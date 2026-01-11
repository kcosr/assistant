import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { CURRENT_PROTOCOL_VERSION, type ClientPanelEventMessage } from '@assistant/shared';

import { ConversationStore } from '../conversationStore';
import { Session, SessionHub, SessionIndex } from '../index';
import { AgentRegistry } from '../agents';
import type { Tool, ToolContext, ToolHost } from '../tools';
import type { EventStore } from '../events';
import type { PanelEventHandler } from '../plugins/types';
import type { PluginRegistry } from '../plugins/registry';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

function createTestConfig(transcriptsDir: string): unknown {
  return {
    port: 0,
    apiKey: 'test-api-key',
    chatModel: 'gpt-4o-mini',
    mcpServers: undefined,
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

class TestWebSocket {
  readonly sent: unknown[] = [];
  readyState: number = WebSocket.OPEN;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers: Record<string, Array<(...args: any[]) => void>> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): void {
    const list = this.handlers[event];
    if (!list) {
      return;
    }
    for (const handler of list) {
      handler(...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(data: any): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
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

function extractPanelEvents(sent: unknown[]): Array<Record<string, unknown>> {
  return sent
    .filter((frame): frame is string => typeof frame === 'string')
    .map((frame) => JSON.parse(frame))
    .filter((message) => message && typeof message === 'object' && message.type === 'panel_event')
    .map((message) => message as Record<string, unknown>);
}

describe('panel plugin websocket handlers', () => {
  it('routes panel_event to a plugin handler and skips default broadcast', async () => {
    const sessionsFile = createTempFile('panel-plugin-ws-sessions');
    const transcriptsDir = createTempDir('panel-plugin-ws-transcripts');

    const sessionIndex = new SessionIndex(sessionsFile);
    const conversationStore = new ConversationStore(transcriptsDir);
    const agentRegistry = new AgentRegistry([]);

    const handler: PanelEventHandler = vi.fn(async (event, ctx) => {
      ctx.sendToClient({
        type: 'panel_event',
        panelId: event.panelId,
        panelType: event.panelType,
        payload: { type: 'echo', ok: true },
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      });
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

    const sessionSummary = await sessionIndex.createSession({ agentId: 'general' });
    const ws = new TestWebSocket();
    const config = createTestConfig(transcriptsDir);
    const eventStore = createTestEventStore();

    const session = new Session({
      clientSocket: ws as unknown as WebSocket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost: noopToolHost,
      conversationStore,
      sessionHub,
      eventStore,
    });

    const state = await sessionHub.attachConnection(session, sessionSummary.sessionId);
    (session as unknown as { sessionId?: string }).sessionId = state.summary.sessionId;
    (session as unknown as { sessionState?: unknown }).sessionState = state;

    const hello = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId: sessionSummary.sessionId,
    } as const;

    ws.emit('message', JSON.stringify(hello), false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event: ClientPanelEventMessage = {
      type: 'panel_event',
      panelId: 'terminal-1',
      panelType: 'terminal',
      sessionId: sessionSummary.sessionId,
      payload: { type: 'terminal_input', text: 'ls' },
    };

    ws.emit('message', JSON.stringify(event), false);

    const panelEvents = extractPanelEvents(ws.sent);
    const terminalEvents = panelEvents.filter((msg) => msg['panelType'] === 'terminal');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.['payload']).toMatchObject({ type: 'echo', ok: true });
  });
});
