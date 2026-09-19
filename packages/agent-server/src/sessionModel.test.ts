import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from './agents';
import type { SessionSummary } from './sessionIndex';
import {
  getAgentModelSettings,
  getAgentAvailableThinkingLevels,
  resolveSessionModelForRun,
  resolveSessionThinkingForRun,
} from './sessionModel';
import { resolveSessionConfigForAgent, resolveSessionConfigCapabilities } from './sessionConfig';

const agent: AgentDefinition = {
  agentId: 'assistant',
  displayName: 'Assistant',
  description: '',
  chatProfile: 'local',
  chat: {
    provider: 'pi',
    models: ['local/model-a', 'remote/model-b'],
    modelSettings: [
      { id: 'local/model-a', thinking: ['xhigh', 'medium', 'none'] },
      { id: 'remote/model-b', thinking: ['low', 'none'] },
    ],
  },
};
const summary = (model?: string, thinking?: string) => ({ model, thinking }) as SessionSummary;

describe('profile model selection', () => {
  it('switches between models without carrying their settings across providers', () => {
    for (const [model, expectedThinking] of [
      ['local/model-a', 'xhigh'],
      ['remote/model-b', 'low'],
      ['local/model-a', 'xhigh'],
    ] as const) {
      const state = summary(model, 'invalid');
      expect(resolveSessionModelForRun({ agent, summary: state })).toBe(model);
      expect(resolveSessionThinkingForRun({ agent, summary: state })).toBe(expectedThinking);
      expect(getAgentModelSettings(agent, model)?.thinking?.[0]).toBe(expectedThinking);
    }
  });
  it('preserves allowed medium, xhigh and none selections', () => {
    for (const thinking of ['xhigh', 'medium', 'none']) {
      expect(resolveSessionThinkingForRun({ agent, summary: summary('local/model-a', thinking) })).toBe(
        thinking,
      );
    }
    expect(getAgentAvailableThinkingLevels(agent, 'remote/model-b')).toEqual(['low', 'none']);
  });
  it('uses profile defaults for removed selections', () => {
    expect(resolveSessionModelForRun({ agent, summary: summary('removed/model') })).toBe(
      'local/model-a',
    );
    expect(resolveSessionThinkingForRun({ agent, summary: summary('removed/model', 'high') })).toBe(
      'xhigh',
    );
  });
  it('validates a new session against its selected model', async () => {
    await expect(
      resolveSessionConfigForAgent({
        agent,
        sessionConfig: { model: 'remote/model-b', thinking: 'medium' },
      }),
    ).rejects.toThrow('not allowed');
    await expect(
      resolveSessionConfigForAgent({
        agent,
        sessionConfig: { model: 'remote/model-b', thinking: 'low' },
      }),
    ).resolves.toMatchObject({ model: 'remote/model-b', thinking: 'low' });
    expect((await resolveSessionConfigCapabilities({ agent })).thinkingByModel).toEqual({
      'local/model-a': ['xhigh', 'medium', 'none'],
      'remote/model-b': ['low', 'none'],
    });
  });
  it('preserves CLI model and thinking selection', () => {
    const cli: AgentDefinition = {
      ...agent,
      chat: { provider: 'codex-cli', models: ['gpt-5'], thinking: ['high', 'low'] },
    };
    expect(resolveSessionThinkingForRun({ agent: cli, summary: summary('gpt-5', 'low') })).toBe(
      'low',
    );
  });
});
