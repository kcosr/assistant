// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ClientControlMessage, ServerMessage } from '@assistant/shared';

import { handleChatOutputCancel } from './chatOutputCancelHandling';
import type { ConversationStore } from '../conversationStore';
import type { LogicalSessionState, SessionHub } from '../sessionHub';

describe('handleChatOutputCancel', () => {
  it('logs interrupted assistant message and tool results for active tool calls', async () => {
    const sessionId = 'session-1';
    const responseId = 'resp-1';

    const logAssistantMessage = vi.fn(
      async (_record: Parameters<ConversationStore['logAssistantMessage']>[0]) => undefined,
    );
    const logToolResult = vi.fn(
      async (_record: Parameters<ConversationStore['logToolResult']>[0]) => undefined,
    );
    const logOutputCancelled = vi.fn(
      async (_record: Parameters<ConversationStore['logOutputCancelled']>[0]) => undefined,
    );

    const conversationStore = {
      logAssistantMessage,
      logToolResult,
      logOutputCancelled,
    } as unknown as ConversationStore;

    const broadcastMessages: ServerMessage[] = [];
    const recordSessionActivity = vi.fn(async () => undefined);

    const sessionHub = {
      broadcastToSession: (_id: string, message: ServerMessage) => {
        broadcastMessages.push(message);
      },
      recordSessionActivity,
    } as unknown as SessionHub;

    const abortController = new AbortController();

    const state: LogicalSessionState = {
      summary: {
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId,
        abortController,
        accumulatedText: 'Partial answer',
        activeToolCalls: new Map([
          [
            'call-1',
            {
              callId: 'call-1',
              toolName: 'bash',
              argsJson: '{"command":"ls"}',
            },
          ],
          [
            'call-2',
            {
              callId: 'call-2',
              toolName: 'read',
              argsJson: '{"path":"foo.txt"}',
            },
          ],
        ]),
      },
      messageQueue: [],
    };

    const message: ClientControlMessage = {
      type: 'control',
      action: 'cancel',
      target: 'output',
      audioEndMs: 1234,
    };

    handleChatOutputCancel({
      message,
      activeRunState: { sessionId, state },
      conversationStore,
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
    });

    expect(abortController.signal.aborted).toBe(true);

    expect(logAssistantMessage).toHaveBeenCalledTimes(1);
    const assistantRecord = logAssistantMessage.mock.calls[0]?.[0];
    expect(assistantRecord).toBeDefined();
    if (!assistantRecord) {
      throw new Error('expected assistant record to be defined');
    }
    expect(assistantRecord.sessionId).toBe(sessionId);
    expect(assistantRecord.responseId).toBe(responseId);
    expect(assistantRecord.text).toBe('Partial answer');
    expect(assistantRecord.interrupted).toBe(true);

    expect(logToolResult).toHaveBeenCalledTimes(2);
    const toolRecords = logToolResult.mock.calls
      .map((call) => call[0])
      .filter((r): r is Parameters<ConversationStore['logToolResult']>[0] => !!r);
    const callIds = toolRecords.map((r) => r.callId).sort();
    expect(callIds).toEqual(['call-1', 'call-2']);
    for (const record of toolRecords) {
      expect(record.sessionId).toBe(sessionId);
      expect(record.ok).toBe(false);
      expect(record.error).toEqual({
        code: 'tool_interrupted',
        message: 'Tool call was interrupted by the user',
      });
    }

    const toolResultMessages = broadcastMessages.filter((m) => m.type === 'tool_result') as Array<
      Extract<ServerMessage, { type: 'tool_result' }>
    >;
    expect(toolResultMessages).toHaveLength(2);
    const messageCallIds = toolResultMessages.map((m) => m.callId).sort();
    expect(messageCallIds).toEqual(['call-1', 'call-2']);
    for (const m of toolResultMessages) {
      expect(m.ok).toBe(false);
      expect(m.error).toEqual({
        code: 'tool_interrupted',
        message: 'Tool call was interrupted by the user',
      });
    }

    expect(state.activeChatRun?.activeToolCalls?.size).toBe(0);

    expect(logOutputCancelled).toHaveBeenCalledTimes(1);
    const cancelledRecord = logOutputCancelled.mock.calls[0]?.[0];
    expect(cancelledRecord).toBeDefined();
    if (!cancelledRecord) {
      throw new Error('expected output_cancelled record to be defined');
    }
    expect(cancelledRecord.sessionId).toBe(sessionId);
    expect(cancelledRecord.responseId).toBe(responseId);
  });
});
