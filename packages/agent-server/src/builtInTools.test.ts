import { describe, expect, it } from 'vitest';
import { filterVisibleAgents } from './index';
import { AgentRegistry } from './agents';
import { BuiltInToolHost } from './tools';
import type { BuiltInToolDefinition, ToolContext } from './tools';
import { registerBuiltInSessionTools } from './builtInTools';

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

describe('registerBuiltInSessionTools', () => {
  function createHost(): BuiltInToolHost {
    const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    registerBuiltInSessionTools({
      host,
      sessionHub: {} as never,
    });
    return host;
  }

  function createContext(): ToolContext {
    return {
      sessionId: 'session-1',
      signal: new AbortController().signal,
    };
  }

  it('registers voice_speak and voice_ask with agent-facing descriptions', async () => {
    const host = createHost();

    const tools = await host.listTools();

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'voice_speak',
          description: expect.stringContaining(
            'Only use this when the user has initiated or requested voice-style interaction.',
          ),
        }),
        expect.objectContaining({
          name: 'voice_ask',
          description: expect.stringContaining('spoken reply is expected'),
        }),
      ]),
    );
  });

  it('returns the minimal accepted payload for valid voice prompts', async () => {
    const host = createHost();
    const ctx = createContext();

    await expect(host.callTool('voice_speak', '{"text":"Status update"}', ctx)).resolves.toEqual({
      accepted: true,
    });
    await expect(
      host.callTool('voice_ask', '{"text":"What should I do next?"}', ctx),
    ).resolves.toEqual({
      accepted: true,
    });
  });

  it('rejects missing or empty voice prompt text', async () => {
    const host = createHost();
    const ctx = createContext();

    await expect(host.callTool('voice_speak', '{}', ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'text is required and must be a string',
    });
    await expect(host.callTool('voice_ask', '{"text":"   "}', ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'text must not be empty',
    });
  });
});
