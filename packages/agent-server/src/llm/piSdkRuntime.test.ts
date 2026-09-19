import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import { resolvePiSdkRuntimeModel, runPiSdkChatCompletionIteration } from './piSdkProvider';
import { completePiSdkModel, getPiSdkRuntime } from './piSdkRuntime';

let directory: string;
let server: http.Server;
let requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, any> }>;
let responseMode: 'text' | 'tool';

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-registry-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  requests = [];
  responseMode = 'text';
  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url!,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (delta: unknown, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    emit({ role: 'assistant' });
    if (responseMode === 'tool') {
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
