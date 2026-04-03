import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@assistant/shared';

import type { AgentTool, ToolHost } from '../tools';
import type { LogicalSessionState } from '../sessionHub';
import { handleChatToolCalls } from './toolCallHandling';

describe('handleChatToolCalls', () => {
  it('executes resolved native agent tools directly before falling back to ToolHost.callTool', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'native-result' }],
      details: { ok: true },
    }));
    const nativeTool: AgentTool = {
      name: 'write',
      label: 'Write',
      description: 'Write a file',
      parameters: {},
      execute,
    };
    const callTool = vi.fn(async () => {
      throw new Error('legacy host path should not be used');
    });
    const sessionToolHost: ToolHost = {
      listTools: async () => [],
      listAgentTools: async () => [],
      callTool,
    };

    const state: LogicalSessionState = {
      summary: {
        sessionId: 'session-1',
        agentId: 'pi-agent',
        createdAt: '',
        updatedAt: '',
      },
      chatMessages: [],
      messageQueue: [],
      activeChatRun: {
        requestId: 'request-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        abortController: new AbortController(),
        accumulatedText: '',
      },
    };

    const broadcasts: unknown[] = [];
    await handleChatToolCalls({
      sessionId: 'session-1',
      state,
      toolCalls: [
        {
          id: 'tool-call-1',
          name: 'write',
          argumentsJson: '{"path":"note.txt","content":"hello"}',
        },
      ],
      baseToolHost: sessionToolHost,
      sessionToolHost,
      agentTools: [nativeTool],
      sessionHub: {
        broadcastToSession: (_sessionId: string, message: ServerMessage) => {
          broadcasts.push(message);
        },
        getInteractionAvailability: () => ({
          supportedCount: 0,
          enabledCount: 0,
          available: false,
        }),
        getAgentRegistry: () => ({}) as never,
        getSessionIndex: () => ({}) as never,
      } as never,
      envConfig: {
        maxToolCallsPerMinute: 10,
      } as never,
      maxToolCallsPerMinute: 10,
      rateLimitWindowMs: 60_000,
      sendError: () => undefined,
      log: () => undefined,
    });

    expect(execute).toHaveBeenCalledWith(
      'tool-call-1',
      { path: 'note.txt', content: 'hello' },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(callTool).not.toHaveBeenCalled();
    expect(broadcasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_call_start', toolName: 'write' }),
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'write',
          ok: true,
          result: { content: [{ type: 'text', text: 'native-result' }], details: { ok: true } },
        }),
      ]),
    );
  });
});
