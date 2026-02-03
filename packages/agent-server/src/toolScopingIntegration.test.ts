import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Session, SessionHub, SessionIndex } from './index';
import { AgentRegistry } from './agents';
import { type Tool, type ToolContext, type ToolHost, ToolError } from './tools';
import type { EventStore } from './events';

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
    toolsEnabled: true,
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

class StaticToolHost implements ToolHost {
  private readonly tools: Tool[];

  constructor(tools: Tool[]) {
    this.tools = tools;
  }

  async listTools(): Promise<Tool[]> {
    return this.tools;
  }

  async callTool(_name: string, _argsJson: string, _ctx: ToolContext): Promise<unknown> {
    return null;
  }
}

describe('Session tool scoping integration', () => {
  it('agent with toolAllowlist only sees matching tools plus system tools', async () => {
    const sessionsFile = createTempFile('tool-scoping-allowlist-sessions');
    const dataDir = createTempDir('tool-scoping-allowlist-data');

    const sessionIndex = new SessionIndex(sessionsFile);
    const eventStore = createTestEventStore();

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'todo-agent',
        displayName: 'Todo Agent',
        description: 'Manages todo items.',
        systemPrompt: 'You are a todo assistant.',
        toolAllowlist: ['todo_*'],
      },
    ]);

    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const baseTools: Tool[] = [
      {
        name: 'todo_add',
        description: 'Add todo item',
        parameters: {},
      },
      {
        name: 'dangerous_wipe',
        description: 'Dangerous wipe tool',
        parameters: {},
      },
      {
        name: 'system_sessions_list',
        description: 'List sessions',
        parameters: {},
      },
    ];
    const toolHost = new StaticToolHost(baseTools);

    const summary = await sessionIndex.createSession({ agentId: 'todo-agent' });

    const ws = new TestWebSocket();
    const config = createTestConfig(dataDir);

    const session = new Session({
      clientSocket: ws as unknown as WebSocket,
      // Config shape is validated at runtime; we rely on fields used by Session.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost,
      sessionHub,
      eventStore,
    });

    const state = await sessionHub.attachConnection(session, summary.sessionId);
    (session as unknown as { sessionId?: string }).sessionId = state.summary.sessionId;
    (session as unknown as { sessionState?: unknown }).sessionState = state;

    await (
      session as unknown as {
        configureChatCompletionsSession(): Promise<void>;
      }
    ).configureChatCompletionsSession();

    const tools = (
      session as unknown as {
        chatCompletionTools?: Array<{ function: { name: string } }>;
      }
    ).chatCompletionTools;

    if (!tools) {
      throw new Error('Expected chatCompletionTools to be initialised');
    }

    const toolNames = tools.map((tool) => tool.function.name).sort();
    expect(toolNames).toEqual(['system_sessions_list', 'todo_add']);
  });

  it('agent with capabilityAllowlist only sees matching capability tools plus system tools', async () => {
    const sessionsFile = createTempFile('tool-scoping-capability-allowlist-sessions');
    const dataDir = createTempDir('tool-scoping-capability-allowlist-data');

    const sessionIndex = new SessionIndex(sessionsFile);
    const eventStore = createTestEventStore();

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'lists-agent',
        displayName: 'Lists Agent',
        description: 'Handles lists only.',
        systemPrompt: 'You manage lists.',
        capabilityAllowlist: ['lists.*'],
      },
    ]);

    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const baseTools: Tool[] = [
      {
        name: 'lists_list',
        description: 'List lists',
        parameters: {},
        capabilities: ['lists.read'],
      },
      {
        name: 'lists_write',
        description: 'Write list',
        parameters: {},
        capabilities: ['lists.write'],
      },
      {
        name: 'files_write',
        description: 'Write files',
        parameters: {},
        capabilities: ['files.write'],
      },
      {
        name: 'system_sessions_list',
        description: 'List sessions',
        parameters: {},
      },
    ];
    const toolHost = new StaticToolHost(baseTools);

    const summary = await sessionIndex.createSession({ agentId: 'lists-agent' });

    const ws = new TestWebSocket();
    const config = createTestConfig(dataDir);

    const session = new Session({
      clientSocket: ws as unknown as WebSocket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost,
      sessionHub,
      eventStore,
    });

    const state = await sessionHub.attachConnection(session, summary.sessionId);
    (session as unknown as { sessionId?: string }).sessionId = state.summary.sessionId;
    (session as unknown as { sessionState?: unknown }).sessionState = state;

    await (
      session as unknown as {
        configureChatCompletionsSession(): Promise<void>;
      }
    ).configureChatCompletionsSession();

    const tools = (
      session as unknown as {
        chatCompletionTools?: Array<{ function: { name: string } }>;
      }
    ).chatCompletionTools;

    if (!tools) {
      throw new Error('Expected chatCompletionTools to be initialised');
    }

    const toolNames = tools.map((tool) => tool.function.name).sort();
    expect(toolNames).toEqual(['lists_list', 'lists_write', 'system_sessions_list']);
  });

  it('agent with toolDenylist does not see denied tools', async () => {
    const sessionsFile = createTempFile('tool-scoping-denylist-sessions');
    const dataDir = createTempDir('tool-scoping-denylist-data');

    const sessionIndex = new SessionIndex(sessionsFile);
    const eventStore = createTestEventStore();

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'cautious-agent',
        displayName: 'Cautious Agent',
        description: 'Avoids dangerous tools.',
        systemPrompt: 'You are a cautious assistant.',
        toolDenylist: ['dangerous_*'],
      },
    ]);

    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const baseTools: Tool[] = [
      {
        name: 'todo_add',
        description: 'Add todo item',
        parameters: {},
      },
      {
        name: 'dangerous_wipe',
        description: 'Dangerous wipe tool',
        parameters: {},
      },
      {
        name: 'system_sessions_list',
        description: 'List sessions',
        parameters: {},
      },
    ];
    const toolHost = new StaticToolHost(baseTools);

    const summary = await sessionIndex.createSession({ agentId: 'cautious-agent' });

    const ws = new TestWebSocket();
    const config = createTestConfig(dataDir);

    const session = new Session({
      clientSocket: ws as unknown as WebSocket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost,
      sessionHub,
      eventStore,
    });

    const state = await sessionHub.attachConnection(session, summary.sessionId);
    (session as unknown as { sessionId?: string }).sessionId = state.summary.sessionId;
    (session as unknown as { sessionState?: unknown }).sessionState = state;

    await (
      session as unknown as {
        configureChatCompletionsSession(): Promise<void>;
      }
    ).configureChatCompletionsSession();

    const tools = (
      session as unknown as {
        chatCompletionTools?: Array<{ function: { name: string } }>;
      }
    ).chatCompletionTools;

    if (!tools) {
      throw new Error('Expected chatCompletionTools to be initialised');
    }

    const toolNames = tools.map((tool) => tool.function.name).sort();
    expect(toolNames).toEqual(['system_sessions_list', 'todo_add']);
  });

  it('rejects callTool for tools not allowed by the agent allowlist', async () => {
    const sessionsFile = createTempFile('tool-scoping-call-sessions');
    const dataDir = createTempDir('tool-scoping-call-data');

    const sessionIndex = new SessionIndex(sessionsFile);
    const eventStore = createTestEventStore();

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'todo-agent',
        displayName: 'Todo Agent',
        description: 'Manages todo items.',
        systemPrompt: 'You are a todo assistant.',
        toolAllowlist: ['todo_*'],
      },
    ]);

    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const baseTools: Tool[] = [
      {
        name: 'todo_add',
        description: 'Add todo item',
        parameters: {},
      },
      {
        name: 'other_tool',
        description: 'Some other tool',
        parameters: {},
      },
      {
        name: 'system_sessions_list',
        description: 'List sessions',
        parameters: {},
      },
    ];
    const toolHost = new StaticToolHost(baseTools);

    const summary = await sessionIndex.createSession({ agentId: 'todo-agent' });

    const ws = new TestWebSocket();
    const config = createTestConfig(dataDir);

    const session = new Session({
      clientSocket: ws as unknown as WebSocket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      toolHost,
      sessionHub,
      eventStore,
    });

    const state = await sessionHub.attachConnection(session, summary.sessionId);
    (session as unknown as { sessionId?: string }).sessionId = state.summary.sessionId;
    (session as unknown as { sessionState?: unknown }).sessionState = state;

    await (
      session as unknown as {
        configureSessionToolHost(): void;
      }
    ).configureSessionToolHost();

    const scopedHost = (session as unknown as { sessionToolHost?: ToolHost }).sessionToolHost;
    if (!scopedHost) {
      throw new Error('Expected sessionToolHost to be initialised');
    }

    const ctx: ToolContext = {
      sessionId: state.summary.sessionId,
      signal: new AbortController().signal,
    };

    await expect(scopedHost.callTool('other_tool', '{}', ctx)).rejects.toBeInstanceOf(ToolError);

    await expect(scopedHost.callTool('other_tool', '{}', ctx)).rejects.toMatchObject({
      code: 'tool_not_allowed',
    });
  });
});
