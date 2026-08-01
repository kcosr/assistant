import { describe, expect, it, vi } from 'vitest';

import type { SessionHub } from './sessionHub';
import type { AgentTool, ToolContext } from './tools/types';
import { InteractionRegistry } from './ws/interactionRegistry';
import {
  applyToolApprovalPolicy,
  formatToolApprovalPrompt,
  toolRequiresApproval,
} from './toolApprovalPolicy';

function createHarness(options: { available?: boolean } = {}) {
  const registry = new InteractionRegistry();
  const broadcastToSession = vi.fn();
  const sessionHub = {
    getInteractionAvailability: () => ({
      supportedCount: options.available === false ? 0 : 1,
      enabledCount: options.available === false ? 0 : 1,
      available: options.available !== false,
    }),
    getInteractionRegistry: () => registry,
    getSessionState: () => ({
      summary: { sessionId: 'session-1', agentId: 'assistant', revision: 0 },
      activeChatRun: {
        turnId: 'turn-1',
        requestId: 'request-1',
        responseId: 'response-1',
      },
    }),
    getAgentRegistry: () => ({ getAgent: () => ({ chat: { provider: 'pi' } }) }),
    broadcastToSession,
  } as unknown as SessionHub;
  const context: ToolContext = {
    signal: new AbortController().signal,
    sessionId: 'session-1',
    sessionHub,
  };
  const execute = vi.fn(async () => ({
    content: [{ type: 'text', text: 'done' }],
    details: { ok: true },
  }));
  const tool: AgentTool = {
    name: 'bash',
    label: 'Bash',
    description: 'Run a command',
    parameters: { type: 'object' },
    execute,
  };
  const [wrapped] = applyToolApprovalPolicy({
    tools: [tool],
    required: ['bash'],
    context,
  });
  if (!wrapped) {
    throw new Error('Expected wrapped tool');
  }
  return { registry, broadcastToSession, execute, wrapped };
}

function getInteractionRequest(broadcastToSession: ReturnType<typeof vi.fn>): {
  interactionId: string;
} {
  for (const call of broadcastToSession.mock.calls) {
    const message = call[1] as {
      type?: string;
      event?: { chatEventType?: string; payload?: { interactionId?: string } };
    };
    if (
      message.type === 'transcript_event' &&
      message.event?.chatEventType === 'interaction_request'
    ) {
      const interactionId = message.event.payload?.interactionId;
      if (interactionId) {
        return { interactionId };
      }
    }
  }
  throw new Error('Expected an interaction request');
}

describe('tool approval policy', () => {
  it('matches exact names and globs', () => {
    expect(toolRequiresApproval('read', ['read'])).toBe(true);
    expect(toolRequiresApproval('notes_write', ['*_write'])).toBe(true);
    expect(toolRequiresApproval('find', ['read', '*_write'])).toBe(false);
  });

  it('formats concise prompts for common argument shapes', () => {
    expect(formatToolApprovalPrompt('bash', { command: 'npm test' })).toBe(
      'Run command?\nnpm test',
    );
    expect(formatToolApprovalPrompt('read', { path: '/tmp/file.txt' })).toBe(
      'Allow read for /tmp/file.txt?',
    );
    expect(formatToolApprovalPrompt('custom', { secret: 'not echoed' })).toBe('Allow custom?');
  });

  it('blocks execution until the user approves', async () => {
    const { registry, broadcastToSession, execute, wrapped } = createHarness();
    const resultPromise = wrapped.execute('call-1', { command: 'npm test' });

    await vi.waitFor(() => expect(broadcastToSession).toHaveBeenCalled());
    expect(execute).not.toHaveBeenCalled();
    const { interactionId } = getInteractionRequest(broadcastToSession);
    expect(
      registry.resolveResponse({
        sessionId: 'session-1',
        callId: 'call-1',
        interactionId,
        response: { action: 'approve', approvalScope: 'once' },
      }),
    ).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({ details: { ok: true } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not execute a denied tool', async () => {
    const { registry, broadcastToSession, execute, wrapped } = createHarness();
    const resultPromise = wrapped.execute('call-2', { command: 'rm file' });

    await vi.waitFor(() => expect(broadcastToSession).toHaveBeenCalled());
    const { interactionId } = getInteractionRequest(broadcastToSession);
    registry.resolveResponse({
      sessionId: 'session-1',
      callId: 'call-2',
      interactionId,
      response: { action: 'deny' },
    });

    await expect(resultPromise).rejects.toMatchObject({ code: 'tool_denied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when no interactive client is available', async () => {
    const { execute, wrapped } = createHarness({ available: false });

    await expect(wrapped.execute('call-3', { command: 'pwd' })).rejects.toMatchObject({
      code: 'interaction_unavailable',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels a pending approval with the chat run', async () => {
    const { broadcastToSession, execute, wrapped } = createHarness();
    const controller = new AbortController();
    const resultPromise = wrapped.execute('call-4', { command: 'sleep 10' }, controller.signal);

    await vi.waitFor(() => expect(broadcastToSession).toHaveBeenCalled());
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ code: 'tool_aborted' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('leaves tools that do not match the policy unchanged', async () => {
    const execute = vi.fn(async () => ({ content: [], details: null }));
    const tool: AgentTool = {
      name: 'read',
      label: 'Read',
      description: 'Read a file',
      parameters: { type: 'object' },
      execute,
    };
    const [result] = applyToolApprovalPolicy({
      tools: [tool],
      required: ['bash', '*_write'],
      context: {
        signal: new AbortController().signal,
        sessionId: 'session-1',
      },
    });

    expect(result).toBe(tool);
    await result?.execute('call-5', { path: '/tmp/file.txt' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
