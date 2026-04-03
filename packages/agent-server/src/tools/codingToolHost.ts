import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { PluginsConfig } from '../config';
import type {
  createBashTool as createBashToolType,
  createEditTool as createEditToolType,
  createFindTool as createFindToolType,
  createGrepTool as createGrepToolType,
  createLsTool as createLsToolType,
  createReadTool as createReadToolType,
  createWriteTool as createWriteToolType,
} from '@mariozechner/pi-coding-agent';

import type { AgentTool, Tool, ToolContext, ToolHost } from './types';
import { ToolError } from './errors';
import { resolveSessionWorkingDir } from './sessionWorkingDir';

type CodingToolName = 'bash' | 'read' | 'write' | 'edit' | 'ls' | 'find' | 'grep';
type NativeTool = AgentTool & { name: CodingToolName };
type CodingAgentModule = {
  createBashTool: typeof createBashToolType;
  createReadTool: typeof createReadToolType;
  createWriteTool: typeof createWriteToolType;
  createEditTool: typeof createEditToolType;
  createLsTool: typeof createLsToolType;
  createFindTool: typeof createFindToolType;
  createGrepTool: typeof createGrepToolType;
};

type CodingPluginConfig = PluginsConfig[string] & {
  mode?: 'local' | undefined;
  local?: {
    workspaceRoot?: string | undefined;
  } | undefined;
};

type CodingToolHostOptions = {
  dataDir: string;
  pluginConfig?: CodingPluginConfig;
  loadCodingAgentModule?: () => Promise<CodingAgentModule>;
};

const SESSION_WORKING_DIR_MACRO = '${session.workingDir}';
const DEFAULT_WORKSPACE_DIRNAME = 'coding-workspaces';
const TOOL_CAPABILITIES: Record<CodingToolName, string[]> = {
  bash: ['terminal.exec'],
  read: ['files.read'],
  write: ['files.write'],
  edit: ['files.write'],
  ls: ['files.read'],
  find: ['files.read'],
  grep: ['files.read'],
};

function withCapabilities(tool: NativeTool): NativeTool {
  const capabilities = TOOL_CAPABILITIES[tool.name];
  return {
    ...tool,
    ...(capabilities.length > 0 ? { capabilities } : {}),
  };
}

function createNativeTools(
  module: CodingAgentModule,
  cwd: string,
): Record<CodingToolName, NativeTool> {
  return {
    bash: withCapabilities(module.createBashTool(cwd) as NativeTool),
    read: withCapabilities(module.createReadTool(cwd) as NativeTool),
    write: withCapabilities(module.createWriteTool(cwd) as NativeTool),
    edit: withCapabilities(module.createEditTool(cwd) as NativeTool),
    ls: withCapabilities(module.createLsTool(cwd) as NativeTool),
    find: withCapabilities(module.createFindTool(cwd) as NativeTool),
    grep: withCapabilities(module.createGrepTool(cwd) as NativeTool),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveToolUpdateDelta(previousText: string, nextText: string): string {
  if (!nextText) {
    return '';
  }
  if (!previousText) {
    return nextText;
  }
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }
  return nextText;
}

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('');
}

let codingAgentModulePromise: Promise<CodingAgentModule> | null = null;

async function loadCodingAgentModule(): Promise<CodingAgentModule> {
  if (!codingAgentModulePromise) {
    codingAgentModulePromise = import('@mariozechner/pi-coding-agent').then(
      (module) => module as CodingAgentModule,
    );
  }
  return codingAgentModulePromise;
}

export class CodingToolHost implements ToolHost {
  private readonly dataDir: string;
  private readonly pluginConfig: CodingPluginConfig | undefined;
  private readonly loadModule: () => Promise<CodingAgentModule>;

  constructor(options: CodingToolHostOptions) {
    this.dataDir = options.dataDir;
    this.pluginConfig = options.pluginConfig;
    this.loadModule = options.loadCodingAgentModule ?? loadCodingAgentModule;

    if (this.pluginConfig?.mode && this.pluginConfig.mode !== 'local') {
      throw new ToolError(
        'invalid_plugin_config',
        `Unsupported coding plugin mode: ${this.pluginConfig.mode}`,
      );
    }
  }

  private async resolveToolCwd(ctx: ToolContext): Promise<string> {
    const configuredWorkspaceRoot =
      this.pluginConfig?.local?.workspaceRoot &&
      this.pluginConfig.local.workspaceRoot.trim().length > 0
        ? this.pluginConfig.local.workspaceRoot.trim()
        : path.join(this.dataDir, DEFAULT_WORKSPACE_DIRNAME);
    const sessionWorkingDir = await resolveSessionWorkingDir(ctx);
    const resolvedWorkspaceRoot = configuredWorkspaceRoot.includes(SESSION_WORKING_DIR_MACRO)
      ? configuredWorkspaceRoot.replaceAll(SESSION_WORKING_DIR_MACRO, sessionWorkingDir ?? '').trim()
      : configuredWorkspaceRoot;
    const workspaceRoot =
      resolvedWorkspaceRoot.length > 0
        ? resolvedWorkspaceRoot
        : path.join(this.dataDir, DEFAULT_WORKSPACE_DIRNAME);
    await mkdir(workspaceRoot, { recursive: true });
    return workspaceRoot;
  }

  private ensureNotAborted(ctx: ToolContext): void {
    if (ctx.signal.aborted) {
      throw new ToolError('tool_aborted', 'Tool execution aborted');
    }
  }

  private async executeNativeTool(
    toolName: CodingToolName,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<unknown> {
    this.ensureNotAborted(ctx);
    const cwd = await this.resolveToolCwd(ctx);
    const module = await this.loadModule();
    const tool = createNativeTools(module, cwd)[toolName];
    let streamedText = '';
    try {
      const result = await tool.execute(
        ctx.toolCallId ?? `${toolName}:${ctx.sessionId}`,
        args,
        ctx.signal,
        typeof ctx.onUpdate === 'function'
          ? (partialResult) => {
              const nextText = getTextContent(partialResult);
              const delta = resolveToolUpdateDelta(streamedText, nextText);
              streamedText = nextText;
              const details = isRecord(partialResult.details) ? partialResult.details : undefined;
              if (delta.length === 0 && details === undefined) {
                return;
              }
              ctx.onUpdate?.({
                delta,
                ...(details ? { details } : {}),
              });
            }
          : undefined,
      );
      this.ensureNotAborted(ctx);
      return result;
    } catch (error) {
      if (ctx.signal.aborted) {
        throw new ToolError('tool_aborted', 'Tool execution aborted');
      }
      throw error;
    }
  }

  async listTools(): Promise<Tool[]> {
    const module = await this.loadModule();
    const descriptorTools = createNativeTools(module, process.cwd());
    return Object.values(descriptorTools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.capabilities ? { capabilities: tool.capabilities } : {}),
    }));
  }

  async listAgentTools(ctx: ToolContext): Promise<AgentTool[]> {
    const cwd = await this.resolveToolCwd(ctx);
    const module = await this.loadModule();
    return Object.values(createNativeTools(module, cwd));
  }

  async callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown> {
    if (
      name !== 'bash' &&
      name !== 'read' &&
      name !== 'write' &&
      name !== 'edit' &&
      name !== 'ls' &&
      name !== 'find' &&
      name !== 'grep'
    ) {
      throw new ToolError('tool_not_found', `Tool not found: ${name}`);
    }

    let args: unknown;
    try {
      const trimmed = argsJson.trim();
      args = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      throw new ToolError('invalid_arguments', 'Tool arguments were not valid JSON');
    }

    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    return this.executeNativeTool(name, normalizedArgs, ctx);
  }
}
