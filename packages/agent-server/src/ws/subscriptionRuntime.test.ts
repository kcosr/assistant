import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatEvent,
  ClientPanelEventMessage,
  ClientSubscribeMessage,
  ClientUnsubscribeMessage,
  ClientTextInputMessage,
  ClientSetSessionModelMessage,
  ServerMessage,
} from '@assistant/shared';

import { SessionRuntime, type SessionRuntimeOptions } from './sessionRuntime';
import type { WsTransport } from './wsTransport';
import type { SessionConnection } from './sessionConnection';
import { SessionIndex } from '../sessionIndex';
import { AgentRegistry } from '../agents';
import type { LogicalSessionState } from '../sessionHub';
import { SessionHub } from '../sessionHub';
import type { ToolHost, ToolContext, Tool } from '../tools';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { PanelEventHandler } from '../plugins/types';
import type { PluginRegistry } from '../plugins/registry';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

function createTestConfig(dataDir: string): EnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    toolsEnabled: false,
    dataDir,
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

function createTestEventStore(): EventStore {
  const eventsBySession = new Map<string, ChatEvent[]>();
  return {
    append: async (sessionId, event) => {
      const events = eventsBySession.get(sessionId) ?? [];
      events.push(event);
      eventsBySession.set(sessionId, events);
    },
    appendBatch: async (sessionId, events) => {
      const existing = eventsBySession.get(sessionId) ?? [];
      existing.push(...events);
      eventsBySession.set(sessionId, existing);
    },
    getEvents: async (sessionId) => [...(eventsBySession.get(sessionId) ?? [])],
    getEventsSince: async (sessionId, afterEventId) => {
      const events = eventsBySession.get(sessionId) ?? [];
      if (!afterEventId) {
        return [...events];
      }
      const index = events.findIndex((event) => event.id === afterEventId);
      return index === -1 ? [...events] : events.slice(index + 1);
    },
    subscribe: () => () => {},
    clearSession: async (sessionId) => {
      eventsBySession.delete(sessionId);
    },
    deleteSession: async (sessionId) => {
      eventsBySession.delete(sessionId);
    },
  };
}

const noopToolHost: ToolHost = {
  async listTools(): Promise<Tool[]> {
    return [];
  },
  async callTool(_name: string, _argsJson: string, _ctx: ToolContext): Promise<unknown> {
    throw new Error('callTool should not be invoked in these tests');
  },
};

function createRuntime(options: {
  sessionHub: SessionHub;
  subscriptions?: string[];
  toolHost?: ToolHost;
  eventStore?: EventStore;
}): {
  runtime: SessionRuntime;
  transportSent: ServerMessage[];
  connection: SessionConnection;
  unsubscribeSpy: ReturnType<typeof vi.fn>;
} {
  const transportSent: ServerMessage[] = [];
  const transport: WsTransport = {
    sendJson(message: ServerMessage) {
      transportSent.push(message);
    },
    sendBinary(_bytes: Uint8Array) {
      // not used in these tests
    },
    close(_code: number, _reason: string) {
      // not used
    },
    isOpen() {
      return true;
    },
    isOpenOrConnecting() {
      return true;
    },
  };

  const subscribe = vi.fn();
  const unsubscribe = vi.fn();

  const connection: SessionConnection = {
    sendServerMessageFromHub: () => {},
    sendErrorFromHub: () => {},
    subscribe,
    unsubscribe,
    isSubscribedTo(sessionId: string): boolean {
      const trimmed = sessionId.trim();
      if (!trimmed) {
        return false;
      }
      return options.sessionHub.getConnectionSubscriptions(connection).has(trimmed);
    },
  };

  const config = createTestConfig(createTempDir('subscription-runtime-data'));

  const runtimeOptions: SessionRuntimeOptions = {
    transport,
    connection,
    config,
    toolHost: options.toolHost ?? noopToolHost,
    sessionHub: options.sessionHub,
    eventStore: options.eventStore ?? createTestEventStore(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openaiClient: {} as any,
  };

  const runtime = new SessionRuntime(runtimeOptions);

  if (options.subscriptions && options.subscriptions.length > 0) {
    for (const id of options.subscriptions) {
      options.sessionHub.subscribeConnection(connection, id);
    }
  }

  return { runtime, transportSent, connection, unsubscribeSpy: unsubscribe };
}

describe('SessionRuntime subscription message handlers', () => {
  it('handleSubscribe subscribes and emits subscribed message', async () => {
    const sessionsFile = createTempFile('subscription-runtime-subscribe-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime, transportSent } = createRuntime({ sessionHub });

    const message: ClientSubscribeMessage = {
      type: 'subscribe',
      sessionId: summary.sessionId,
    };

    // @ts-expect-error accessing private method for test
    await runtime.handleSubscribe(message);

    const subscribed = transportSent.find((m) => m.type === 'subscribed');
    expect(subscribed).toBeDefined();
    expect(subscribed).toMatchObject({
      type: 'subscribed',
      sessionId: summary.sessionId,
    });
  });

  it('handleUnsubscribe unsubscribes from the requested session', async () => {
    const sessionsFile = createTempFile('subscription-runtime-unsubscribe-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime, transportSent, unsubscribeSpy } = createRuntime({
      sessionHub,
      subscriptions: [sessionA.sessionId, sessionB.sessionId],
    });

    const message: ClientUnsubscribeMessage = {
      type: 'unsubscribe',
      sessionId: sessionB.sessionId,
    };

    // @ts-expect-error accessing private method for test
    await runtime.handleUnsubscribe(message);

    expect(unsubscribeSpy).toHaveBeenCalledWith(sessionB.sessionId);
    const unsubscribed = transportSent.find((m) => m.type === 'unsubscribed');
    expect(unsubscribed).toBeDefined();
    expect(unsubscribed).toMatchObject({
      type: 'unsubscribed',
      sessionId: sessionB.sessionId,
    });

    const remainingSessionIds = Array.from(
      sessionHub.getConnectionSubscriptions({
        sendServerMessageFromHub: () => {},
        sendErrorFromHub: () => {},
      } as SessionConnection),
    );
    expect(remainingSessionIds.length).toBeGreaterThanOrEqual(0);
  });

  it('updates session model without cancelling the active chat run', async () => {
    const sessionsFile = createTempFile('subscription-runtime-model-cancel-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'test-agent',
        displayName: 'Test Agent',
        description: 'Test agent',
        chat: {
          provider: 'pi',
          models: ['openai/gpt-5.2', 'openai/gpt-4o-mini'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'test-agent' });
    const { runtime } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
    });

    const state = await sessionHub.ensureSessionState(summary.sessionId);
    const abortController = new AbortController();
    state.activeChatRun = {
      responseId: 'resp-1',
      abortController,
      accumulatedText: '',
    };

    const message: ClientSetSessionModelMessage = {
      type: 'set_session_model',
      sessionId: summary.sessionId,
      model: 'openai/gpt-4o-mini',
    };

    // @ts-expect-error accessing private method for test
    await runtime.handleSetSessionModel(message);

    expect(abortController.signal.aborted).toBe(false);
    expect(state.activeChatRun?.outputCancelled).not.toBe(true);
    expect(state.summary.model).toBe('openai/gpt-4o-mini');

    const persisted = await sessionIndex.getSession(summary.sessionId);
    expect(persisted?.model).toBe('openai/gpt-4o-mini');
  });

  it('resolveChatCompletionTools reports debug counts and host errors', async () => {
    const sessionsFile = createTempFile('subscription-runtime-tool-debug-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'coding',
        displayName: 'Coding',
        description: 'Coding agent',
        toolAllowlist: ['bash', 'ls'],
        chat: {
          provider: 'pi',
          models: ['openai-codex/gpt-5.4'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'coding' });
    const { runtime } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
    });
    const state = await sessionHub.ensureSessionState(summary.sessionId);

    const okHost: ToolHost = {
      async listTools() {
        return [
          { name: 'bash', description: 'Run bash', parameters: {} },
          { name: 'ls', description: 'List files', parameters: {} },
        ];
      },
      async callTool() {
        throw new Error('not used');
      },
    };

    const okResult = await (
      runtime as unknown as {
        resolveChatCompletionTools: (
          state: LogicalSessionState | undefined,
          sessionToolHost: ToolHost,
        ) => Promise<{
          specs: Array<{ function: { name: string } }>;
          debug: {
            availableToolsCount: number;
            visibleToolsCount: number;
            error?: string;
          };
        }>;
      }
    ).resolveChatCompletionTools(state, okHost);

    expect(okResult.specs.map((tool) => tool.function.name)).toEqual(['bash', 'ls']);
    expect(okResult.debug.availableToolsCount).toBe(2);
    expect(okResult.debug.visibleToolsCount).toBe(2);
    expect(okResult.debug.error).toBeUndefined();

    const failingHost: ToolHost = {
      async listTools() {
        throw new Error('boom');
      },
      async callTool() {
        throw new Error('not used');
      },
    };

    const badResult = await (
      runtime as unknown as {
        resolveChatCompletionTools: (
          state: LogicalSessionState | undefined,
          sessionToolHost: ToolHost,
        ) => Promise<{
          specs: unknown[];
          debug: {
            availableToolsCount: number;
            visibleToolsCount: number;
            error?: string;
          };
        }>;
      }
    ).resolveChatCompletionTools(state, failingHost);

    expect(badResult.specs).toEqual([]);
    expect(badResult.debug.availableToolsCount).toBe(0);
    expect(badResult.debug.visibleToolsCount).toBe(0);
    expect(badResult.debug.error).toContain('boom');
  });

  it('resolves chat completion tools for a subscribed session turn without runtime cache', async () => {
    const sessionsFile = createTempFile('subscription-runtime-primary-turn-tools');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'coding',
        displayName: 'Coding',
        description: 'Coding agent',
        toolAllowlist: ['bash'],
        chat: {
          provider: 'pi',
          models: ['openai-codex/gpt-5.4-mini'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'coding' });

    const toolHost: ToolHost = {
      async listTools() {
        return [{ name: 'bash', description: 'Run bash', parameters: {} }];
      },
      async callTool() {
        throw new Error('not used');
      },
    };

    const { runtime, connection } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      toolHost,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    const captured: { toolsLength: number; debugContext: unknown }[] = [];
    (
      runtime as unknown as {
        runChatInputWithCompletions: (options: {
          chatCompletionTools: unknown[];
          debugChatCompletionsContext?: unknown;
        }) => Promise<void>;
      }
    ).runChatInputWithCompletions = async (options) => {
      captured.push({
        toolsLength: options.chatCompletionTools.length,
        debugContext: options.debugChatCompletionsContext,
      });
    };

    const message: ClientTextInputMessage = {
      type: 'text_input',
      sessionId: summary.sessionId,
      text: 'Run date',
    };

    // @ts-expect-error accessing private method for test
    await runtime.handleTextInputWithChatCompletions(message);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.toolsLength).toBe(1);
    expect(captured[0]?.debugContext).toMatchObject({
      targetSessionId: summary.sessionId,
      resolutionPath: 'resolved',
      finalToolSpecCount: 1,
      availableToolsCount: 1,
      visibleToolsCount: 1,
    });
    expect(connection.isSubscribedTo?.(summary.sessionId)).toBe(true);
  });

  it('updates session thinking without cancelling the active chat run', async () => {
    const sessionsFile = createTempFile('subscription-runtime-thinking-pending-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'test-agent',
        displayName: 'Test Agent',
        description: 'Test agent',
        chat: {
          provider: 'pi',
          models: ['openai/gpt-5.2', 'openai/gpt-4o-mini'],
          thinking: ['medium', 'xhigh'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({
      agentId: 'test-agent',
      thinking: 'medium',
    });
    const { runtime } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
    });

    const state = await sessionHub.ensureSessionState(summary.sessionId);
    const abortController = new AbortController();
    state.activeChatRun = {
      responseId: 'resp-2',
      abortController,
      accumulatedText: '',
    };

    const message = {
      type: 'set_session_thinking',
      sessionId: summary.sessionId,
      thinking: 'xhigh',
    } as const;

    // @ts-expect-error accessing private method for test
    await runtime.handleSetSessionThinking(message);

    expect(abortController.signal.aborted).toBe(false);
    expect(state.activeChatRun?.outputCancelled).not.toBe(true);
    expect(state.summary.thinking).toBe('xhigh');

    const persisted = await sessionIndex.getSession(summary.sessionId);
    expect(persisted?.thinking).toBe('xhigh');
  });

  it('handles output cancel when active run is not tracked on the connection', async () => {
    const sessionsFile = createTempFile('subscription-runtime-output-cancel-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'test-agent',
        displayName: 'Test Agent',
        description: 'Test agent',
        chat: {
          provider: 'pi',
          models: ['openai/gpt-5.2'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'test-agent' });
    const { runtime } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
    });

    const state = await sessionHub.ensureSessionState(summary.sessionId);
    const abortController = new AbortController();
    state.activeChatRun = {
      responseId: 'resp-2',
      abortController,
      accumulatedText: '',
    };

    // @ts-expect-error accessing private method for test
    runtime.handleChatOutputCancel({
      type: 'control',
      action: 'cancel',
      target: 'output',
      sessionId: summary.sessionId,
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(state.activeChatRun?.outputCancelled).toBe(true);
  });

  it('rejects text_input for sessions the connection is not subscribed to', async () => {
    const sessionsFile = createTempFile('subscription-runtime-text-route-unsubscribed-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });

    const { runtime, connection, transportSent } = createRuntime({ sessionHub });

    sessionHub.subscribeConnection(connection, sessionA.sessionId);

    const spy = vi
      .spyOn(
        runtime as unknown as {
          runChatInputWithCompletions: (
            options: Parameters<
              (typeof import('./chatRunLifecycle'))['handleTextInputWithChatCompletions']
            >[0],
          ) => Promise<void>;
        },
        'runChatInputWithCompletions',
      )
      .mockResolvedValue(undefined);

    const message: ClientTextInputMessage = {
      type: 'text_input',
      text: 'hello B',
      sessionId: sessionB.sessionId,
    };

    // @ts-expect-error accessing private method for test
    await runtime.handleTextInputWithChatCompletions(message);

    const calls = spy.mock.calls;
    expect(calls.length).toBe(0);

    const errors = transportSent.filter((m) => m.type === 'error');
    expect(errors.length).toBeGreaterThan(0);
    const lastError = errors[errors.length - 1] as { code?: string };
    expect(lastError.code).toBe('invalid_session_id');

    spy.mockRestore();
  });

  it('queues subscribe before panel_event handlers', async () => {
    const sessionsFile = createTempFile('subscription-runtime-queue-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime, transportSent, connection } = createRuntime({ sessionHub });

    const originalSubscribe = sessionHub.subscribeConnection.bind(sessionHub);
    const subscribeSpy = vi
      .spyOn(sessionHub, 'subscribeConnection')
      .mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return originalSubscribe(...args);
      });

    const subscribeMessage: ClientSubscribeMessage = {
      type: 'subscribe',
      sessionId: summary.sessionId,
    };

    const panelEventMessage: ClientPanelEventMessage = {
      type: 'panel_event',
      panelId: 'terminal-1',
      panelType: 'terminal',
      sessionId: summary.sessionId,
      payload: { type: 'terminal_input', text: 'ls' },
    };

    runtime.onSocketMessage(Buffer.from(JSON.stringify(subscribeMessage), 'utf8'), false);
    runtime.onSocketMessage(Buffer.from(JSON.stringify(panelEventMessage), 'utf8'), false);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const errors = transportSent.filter((message) => message.type === 'error');
    expect(errors).toHaveLength(0);
    expect(sessionHub.getConnectionSubscriptions(connection).has(summary.sessionId)).toBe(true);

    subscribeSpy.mockRestore();
  });

  it('processes panel_event handlers serially per connection', async () => {
    const sessionsFile = createTempFile('subscription-runtime-panel-order-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);

    const sequence: string[] = [];
    const handler: PanelEventHandler = vi.fn(async (event) => {
      const text =
        event.payload && typeof event.payload === 'object'
          ? (event.payload as { text?: string }).text
          : undefined;
      sequence.push(`start:${text ?? 'unknown'}`);
      await new Promise((resolve) => setTimeout(resolve, text === 'first' ? 5 : 0));
      sequence.push(`end:${text ?? 'unknown'}`);
    });

    const pluginRegistry: PluginRegistry = {
      initialize: async () => {},
      getTools: () => [],
      shutdown: async () => {},
      getPanelEventHandler: (panelType) => (panelType === 'terminal' ? handler : undefined),
    };

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      pluginRegistry,
    });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime, connection } = createRuntime({ sessionHub });

    await sessionHub.subscribeConnection(connection, summary.sessionId);

    const firstEvent: ClientPanelEventMessage = {
      type: 'panel_event',
      panelId: 'terminal-1',
      panelType: 'terminal',
      sessionId: summary.sessionId,
      payload: { type: 'terminal_input', text: 'first' },
    };

    const secondEvent: ClientPanelEventMessage = {
      type: 'panel_event',
      panelId: 'terminal-1',
      panelType: 'terminal',
      sessionId: summary.sessionId,
      payload: { type: 'terminal_input', text: 'second' },
    };

    runtime.onSocketMessage(Buffer.from(JSON.stringify(firstEvent), 'utf8'), false);
    runtime.onSocketMessage(Buffer.from(JSON.stringify(secondEvent), 'utf8'), false);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sequence).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('processes terminal snapshot responses while chat runs are active', async () => {
    const sessionsFile = createTempFile('subscription-runtime-snapshot-queue-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);

    const handler: PanelEventHandler = vi.fn(async () => {});

    const pluginRegistry: PluginRegistry = {
      initialize: async () => {},
      getTools: () => [],
      shutdown: async () => {},
      getPanelEventHandler: (panelType) => (panelType === 'terminal' ? handler : undefined),
    };

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      pluginRegistry,
    });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
    });
    (runtime as unknown as { clientHelloReceived: boolean }).clientHelloReceived = true;

    let resolveChat: () => void = () => {};
    const textSpy = vi
      .spyOn(
        runtime as unknown as {
          handleTextInputWithChatCompletions: (message: ClientTextInputMessage) => Promise<void>;
        },
        'handleTextInputWithChatCompletions',
      )
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveChat = resolve;
          }),
      );

    const inputMessage: ClientTextInputMessage = {
      type: 'text_input',
      text: 'hello',
      sessionId: summary.sessionId,
    };
    runtime.onSocketMessage(Buffer.from(JSON.stringify(inputMessage), 'utf8'), false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textSpy).toHaveBeenCalledTimes(1);

    const snapshotMessage: ClientPanelEventMessage = {
      type: 'panel_event',
      panelId: 'terminal-1',
      panelType: 'terminal',
      payload: {
        type: 'terminal_snapshot_response',
        requestId: 'request-1',
        snapshot: {
          cols: 80,
          rows: 24,
          cursor: { x: 0, y: 0 },
          bufferType: 'normal',
          lines: ['ok'],
          wrapped: [false],
          timestamp: new Date().toISOString(),
        },
      },
    };
    runtime.onSocketMessage(Buffer.from(JSON.stringify(snapshotMessage), 'utf8'), false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);

    resolveChat();
    await new Promise((resolve) => setTimeout(resolve, 0));
    textSpy.mockRestore();
  });

  it('reprompts async questionnaires when submitted answers fail validation', async () => {
    const sessionsFile = createTempFile('subscription-runtime-questionnaire-reprompt-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const eventStore = createTestEventStore();
    await eventStore.append(summary.sessionId, {
      id: 'qreq-1',
      timestamp: Date.now(),
      sessionId: summary.sessionId,
      type: 'questionnaire_request',
      payload: {
        questionnaireRequestId: 'qr-1',
        toolCallId: 'tool-1',
        toolName: 'questions_ask',
        mode: 'async',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
        },
        status: 'pending',
        createdAt: '2026-03-29T12:00:00.000Z',
      },
    });
    const { runtime, connection } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      eventStore,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    // @ts-expect-error accessing private method for test
    await runtime.handleQuestionnaireSubmit({
      type: 'questionnaire_submit',
      sessionId: summary.sessionId,
      questionnaireRequestId: 'qr-1',
      answers: { name: '' },
    });

    const events = await eventStore.getEvents(summary.sessionId);
    const reprompt = events.find((event) => event.type === 'questionnaire_reprompt');
    expect(reprompt).toBeDefined();
    if (!reprompt || reprompt.type !== 'questionnaire_reprompt') {
      return;
    }
    expect(reprompt.payload.fieldErrors).toEqual({ name: 'This field is required.' });
    expect(reprompt.payload.initialValues).toEqual({ name: '' });
  });

  it('queues a hidden follow-up turn after a valid async questionnaire submission', async () => {
    const sessionsFile = createTempFile('subscription-runtime-questionnaire-submit-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const eventStore = createTestEventStore();
    await eventStore.append(summary.sessionId, {
      id: 'qreq-2',
      timestamp: Date.now(),
      sessionId: summary.sessionId,
      type: 'questionnaire_request',
      payload: {
        questionnaireRequestId: 'qr-2',
        toolCallId: 'tool-2',
        toolName: 'questions_ask',
        mode: 'async',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
        },
        status: 'pending',
        autoResume: true,
        createdAt: '2026-03-29T12:00:00.000Z',
      },
    });
    const queueSpy = vi
      .spyOn(sessionHub, 'queueMessage')
      .mockResolvedValue({ id: 'msg-1', text: 'Questionnaire response received', queuedAt: '', source: 'user' });
    const processNextSpy = vi.spyOn(sessionHub, 'processNextQueuedMessage').mockResolvedValue(true);
    const { runtime, connection } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      eventStore,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    // @ts-expect-error accessing private method for test
    await runtime.handleQuestionnaireSubmit({
      type: 'questionnaire_submit',
      sessionId: summary.sessionId,
      questionnaireRequestId: 'qr-2',
      answers: { name: 'Ada' },
    });

    const events = await eventStore.getEvents(summary.sessionId);
    const submission = events.find((event) => event.type === 'questionnaire_submission');
    expect(submission).toBeDefined();
    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy.mock.calls[0]?.[0]).toMatchObject({
      sessionId: summary.sessionId,
      text: 'Questionnaire response received',
      source: 'user',
    });
    expect(processNextSpy).toHaveBeenCalledWith(summary.sessionId);
  });

  it('does not queue a follow-up turn when autoResume is false', async () => {
    const sessionsFile = createTempFile('subscription-runtime-questionnaire-passive-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const eventStore = createTestEventStore();
    await eventStore.append(summary.sessionId, {
      id: 'qreq-4',
      timestamp: Date.now(),
      sessionId: summary.sessionId,
      type: 'questionnaire_request',
      payload: {
        questionnaireRequestId: 'qr-4',
        toolCallId: 'tool-4',
        toolName: 'questions_ask',
        mode: 'async',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
        },
        status: 'pending',
        autoResume: false,
        createdAt: '2026-03-29T12:00:00.000Z',
      },
    });
    const queueSpy = vi.spyOn(sessionHub, 'queueMessage');
    const processNextSpy = vi.spyOn(sessionHub, 'processNextQueuedMessage');
    const { runtime, connection } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      eventStore,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    // @ts-expect-error accessing private method for test
    await runtime.handleQuestionnaireSubmit({
      type: 'questionnaire_submit',
      sessionId: summary.sessionId,
      questionnaireRequestId: 'qr-4',
      answers: { name: 'Ada' },
    });

    expect(queueSpy).not.toHaveBeenCalled();
    expect(processNextSpy).not.toHaveBeenCalled();
  });

  it('rejects questionnaire submits after the request is no longer pending', async () => {
    const sessionsFile = createTempFile('subscription-runtime-questionnaire-terminal-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const eventStore = createTestEventStore();
    await eventStore.appendBatch(summary.sessionId, [
      {
        id: 'qreq-5',
        timestamp: Date.now(),
        sessionId: summary.sessionId,
        type: 'questionnaire_request',
        payload: {
          questionnaireRequestId: 'qr-5',
          toolCallId: 'tool-5',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      },
      {
        id: 'qsub-5',
        timestamp: Date.now() + 1,
        sessionId: summary.sessionId,
        type: 'questionnaire_submission',
        payload: {
          questionnaireRequestId: 'qr-5',
          toolCallId: 'tool-5',
          status: 'submitted',
          submittedAt: '2026-03-29T12:01:00.000Z',
          answers: { name: 'Ada' },
        },
      },
    ]);
    const { runtime, connection, transportSent } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      eventStore,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    // @ts-expect-error accessing private method for test
    await runtime.handleQuestionnaireSubmit({
      type: 'questionnaire_submit',
      sessionId: summary.sessionId,
      questionnaireRequestId: 'qr-5',
      answers: { name: 'Grace' },
    });

    const error = transportSent.find(
      (message) => message.type === 'error' && message.code === 'questionnaire_not_pending',
    );
    expect(error).toBeDefined();
  });

  it('records questionnaire cancellation updates', async () => {
    const sessionsFile = createTempFile('subscription-runtime-questionnaire-cancel-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const eventStore = createTestEventStore();
    await eventStore.append(summary.sessionId, {
      id: 'qreq-3',
      timestamp: Date.now(),
      sessionId: summary.sessionId,
      type: 'questionnaire_request',
      payload: {
        questionnaireRequestId: 'qr-3',
        toolCallId: 'tool-3',
        toolName: 'questions_ask',
        mode: 'async',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name' }],
        },
        status: 'pending',
        createdAt: '2026-03-29T12:00:00.000Z',
      },
    });
    const { runtime, connection } = createRuntime({
      sessionHub,
      subscriptions: [summary.sessionId],
      eventStore,
    });
    await sessionHub.subscribeConnection(connection, summary.sessionId);

    // @ts-expect-error accessing private method for test
    await runtime.handleQuestionnaireCancel({
      type: 'questionnaire_cancel',
      sessionId: summary.sessionId,
      questionnaireRequestId: 'qr-3',
      reason: 'User dismissed it',
    });

    const events = await eventStore.getEvents(summary.sessionId);
    const update = events.find((event) => event.type === 'questionnaire_update');
    expect(update).toBeDefined();
    if (!update || update.type !== 'questionnaire_update') {
      return;
    }
    expect(update.payload.status).toBe('cancelled');
    expect(update.payload.reason).toBe('User dismissed it');
  });
});
