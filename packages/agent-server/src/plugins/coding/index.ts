import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@mariozechner/pi-coding-agent';

import type { AgentTool, ToolContext } from '../../tools';
import { ToolError } from '../../tools';
import type { PluginToolDefinition, PluginConfig, ToolPlugin } from '../types';

const CODING_PLUGIN_MANIFEST: CombinedPluginManifest = {
  id: 'coding',
  version: '0.1.0',
  server: {
    provides: ['coding'],
    capabilities: ['files.read', 'files.write', 'terminal.exec'],
  },
};

type CodingToolName = 'bash' | 'read' | 'write' | 'edit' | 'ls' | 'find' | 'grep';

type NativeTool = AgentTool & { name: CodingToolName };

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

interface CodingPluginConfig extends PluginConfig {
  mode?: 'local';
  local?: {
    workspaceRoot?: string;
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

function withCapabilities(tool: NativeTool): NativeTool {
  const capabilities = TOOL_CAPABILITIES[tool.name];
  return {
    ...tool,
    ...(capabilities.length > 0 ? { capabilities } : {}),
  };
}

function createNativeTools(cwd: string): Record<CodingToolName, NativeTool> {
  return {
    bash: withCapabilities(createBashTool(cwd) as NativeTool),
    read: withCapabilities(createReadTool(cwd) as NativeTool),
    write: withCapabilities(createWriteTool(cwd) as NativeTool),
    edit: withCapabilities(createEditTool(cwd) as NativeTool),
    ls: withCapabilities(createLsTool(cwd) as NativeTool),
    find: withCapabilities(createFindTool(cwd) as NativeTool),
    grep: withCapabilities(createGrepTool(cwd) as NativeTool),
  };
}

const DESCRIPTOR_TOOLS = createNativeTools(process.cwd());

export function createCodingPlugin(): ToolPlugin {
  let currentPluginConfig: CodingPluginConfig | undefined;
  let currentDataDir: string | undefined;

  function requireInitialized(): { dataDir: string; pluginConfig?: CodingPluginConfig } {
    if (!currentDataDir) {
      throw new ToolError('plugin_not_initialized', 'Coding plugin has not been initialized');
    }
    return {
      dataDir: currentDataDir,
      ...(currentPluginConfig ? { pluginConfig: currentPluginConfig } : {}),
    };
  }

  async function resolveSessionWorkingDir(ctx: ToolContext): Promise<string | undefined> {
    const state = ctx.sessionHub?.getSessionState(ctx.sessionId);
    const stateWorkingDir = state?.summary.attributes?.core?.workingDir;
    if (typeof stateWorkingDir === 'string' && stateWorkingDir.trim().length > 0) {
      return stateWorkingDir.trim();
    }

    if (ctx.sessionHub) {
      const ensured = await ctx.sessionHub.ensureSessionState(ctx.sessionId);
      const ensuredWorkingDir = ensured.summary.attributes?.core?.workingDir;
      if (typeof ensuredWorkingDir === 'string' && ensuredWorkingDir.trim().length > 0) {
        return ensuredWorkingDir.trim();
      }
    }

    const summary = await ctx.sessionIndex?.getSession(ctx.sessionId);
    const indexedWorkingDir = summary?.attributes?.core?.workingDir;
    if (typeof indexedWorkingDir === 'string' && indexedWorkingDir.trim().length > 0) {
      return indexedWorkingDir.trim();
    }

    return undefined;
  }

  async function resolveToolCwd(ctx: ToolContext): Promise<string> {
    const { dataDir, pluginConfig } = requireInitialized();
    const configuredWorkspaceRoot =
      pluginConfig?.local?.workspaceRoot && pluginConfig.local.workspaceRoot.trim().length > 0
        ? pluginConfig.local.workspaceRoot.trim()
        : path.join(dataDir, DEFAULT_WORKSPACE_DIRNAME);
    const sessionWorkingDir = await resolveSessionWorkingDir(ctx);
    const resolvedWorkspaceRoot = configuredWorkspaceRoot.includes(SESSION_WORKING_DIR_MACRO)
      ? configuredWorkspaceRoot.replaceAll(SESSION_WORKING_DIR_MACRO, sessionWorkingDir ?? '').trim()
      : configuredWorkspaceRoot;
    const workspaceRoot =
      resolvedWorkspaceRoot.length > 0
        ? resolvedWorkspaceRoot
        : path.join(dataDir, DEFAULT_WORKSPACE_DIRNAME);
    await mkdir(workspaceRoot, { recursive: true });
    return workspaceRoot;
  }

  function ensureNotAborted(ctx: ToolContext): void {
    if (ctx.signal.aborted) {
      throw new ToolError('tool_aborted', 'Tool execution aborted');
    }
  }

  async function executeNativeTool(
    toolName: CodingToolName,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<unknown> {
    ensureNotAborted(ctx);
    const cwd = await resolveToolCwd(ctx);
    const tool = createNativeTools(cwd)[toolName];
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
      ensureNotAborted(ctx);
      return result;
    } catch (error) {
      if (ctx.signal.aborted) {
        throw new ToolError('tool_aborted', 'Tool execution aborted');
      }
      throw error;
    }
  }

  const tools: PluginToolDefinition[] = (
    Object.keys(DESCRIPTOR_TOOLS) as Array<CodingToolName>
  ).map((toolName) => {
    const tool = DESCRIPTOR_TOOLS[toolName];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as PluginToolDefinition['inputSchema'],
      ...(tool.capabilities ? { capabilities: tool.capabilities } : {}),
      handler: (args, ctx) => executeNativeTool(toolName, args, ctx),
    };
  });

  return {
    name: 'coding',
    manifest: CODING_PLUGIN_MANIFEST,
    tools,
    async getAgentTools(ctx: ToolContext): Promise<AgentTool[]> {
      const cwd = await resolveToolCwd(ctx);
      return Object.values(createNativeTools(cwd));
    },
    async initialize(dataDir: string, pluginConfig?: PluginConfig): Promise<void> {
      currentDataDir = dataDir;
      currentPluginConfig = pluginConfig as CodingPluginConfig | undefined;
      if (currentPluginConfig?.mode && currentPluginConfig.mode !== 'local') {
        throw new ToolError(
          'invalid_plugin_config',
          `Unsupported coding plugin mode: ${currentPluginConfig.mode}`,
        );
      }
    },
  };
}
