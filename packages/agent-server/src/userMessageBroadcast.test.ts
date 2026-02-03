import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Session, SessionHub, SessionIndex } from './index';
import { AgentRegistry } from './agents';
import type { ToolHost, ToolContext, Tool } from './tools';
import type { EventStore } from './events';
import type { ServerMessage } from '@assistant/shared';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

function createTestConfig(dataDir: string): unknown {
  return {
    port: 0,
    apiKey: 'test-api-key',
    mcpServers: undefined,
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

class TestWebSocket {
  readonly sent: unknown[] = [];
  readyState: number = WebSocket.OPEN;
  // Minimal event handler tracking to satisfy Session constructor.
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
    clearSession: async () => {},
    deleteSession: async () => {},
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

describe('user message broadcast', () => {
  it('broadcasts user_message to other connections only', async () => {
    const sessionsFile = createTempFile('user-message-broadcast-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const summary = await sessionIndex.createSession({ agentId: 'general' });

    const ws1 = new TestWebSocket();
    const ws2 = new TestWebSocket();
    const config = createTestConfig(createTempDir('user-message-broadcast-data'));
    const eventStore = createTestEventStore();

    const session1 = new Session({
      clientSocket: ws1 as unknown as WebSocket,
      // Config shape is validated at runtime; we rely on fields used by Session.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost: noopToolHost,
      sessionHub,
      eventStore,
    });

    const session2 = new Session({
      clientSocket: ws2 as unknown as WebSocket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost: noopToolHost,
      sessionHub,
      eventStore,
    });

    const state1 = await sessionHub.attachConnection(session1, summary.sessionId);
    (session1 as unknown as { sessionId?: string }).sessionId = state1.summary.sessionId;
    (session1 as unknown as { sessionState?: unknown }).sessionState = state1;

    const state2 = await sessionHub.attachConnection(session2, summary.sessionId);
    (session2 as unknown as { sessionId?: string }).sessionId = state2.summary.sessionId;
    (session2 as unknown as { sessionState?: unknown }).sessionState = state2;

    const before1 = ws1.sent.length;
    const before2 = ws2.sent.length;

    const message: ServerMessage = {
      type: 'user_message',
      sessionId: summary.sessionId,
      text: 'hello',
    };

    sessionHub.broadcastToSessionExcluding(summary.sessionId, message, session1);

    expect(ws1.sent.length).toBe(before1);
    expect(ws2.sent.length).toBe(before2 + 1);
    const last = ws2.sent[ws2.sent.length - 1];
    expect(JSON.parse(last as string)).toEqual(message);
  });
});
