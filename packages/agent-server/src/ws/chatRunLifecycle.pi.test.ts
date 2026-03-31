import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { LogicalSessionState, SessionHub } from '../sessionHub';

vi.mock('../llm/piSdkProvider', async () => {
  const actual = await vi.importActual<typeof import('../llm/piSdkProvider')>('../llm/piSdkProvider');
  return {
    ...actual,
    resolvePiSdkModel: vi.fn(),
    runPiSdkChatCompletionIteration: vi.fn(),
  };
});

vi.mock('../llm/piAgentAuth', () => ({
  resolvePiAgentAuthApiKey: vi.fn(async () => undefined),
}));

import { handleTextInputWithChatCompletions } from './chatRunLifecycle';
import { resolvePiSdkModel, runPiSdkChatCompletionIteration } from '../llm/piSdkProvider';

function createTestEventStore(): EventStore {
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
}

function createEnvConfig(): EnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    toolsEnabled: false,
    dataDir: '/tmp/assistant-tests',
    audioInputMode: 'manual',
    audioSampleRate: 24000,
    audioTranscriptionEnabled: false,
    audioOutputVoice: undefined,
    audioOutputSpeed: undefined,
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: undefined,
    ttsFrameDurationMs: 250,
    ttsBackend: 'openai',
    elevenLabsApiKey: undefined,
    elevenLabsVoiceId: undefined,
    elevenLabsModelId: undefined,
    elevenLabsBaseUrl: undefined,
    maxMessagesPerMinute: 60,
    maxAudioBytesPerMinute: 2_000_000,
    maxToolCallsPerMinute: 30,
    debugChatCompletions: false,
    debugHttpRequests: false,
  };
}

function encodePiCwd(cwd: string): string {
  const stripped = cwd.replace(/^[/\\]/, '');
  return `--${stripped.replace(/[\\/:]/g, '-')}--`;
}

describe('handleTextInputWithChatCompletions (pi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the canonical Pi transcript for replay and records only the final answer text', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-replay-'));
    const baseDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', encodePiCwd(cwd));
    await fs.mkdir(baseDir, { recursive: true });
    const piSessionId = 'pi-session-1';
    const sessionPath = path.join(baseDir, `2026-03-26T00-00-00-000Z_${piSessionId}.jsonl`);
    const rawPiSession = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: piSessionId,
        timestamp: '2026-03-26T00:00:00.000Z',
        cwd,
      }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-03-26T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Earlier request' }],
          timestamp: 1,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-03-26T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Working on it',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'text',
              text: 'Stored final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 2,
        },
      }),
    ].join('\n');
    await fs.writeFile(sessionPath, rawPiSession, 'utf8');

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const broadcast: ServerMessage[] = [];
    const recordSessionActivity = vi.fn(async () => undefined);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {
          providers: {
            pi: {
              sessionId: piSessionId,
              cwd,
            },
          },
        },
      },
      chatMessages: [
        { role: 'system', content: 'System prompt' },
        { role: 'assistant', content: 'polluted to=lists_items_list ...' },
      ],
    } as unknown as LogicalSessionState;

    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    let replayMessagesAtCall:
      | Array<{
          role: string;
          content?: string;
          piSdkMessage?: unknown;
        }>
      | undefined;

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      replayMessagesAtCall = options.messages.map((message) => structuredClone(message));
      return {
        text: 'Working on itStored final answer',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Working on it',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'text',
              text: 'Stored final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      };
    });

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(runPiSdkChatCompletionIteration).toHaveBeenCalledTimes(1);
    expect(replayMessagesAtCall).toMatchObject([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Earlier request' },
      {
        role: 'assistant',
        content: 'Stored final answer',
        piSdkMessage: {
          role: 'assistant',
          provider: 'openai-codex',
        },
      },
      { role: 'user', content: 'Current request' },
    ]);
    expect(
      replayMessagesAtCall?.some(
        (message) =>
          message.role === 'assistant' &&
          typeof message.content === 'string' &&
          message.content.includes('polluted'),
      ),
    ).toBe(false);

    const textDone = broadcast.find((message) => message.type === 'text_done') as
      | { text?: string }
      | undefined;
    expect(textDone?.text).toBe('Stored final answer');
    expect(recordSessionActivity).toHaveBeenCalledWith('s1', 'Stored final answer');
    expect(state.chatMessages).toMatchObject([
      { role: 'system', content: 'System prompt' },
      { role: 'assistant', content: 'polluted to=lists_items_list ...' },
      { role: 'user', content: 'Current request' },
      { role: 'assistant', content: 'Stored final answer' },
    ]);
    expect(
      state.chatMessages.some(
        (message) => message.role === 'user' && message.content === 'Earlier request',
      ),
    ).toBe(false);
    expect(state.chatMessages[state.chatMessages.length - 1]).toMatchObject({
      role: 'assistant',
      content: 'Stored final answer',
    });
  });

  it('does not duplicate the final assistant in Pi sync when replay messages alias state', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const syncedMessages: Array<{
      role: string;
      content?: string;
      piSdkMessage?: unknown;
    }> = [];

    const piSessionWriter = {
      sync: vi.fn(async (options: { messages: Array<{ role: string; content?: string; piSdkMessage?: unknown }> }) => {
        syncedMessages.push(...options.messages);
        return undefined;
      }),
    };

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => piSessionWriter as never,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    let capturedFirstIterationMessages: Array<{ role: string; content?: string | undefined }> | undefined;

    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration)
      .mockImplementationOnce(async (options) => {
        capturedFirstIterationMessages = options.messages.map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : undefined,
        }));
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'bash',
              argumentsJson: '{"command":"pwd"}',
            },
          ],
          aborted: false,
          assistantMessage: {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pwd' } },
            ],
            api: 'openai-responses',
            provider: 'openai-codex',
            model: 'gpt-5.4',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'toolUse',
            timestamp: Date.now(),
          } as never,
        };
      })
      .mockImplementationOnce(async () => ({
        text: 'done',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'done',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      }));

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async (_sessionId, stateArg) => {
        stateArg.chatMessages.push({
          role: 'tool',
          tool_call_id: 'call-1',
          content: '{"ok":true}',
        });
      },
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(capturedFirstIterationMessages).toEqual([{ role: 'user', content: 'Current request' }]);
    expect(piSessionWriter.sync).toHaveBeenCalledTimes(1);
    const assistantMessages = syncedMessages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toMatchObject({ content: '' });
    expect(assistantMessages[1]).toMatchObject({ content: 'done' });
  });

  it('surfaces PI timeouts as backend errors and closes the turn durably', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => ({
      text: '',
      toolCalls: [],
      aborted: true,
      abortReason: 'timeout',
      assistantMessage: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'aborted',
        timestamp: Date.now(),
      } as never,
    }));

    const events: ChatEvent[] = [];
    const eventStore: EventStore = {
      append: async (_sessionId, event) => {
        events.push(event);
      },
      appendBatch: async (_sessionId, batch) => {
        events.push(...batch);
      },
      getEvents: async () => events,
      getEventsSince: async () => events,
      subscribe: () => () => {},
      clearSession: async () => {},
      deleteSession: async () => {},
    };

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError,
      log: () => undefined,
      eventStore,
    });

    expect(sendError).toHaveBeenCalledWith(
      'upstream_timeout',
      'Chat backend request timed out',
      undefined,
      { retryable: true },
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['error', 'interrupt', 'turn_end']),
    );
    expect(events.find((event) => event.type === 'interrupt')).toMatchObject({
      payload: { reason: 'timeout' },
    });
  });
});
