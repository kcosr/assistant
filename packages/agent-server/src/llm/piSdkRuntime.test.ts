import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import { runChatCompletionCore } from '../chatRunCore';
import type { ChatRunCoreOptions } from '../chatRunCore';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { AgentTool } from '../tools';
import { PiSessionWriter } from '../history/piSessionWriter';
import { loadCanonicalPiReplayMessages } from '../history/piSessionReplay';
import { resolveInterruptedPiSyncMessages } from '../history/piSessionSync';
import { resolvePiSdkRuntimeModel, runPiSdkChatCompletionIteration } from './piSdkProvider';
import { completePiSdkModel, getPiSdkRuntime } from './piSdkRuntime';

let directory: string;
let server: http.Server;
let requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, any> }>;
let responseMode: 'text' | 'tool' | 'tool-then-text' | 'abort' | 'overflow';
let onRequest: (() => void) | undefined;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-registry-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  requests = [];
  responseMode = 'text';
  onRequest = undefined;
  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url!,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    onRequest?.();
    if (responseMode === 'abort') return;
    if (responseMode === 'overflow') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: 'maximum context length exceeded', type: 'invalid_request_error' },
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (request.url?.startsWith('/anthropic/')) {
      const emit = (type: string, data: Record<string, unknown>) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      emit('message_start', {
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'example-model',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done' } });
      emit('content_block_stop', { index: 0 });
      emit('message_delta', {
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      emit('message_stop', {});
      response.end();
      return;
    }
    const emit = (delta: unknown, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    emit({ role: 'assistant' });
    if (responseMode === 'tool' || (responseMode === 'tool-then-text' && requests.length === 1)) {
      emit({
        tool_calls: [
          {
            index: 0,
            id: 'call_test',
            type: 'function',
            function: { name: 'lookup', arguments: '{"key":' },
          },
        ],
      });
      emit({ tool_calls: [{ index: 0, function: { arguments: '"value"}' } }] });
      emit({}, 'tool_calls');
    } else {
      emit({ content: 'Done' });
      emit({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const template = {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
    thinkingFormat: 'chat-template',
    chatTemplateKwargs: {
      enable_thinking: { $var: 'thinking.enabled' },
      reasoning_effort: { $var: 'thinking.effort', omitWhenOff: true },
    },
  };
  await fs.writeFile(
    path.join(directory, 'auth.json'),
    JSON.stringify({
      anthropic: { type: 'api_key', key: 'builtin-test-key' },
      'openai-codex': {
        type: 'oauth',
        access: 'oauth-test-access',
        refresh: 'unused',
        expires: Date.now() + 600_000,
        accountId: 'test-account',
      },
    }),
  );
  await fs.writeFile(
    path.join(directory, 'models.json'),
    JSON.stringify({
      providers: {
        'anthropic-local': {
          baseUrl: `${base}/anthropic`,
          api: 'anthropic-messages',
          apiKey: 'anthropic-local-test-key',
          models: [
            {
              id: 'example-model',
              name: 'Local Anthropic',
              reasoning: false,
              input: ['text'],
              contextWindow: 114688,
              maxTokens: 4096,
              compat: { supportsMidConvoSystemMessages: true },
            },
          ],
        },
        local: {
          baseUrl: `${base}/local/v1`,
          api: 'openai-completions',
          apiKey: 'local-test-key',
          authHeader: true,
          headers: { 'X-Provider': 'local' },
          compat: template,
          models: [
            {
              id: 'example-model',
              name: 'Local',
              reasoning: true,
              input: ['text'],
              contextWindow: 114688,
              maxTokens: 16384,
              headers: { 'X-Model': 'example-model' },
              thinkingLevelMap: {
                minimal: null,
                low: null,
                medium: 'medium',
                high: null,
                xhigh: 'xhigh',
                max: null,
              },
            },
          ],
        },
        remote: {
          baseUrl: `${base}/remote/v1`,
          api: 'openai-completions',
          apiKey: '$REMOTE_TEST_CREDENTIAL',
          authHeader: true,
          headers: { 'X-Provider': 'remote' },
          compat: {
            ...template,
            chatTemplateKwargs: { ...template.chatTemplateKwargs, preserve_thinking: true },
          },
          models: [
            {
              id: 'example-model',
              name: 'Remote',
              reasoning: true,
              input: ['text', 'image'],
              contextWindow: 262144,
              maxTokens: 32768,
              thinkingLevelMap: { medium: 'medium', xhigh: 'xhigh' },
            },
          ],
        },
      },
    }),
  );
  vi.stubEnv('REMOTE_TEST_CREDENTIAL', 'remote-test-key');
});

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

async function run(
  modelSpec: string,
  reasoning: 'medium' | 'xhigh' | 'off',
  messages: ChatCompletionMessage[] = [{ role: 'user', content: 'Hello' }],
) {
  const { runtimeModel } = await resolvePiSdkRuntimeModel({ modelSpec });
  return runPiSdkChatCompletionIteration({
    model: runtimeModel,
    messages,
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Look up a key',
          parameters: {
            type: 'object',
            properties: { key: { type: 'string' } },
            required: ['key'],
          },
        },
      },
    ],
    reasoning,
    temperature: 0.25,
    abortSignal: new AbortController().signal,
    onDeltaText: () => undefined,
  });
}

describe('Pi registry and real SDK request serialization', () => {
  it('loads builtin models and credentials as well as complete custom definitions', async () => {
    const runtime = await getPiSdkRuntime();
    const builtin = runtime.getModels('anthropic')[0]!;
    expect(
      (await resolvePiSdkRuntimeModel({ modelSpec: `anthropic/${builtin.id}` })).runtimeModel,
    ).toBe(builtin);
    expect((await runtime.getAuth(builtin))?.auth.apiKey).toBe('builtin-test-key');
    expect((await runtime.getAuth('openai-codex'))?.auth.apiKey).toBe('oauth-test-access');
    const { runtimeModel: model } = await resolvePiSdkRuntimeModel({
      modelSpec: 'local/example-model',
    });
    expect(model).toMatchObject({
      contextWindow: 114688,
      maxTokens: 16384,
      input: ['text'],
      thinkingLevelMap: { xhigh: 'xhigh', medium: 'medium', high: null },
    });
    expect(
      (await resolvePiSdkRuntimeModel({ modelSpec: 'remote/example-model' })).runtimeModel,
    ).toMatchObject({
      contextWindow: 262144,
      maxTokens: 32768,
      input: ['text', 'image'],
    });
  }, 30_000);

  it('switches providers without leaking connection settings and preserves medium/xhigh/off', async () => {
    await run('local/example-model', 'medium');
    await run('remote/example-model', 'xhigh');
    await run('local/example-model', 'xhigh');
    await run('local/example-model', 'off');
    expect(requests.map((r) => r.url)).toEqual([
      '/local/v1/chat/completions',
      '/remote/v1/chat/completions',
      '/local/v1/chat/completions',
      '/local/v1/chat/completions',
    ]);
    expect(requests.map((r) => r.headers.authorization)).toEqual([
      'Bearer local-test-key',
      'Bearer remote-test-key',
      'Bearer local-test-key',
      'Bearer local-test-key',
    ]);
    expect(requests.map((r) => r.headers['x-provider'])).toEqual([
      'local',
      'remote',
      'local',
      'local',
    ]);
    expect(requests[0]!.headers['x-model']).toBe('example-model');
    expect(requests[1]!.headers['x-model']).toBeUndefined();
    expect(requests.map((r) => r.body['chat_template_kwargs'])).toEqual([
      { enable_thinking: true, reasoning_effort: 'medium' },
      { enable_thinking: true, reasoning_effort: 'xhigh', preserve_thinking: true },
      { enable_thinking: true, reasoning_effort: 'xhigh' },
      { enable_thinking: false },
    ]);
    expect(requests.map((r) => r.body['temperature'])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(requests[0]!.body['max_tokens']).toBe(16384);
    expect(requests[1]!.body['max_tokens']).toBe(32768);
  });

  it('streams tool arguments and sends the complete tool result round trip with existing history', async () => {
    const history: ChatCompletionMessage[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Understood' },
      { role: 'user', content: 'Look up value' },
    ];
    responseMode = 'tool';
    const first = await run('local/example-model', 'medium', history);
    expect(first.toolCalls).toEqual([
      { id: 'call_test', name: 'lookup', argumentsJson: '{"key":"value"}' },
    ]);
    responseMode = 'text';
    const second = await run('local/example-model', 'off', [
      ...history,
      { role: 'assistant', content: first.text, piSdkMessage: first.assistantMessage },
      { role: 'tool', tool_call_id: 'call_test', content: '{"value":42}' },
    ]);
    expect(second.text).toBe('Done');
    expect(requests[1]!.body['messages']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Understood' }),
        expect.objectContaining({
          role: 'assistant',
          tool_calls: [
            expect.objectContaining({
              id: 'call_test',
              function: { name: 'lookup', arguments: '{"key":"value"}' },
            }),
          ],
        }),
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call_test',
          content: '{"value":42}',
        }),
      ]),
    );
  });

  it('applies shared request overrides before observers for streaming and compaction requests', async () => {
    await fs.writeFile(
      path.join(directory, 'request-overrides.json'),
      JSON.stringify({
        models: {
          'local/example-model': {
            sampling: {
              temperature: 0.8,
              top_p: 0.95,
              top_k: 20,
              min_p: 0,
              presence_penalty: 0,
              repeat_penalty: 1,
            },
          },
        },
      }),
    );
    await run('local/example-model', 'medium');
    await run('remote/example-model', 'xhigh');
    const { runtimeModel } = await resolvePiSdkRuntimeModel({ modelSpec: 'local/example-model' });
    const observed: unknown[] = [];
    // Compaction uses the same completePiSdkModel entry point.
    await completePiSdkModel(
      runtimeModel,
      { messages: [{ role: 'user', content: 'Summarize', timestamp: 1 }] },
      {
        reasoning: 'medium',
        onPayload: (payload) => {
          observed.push(payload);
          return { ...(payload as Record<string, unknown>), top_p: 0.9 };
        },
      },
    );
    expect(requests[0]!.body).toMatchObject({
      temperature: 0.8,
      top_p: 0.95,
      top_k: 20,
      min_p: 0,
      presence_penalty: 0,
      repeat_penalty: 1,
    });
    expect(requests[1]!.body['temperature']).toBe(0.25);
    expect(requests[1]!.body).not.toHaveProperty('top_k');
    expect(observed[0]).toMatchObject({ temperature: 0.8, top_p: 0.95, top_k: 20 });
    expect(requests[2]!.body).toMatchObject({ temperature: 0.8, top_p: 0.9, top_k: 20 });
    expect(requests[2]!.body['chat_template_kwargs']).toEqual({
      enable_thinking: true,
      reasoning_effort: 'medium',
    });
  });

  it('reports invalid registry definitions rather than silently falling back to builtins', async () => {
    await fs.writeFile(path.join(directory, 'models.json'), '{ invalid json');
    await expect(getPiSdkRuntime()).rejects.toThrow('Failed to load Pi registry');
  });
});

function createCoreHarness(options: { maxToolIterations?: number } = {}) {
  const state: LogicalSessionState = {
    summary: { sessionId: 'real-pi', agentId: 'pi', createdAt: '', updatedAt: '' },
    chatMessages: [
      { role: 'system', content: 'Follow the session instructions.' },
      { role: 'user', content: 'Look it up', historyTimestampMs: 1 },
    ],
    messageQueue: [],
  };
  const execute = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'Value: 42' }],
    details: {},
  }));
  const tool: AgentTool = {
    name: 'lookup',
    label: 'Lookup',
    description: 'Look up a key',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    execute,
  };
  const send = vi.fn();
  const abortController = new AbortController();
  const sessionHub = {
    updateSessionContextUsage: vi.fn(async () => undefined),
    getPiSessionWriter: () => undefined,
  } as unknown as SessionHub;
  const coreOptions: ChatRunCoreOptions = {
    sessionId: state.summary.sessionId,
    state,
    text: 'Look it up',
    responseId: 'real-response',
    agent: {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: {
        provider: 'pi',
        models: ['local/example-model'],
        config: { maxToolIterations: options.maxToolIterations ?? 5 },
      },
    },
    provider: 'pi',
    envConfig: { debugChatCompletions: false } as ChatRunCoreOptions['envConfig'],
    chatCompletionTools: [],
    agentTools: [tool],
    handleChatToolCalls: async () => undefined,
    sessionHub,
    output: { send },
    abortController,
    shouldEmitChatEvents: false,
    includeAgentExchangeIdInMessages: false,
    trackTextStartedAt: false,
    log: () => undefined,
  };
  return { state, coreOptions, execute, send, abortController };
}

describe('real Pi Agent runtime lifecycle', () => {
  it('sends instructions and tool declarations, executes a tool, and preserves declaration ordering', async () => {
    responseMode = 'tool-then-text';
    const { state, coreOptions, execute, send } = createCoreHarness();
    const result = await runChatCompletionCore(coreOptions);
    expect(result.fullText).toBe('Done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual(expect.arrayContaining(['call_test', { key: 'value' }]));
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body['messages'][0]).toMatchObject({
      role: 'system',
      content: 'Follow the session instructions.',
    });
    expect(requests[0]!.body['tools']).toMatchObject([{ function: { name: 'lookup' } }]);
    expect(requests[1]!.body['messages']).toContainEqual(
      expect.objectContaining({ role: 'tool', content: 'Value: 42' }),
    );
    expect(result.piReplayMessages?.map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    expect(result.piReplayMessages?.[1]).toMatchObject({
      piSdkMessage: { toolsAdded: [{ name: 'lookup' }] },
    });
    expect(state.piAgentRuntime?.agent.state.systemPrompt).toBe('Follow the session instructions.');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_result', ok: true }));
  });

  it('preserves native tool failures in replay and emitted results', async () => {
    responseMode = 'tool-then-text';
    const { coreOptions, execute, send } = createCoreHarness();
    execute.mockImplementation(async () => ({
      content: [{ type: 'text', text: 'Command exited with code 7' }],
      details: { exitCode: 7 },
      isError: true,
    }));
    const result = await runChatCompletionCore(coreOptions);
    expect(result.piReplayMessages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        piSdkMessage: expect.objectContaining({ isError: true, details: { exitCode: 7 } }),
      }),
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_result', ok: false }));
  });

  it('replaces configured instructions and tools while preserving historical system patches across runtime recreation', async () => {
    const { state, coreOptions } = createCoreHarness();
    const first = await runChatCompletionCore(coreOptions);
    const initialSystem = first.piReplayMessages?.[0];
    const historicalPatch: ChatCompletionMessage = {
      role: 'system',
      content: 'Keep this independent instruction.',
      historyTimestampMs: 2,
      piSdkMessage: {
        role: 'system',
        content: 'Keep this independent instruction.',
        sections: { project: 'Project guidance' },
        timestamp: 2,
      },
    };
    state.chatMessages = [
      ...first.piReplayMessages!,
      { role: 'assistant', content: first.fullText, piSdkMessage: first.piSdkMessage! },
      historicalPatch,
      { role: 'user', content: 'Continue', historyTimestampMs: 3 },
    ];
    state.chatMessages[0]!.content = 'Use the updated instructions.';
    state.piAgentRuntime = undefined;
    const second = await runChatCompletionCore({
      ...coreOptions,
      text: 'Continue',
      agentTools: [],
    });
    expect(requests[1]!.body['messages'][0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('Use the updated instructions.'),
    });
    const requestSystem = requests[1]!.body['messages'][0].content;
    expect(requestSystem).toContain('Keep this independent instruction.');
    expect(requestSystem).toContain('Project guidance');
    expect(requestSystem).not.toContain('Follow the session instructions.');
    expect(requests[1]!.body['tools']).toBeUndefined();
    expect(second.piReplayMessages?.[0]).toMatchObject({
      piSdkMessage: initialSystem?.role === 'system' ? initialSystem.piSdkMessage : undefined,
    });
    expect(second.piReplayMessages).toContainEqual(historicalPatch);
    expect(second.piReplayMessages).toContainEqual(
      expect.objectContaining({
        piSdkMessage: expect.objectContaining({
          sections: { assistant_instructions: 'Use the updated instructions.' },
        }),
      }),
    );
    expect(second.piReplayMessages).toContainEqual(
      expect.objectContaining({
        piSdkMessage: expect.objectContaining({ toolsRemoved: [{ name: 'lookup' }] }),
      }),
    );
  });

  it.each([
    { provider: 'local', systemPosition: 'none' },
    { provider: 'anthropic-local', systemPosition: 'none' },
    { provider: 'anthropic-local', systemPosition: 'later' },
    { provider: 'anthropic-local', systemPosition: 'leading' },
  ])(
    'resumes canonical history without rewriting it ($provider, prior system: $systemPosition)',
    async ({ provider, systemPosition }) => {
      const withPriorSystem = systemPosition !== 'none';
      const withLeadingSystem = systemPosition === 'leading';
      const { state, coreOptions } = createCoreHarness();
      state.summary.attributes = { core: { workingDir: '/project' } };
      vi.spyOn(os, 'homedir').mockReturnValue(directory);
      const baseDir = path.join(directory, '.pi', 'agent', 'sessions');
      const writer = new PiSessionWriter({ baseDir });
      const updateAttributes = async (patch: Record<string, unknown>) => {
        state.summary.attributes = { ...state.summary.attributes, ...patch };
        return state.summary;
      };
      const previousMessages: ChatCompletionMessage[] = [
        { role: 'user', content: 'Earlier question', historyTimestampMs: 1 },
        { role: 'assistant', content: 'Earlier answer', historyTimestampMs: 2 },
        ...(withPriorSystem
          ? [
              {
                role: 'system' as const,
                content: '',
                piSdkMessage: {
                  role: 'system' as const,
                  content: '',
                  timestamp: 3,
                  toolsAdded: [
                    { name: 'obsolete', description: 'Old tool', parameters: { type: 'object' } },
                  ],
                },
              },
              {
                role: 'system' as const,
                content: 'Independent instructions',
                piSdkMessage: {
                  role: 'system' as const,
                  content: 'Independent instructions',
                  timestamp: 4,
                  sections: {
                    assistant_instructions: 'Old instructions',
                    project: 'Keep project guidance',
                  },
                },
              },
            ]
          : []),
      ];
      if (withLeadingSystem) {
        previousMessages.unshift(...previousMessages.splice(2, 1));
      }
      await writer.sync({
        summary: state.summary,
        updateAttributes,
        messages: previousMessages,
        modelSpec: 'local/example-model',
      });
      const historyDir = path.join(baseDir, '--project--');
      const file = path.join(historyDir, (await fs.readdir(historyDir))[0]!);
      const previous = await fs.readFile(file, 'utf8');
      coreOptions.agent!.chat!.models = [`${provider}/example-model`];
      const result = await runChatCompletionCore(coreOptions);
      if (provider === 'anthropic-local') {
        expect(requests[0]!.body['system']).toEqual([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Follow the session instructions.'),
          }),
        ]);
        const bodyText = JSON.stringify(requests[0]!.body);
        expect(bodyText.match(/Follow the session instructions\./g)).toHaveLength(1);
        expect(bodyText).toContain('Earlier question');
        expect(bodyText).toContain('Earlier answer');
        expect(bodyText).toContain('Look it up');
        expect(bodyText).not.toContain('Old instructions');
        if (withPriorSystem) {
          expect(bodyText).toContain('Independent instructions');
          expect(bodyText).toContain('Keep project guidance');
        }
      } else {
        expect(requests[0]!.body['messages']).toMatchObject([
          { role: 'system', content: 'Follow the session instructions.' },
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Look it up' },
        ]);
      }
      await writer.sync({
        summary: state.summary,
        updateAttributes,
        messages: [
          ...result.piReplayMessages!,
          { role: 'assistant', content: result.fullText, piSdkMessage: result.piSdkMessage! },
        ],
        modelSpec: 'local/example-model',
      });
      expect((await fs.readFile(file, 'utf8')).startsWith(previous)).toBe(true);
      const replay = await loadCanonicalPiReplayMessages({ summary: state.summary, baseDir });
      expect(replay?.map((message) => message.role)).toEqual([
        ...(withLeadingSystem ? ['system'] : []),
        'user',
        'assistant',
        ...(withPriorSystem ? (withLeadingSystem ? ['system'] : ['system', 'system']) : []),
        'system',
        'system',
        'user',
        'assistant',
      ]);
      expect(replay?.filter((message) => message.content === 'Earlier question')).toHaveLength(1);
      expect(replay).toContainEqual(
        expect.objectContaining({
          piSdkMessage: expect.objectContaining({
            sections: { assistant_instructions: 'Follow the session instructions.' },
          }),
        }),
      );
    },
  );

  it('records steering accepted by a running real Agent', async () => {
    const { state, coreOptions } = createCoreHarness();
    onRequest = () => {
      if (requests.length === 1)
        state.piAgentRuntime?.agent.steer({
          role: 'user',
          content: 'Change direction',
          timestamp: 7,
        });
    };
    const result = await runChatCompletionCore(coreOptions);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body['messages']).toContainEqual(
      expect.objectContaining({ role: 'user', content: 'Change direction' }),
    );
    expect(result.piReplayMessages).toContainEqual({
      role: 'user',
      content: 'Change direction',
      historyTimestampMs: 7,
    });
  });

  it('aborts a real in-flight provider request', async () => {
    responseMode = 'abort';
    const { coreOptions, abortController } = createCoreHarness();
    onRequest = () => abortController.abort();
    const result = await runChatCompletionCore(coreOptions);
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe('aborted');
    expect(requests).toHaveLength(1);
  });

  it('keeps pre-prompt tool declarations in the interrupted baseline and discards the late tool tail', async () => {
    responseMode = 'tool';
    const { coreOptions, execute, abortController } = createCoreHarness();
    execute.mockImplementation(async () => {
      abortController.abort();
      return { content: [{ type: 'text', text: 'Late result' }], details: {} };
    });
    const result = await runChatCompletionCore(coreOptions);
    expect(result.aborted).toBe(true);
    const interrupted = resolveInterruptedPiSyncMessages({
      baseMessages: result.piBaseReplayMessages!,
      replayMessages: result.piReplayMessages!,
    });
    expect(interrupted.messages.map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
    ]);
    expect(interrupted.messages[1]).toMatchObject({
      piSdkMessage: { toolsAdded: [{ name: 'lookup' }] },
    });
    expect(interrupted.droppedMessages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
    ]);
    expect(requests).toHaveLength(1);
  });

  it.each(['aborted', 'timeout'])(
    'reports %s when cancelled after overflow compaction before retry',
    async (reason) => {
      responseMode = 'overflow';
      const { coreOptions, state, abortController } = createCoreHarness();
      const compactSession = vi.fn(async () => {
        abortController.abort(reason);
        return { summary: state.summary };
      });
      coreOptions.sessionHub.compactSession = compactSession as never;
      const result = await runChatCompletionCore(coreOptions);
      expect(compactSession).toHaveBeenCalledTimes(1);
      expect(result.aborted).toBe(true);
      expect(result.abortReason).toBe(reason);
      expect(requests).toHaveLength(1);
    },
  );

  it('does not start a request when its outer signal is already aborted', async () => {
    const { coreOptions, abortController } = createCoreHarness();
    abortController.abort();
    const result = await runChatCompletionCore(coreOptions);
    expect(result.aborted).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('stops after the configured tool iteration limit before another provider request', async () => {
    responseMode = 'tool';
    const { coreOptions, execute } = createCoreHarness({ maxToolIterations: 1 });
    await expect(runChatCompletionCore(coreOptions)).rejects.toMatchObject({
      code: 'tool_iteration_limit',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });
});
