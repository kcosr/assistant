import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';

import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import { ToolError } from '../../../../agent-server/src/tools';

import { listWorkspaceEntries, type WorkspaceEntry } from './workspace';
import { readWorkspaceFile } from './workspaceRead';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type WorkspaceListResponse = {
  root: string;
  rootName: string;
  rootIsRepo: boolean;
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
};

type WorkspaceReadResponse = {
  root: string;
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} cannot be empty`);
  }
  return trimmed;
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (!workspaceRoot) {
    throw new ToolError('invalid_configuration', 'Files workspace root is not configured');
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new ToolError('invalid_configuration', 'Files workspace root must be an absolute path');
  }
  return workspaceRoot;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let workspaceRoot: string | null = null;

  return {
    operations: {
      'workspace-list': async (args): Promise<WorkspaceListResponse> => {
        const parsed = asObject(args);
        const relativePath = parseOptionalString(parsed['path'], 'path');
        const root = requireWorkspaceRoot(workspaceRoot);
        const result = await listWorkspaceEntries({
          workspaceRoot: root,
          path: relativePath ?? null,
        });
        if ('error' in result) {
          if (result.status === 400) {
            throw new ToolError('invalid_arguments', result.error);
          }
          if (result.status === 404) {
            throw new ToolError('files_not_found', result.error);
          }
          throw new ToolError('files_workspace_list_failed', result.error);
        }
        return {
          root: result.root,
          rootName: result.rootName,
          rootIsRepo: result.rootIsRepo,
          path: result.path,
          entries: result.entries,
          truncated: result.truncated,
        };
      },
      'workspace-read': async (args): Promise<WorkspaceReadResponse> => {
        const parsed = asObject(args);
        const filePath = requireNonEmptyString(parsed['path'], 'path');
        const root = requireWorkspaceRoot(workspaceRoot);
        const result = await readWorkspaceFile({ workspaceRoot: root, path: filePath });
        if ('error' in result) {
          if (result.status === 400) {
            throw new ToolError('invalid_arguments', result.error);
          }
          if (result.status === 404) {
            throw new ToolError('files_not_found', result.error);
          }
          throw new ToolError('files_workspace_read_failed', result.error);
        }
        return {
          root: result.root,
          path: result.path,
          content: result.content,
          truncated: result.truncated,
          binary: result.binary,
        };
      },
    },
    async initialize(_dataDir, pluginConfig): Promise<void> {
      workspaceRoot = pluginConfig?.workspaceRoot ?? null;
    },
    async shutdown(): Promise<void> {
      workspaceRoot = null;
    },
  };
}
