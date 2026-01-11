import { describe, expect, it } from 'vitest';
import { filterVisibleAgents } from './index';
import { AgentRegistry } from './agents';

// Agent tool tests moved to packages/plugins/core/agents/server/index.test.ts.

// context_get_active_artifact has been removed; corresponding tests are no longer needed.

describe('filterVisibleAgents', () => {
  it('applies agentAllowlist patterns when present', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['helper-*'],
      },
      {
        agentId: 'helper-one',
        displayName: 'Helper One',
        description: 'First helper agent',
        systemPrompt: 'You are helper one.',
      },
      {
        agentId: 'helper-two',
        displayName: 'Helper Two',
        description: 'Second helper agent',
        systemPrompt: 'You are helper two.',
      },
      {
        agentId: 'other',
        displayName: 'Other',
        description: 'Other agent',
        systemPrompt: 'You are other.',
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('helper-one');
    expect(ids).toContain('helper-two');
    expect(ids).not.toContain('other');
  });

  it('applies agentDenylist patterns after allowlist', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['helper-*'],
        agentDenylist: ['helper-secret'],
      },
      {
        agentId: 'helper-1',
        displayName: 'Helper One',
        description: 'First helper agent',
        systemPrompt: 'You are helper one.',
      },
      {
        agentId: 'helper-secret',
        displayName: 'Helper Secret',
        description: 'Secret helper agent',
        systemPrompt: 'You are secret.',
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('helper-1');
    expect(ids).not.toContain('helper-secret');
  });

  it('excludes agents marked uiVisible=false even when allowlisted', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['hidden', 'visible'],
      },
      {
        agentId: 'visible',
        displayName: 'Visible',
        description: 'Visible agent',
        systemPrompt: 'You are visible.',
      },
      {
        agentId: 'hidden',
        displayName: 'Hidden',
        description: 'Hidden agent',
        systemPrompt: 'You are hidden.',
        uiVisible: false,
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('visible');
    expect(ids).not.toContain('hidden');
  });
});
