import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from './agents';
import {
  buildSessionAttributesPatchFromConfig,
  filterSessionSkills,
  getSelectedSessionSkillIds,
  resolveSessionConfigCapabilities,
  resolveSessionConfigForAgent,
} from './sessionConfig';

function createSkillRoot(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeSkill(options: {
  root: string;
  dirName: string;
  description: string;
}): void {
  const dir = path.join(options.root, options.dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${options.dirName}\ndescription: ${options.description}\n---\n\n# ${options.dirName}\n`,
    'utf8',
  );
}

describe('sessionConfig', () => {
  it('resolves agent capabilities including available skills', async () => {
    const root = createSkillRoot('session-config-skills');
    writeSkill({ root, dirName: 'agent-runner-review', description: 'Review with PI' });

    const agent: AgentDefinition = {
      agentId: 'coding',
      displayName: 'Coding',
      description: 'Coding agent',
      skills: [{ root, available: ['agent-runner-review'] }],
      chat: {
        models: ['gpt-5.4', 'gpt-5.4-mini'],
        thinking: ['low', 'medium'],
      },
    };

    const capabilities = await resolveSessionConfigCapabilities({
      agent,
    });

    expect(capabilities).toEqual({
      models: ['gpt-5.4', 'gpt-5.4-mini'],
      thinking: ['low', 'medium'],
      skills: [
        {
          id: 'agent-runner-review',
          name: 'agent-runner-review',
          description: 'Review with PI',
        },
      ],
    });
  });

  it('rejects sessionConfig values not allowed by the agent', async () => {
    const agent: AgentDefinition = {
      agentId: 'coding',
      displayName: 'Coding',
      description: 'Coding agent',
      chat: {
        models: ['gpt-5.4'],
        thinking: ['low'],
      },
    };

    await expect(
      resolveSessionConfigForAgent({
        agent,
        sessionConfig: { model: 'gpt-5.4-mini' },
      }),
    ).rejects.toThrow('Model "gpt-5.4-mini" is not allowed for agent "coding"');

    await expect(
      resolveSessionConfigForAgent({
        agent,
        sessionConfig: { thinking: 'high' },
      }),
    ).rejects.toThrow('Thinking level "high" is not allowed for agent "coding"');

    await expect(
      resolveSessionConfigForAgent({
        agent,
        sessionConfig: { workingDir: 'relative/path' },
      }),
    ).rejects.toThrow('sessionConfig.workingDir must be an absolute path');
  });

  it('normalizes selected skills against agent capabilities', async () => {
    const root = createSkillRoot('session-config-selected-skills');
    writeSkill({ root, dirName: 'worktrees', description: 'Worktree helper' });
    writeSkill({ root, dirName: 'agent-runner-review', description: 'Review helper' });

    const agent: AgentDefinition = {
      agentId: 'coding',
      displayName: 'Coding',
      description: 'Coding agent',
      skills: [{ root, available: ['worktrees', 'agent-runner-review'] }],
      chat: {
        models: ['gpt-5.4'],
      },
    };

    const resolved = await resolveSessionConfigForAgent({
      agent,
      sessionConfig: {
        skills: ['worktrees', 'agent-runner-review', 'worktrees'],
      },
    });

    expect(resolved.skills).toEqual(['agent-runner-review', 'worktrees']);
  });

  it('builds attribute patches and filters selected skills', () => {
    expect(
      buildSessionAttributesPatchFromConfig({
        model: 'gpt-5.4',
        thinking: 'medium',
        workingDir: '/tmp/project',
        skills: ['worktrees'],
      }),
    ).toEqual({
      core: { workingDir: '/tmp/project' },
      agent: { skills: ['worktrees'] },
    });

    expect(
      filterSessionSkills({
        availableSkills: [
          { id: 'a', name: 'A', description: 'A' },
          { id: 'b', name: 'B', description: 'B' },
        ],
        selectedSkillIds: ['b'],
      }),
    ).toEqual([
      { id: 'a', name: 'A', description: 'A' },
      { id: 'b', name: 'B', description: 'B' },
    ]);

    expect(
      getSelectedSessionSkillIds({
        agent: {
          skills: ['worktrees', ' agent-runner-review ', 'worktrees'],
        },
      }),
    ).toEqual(['agent-runner-review', 'worktrees']);
  });
});
