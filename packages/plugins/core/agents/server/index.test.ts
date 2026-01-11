import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest } from '@assistant/shared';
import { ConversationStore } from '../../../../agent-server/src/conversationStore';
import { SessionHub, SessionIndex } from '../../../../agent-server/src/index';
import { AgentRegistry } from '../../../../agent-server/src/agents';
import {
  BuiltInToolHost,
  type BuiltInToolDefinition,
  type ToolContext,
} from '../../../../agent-server/src/tools';
import type { EnvConfig } from '../../../../agent-server/src/envConfig';
import * as chatProcessor from '../../../../agent-server/src/chatProcessor';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

function createEnvConfig(dataDir: string): EnvConfig {
  return {
    port: 0,
    apiKey: 'test-key',
    chatModel: 'gpt-4o',
    toolsEnabled: false,
    conversationLogPath: '',
    transcriptsDir: '',
    dataDir,
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

async function createTestEnvironment() {
  const sessionsFile = createTempFile('agents-plugin-sessions');
  const conversationsFile = createTempFile('agents-plugin-conversations');
  const dataDir = createTempDir('agents-plugin-data');

  const sessionIndex = new SessionIndex(sessionsFile);
  const conversationStore = new ConversationStore(conversationsFile);
  const agentRegistry = new AgentRegistry([]);
  const sessionHub = new SessionHub({ conversationStore, sessionIndex, agentRegistry });

  const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
  const initialSession = await sessionIndex.createSession({ agentId: 'general' });

  const ctx: ToolContext = {
    sessionId: initialSession.sessionId,
    signal: new AbortController().signal,
    envConfig: createEnvConfig(dataDir),
  };

  return {
    host,
    ctx,
    sessionIndex,
    sessionHub,
    conversationStore,
    agentRegistry,
  };
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('agents plugin operations', () => {
  describe('message', () => {
    it('rejects messaging agents that are not visible from the current agent session', async () => {
      const { ctx, sessionIndex, conversationStore, sessionHub, host } =
        await createTestEnvironment();
      const plugin = createTestPlugin();

      const agentRegistry = new AgentRegistry([
        {
          agentId: 'source',
          displayName: 'Source',
          description: 'Source agent',
          systemPrompt: 'You are the source agent.',
          agentAllowlist: ['visible-*'],
        },
        {
          agentId: 'visible-agent',
          displayName: 'Visible Agent',
          description: 'Visible target agent',
          systemPrompt: 'You are visible.',
        },
        {
          agentId: 'hidden-agent',
          displayName: 'Hidden Agent',
          description: 'Hidden target agent',
          systemPrompt: 'You are hidden.',
        },
      ]);

      const current = await sessionIndex.createSession({ agentId: 'source' });

      const ctxWithVisibility: ToolContext = {
        ...ctx,
        sessionId: current.sessionId,
        agentRegistry,
        sessionIndex,
        envConfig: createEnvConfig(ctx.envConfig?.dataDir ?? ''),
        baseToolHost: host,
        conversationStore,
        sessionHub,
      };

      await expect(
        plugin.operations?.message(
          { agentId: 'hidden-agent', content: 'Do something' },
          ctxWithVisibility,
        ),
      ).rejects.toMatchObject({
        message: 'Agent not accessible: hidden-agent',
      });
    });

    it('triggers a new turn in the calling session on async callback when caller is idle', async () => {
      const { ctx, sessionIndex, conversationStore, sessionHub, host } =
        await createTestEnvironment();
      const plugin = createTestPlugin();

      const agentRegistry = new AgentRegistry([
        {
          agentId: 'source',
          displayName: 'Source',
          description: 'Source agent',
          systemPrompt: 'You are the source agent.',
        },
        {
          agentId: 'worker',
          displayName: 'Worker',
          description: 'Worker agent',
          systemPrompt: 'You are the worker agent.',
        },
      ]);

      const callerSession = await sessionIndex.createSession({ agentId: 'source' });
      const targetSession = await sessionIndex.createSession({ agentId: 'worker' });

      const ctxWithAgents: ToolContext = {
        ...ctx,
        sessionId: callerSession.sessionId,
        agentRegistry,
        sessionIndex,
        envConfig: createEnvConfig(ctx.envConfig?.dataDir ?? ''),
        baseToolHost: host,
        conversationStore,
        sessionHub,
      };

      const processUserMessageSpy = vi
        .spyOn(chatProcessor, 'processUserMessage')
        .mockImplementation(async (options) => {
          if (options.sessionId === targetSession.sessionId) {
            return {
              responseId: 'worker-resp-1',
              response: 'Worker finished the task',
              truncated: false,
              toolCallCount: 0,
              toolCalls: [],
              durationMs: 10,
            };
          }

          if (options.sessionId === callerSession.sessionId) {
            return {
              responseId: 'source-resp-2',
              response: 'Source handled callback',
              truncated: false,
              toolCallCount: 0,
              toolCalls: [],
              durationMs: 5,
            };
          }

          throw new Error(`Unexpected sessionId for processUserMessage: ${options.sessionId}`);
        });

      const logAgentCallbackSpy = vi.spyOn(conversationStore, 'logAgentCallback');
      const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToSession');

      const result = (await plugin.operations?.message(
        {
          agentId: 'worker',
          content: 'Please do some work',
          session: targetSession.sessionId,
          mode: 'async',
        },
        ctxWithAgents,
      )) as { status: string; mode: string };

      expect(result.status).toBe('started');
      expect(result.mode).toBe('async');

      await new Promise((resolve) => setTimeout(resolve, 0));

      const firstCall = processUserMessageSpy.mock.calls[0]?.[0];
      expect(firstCall?.sessionId).toBe(targetSession.sessionId);
      expect(firstCall?.agentMessageContext).toEqual(
        expect.objectContaining({
          fromSessionId: callerSession.sessionId,
          fromAgentId: 'source',
        }),
      );

      expect(logAgentCallbackSpy).toHaveBeenCalledWith({
        sessionId: callerSession.sessionId,
        fromSessionId: targetSession.sessionId,
        fromAgentId: 'worker',
        responseId: 'worker-resp-1',
        text: 'Worker finished the task',
      });

      const callbackMessages = broadcastSpy.mock.calls
        .map((call) => call[1])
        .filter((msg) => msg && (msg as { type?: string }).type === 'agent_callback_result');

      expect(callbackMessages.length).toBe(1);
      const callbackPayload = callbackMessages[0] as {
        type: string;
        sessionId: string;
        responseId: string;
        result: string;
      };
      expect(callbackPayload.sessionId).toBe(callerSession.sessionId);
      expect(callbackPayload.responseId).toBe('worker-resp-1');
      expect(callbackPayload.result).toBe('Worker finished the task');
    });

    it('includes messageId when async agent messages are queued due to a busy target session', async () => {
      const { ctx, sessionIndex, conversationStore, sessionHub, host } =
        await createTestEnvironment();
      const plugin = createTestPlugin();

      const agentRegistry = new AgentRegistry([
        {
          agentId: 'source',
          displayName: 'Source',
          description: 'Source agent',
          systemPrompt: 'You are the source agent.',
        },
        {
          agentId: 'worker',
          displayName: 'Worker',
          description: 'Worker agent',
          systemPrompt: 'You are the worker agent.',
        },
      ]);

      const callerSession = await sessionIndex.createSession({ agentId: 'source' });
      const targetSession = await sessionIndex.createSession({ agentId: 'worker' });

      const targetState = await sessionHub.ensureSessionState(targetSession.sessionId);
      targetState.activeChatRun = {
        responseId: 'busy-run',
        abortController: new AbortController(),
        accumulatedText: '',
      };

      const ctxWithAgents: ToolContext = {
        ...ctx,
        sessionId: callerSession.sessionId,
        agentRegistry,
        sessionIndex,
        envConfig: createEnvConfig(ctx.envConfig?.dataDir ?? ''),
        baseToolHost: host,
        conversationStore,
        sessionHub,
      };

      const result = (await plugin.operations?.message(
        {
          agentId: 'worker',
          content: 'Please do some work',
          session: targetSession.sessionId,
          mode: 'async',
        },
        ctxWithAgents,
      )) as { status: string; mode: string; messageId?: string };

      expect(result.status).toBe('queued');
      expect(result.mode).toBe('async');
      expect(typeof result.messageId).toBe('string');
      expect(result.messageId?.trim()).toBeTruthy();
    });

    it('queues async callbacks when the calling session is busy', async () => {
      const { ctx, sessionIndex, conversationStore, sessionHub, host } =
        await createTestEnvironment();
      const plugin = createTestPlugin();

      const agentRegistry = new AgentRegistry([
        {
          agentId: 'source',
          displayName: 'Source',
          description: 'Source agent',
          systemPrompt: 'You are the source agent.',
        },
        {
          agentId: 'worker',
          displayName: 'Worker',
          description: 'Worker agent',
          systemPrompt: 'You are the worker agent.',
        },
      ]);

      const callerSession = await sessionIndex.createSession({ agentId: 'source' });
      const targetSession = await sessionIndex.createSession({ agentId: 'worker' });

      const callerState = await sessionHub.ensureSessionState(callerSession.sessionId);
      callerState.activeChatRun = {
        responseId: 'in-progress',
        abortController: new AbortController(),
        accumulatedText: '',
      };

      const ctxWithAgents: ToolContext = {
        ...ctx,
        sessionId: callerSession.sessionId,
        agentRegistry,
        sessionIndex,
        envConfig: createEnvConfig(ctx.envConfig?.dataDir ?? ''),
        baseToolHost: host,
        conversationStore,
        sessionHub,
      };

      const processUserMessageSpy = vi
        .spyOn(chatProcessor, 'processUserMessage')
        .mockImplementation(async (options) => {
          if (options.sessionId === targetSession.sessionId) {
            return {
              responseId: 'worker-resp-queued',
              response: 'Worker finished queued task',
              truncated: false,
              toolCallCount: 0,
              toolCalls: [],
              durationMs: 10,
            };
          }

          if (options.sessionId === callerSession.sessionId) {
            return {
              responseId: 'source-resp-after-queue',
              response: 'Source handled queued callback',
              truncated: false,
              toolCallCount: 0,
              toolCalls: [],
              durationMs: 5,
            };
          }

          throw new Error(`Unexpected sessionId for processUserMessage: ${options.sessionId}`);
        });

      const queueMessageSpy = vi.spyOn(sessionHub, 'queueMessage');
      const logAgentCallbackSpy = vi.spyOn(conversationStore, 'logAgentCallback');

      const result = (await plugin.operations?.message(
        {
          agentId: 'worker',
          content: 'Please do some queued work',
          session: targetSession.sessionId,
          mode: 'async',
        },
        ctxWithAgents,
      )) as { status: string; mode: string };

      expect(result.status).toBe('started');
      expect(result.mode).toBe('async');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(processUserMessageSpy).toHaveBeenCalledTimes(1);
      expect(processUserMessageSpy.mock.calls[0]?.[0].sessionId).toBe(targetSession.sessionId);

      expect(logAgentCallbackSpy).toHaveBeenCalledWith({
        sessionId: callerSession.sessionId,
        fromSessionId: targetSession.sessionId,
        fromAgentId: 'worker',
        responseId: 'worker-resp-queued',
        text: 'Worker finished queued task',
      });

      expect(queueMessageSpy).toHaveBeenCalledTimes(1);
      const queuedArgs = queueMessageSpy.mock.calls[0]?.[0];
      if (!queuedArgs) {
        throw new Error('Expected queuedArgs to be defined');
      }
      expect(queuedArgs.sessionId).toBe(callerSession.sessionId);
      expect(queuedArgs.source).toBe('agent');
      expect(queuedArgs.fromAgentId).toBe('worker');
      expect(queuedArgs.fromSessionId).toBe(targetSession.sessionId);
      expect(queuedArgs.text).toBe(
        '[Async response, responseId=worker-resp-queued]: Worker finished queued task',
      );
      expect(typeof queuedArgs.execute).toBe('function');

      await queuedArgs.execute();

      expect(processUserMessageSpy).toHaveBeenCalledTimes(2);
      const secondCall = processUserMessageSpy.mock.calls[1]?.[0];
      if (!secondCall) {
        throw new Error('Expected secondCall to be defined');
      }
      expect(secondCall.sessionId).toBe(callerSession.sessionId);
      expect(secondCall.agentMessageContext).toEqual(
        expect.objectContaining({
          fromSessionId: targetSession.sessionId,
          fromAgentId: 'worker',
          responseId: 'worker-resp-queued',
          logType: 'callback',
        }),
      );
    });
  });

  describe('list', () => {
    it('excludes agents marked uiVisible=false', async () => {
      const { ctx } = await createTestEnvironment();
      const plugin = createTestPlugin();

      const agentRegistry = new AgentRegistry([
        {
          agentId: 'visible-one',
          displayName: 'Visible One',
          description: 'Visible agent',
          systemPrompt: 'You are visible.',
        },
        {
          agentId: 'hidden-one',
          displayName: 'Hidden One',
          description: 'Hidden agent',
          systemPrompt: 'You are hidden.',
          uiVisible: false,
        },
        {
          agentId: 'visible-two',
          displayName: 'Visible Two',
          description: 'Visible agent',
          systemPrompt: 'You are visible too.',
        },
      ]);

      const ctxWithRegistry: ToolContext = {
        ...ctx,
        agentRegistry,
      };

      const result = (await plugin.operations?.list({}, ctxWithRegistry)) as {
        agents: Array<{ agentId: string }>;
      };

      const ids = result.agents.map((a) => a.agentId);
      expect(ids).toContain('visible-one');
      expect(ids).toContain('visible-two');
      expect(ids).not.toContain('hidden-one');
    });
  });
});
