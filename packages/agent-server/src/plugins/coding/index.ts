import path from 'node:path';

import {
  LocalExecutor,
  type BashRunOptions,
  type FindOptions,
  type GrepOptions,
  type LsOptions,
  type ToolExecutor,
} from '@assistant/coding-executor';
import type { CombinedPluginManifest } from '@assistant/shared';

import type { ToolContext } from '../../tools';
import { ToolError } from '../../tools';
import type { PluginToolDefinition, PluginConfig, ToolPlugin } from '../types';
import { SidecarSocketExecutor } from './sidecarSocketExecutor';

const CODING_PLUGIN_MANIFEST: CombinedPluginManifest = {
  id: 'coding',
  version: '0.1.0',
  server: {
    provides: ['coding'],
    capabilities: ['files.read', 'files.write', 'terminal.exec'],
  },
};

interface CodingPluginConfig extends PluginConfig {
  mode?: 'local' | 'sidecar';
  local?: {
    workspaceRoot?: string;
  };
  sidecar?: {
    socketPath?: string;
    tcp?: {
      host: string;
      port: number;
    };
    waitForReadyMs?: number;
    auth?: {
      token?: string;
      required?: boolean;
    };
  };
}

export function createCodingPlugin(): ToolPlugin {
  let executor: ToolExecutor | undefined;

  function requireExecutor(): ToolExecutor {
    if (!executor) {
      throw new ToolError('plugin_not_initialized', 'Coding plugin has not been initialized');
    }
    return executor;
  }

  function initializeExecutor(dataDir: string, pluginConfig?: CodingPluginConfig): void {
    const mode = pluginConfig?.mode ?? 'local';
    if (mode === 'local') {
      const workspaceRoot =
        pluginConfig?.local?.workspaceRoot && pluginConfig.local.workspaceRoot.trim().length > 0
          ? pluginConfig.local.workspaceRoot
          : path.join(dataDir, 'coding-workspaces');

      executor = new LocalExecutor({ workspaceRoot });
      return;
    }

    if (mode === 'sidecar') {
      const sidecarCfg = pluginConfig?.sidecar ?? {};
      const socketPath =
        sidecarCfg.socketPath && sidecarCfg.socketPath.trim().length > 0
          ? sidecarCfg.socketPath.trim()
          : undefined;
      const tcpCfg = sidecarCfg.tcp;
      const authToken =
        sidecarCfg.auth?.token && sidecarCfg.auth.token.trim().length > 0
          ? sidecarCfg.auth.token.trim()
          : undefined;
      const authRequired = sidecarCfg.auth?.required === true;

      if (authRequired && !authToken) {
        throw new ToolError(
          'invalid_plugin_config',
          'plugins.coding.sidecar.auth.token is required when auth.required is true',
        );
      }

      if (socketPath && tcpCfg) {
        throw new ToolError(
          'invalid_plugin_config',
          'Configure either plugins.coding.sidecar.socketPath or plugins.coding.sidecar.tcp (not both)',
        );
      }

      if (!socketPath && !tcpCfg) {
        throw new ToolError(
          'invalid_plugin_config',
          'plugins.coding.sidecar.socketPath or plugins.coding.sidecar.tcp is required when mode is "sidecar"',
        );
      }

      let tcpHost: string | undefined;
      if (tcpCfg) {
        tcpHost = tcpCfg.host?.trim();
        if (!tcpHost) {
          throw new ToolError(
            'invalid_plugin_config',
            'plugins.coding.sidecar.tcp.host is required when tcp is configured',
          );
        }
        if (!Number.isFinite(tcpCfg.port) || tcpCfg.port <= 0) {
          throw new ToolError(
            'invalid_plugin_config',
            'plugins.coding.sidecar.tcp.port must be a positive number',
          );
        }
      }

      const executorOptions = {
        ...(socketPath ? { socketPath } : {}),
        ...(tcpCfg
          ? {
              tcp: {
                host: tcpHost!,
                port: tcpCfg.port,
              },
            }
          : {}),
        ...(sidecarCfg.waitForReadyMs !== undefined
          ? { waitForReadyMs: sidecarCfg.waitForReadyMs }
          : {}),
        ...(authToken ? { authToken } : {}),
      };

      executor = new SidecarSocketExecutor(executorOptions);
      return;
    }

    throw new ToolError('invalid_plugin_config', `Unsupported coding plugin mode: ${mode}`);
  }

  function ensureNotAborted(ctx: ToolContext): void {
    if (ctx.signal.aborted) {
      throw new ToolError('tool_aborted', 'Tool execution aborted');
    }
  }

  const bashTool: PluginToolDefinition = {
    name: 'bash',
    description:
      'Execute a bash command in the configured workspace root. Returns combined stdout and stderr.',
    capabilities: ['terminal.exec'],
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 300)',
        },
      },
      required: ['command'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const command = args['command'];
      if (typeof command !== 'string' || !command.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: command');
      }

      ensureNotAborted(ctx);

      const timeoutRaw = args['timeout'];
      let timeoutSeconds: number | undefined;
      if (typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) && timeoutRaw > 0) {
        timeoutSeconds = timeoutRaw;
      }

      const exec = requireExecutor();

      const options: BashRunOptions = {};
      if (timeoutSeconds !== undefined) {
        options.timeoutSeconds = timeoutSeconds;
      }
      const onUpdate = ctx.onUpdate;
      if (typeof onUpdate === 'function') {
        options.onData = (chunk, source) => {
          if (!chunk) {
            return;
          }
          const update: { delta: string; details?: Record<string, unknown> } = {
            delta: chunk,
          };
          if (source === 'stdout' || source === 'stderr') {
            update.details = { stream: source };
          }
          onUpdate(update);
        };
      }

      options.abortSignal = ctx.signal;

      const result = await exec.runBash(command, options);
      if (ctx.signal.aborted) {
        throw new ToolError('tool_aborted', 'Tool execution aborted');
      }
      return result;
    },
  };

  const readTool: PluginToolDefinition = {
    name: 'read',
    description:
      'Read the contents of a file in the workspace root. Supports text files and common image formats.',
    capabilities: ['files.read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root',
        },
        offset: {
          type: 'number',
          description: 'Line number to start from (1-indexed)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['path'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPath = args['path'];
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: path');
      }

      const offsetRaw = args['offset'];
      const limitRaw = args['limit'];

      let offset: number | undefined;
      if (typeof offsetRaw === 'number' && Number.isFinite(offsetRaw)) {
        offset = offsetRaw;
      }

      let limit: number | undefined;
      if (typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0) {
        limit = limitRaw;
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();
      const options: { offset?: number; limit?: number } = {};
      if (offset !== undefined) {
        options.offset = offset;
      }
      if (limit !== undefined) {
        options.limit = limit;
      }
      return Object.keys(options).length > 0
        ? exec.readFile(rawPath, options)
        : exec.readFile(rawPath);
    },
  };

  const writeTool: PluginToolDefinition = {
    name: 'write',
    description:
      'Write content to a file in the workspace root. Creates parent directories if needed and overwrites existing files.',
    capabilities: ['files.write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root',
        },
        content: {
          type: 'string',
          description: 'Content to write',
        },
      },
      required: ['path', 'content'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPath = args['path'];
      const content = args['content'];

      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: path');
      }
      if (typeof content !== 'string') {
        throw new ToolError('invalid_arguments', 'Missing required parameter: content');
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();
      return exec.writeFile(rawPath, content);
    },
  };

  const editTool: PluginToolDefinition = {
    name: 'edit',
    description:
      'Edit a file by replacing an exact text match in the workspace root. The oldText must be unique.',
    capabilities: ['files.write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root',
        },
        oldText: {
          type: 'string',
          description: 'Exact text to find (must be unique)',
        },
        newText: {
          type: 'string',
          description: 'Replacement text',
        },
      },
      required: ['path', 'oldText', 'newText'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPath = args['path'];
      const oldText = args['oldText'];
      const newText = args['newText'];

      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: path');
      }
      if (typeof oldText !== 'string' || oldText.length === 0) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: oldText');
      }
      if (typeof newText !== 'string') {
        throw new ToolError('invalid_arguments', 'Missing required parameter: newText');
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();
      return exec.editFile(rawPath, oldText, newText);
    },
  };

  const lsTool: PluginToolDefinition = {
    name: 'ls',
    description: 'List directory contents with "/" suffix for directories.',
    capabilities: ['files.read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to list (default: workspace root)',
        },
        limit: {
          type: 'number',
          description: 'Max entries (default: 500)',
        },
      },
      required: [],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPath = args['path'];
      const rawLimit = args['limit'];

      let pathArg: string | undefined;
      if (typeof rawPath === 'string' && rawPath.trim().length > 0) {
        pathArg = rawPath;
      }

      const options: LsOptions = {};
      if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0) {
        options.limit = rawLimit;
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();

      return Object.keys(options).length > 0
        ? exec.ls(pathArg, options)
        : exec.ls(pathArg);
    },
  };

  const findTool: PluginToolDefinition = {
    name: 'find',
    description: 'Find files by glob pattern. Uses fd when available.',
    capabilities: ['files.read'],
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files, e.g. "*.ts", "**/*.json"',
        },
        path: {
          type: 'string',
          description: 'Directory to search (default: workspace root)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 1000)',
        },
      },
      required: ['pattern'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPattern = args['pattern'];
      if (typeof rawPattern !== 'string' || !rawPattern.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: pattern');
      }

      const rawPath = args['path'];
      let pathArg: string | undefined;
      if (typeof rawPath === 'string' && rawPath.trim().length > 0) {
        pathArg = rawPath;
      }

      const rawLimit = args['limit'];
      let limit: number | undefined;
      if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = Math.floor(rawLimit);
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();

      const options: FindOptions = {
        pattern: rawPattern,
      };
      if (pathArg !== undefined) {
        options.path = pathArg;
      }
      if (limit !== undefined) {
        options.limit = limit;
      }

      const result = await exec.find(options, ctx.signal);
      if (ctx.signal.aborted) {
        throw new ToolError('tool_aborted', 'Tool execution aborted');
      }
      return result;
    },
  };

  const grepTool: PluginToolDefinition = {
    name: 'grep',
    description:
      'Search file contents for a pattern. Returns matching lines with file paths and line numbers. Uses ripgrep when available with a Node.js fallback.',
    capabilities: ['files.read'],
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (regex or literal)',
        },
        path: {
          type: 'string',
          description: 'Directory to search (default: workspace root)',
        },
        glob: {
          type: 'string',
          description: 'Filter files by glob pattern, e.g. "*.ts"',
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case-insensitive search (default: false)',
        },
        literal: {
          type: 'boolean',
          description: 'Treat pattern as literal string (default: false)',
        },
        context: {
          type: 'number',
          description: 'Lines of context around matches (default: 0)',
        },
        limit: {
          type: 'number',
          description: 'Max matches (default: 100)',
        },
      },
      required: ['pattern'],
    },
    async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
      const rawPattern = args['pattern'];
      if (typeof rawPattern !== 'string' || !rawPattern.trim()) {
        throw new ToolError('invalid_arguments', 'Missing required parameter: pattern');
      }

      const pattern = rawPattern.trim();
      const pathArg = args['path'];
      const globArg = args['glob'];
      const ignoreCaseArg = args['ignoreCase'];
      const literalArg = args['literal'];
      const contextArg = args['context'];
      const limitArg = args['limit'];

      const options: GrepOptions = { pattern };

      if (typeof pathArg === 'string' && pathArg.trim()) {
        options.path = pathArg;
      }
      if (typeof globArg === 'string' && globArg.trim()) {
        options.glob = globArg;
      }
      if (typeof ignoreCaseArg === 'boolean') {
        options.ignoreCase = ignoreCaseArg;
      }
      if (typeof literalArg === 'boolean') {
        options.literal = literalArg;
      }
      if (typeof contextArg === 'number' && Number.isFinite(contextArg) && contextArg >= 0) {
        options.context = contextArg;
      }
      if (typeof limitArg === 'number' && Number.isFinite(limitArg) && limitArg > 0) {
        options.limit = limitArg;
      }

      ensureNotAborted(ctx);

      const exec = requireExecutor();
      const result = await exec.grep(options, ctx.signal);
      if (ctx.signal.aborted) {
        throw new ToolError('tool_aborted', 'Tool execution aborted');
      }
      return result;
    },
  };

  const tools: PluginToolDefinition[] = [
    bashTool,
    readTool,
    writeTool,
    editTool,
    lsTool,
    findTool,
    grepTool,
  ];

  return {
    name: 'coding',
    manifest: CODING_PLUGIN_MANIFEST,
    tools,
    async initialize(dataDir: string, pluginConfig?: PluginConfig): Promise<void> {
      initializeExecutor(dataDir, pluginConfig as CodingPluginConfig | undefined);
    },
    async shutdown(): Promise<void> {
      if (!executor) {
        return;
      }

      const exec = executor as ToolExecutor & {
        shutdown?: () => Promise<void>;
      };

      if (typeof exec.shutdown === 'function') {
        await exec.shutdown();
      }
    },
  };
}
