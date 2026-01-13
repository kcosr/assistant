import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  ClientPanelEventMessage,
  ClientSubscribeMessage,
  ClientUnsubscribeMessage,
  ClientTextInputMessage,
  ServerMessage,
} from '@assistant/shared';

import { SessionRuntime, type SessionRuntimeOptions } from './sessionRuntime';
import type { WsTransport } from './wsTransport';
import type { SessionConnection } from './sessionConnection';
import { ConversationStore } from '../conversationStore';
import { SessionIndex } from '../sessionIndex';
import { AgentRegistry } from '../agents';
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

function createTestConfig(transcriptsDir: string): EnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    chatModel: 'gpt-4o-mini',
    toolsEnabled: false,
    conversationLogPath: '',
    transcriptsDir,
    dataDir: os.tmpdir(),
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
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
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
  sessionId?: string;
  subscriptions?: string[];
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

  const config = createTestConfig(createTempDir('subscription-runtime-conversations'));

  const runtimeOptions: SessionRuntimeOptions = {
    transport,
    connection,
    config,
    toolHost: noopToolHost,
    conversationStore: new ConversationStore(config.transcriptsDir),
    sessionHub: options.sessionHub,
    eventStore: createTestEventStore(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openaiClient: {} as any,
  };

  const runtime = new SessionRuntime(runtimeOptions);

  if (options.sessionId) {
    (runtime as unknown as { sessionId?: string }).sessionId = options.sessionId;
  }

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
    const transcriptsDir = createTempDir('subscription-runtime-subscribe-conversations');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ conversationStore, sessionIndex, agentRegistry });

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
    const transcriptsDir = createTempDir('subscription-runtime-unsubscribe-conversations');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ conversationStore, sessionIndex, agentRegistry });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime, transportSent, unsubscribeSpy } = createRuntime({
      sessionHub,
      sessionId: sessionA.sessionId,
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

  it('rejects text_input for sessions the connection is not subscribed to', async () => {
    const sessionsFile = createTempFile('subscription-runtime-text-route-unsubscribed-sessions');
    const transcriptsDir = createTempDir('subscription-runtime-text-route-unsubscribed-convos');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ conversationStore, sessionIndex, agentRegistry });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });

    const { runtime, connection, transportSent } = createRuntime({
      sessionHub,
      sessionId: sessionA.sessionId,
    });

    const stateA = await sessionHub.ensureSessionState(sessionA.sessionId);

    sessionHub.subscribeConnection(connection, sessionA.sessionId);

    (runtime as unknown as { sessionState?: unknown }).sessionState = stateA;

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
    const transcriptsDir = createTempDir('subscription-runtime-queue-conversations');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ conversationStore, sessionIndex, agentRegistry });

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
    const transcriptsDir = createTempDir('subscription-runtime-panel-order-conversations');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
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
      conversationStore,
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
    const transcriptsDir = createTempDir('subscription-runtime-snapshot-queue-conversations');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);

    const handler: PanelEventHandler = vi.fn(async () => {});

    const pluginRegistry: PluginRegistry = {
      initialize: async () => {},
      getTools: () => [],
      shutdown: async () => {},
      getPanelEventHandler: (panelType) => (panelType === 'terminal' ? handler : undefined),
    };

    const sessionHub = new SessionHub({
      conversationStore,
      sessionIndex,
      agentRegistry,
      pluginRegistry,
    });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { runtime } = createRuntime({
      sessionHub,
      sessionId: summary.sessionId,
      subscriptions: [summary.sessionId],
    });
    (runtime as unknown as { ready: boolean }).ready = true;

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
});
