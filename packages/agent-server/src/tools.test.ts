import { describe, expect, it } from 'vitest';
import {
  BuiltInToolHost,
  CompositeToolHost,
  createToolHost,
  filterToolsForAgent,
  filterToolsByAllowlist,
  mapToolsToChatCompletionSpecs,
  matchesGlobPattern,
  ScopedToolHost,
  ToolError,
  type BuiltInToolDefinition,
  type Tool,
  type ToolContext,
} from './tools';

describe('mapToolsToChatCompletionSpecs', () => {
  it('maps tools into Chat Completions function tool specs', () => {
    const tools: Tool[] = [
      {
        name: 'demo_tool',
        description: 'Demo tool',
        parameters: {
          type: 'object',
          properties: {
            foo: { type: 'string' },
          },
          required: ['foo'],
        },
      },
    ];

    const specs = mapToolsToChatCompletionSpecs(tools);

    expect(specs).toHaveLength(1);
    const firstSpec = specs[0];
    if (!firstSpec) {
      throw new Error('Expected a mapped tool spec');
    }

    expect(firstSpec).toMatchObject({
      type: 'function',
      function: {
        name: 'demo_tool',
        description: 'Demo tool',
      },
    });

    expect(firstSpec.function.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
      }),
    );
  });
});

describe('matchesGlobPattern', () => {
  it('matches exact patterns without wildcards', () => {
    expect(matchesGlobPattern('web_fetch', 'web_fetch')).toBe(true);
    expect(matchesGlobPattern('web_fetch', 'web_fetch_v2')).toBe(false);
  });

  it('matches patterns with * wildcard at the end', () => {
    expect(matchesGlobPattern('reading_list_add', 'reading_list_*')).toBe(true);
    expect(matchesGlobPattern('reading_list_remove', 'reading_list_*')).toBe(true);
    expect(matchesGlobPattern('reading_list', 'reading_list_*')).toBe(false);
  });

  it('treats * as match-anything pattern', () => {
    expect(matchesGlobPattern('anything_goes', '*')).toBe(true);
    expect(matchesGlobPattern('system_sessions_list', '*')).toBe(true);
  });
});

describe('filterToolsByAllowlist', () => {
  const sampleTools: Tool[] = [
    {
      name: 'reading_list_add',
      description: 'Add to reading list',
      parameters: {},
    },
    {
      name: 'reading_list_list',
      description: 'List reading items',
      parameters: {},
    },
    {
      name: 'todo_add',
      description: 'Add todo item',
      parameters: {},
    },
    {
      name: 'system_sessions_list',
      description: 'List sessions',
      parameters: {},
    },
  ];

  it('returns all tools when allowlist is undefined', () => {
    const filtered = filterToolsByAllowlist(sampleTools, undefined);
    expect(filtered).toEqual(sampleTools);
  });

  it('returns only system_* tools when allowlist is empty', () => {
    const filtered = filterToolsByAllowlist(sampleTools, []);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['system_sessions_list']);
  });

  it('filters tools by glob patterns and always includes system_* and always-allowed tools', () => {
    const filtered = filterToolsByAllowlist(sampleTools, ['reading_list_*']);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['reading_list_add', 'reading_list_list', 'system_sessions_list']);
  });

  it('supports multiple patterns in the allowlist', () => {
    const filtered = filterToolsByAllowlist(sampleTools, ['reading_list_*', 'todo_*']);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'reading_list_add',
      'reading_list_list',
      'system_sessions_list',
      'todo_add',
    ]);
  });
});

describe('filterToolsForAgent', () => {
  const sampleTools: Tool[] = [
    {
      name: 'reading_list_add',
      description: 'Add to reading list',
      parameters: {},
    },
    {
      name: 'reading_list_delete',
      description: 'Delete from reading list',
      parameters: {},
    },
    {
      name: 'todo_add',
      description: 'Add todo item',
      parameters: {},
    },
    {
      name: 'system_sessions_list',
      description: 'List sessions',
      parameters: {},
    },
  ];

  it('supports denylist-only filtering when allowlist is undefined', () => {
    const filtered = filterToolsForAgent(sampleTools, undefined, ['reading_list_*']);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['system_sessions_list', 'todo_add']);
  });

  it('applies denylist after allowlist when both are provided', () => {
    const filtered = filterToolsForAgent(
      sampleTools,
      ['reading_list_*', 'todo_*'],
      ['reading_list_delete'],
    );
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['reading_list_add', 'system_sessions_list', 'todo_add']);
  });

  it('treats an empty denylist as having no effect', () => {
    const filtered = filterToolsForAgent(sampleTools, ['reading_list_*'], []);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['reading_list_add', 'reading_list_delete', 'system_sessions_list']);
  });

  it('allows system_* tools via allowlist but can still deny them via denylist', () => {
    const filtered = filterToolsForAgent(sampleTools, [], ['system_*']);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual([]);
  });

  it('filters tools by capability allowlist', () => {
    const capabilityTools: Tool[] = [
      {
        name: 'lists_read',
        description: 'List read',
        parameters: {},
        capabilities: ['lists.read'],
      },
      {
        name: 'lists_write',
        description: 'List write',
        parameters: {},
        capabilities: ['lists.write'],
      },
      {
        name: 'multi_cap',
        description: 'Multi capability tool',
        parameters: {},
        capabilities: ['files.read', 'terminal.exec'],
      },
      {
        name: 'system_sessions_list',
        description: 'List sessions',
        parameters: {},
      },
    ];

    const filtered = filterToolsForAgent(
      capabilityTools,
      undefined,
      undefined,
      ['lists.*'],
      undefined,
    );
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['lists_read', 'lists_write', 'system_sessions_list']);
  });

  it('filters tools by capability denylist', () => {
    const capabilityTools: Tool[] = [
      {
        name: 'lists_read',
        description: 'List read',
        parameters: {},
        capabilities: ['lists.read'],
      },
      {
        name: 'lists_write',
        description: 'List write',
        parameters: {},
        capabilities: ['lists.write'],
      },
    ];

    const filtered = filterToolsForAgent(capabilityTools, undefined, undefined, undefined, [
      'lists.write',
    ]);
    const names = filtered.map((tool) => tool.name).sort();
    expect(names).toEqual(['lists_read']);
  });

  it('requires all tool capabilities to match the allowlist', () => {
    const capabilityTools: Tool[] = [
      {
        name: 'multi_cap',
        description: 'Multi capability tool',
        parameters: {},
        capabilities: ['files.read', 'terminal.exec'],
      },
    ];

    const filtered = filterToolsForAgent(
      capabilityTools,
      undefined,
      undefined,
      ['files.*'],
      undefined,
    );
    expect(filtered).toEqual([]);
  });
});

describe('createToolHost', () => {
  it('returns a no-op host when tools are disabled', async () => {
    const host = createToolHost({
      toolsEnabled: false,
      mcpServers: [{ command: 'echo' }],
    });

    const tools = await host.listTools();
    expect(tools).toEqual([]);

    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };

    await expect(host.callTool('demo_tool', '{"foo":"bar"}', ctx)).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('returns a no-op host when MCP servers array is empty', async () => {
    const host = createToolHost({
      toolsEnabled: true,
      mcpServers: [],
    });

    const tools = await host.listTools();
    expect(tools).toEqual([]);

    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };

    await expect(host.callTool('demo_tool', '{"foo":"bar"}', ctx)).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('returns a no-op host when MCP servers is undefined', async () => {
    const host = createToolHost({
      toolsEnabled: true,
    });

    const tools = await host.listTools();
    expect(tools).toEqual([]);

    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };

    await expect(host.callTool('demo_tool', '{"foo":"bar"}', ctx)).rejects.toBeInstanceOf(
      ToolError,
    );
  });
});

describe('BuiltInToolHost', () => {
  it('registers tools and lists them', async () => {
    const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });

    host.registerTool({
      name: 'echo',
      description: 'Echo tool',
      parameters: { type: 'object' },
      handler: async () => 'ok',
    });

    const tools = await host.listTools();
    expect(tools).toHaveLength(1);
    const firstTool = tools[0];
    expect(firstTool).toMatchObject({
      name: 'echo',
      description: 'Echo tool',
    });
    expect(firstTool?.parameters).toEqual({ type: 'object' });
  });

  it('invokes the correct handler with parsed args and context', async () => {
    const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });

    let receivedArgs: unknown;
    let receivedCtx: ToolContext | undefined;

    host.registerTool({
      name: 'echo',
      description: 'Echo tool',
      parameters: { type: 'object' },
      handler: async (args, ctx) => {
        receivedArgs = args;
        receivedCtx = ctx;
        return { ok: true };
      },
    });

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    const result = await host.callTool('echo', '{"foo":"bar"}', ctx);
    expect(result).toEqual({ ok: true });
    expect(receivedArgs).toEqual({ foo: 'bar' });
    expect(receivedCtx).toEqual(ctx);
  });

  it('throws a ToolError when the tool is not found', async () => {
    const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    await expect(host.callTool('missing_tool', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('CompositeToolHost', () => {
  it('aggregates tools from multiple hosts', async () => {
    const hostA = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    hostA.registerTool({
      name: 'tool_a',
      description: 'Tool A',
      parameters: { a: true },
      handler: async () => 'a',
    });

    const hostB = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    hostB.registerTool({
      name: 'tool_b',
      description: 'Tool B',
      parameters: { b: true },
      handler: async () => 'b',
    });

    const composite = new CompositeToolHost([hostA, hostB]);

    const tools = await composite.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['tool_a', 'tool_b']);
  });

  it('routes callTool to the correct underlying host', async () => {
    const hostA = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    hostA.registerTool({
      name: 'tool_a',
      description: 'Tool A',
      parameters: {},
      handler: async () => 'from_a',
    });

    const hostB = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    hostB.registerTool({
      name: 'tool_b',
      description: 'Tool B',
      parameters: {},
      handler: async () => 'from_b',
    });

    const composite = new CompositeToolHost([hostA, hostB]);

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    const resultA = await composite.callTool('tool_a', '{}', ctx);
    const resultB = await composite.callTool('tool_b', '{}', ctx);

    expect(resultA).toBe('from_a');
    expect(resultB).toBe('from_b');
  });

  it('throws a ToolError when no host provides the tool', async () => {
    const composite = new CompositeToolHost([
      new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() }),
    ]);

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    await expect(composite.callTool('missing_tool', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('ScopedToolHost', () => {
  it('filters listed tools using the allowlist', async () => {
    const baseHost = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    baseHost.registerTool({
      name: 'reading_list_add',
      description: 'Add to reading list',
      parameters: {},
      handler: async () => 'ok',
    });
    baseHost.registerTool({
      name: 'todo_add',
      description: 'Add todo item',
      parameters: {},
      handler: async () => 'ok',
    });
    baseHost.registerTool({
      name: 'system_sessions_list',
      description: 'List sessions',
      parameters: {},
      handler: async () => 'ok',
    });

    const scoped = new ScopedToolHost({
      baseHost,
      allowlist: ['reading_list_*'],
    });

    const tools = await scoped.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(['reading_list_add', 'system_sessions_list']);
  });

  it('rejects tool calls that are not allowed by the allowlist', async () => {
    const baseHost = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    baseHost.registerTool({
      name: 'todo_add',
      description: 'Add todo item',
      parameters: {},
      handler: async () => 'ok',
    });

    const scoped = new ScopedToolHost({
      baseHost,
      allowlist: ['reading_list_*'],
    });

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    await expect(scoped.callTool('todo_add', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('always allows system_* tool calls even when disallowed by allowlist', async () => {
    const baseHost = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    baseHost.registerTool({
      name: 'system_sessions_list',
      description: 'List sessions',
      parameters: {},
      handler: async () => 'ok',
    });

    const scoped = new ScopedToolHost({
      baseHost,
      allowlist: [],
    });

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    const result = await scoped.callTool('system_sessions_list', '{}', ctx);
    expect(result).toBe('ok');
  });

  it('applies denylist rules to system_* tools when specified', async () => {
    const baseHost = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    baseHost.registerTool({
      name: 'system_sessions_list',
      description: 'List sessions',
      parameters: {},
      handler: async () => 'ok',
    });

    const scoped = new ScopedToolHost({
      baseHost,
      allowlist: [],
      denylist: ['system_*'],
    });

    const ctx: ToolContext = { sessionId: 'session-1', signal: new AbortController().signal };

    await expect(scoped.callTool('system_sessions_list', '{}', ctx)).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  // context_get_active_artifact has been removed; no special allowlist handling is required.
});
