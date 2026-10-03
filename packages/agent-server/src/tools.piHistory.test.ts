import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentTool as PiAgentTool } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, JsonValue, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';

import { PiSessionWriter } from './history/piSessionWriter';
import { mergeSessionAttributes } from './sessionAttributes';
import type { SessionSummary } from './sessionIndex';
import { createAgentTool } from './tools';

const model: Model<'openai-responses'> = {
  id: 'test-model',
  name: 'Test model',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
};

const circular: Record<string, unknown> = {};
circular['self'] = circular;
const plainResult = { payload: 'wrapper_unique_payload' };
const nativeResult = {
  content: [{ type: 'text' as const, text: 'Native failure' }],
  details: { reason: 'native metadata' },
  structuredContent: { exit_code: 7 },
  isError: true,
};
const cases: Array<{
  label: string;
  value: unknown;
  text: string;
  details?: JsonValue;
  isError?: boolean;
}> = [
  { label: 'plain JSON', value: plainResult, text: JSON.stringify(plainResult, null, 2) },
  { label: 'BigInt', value: 42n, text: '42' },
  { label: 'circular object', value: circular, text: '[object Object]' },
  {
    label: 'native result',
    value: nativeResult,
    text: 'Native failure',
    details: nativeResult.details,
    isError: true,
  },
];

describe('wrapped tool results in Pi history', () => {
  it.each(cases)(
    'persists $label through the real Agent without duplicate plain details',
    async ({ value, text, details, isError = false }) => {
      const [{ Agent }, { createAssistantMessageEventStream, Type }] = await Promise.all([
        import('@earendil-works/pi-agent-core'),
        import('@earendil-works/pi-ai'),
      ]);
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-wrapper-history-'));
      try {
        const tool = createAgentTool({
          name: 'example',
          description: 'Return an example result',
          parameters: Type.Object({}),
          context: { sessionId: 'wrapper-session', signal: new AbortController().signal },
          handler: async () => value,
        });
        const assistant: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'example-call', name: 'example', arguments: {} }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 1,
        };
        const agent = new Agent({
          initialState: { model, tools: [tool as PiAgentTool] },
          streamFn: () => {
            const stream = createAssistantMessageEventStream();
            stream.push({ type: 'done', reason: 'toolUse', message: assistant });
            return stream;
          },
          finishTurn: () => ({ action: 'end' }),
        });
        let executedResult: unknown;
        agent.subscribe((event) => {
          if (event.type === 'tool_execution_end') executedResult = event.result;
        });
        await agent.prompt('Run the example tool');
        const result = agent.state.messages.find((message) => message.role === 'toolResult');
        expect(result).toBeDefined();
        expect(result).toMatchObject({ content: [{ type: 'text', text }], isError });
        expect(result!.details).toEqual(details);
        if (value === nativeResult) expect(executedResult).toBe(nativeResult);

        const summary: SessionSummary = {
          sessionId: 'wrapper-session',
          agentId: 'pi',
          createdAt: '',
          updatedAt: '',
          attributes: { core: { workingDir: '/project' } },
        };
        await new PiSessionWriter({ baseDir }).sync({
          summary,
          updateAttributes: async (patch) => {
            summary.attributes = mergeSessionAttributes(summary.attributes, patch);
            return summary;
          },
          messages: [
            { role: 'user', content: 'Run the example tool' },
            { role: 'assistant', content: '', piSdkMessage: assistant },
            { role: 'tool', tool_call_id: 'example-call', content: text, piSdkMessage: result! },
          ],
        });
        const directory = path.join(baseDir, '--project--');
        const file = path.join(directory, (await fs.readdir(directory))[0]!);
        const raw = await fs.readFile(file, 'utf8');
        const entries = raw
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { message?: { role: string; details?: unknown } });
        const persisted = entries.find((entry) => entry.message?.role === 'toolResult')?.message;
        expect(persisted).toMatchObject({ content: [{ type: 'text', text }], isError });
        expect(persisted?.details).toEqual(details);
        if (value === plainResult) expect(raw.match(/wrapper_unique_payload/g)).toHaveLength(1);
      } finally {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    },
  );
});
