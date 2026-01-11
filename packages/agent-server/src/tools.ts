import { registerBuiltInSessionTools } from './builtInTools';

export type {
  BuiltInToolDefinition,
  CreateToolHostDeps,
  McpServerConfig,
  Tool,
  ToolContext,
  ToolHost,
  ToolHostConfig,
} from './tools/types';

export { ToolError } from './tools/errors';
export {
  mapToolsToChatCompletionSpecs,
  type ChatCompletionToolSpec,
} from './tools/chatCompletionMapping';
export { filterToolsByAllowlist, filterToolsForAgent, matchesGlobPattern } from './tools/scoping';
export { McpToolHost } from './tools/mcpToolHost';

import type {
  BuiltInToolDefinition,
  CreateToolHostDeps,
  Tool,
  ToolContext,
  ToolHost,
  ToolHostConfig,
} from './tools/types';
import { ToolError } from './tools/errors';
import { filterToolsForAgent } from './tools/scoping';
import { McpToolHost } from './tools/mcpToolHost';

class NoopToolHost implements ToolHost {
  async listTools(): Promise<Tool[]> {
    return [];
  }

  async callTool(_name: string, _argsJson: string, _ctx: ToolContext): Promise<unknown> {
    throw new ToolError('tools_disabled', 'Tool host is not configured');
  }
}

export class BuiltInToolHost implements ToolHost {
  private readonly tools: Map<string, BuiltInToolDefinition>;

  constructor(options: { tools: Map<string, BuiltInToolDefinition> }) {
    this.tools = options.tools;
  }

  registerTool(definition: BuiltInToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    for (const tool of this.tools.values()) {
      tools.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.capabilities ? { capabilities: tool.capabilities } : {}),
      });
    }
    return tools;
  }

  async callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown> {
    const definition = this.tools.get(name);
    if (!definition) {
      throw new ToolError('tool_not_found', `Tool not found: ${name}`);
    }

    let args: unknown;
    try {
      const trimmed = argsJson.trim();
      args = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      throw new ToolError('invalid_arguments', 'Tool arguments were not valid JSON');
    }

    return definition.handler(args, ctx);
  }
}

export class CompositeToolHost implements ToolHost {
  private readonly hosts: ToolHost[];
  private readonly toolHostByName = new Map<string, ToolHost>();

  constructor(hosts: ToolHost[]) {
    this.hosts = hosts;
  }

  async listTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];
    this.toolHostByName.clear();

    for (const host of this.hosts) {
      const tools = await host.listTools();
      for (const tool of tools) {
        allTools.push(tool);
        if (!this.toolHostByName.has(tool.name)) {
          this.toolHostByName.set(tool.name, host);
        }
      }
    }

    return allTools;
  }

  async callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown> {
    let host = this.toolHostByName.get(name);
    if (!host) {
      await this.listTools();
      host = this.toolHostByName.get(name);
    }

    if (!host) {
      throw new ToolError('tool_not_found', `Tool not found: ${name}`);
    }

    return host.callTool(name, argsJson, ctx);
  }
}

export class ScopedToolHost implements ToolHost {
  private readonly baseHost: ToolHost;
  private readonly allowlist: string[] | undefined;
  private readonly denylist: string[] | undefined;
  private readonly capabilityAllowlist: string[] | undefined;
  private readonly capabilityDenylist: string[] | undefined;

  constructor(options: {
    baseHost: ToolHost;
    allowlist?: string[];
    denylist?: string[];
    capabilityAllowlist?: string[];
    capabilityDenylist?: string[];
  }) {
    this.baseHost = options.baseHost;
    this.allowlist = options.allowlist;
    this.denylist = options.denylist;
    this.capabilityAllowlist = options.capabilityAllowlist;
    this.capabilityDenylist = options.capabilityDenylist;
  }

  async listTools(): Promise<Tool[]> {
    const tools = await this.baseHost.listTools();
    return filterToolsForAgent(
      tools,
      this.allowlist,
      this.denylist,
      this.capabilityAllowlist,
      this.capabilityDenylist,
    );
  }

  async callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown> {
    const tools = await this.baseHost.listTools();
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new ToolError('tool_not_found', `Tool not found: ${name}`);
    }
    const allowedTools = filterToolsForAgent(
      tools,
      this.allowlist,
      this.denylist,
      this.capabilityAllowlist,
      this.capabilityDenylist,
    );
    if (!allowedTools.some((candidate) => candidate.name === name)) {
      throw new ToolError('tool_not_allowed', `Tool "${name}" is not allowed for this agent`);
    }

    return this.baseHost.callTool(name, argsJson, ctx);
  }
}

export function createToolHost(config: ToolHostConfig, deps?: CreateToolHostDeps): ToolHost {
  const builtInTools = new Map<string, BuiltInToolDefinition>();
  const builtInHost = new BuiltInToolHost({ tools: builtInTools });

  if (deps?.sessionHub) {
    registerBuiltInSessionTools({
      host: builtInHost,
      sessionHub: deps.sessionHub,
    });
  }

  const hosts: ToolHost[] = [builtInHost];

  if (config.toolsEnabled && config.mcpServers?.length) {
    for (const server of config.mcpServers) {
      try {
        hosts.push(
          new McpToolHost({
            command: server.command,
            ...(server.name ? { name: server.name } : {}),
            ...(server.args ? { args: server.args } : {}),
            ...(server.env ? { env: server.env } : {}),
          }),
        );
      } catch (err) {
        console.error(`Failed to start MCP server ${server.name ?? server.command}`, err);
      }
    }
  } else if (config.toolsEnabled && !config.mcpServers?.length) {
    hosts.push(new NoopToolHost());
  }

  return new CompositeToolHost(hosts);
}

export function createScopedToolHost(
  baseHost: ToolHost,
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
  capabilityAllowlist?: string[] | undefined,
  capabilityDenylist?: string[] | undefined,
): ToolHost {
  const hasAllowlist = !!allowlist && allowlist.length > 0;
  const hasDenylist = !!denylist && denylist.length > 0;
  const hasCapabilityAllowlist = !!capabilityAllowlist && capabilityAllowlist.length > 0;
  const hasCapabilityDenylist = !!capabilityDenylist && capabilityDenylist.length > 0;

  if (!hasAllowlist && !hasDenylist && !hasCapabilityAllowlist && !hasCapabilityDenylist) {
    return baseHost;
  }

  const options: {
    baseHost: ToolHost;
    allowlist?: string[];
    denylist?: string[];
    capabilityAllowlist?: string[];
    capabilityDenylist?: string[];
  } = {
    baseHost,
  };
  if (hasAllowlist && allowlist) {
    options.allowlist = allowlist;
  }
  if (hasDenylist && denylist) {
    options.denylist = denylist;
  }
  if (hasCapabilityAllowlist && capabilityAllowlist) {
    options.capabilityAllowlist = capabilityAllowlist;
  }
  if (hasCapabilityDenylist && capabilityDenylist) {
    options.capabilityDenylist = capabilityDenylist;
  }

  return new ScopedToolHost(options);
}
