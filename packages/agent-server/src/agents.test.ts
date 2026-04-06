import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './agents';

describe('AgentRegistry', () => {
  it('stores and retrieves agent definitions by id', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages a reading list of articles and links.',
        systemPrompt: 'You manage a reading list.',
        toolAllowlist: ['reading_list_*'],
      },
      {
        agentId: 'journal',
        displayName: 'Journal',
        description: 'Helps the user reflect and journal.',
        systemPrompt: 'You are a journal assistant.',
      },
    ]);

    expect(registry.hasAgent('reading-list')).toBe(true);
    expect(registry.hasAgent('missing')).toBe(false);

    const readingList = registry.getAgent('reading-list');
    expect(readingList).toBeDefined();
    expect(readingList?.displayName).toBe('Reading List Manager');

    const allAgents = registry.listAgents();
    const ids = allAgents.map((agent) => agent.agentId).sort();
    expect(ids).toEqual(['journal', 'reading-list']);
  });
});
