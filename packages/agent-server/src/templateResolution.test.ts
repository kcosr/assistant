import { describe, expect, it } from 'vitest';
import { deepMergeFragments, resolveAgentTemplates } from './templateResolution';

describe('deepMergeFragments', () => {
  it('replaces scalars with last writer wins', () => {
    const result = deepMergeFragments(
      { a: 'base', b: 1 },
      { a: 'override' },
    );
    expect(result).toEqual({ a: 'override', b: 1 });
  });

  it('deep merges nested objects', () => {
    const result = deepMergeFragments(
      { chat: { provider: 'pi', config: { timeoutMs: 300 } } },
      { chat: { config: { maxTokens: 100 } } },
    );
    expect(result).toEqual({
      chat: { provider: 'pi', config: { timeoutMs: 300, maxTokens: 100 } },
    });
  });

  it('replaces arrays entirely', () => {
    const result = deepMergeFragments(
      { models: ['a', 'b', 'c'] },
      { models: ['x'] },
    );
    expect(result).toEqual({ models: ['x'] });
  });

  it('clears fields with explicit null', () => {
    const result = deepMergeFragments(
      { systemPrompt: 'hello', toolDenylist: ['x'] },
      { toolDenylist: null },
    );
    expect(result).toEqual({ systemPrompt: 'hello' });
    expect('toolDenylist' in result).toBe(false);
  });

  it('ignores undefined values', () => {
    const result = deepMergeFragments(
      { a: 'keep' },
      { a: undefined, b: 'new' },
    );
    expect(result).toEqual({ a: 'keep', b: 'new' });
  });

  it('skips the extends key', () => {
    const result = deepMergeFragments(
      {},
      { extends: 'base', displayName: 'Agent' },
    );
    expect(result).toEqual({ displayName: 'Agent' });
    expect('extends' in result).toBe(false);
  });

  it('replaces non-object with object', () => {
    const result = deepMergeFragments(
      { chat: 'string-value' },
      { chat: { provider: 'pi' } },
    );
    expect(result).toEqual({ chat: { provider: 'pi' } });
  });

  it('replaces object with scalar', () => {
    const result = deepMergeFragments(
      { chat: { provider: 'pi' } },
      { chat: 'replaced' },
    );
    expect(result).toEqual({ chat: 'replaced' });
  });
});

describe('resolveAgentTemplates', () => {
  it('passes through agents without extends', () => {
    const config = {
      agents: [
        { agentId: 'a', displayName: 'A', description: 'desc' },
      ],
    };
    const result = resolveAgentTemplates(config);
    expect(result['agents']).toEqual([
      { agentId: 'a', displayName: 'A', description: 'desc' },
    ]);
    expect('templates' in result).toBe(false);
  });

  it('resolves single extends', () => {
    const config = {
      templates: {
        base: {
          systemPrompt: 'base prompt',
          toolAllowlist: ['tool_a'],
        },
      },
      agents: [
        {
          agentId: 'child',
          extends: 'base',
          displayName: 'Child',
          description: 'desc',
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]).toEqual({
      agentId: 'child',
      displayName: 'Child',
      description: 'desc',
      systemPrompt: 'base prompt',
      toolAllowlist: ['tool_a'],
    });
  });

  it('resolves template chain', () => {
    const config = {
      templates: {
        grandparent: {
          chat: { config: { wrapper: { path: '/run.sh' } } },
        },
        parent: {
          extends: 'grandparent',
          toolAllowlist: ['*'],
        },
      },
      agents: [
        {
          agentId: 'child',
          extends: 'parent',
          displayName: 'Child',
          description: 'desc',
          chat: { provider: 'claude-cli' },
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]).toEqual({
      agentId: 'child',
      displayName: 'Child',
      description: 'desc',
      toolAllowlist: ['*'],
      chat: { provider: 'claude-cli', config: { wrapper: { path: '/run.sh' } } },
    });
  });

  it('resolves multi-extends (array)', () => {
    const config = {
      templates: {
        containerized: {
          chat: { config: { wrapper: { path: '/run.sh' } } },
        },
        'read-only': {
          toolDenylist: ['*_write'],
        },
      },
      agents: [
        {
          agentId: 'reviewer',
          extends: ['containerized', 'read-only'],
          displayName: 'Reviewer',
          description: 'desc',
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]).toEqual({
      agentId: 'reviewer',
      displayName: 'Reviewer',
      description: 'desc',
      chat: { config: { wrapper: { path: '/run.sh' } } },
      toolDenylist: ['*_write'],
    });
  });

  it('agent inline fields override template', () => {
    const config = {
      templates: {
        base: {
          systemPrompt: 'base prompt',
          toolAllowlist: ['tool_a'],
        },
      },
      agents: [
        {
          agentId: 'child',
          extends: 'base',
          displayName: 'Child',
          description: 'desc',
          systemPrompt: 'custom prompt',
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]!['systemPrompt']).toBe('custom prompt');
    expect(agents[0]!['toolAllowlist']).toEqual(['tool_a']);
  });

  it('null clears inherited field', () => {
    const config = {
      templates: {
        base: {
          systemPrompt: 'base prompt',
          toolDenylist: ['dangerous'],
        },
      },
      agents: [
        {
          agentId: 'child',
          extends: 'base',
          displayName: 'Child',
          description: 'desc',
          toolDenylist: null,
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]!['systemPrompt']).toBe('base prompt');
    expect('toolDenylist' in agents[0]!).toBe(false);
  });

  it('throws on circular reference', () => {
    const config = {
      templates: {
        a: { extends: 'b' },
        b: { extends: 'a' },
      },
      agents: [
        { agentId: 'x', extends: 'a', displayName: 'X', description: 'desc' },
      ],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/[Cc]ircular/);
  });

  it('throws on missing template reference', () => {
    const config = {
      templates: {},
      agents: [
        { agentId: 'x', extends: 'nonexistent', displayName: 'X', description: 'desc' },
      ],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/nonexistent/);
  });

  it('throws when template contains identity fields', () => {
    const config = {
      templates: {
        bad: { agentId: 'sneaky' },
      },
      agents: [],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/agentId.*identity/);
  });

  it('removes templates section from output', () => {
    const config = {
      templates: { base: { systemPrompt: 'hi' } },
      agents: [{ agentId: 'a', displayName: 'A', description: 'd' }],
      plugins: {},
    };
    const result = resolveAgentTemplates(config);
    expect('templates' in result).toBe(false);
    expect('plugins' in result).toBe(true);
  });

  it('works with no templates section', () => {
    const config = {
      agents: [{ agentId: 'a', displayName: 'A', description: 'd' }],
    };
    const result = resolveAgentTemplates(config);
    expect(result['agents']).toEqual([
      { agentId: 'a', displayName: 'A', description: 'd' },
    ]);
  });

  it('throws when templates is not an object', () => {
    const config = {
      templates: 'invalid',
      agents: [{ agentId: 'a', displayName: 'A', description: 'd' }],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/templates must be an object/);
  });

  it('throws when templates is an array', () => {
    const config = {
      templates: [{ systemPrompt: 'hi' }],
      agents: [{ agentId: 'a', displayName: 'A', description: 'd' }],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/templates must be an object/);
  });

  it('trims whitespace in single-string extends', () => {
    const config = {
      templates: {
        base: { systemPrompt: 'hello' },
      },
      agents: [
        {
          agentId: 'a',
          extends: '  base  ',
          displayName: 'A',
          description: 'd',
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    expect(agents[0]!['systemPrompt']).toBe('hello');
  });

  it('throws on empty-string extends', () => {
    const config = {
      templates: {},
      agents: [
        { agentId: 'a', extends: '', displayName: 'A', description: 'd' },
      ],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/non-empty string/);
  });

  it('throws on whitespace-only extends', () => {
    const config = {
      templates: {},
      agents: [
        { agentId: 'a', extends: '   ', displayName: 'A', description: 'd' },
      ],
    };
    expect(() => resolveAgentTemplates(config)).toThrow(/non-empty string/);
  });

  it('handles diamond inheritance', () => {
    const config = {
      templates: {
        root: { systemPrompt: 'root', toolAllowlist: ['*'] },
        left: { extends: 'root', toolDenylist: ['left_deny'] },
        right: { extends: 'root', toolDenylist: ['right_deny'] },
      },
      agents: [
        {
          agentId: 'diamond',
          extends: ['left', 'right'],
          displayName: 'Diamond',
          description: 'desc',
        },
      ],
    };
    const result = resolveAgentTemplates(config);
    const agents = result['agents'] as Record<string, unknown>[];
    // Right is applied last, so its toolDenylist wins
    expect(agents[0]!['toolDenylist']).toEqual(['right_deny']);
    // Both inherit from root
    expect(agents[0]!['systemPrompt']).toBe('root');
    expect(agents[0]!['toolAllowlist']).toEqual(['*']);
  });
});
