import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ServerMessage } from '@assistant/shared';

import { CodingToolHost, type AgentTool, type ToolHost } from '../tools';
import type { LogicalSessionState } from '../sessionHub';
import { handleChatToolCalls } from './toolCallHandling';

describe('handleChatToolCalls', () => {
  it.each(['native', 'host'] as const)(
    'preserves native Bash failures and structured output through the %s execution path',
    async (executionPath) => {
      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-bash-result-'));
      try {
        const host = new CodingToolHost({ dataDir });
        const state: LogicalSessionState = {
          summary: { sessionId: 'session-1', agentId: 'agent', createdAt: '', updatedAt: '' },
          chatMessages: [],
          messageQueue: [],
        };
        const broadcasts: ServerMessage[] = [];
        await handleChatToolCalls({
          sessionId: 'session-1',
          state,
          toolCalls: [
            {
              id: 'bash-failure',
              name: 'bash',
              argumentsJson: JSON.stringify({ command: 'printf "command output"; exit 7' }),
            },
          ],
          baseToolHost: host,
          sessionToolHost: host,
          agentTools:
            executionPath === 'native'
              ? await host.listAgentTools({
                  sessionId: 'session-1',
                  signal: new AbortController().signal,
                })
              : [],
          sessionHub: {
            getSessionState: () => state,
            broadcastToSession: (_sessionId: string, message: ServerMessage) => {
              broadcasts.push(message);
            },
            getInteractionAvailability: () => ({
              supportedCount: 0,
              enabledCount: 0,
              available: false,
            }),
            getAgentRegistry: () => ({ getAgent: () => undefined }) as never,
            getSessionIndex: () => ({}) as never,
          } as never,
          envConfig: { maxToolCallsPerMinute: 10 } as never,
          maxToolCallsPerMinute: 10,
          rateLimitWindowMs: 60_000,
          sendError: () => undefined,
          log: () => undefined,
        });

        const expectedResult = {
          ok: false,
          result: {
            isError: true,
            content: [{ type: 'text', text: expect.stringContaining('command output') }],
            structuredContent: { exit_code: 7, output: 'command output' },
          },
          error: {
            code: 'tool_error',
            message: expect.stringContaining('Command exited with code 7'),
          },
        };
        expect(broadcasts.find((message) => message.type === 'tool_result')).toMatchObject({
          type: 'tool_result',
          toolName: 'bash',
          ...expectedResult,
        });
        const toolMessage = state.chatMessages.find((message) => message.role === 'tool');
        expect(toolMessage).toBeDefined();
        expect(JSON.parse(toolMessage!.content as string)).toMatchObject(expectedResult);
      } finally {
        await fs.rm(dataDir, { recursive: true, force: true });
      }
    },
    15_000,
  );

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
