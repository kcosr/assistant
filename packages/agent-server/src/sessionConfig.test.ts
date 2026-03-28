import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { AgentDefinition } from './agents';
import type { ToolHost } from './tools';
import type { SessionHub } from './sessionHub';
import {
  buildSessionAttributesPatchFromConfig,
  filterSessionSkills,
  getSelectedSessionSkillIds,
  resolveSessionConfigCapabilities,
  resolveSessionConfigForAgent,
} from './sessionConfig';
import { resolveAgentToolExposureForHost } from './toolExposure';

vi.mock('./toolExposure', () => ({
  resolveAgentToolExposureForHost: vi.fn(),
}));

const mockedResolveAgentToolExposureForHost = vi.mocked(resolveAgentToolExposureForHost);

describe('sessionConfig', () => {
  beforeEach(() => {
    mockedResolveAgentToolExposureForHost.mockReset();
  });

  it('resolves agent capabilities including available skills', async () => {
    mockedResolveAgentToolExposureForHost.mockResolvedValue({
      availableTools: [],
      chatTools: [],
      availableSkills: [
        {
          id: 'agent-runner-review',
          name: 'Agent Runner Review',
          description: 'Review with PI',
          skillsPath: '',
          cliPath: '',
          toolNames: [],
        },
      ],
    });

    const agent: AgentDefinition = {
      agentId: 'coding',
      displayName: 'Coding',
      description: 'Coding agent',
      chat: {
        models: ['gpt-5.4', 'gpt-5.4-mini'],
        thinking: ['low', 'medium'],
      },
    };

    const capabilities = await resolveSessionConfigCapabilities({
      agent,
      sessionHub: { getPluginRegistry: vi.fn() } as unknown as SessionHub,
      baseToolHost: { listTools: vi.fn() } as unknown as ToolHost,
    });

    expect(capabilities).toEqual({
      models: ['gpt-5.4', 'gpt-5.4-mini'],
      thinking: ['low', 'medium'],
      skills: [
        {
          id: 'agent-runner-review',
          name: 'Agent Runner Review',
          description: 'Review with PI',
          skillsPath: '',
          cliPath: '',
          toolNames: [],
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
    mockedResolveAgentToolExposureForHost.mockResolvedValue({
      availableTools: [],
      chatTools: [],
      availableSkills: [
        {
          id: 'worktrees',
          name: 'Worktrees',
          description: 'Worktree helper',
          skillsPath: '',
          cliPath: '',
          toolNames: [],
        },
        {
          id: 'agent-runner-review',
          name: 'Agent Runner Review',
          description: 'Review helper',
          skillsPath: '',
          cliPath: '',
          toolNames: [],
        },
      ],
    });

    const agent: AgentDefinition = {
      agentId: 'coding',
      displayName: 'Coding',
      description: 'Coding agent',
      chat: {
        models: ['gpt-5.4'],
      },
    };

    const resolved = await resolveSessionConfigForAgent({
      agent,
      sessionHub: { getPluginRegistry: vi.fn() } as unknown as SessionHub,
      baseToolHost: { listTools: vi.fn() } as unknown as ToolHost,
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
          { id: 'a', name: 'A', description: 'A', skillsPath: '', cliPath: '', toolNames: [] },
          { id: 'b', name: 'B', description: 'B', skillsPath: '', cliPath: '', toolNames: [] },
        ],
        selectedSkillIds: ['b'],
      }),
    ).toEqual([
      { id: 'b', name: 'B', description: 'B', skillsPath: '', cliPath: '', toolNames: [] },
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
