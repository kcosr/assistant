import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { truncateHead } from '@assistant/coding-executor';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstanceDataDir,
  resolvePluginInstanceConfigs,
  type PluginInstanceConfigDefinition,
  type PluginInstanceDefinition,
} from '../../../../agent-server/src/plugins/instances';

import {
  DiffReviewStore,
  type DiffReviewComment,
  type DiffReviewStatus,
  type DiffReviewTarget,
} from './reviewStore';
import { getDiffSelection, getDiffSnapshot } from './selectionStore';
import {
  getRepoBranch,
  resolvePathWithinRoot,
  resolveRepoRoot,
  runGit,
  runGitWithInput,
} from './git';
import {
  listWorkspaceEntries,
  listWorkspaceRepos,
  type WorkspaceEntry,
  type WorkspaceRepoEntry,
} from './workspace';
import { readWorkspaceFile } from './workspaceRead';
import { getDiffPatch } from './patch';
import { getDiffStatus, type DiffTarget } from './status';
import { createDiffPanelEventHandler } from './watch';

const MAX_PATCH_BYTES = 200 * 1024;
const MAX_PATCH_LINES = 4000;
const MAX_STAGE_PATCH_BYTES = 128 * 1024;

const TARGETS: DiffReviewTarget[] = ['working', 'staged'];

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type StatusResponse = {
  repoRoot: string;
  repoRootAbsolute: string;
  branch: string;
  target: DiffTarget;
  entries: Array<{ path: string; status: string; renameFrom?: string }>;
  truncated: boolean;
};

type WorkspaceListResponse = {
  root: string;
  rootName: string;
  rootIsRepo: boolean;
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
};

type WorkspaceRepoListResponse = {
  root: string;
  rootName: string;
  maxDepth: number;
  maxRepos: number;
  repos: WorkspaceRepoEntry[];
  truncated: boolean;
};

type WorkspaceReadResponse = {
  root: string;
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

type PatchResponse = {
  repoRoot: string;
  repoRootAbsolute: string;
  target: DiffTarget;
  path: string;
  patch: string;
  truncated: boolean;
};

type HunkResponse = PatchResponse & {
  hunkIndex: number;
  hunkHash: string;
};

type ParsedHunk = {
  index: number;
  hash: string;
  lines: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
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

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  return value;
}

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ToolError('invalid_arguments', `${field} must be a number`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new ToolError('invalid_arguments', `${field} must be a number`);
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new ToolError('invalid_arguments', `${field} must be a number`);
    }
    return parsed;
  }
  throw new ToolError('invalid_arguments', `${field} must be a number`);
}

function parseTarget(value: unknown): DiffTarget {
  if (value === undefined || value === null || value === '') {
    return 'working';
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', 'target must be a string');
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'working' || trimmed === 'staged') {
    return trimmed as DiffTarget;
  }
  throw new ToolError('invalid_arguments', 'target must be working or staged');
}

function parseReviewTarget(value: unknown): DiffReviewTarget {
  if (value === undefined || value === null || value === '') {
    return 'working';
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', 'target must be a string');
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'working' || trimmed === 'staged') {
    return trimmed as DiffReviewTarget;
  }
  throw new ToolError('invalid_arguments', 'target must be working or staged');
}

function parseReviewStatus(value: unknown): DiffReviewStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', 'status must be a string');
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'open' || trimmed === 'resolved') {
    return trimmed as DiffReviewStatus;
  }
  throw new ToolError('invalid_arguments', 'status must be open or resolved');
}

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

function requireWorkspaceRoot(workspaceRoot: string | null, instanceId?: string): string {
  if (!workspaceRoot) {
    const suffix = instanceId ? ` for instance "${instanceId}"` : '';
    throw new ToolError('invalid_configuration', `Diff workspace root is not configured${suffix}`);
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new ToolError('invalid_configuration', 'Diff workspace root must be an absolute path');
  }
  return workspaceRoot;
}

function requireRelativePath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ToolError('invalid_arguments', 'Path is outside the repository root');
  }
  return relative.split(path.sep).join('/');
}

function normalizeRepoPathValue(
  workspaceRoot: string,
  repoRoot: { root: string },
  inputPath: string,
): string {
  const absolute = resolvePathWithinRoot(workspaceRoot, inputPath);
  return requireRelativePath(repoRoot.root, absolute);
}

function serializeReviewComment(comment: DiffReviewComment) {
  return {
    id: comment.id,
    path: comment.path,
    target: comment.target,
    hunkHash: comment.hunkHash,
    branch: comment.branch,
    ...(comment.header ? { header: comment.header } : {}),
    body: comment.body,
    status: comment.status,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return ('0000000' + hash.toString(16)).slice(-8);
}

function buildHunkHash(filePath: string, lines: string[]): string {
  const signature = [filePath, ...lines].join('\n');
  return hashString(signature);
}

function parsePatchHunks(
  patchText: string,
  filePath: string,
): {
  prelude: string[];
  hunks: ParsedHunk[];
} {
  const lines = patchText.split('\n');
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunkIndex === -1) {
    return { prelude: lines, hunks: [] };
  }
  const prelude = lines.slice(0, firstHunkIndex);
  const hunks: ParsedHunk[] = [];
  let index = 0;
  let cursor = firstHunkIndex;
  while (cursor < lines.length) {
    if (!lines[cursor]?.startsWith('@@')) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    cursor += 1;
    while (cursor < lines.length && !lines[cursor]?.startsWith('@@')) {
      cursor += 1;
    }
    const hunkLines = lines.slice(start, cursor);
    const hash = buildHunkHash(filePath, hunkLines);
    hunks.push({ index, hash, lines: hunkLines });
    index += 1;
  }
  return { prelude, hunks };
}

function extractHunkPatch(
  patchText: string,
  filePath: string,
  selection: { hunkHash?: string; hunkIndex?: number },
): { patch: string; hunkIndex: number; hunkHash: string } | null {
  const { prelude, hunks } = parsePatchHunks(patchText, filePath);
  if (hunks.length === 0) {
    return null;
  }

  let chosen: ParsedHunk | undefined;
  if (selection.hunkHash) {
    chosen = hunks.find((hunk) => hunk.hash === selection.hunkHash);
  } else if (selection.hunkIndex !== undefined) {
    chosen = hunks.find((hunk) => hunk.index === selection.hunkIndex);
  }

  if (!chosen) {
    return null;
  }

  const patchLines = prelude.concat(chosen.lines);
  let patch = patchLines.join('\n');
  if (!patch.endsWith('\n')) {
    patch += '\n';
  }
  return { patch, hunkIndex: chosen.index, hunkHash: chosen.hash };
}

async function resolveRepo(
  workspaceRoot: string,
  repoPath: string | null,
): Promise<{ root: string; relative: string; branch: string } | { error: string; status: number }> {
  const repoRoot = await resolveRepoRoot(workspaceRoot, repoPath);
  if ('error' in repoRoot) {
    return repoRoot;
  }
  const branchInfo = await getRepoBranch(repoRoot.root);
  if ('error' in branchInfo) {
    return branchInfo;
  }
  if (branchInfo.detached) {
    return { error: 'Repository is in detached HEAD state', status: 409 };
  }
  return { ...repoRoot, branch: branchInfo.branch };
}

async function listStatus(
  workspaceRoot: string,
  repoPath: string | null,
  target: DiffTarget,
): Promise<StatusResponse> {
  const status = await getDiffStatus({ workspaceRoot, repoPath, target });
  if ('error' in status) {
    throw new ToolError('diff_status_failed', status.error);
  }
  return {
    repoRoot: status.repoRoot.relative,
    repoRootAbsolute: status.repoRoot.root,
    branch: status.branch,
    target: status.target,
    entries: status.entries,
    truncated: status.truncated,
  };
}

async function buildPatch(
  workspaceRoot: string,
  repoPath: string | null,
  target: DiffTarget,
  filePath: string,
): Promise<PatchResponse> {
  const patchResult = await getDiffPatch({
    workspaceRoot,
    repoPath,
    target,
    path: filePath,
  });
  if ('error' in patchResult) {
    throw new ToolError('diff_repo_not_found', patchResult.error);
  }

  const truncation = truncateHead(patchResult.patch, {
    maxBytes: MAX_PATCH_BYTES,
    maxLines: MAX_PATCH_LINES,
  });

  return {
    repoRoot: patchResult.repoRoot.relative,
    repoRootAbsolute: patchResult.repoRoot.root,
    target,
    path: patchResult.path,
    patch: truncation.content || '',
    truncated: truncation.truncated || truncation.firstLineExceedsLimit || patchResult.truncated,
  };
}

function broadcastPanelUpdate(
  ctx: ToolContext,
  panelId: string,
  update: Record<string, unknown>,
): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId,
    panelType: 'diff',
    payload: {
      type: 'panel_update',
      ...update,
    },
  });
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let baseDataDir = '';
  let instances: PluginInstanceConfigDefinition[] = [];
  let instanceById = new Map<string, PluginInstanceConfigDefinition>();
  const reviewStores = new Map<string, DiffReviewStore>();

  const resolveInstanceId = (value: unknown): string => {
    if (value === undefined) {
      return DEFAULT_PLUGIN_INSTANCE_ID;
    }
    if (typeof value !== 'string') {
      throw new ToolError('invalid_arguments', 'instance_id must be a string');
    }
    const normalized = normalizePluginInstanceId(value);
    if (!normalized) {
      throw new ToolError(
        'invalid_arguments',
        'instance_id must be a slug (letters, numbers, hyphens, underscores)',
      );
    }
    if (!instanceById.has(normalized)) {
      throw new ToolError('invalid_arguments', `Unknown instance_id: ${normalized}`);
    }
    return normalized;
  };

  const getInstanceConfig = (instanceId: string): PluginInstanceConfigDefinition => {
    const instance = instanceById.get(instanceId);
    if (!instance) {
      throw new ToolError('invalid_arguments', `Unknown instance_id: ${instanceId}`);
    }
    return instance;
  };

  const getWorkspaceRootForInstance = (instanceId: string): string | null => {
    const instance = instanceById.get(instanceId);
    return instance?.config.workspaceRoot ?? null;
  };

  const getReviewStore = (instanceId: string): DiffReviewStore => {
    const existing = reviewStores.get(instanceId);
    if (existing) {
      return existing;
    }
    if (!baseDataDir) {
      throw new ToolError('plugin_not_initialized', 'Diff plugin has not been initialized');
    }
    const instanceDir = resolvePluginInstanceDataDir(baseDataDir, instanceId);
    const store = new DiffReviewStore(path.join(instanceDir, 'diff-comments.json'));
    reviewStores.set(instanceId, store);
    return store;
  };

  return {
    panelEventHandlers: {
      diff: createDiffPanelEventHandler(getWorkspaceRootForInstance),
    },
    operations: {
      instance_list: async (): Promise<PluginInstanceDefinition[]> =>
        instances.map((instance) => ({ id: instance.id, label: instance.label })),
      status: async (args): Promise<StatusResponse> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseTarget(parsed['target']);
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        return listStatus(root, repoPath ?? null, target);
      },
      'workspace-list': async (args): Promise<WorkspaceListResponse> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const relativePath = parseOptionalString(parsed['path'], 'path');
        const result = await listWorkspaceEntries({
          workspaceRoot: root,
          path: relativePath ?? null,
        });
        if ('error' in result) {
          throw new ToolError('diff_workspace_list_failed', result.error);
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
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const filePath = requireNonEmptyString(parsed['path'], 'path');
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const result = await readWorkspaceFile({ workspaceRoot: root, path: filePath });
        if ('error' in result) {
          throw new ToolError('diff_workspace_read_failed', result.error);
        }
        return {
          root: result.root,
          path: result.path,
          content: result.content,
          truncated: result.truncated,
          binary: result.binary,
        };
      },
      'workspace-repos': async (args): Promise<WorkspaceRepoListResponse> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const maxDepth = parseOptionalNumber(parsed['maxDepth'], 'maxDepth');
        const maxRepos = parseOptionalNumber(parsed['maxRepos'], 'maxRepos');
        const result = await listWorkspaceRepos({
          workspaceRoot: root,
          maxDepth: maxDepth ?? undefined,
          maxRepos: maxRepos ?? undefined,
        });
        if ('error' in result) {
          throw new ToolError('diff_workspace_repos_failed', result.error);
        }
        return {
          root: result.root,
          rootName: result.rootName,
          maxDepth: result.maxDepth,
          maxRepos: result.maxRepos,
          repos: result.repos,
          truncated: result.truncated,
        };
      },
      patch: async (args): Promise<PatchResponse> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseTarget(parsed['target']);
        const filePath = requireNonEmptyString(parsed['path'], 'path');
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        return buildPatch(root, repoPath ?? null, target, filePath);
      },
      hunk: async (args): Promise<HunkResponse> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseTarget(parsed['target']);
        const filePath = requireNonEmptyString(parsed['path'], 'path');
        const hunkHash = parseOptionalString(parsed['hunkHash'], 'hunkHash');
        const hunkIndexRaw = parseOptionalNumber(parsed['hunkIndex'], 'hunkIndex');
        const hunkIndex = hunkIndexRaw !== undefined ? hunkIndexRaw : undefined;
        if (!hunkHash && hunkIndex === undefined) {
          throw new ToolError('invalid_arguments', 'hunk requires hunkHash or hunkIndex');
        }
        if (hunkIndex !== undefined && !Number.isInteger(hunkIndex)) {
          throw new ToolError('invalid_arguments', 'hunkIndex must be an integer');
        }
        if (hunkIndex !== undefined && hunkIndex < 0) {
          throw new ToolError('invalid_arguments', 'hunkIndex must be a non-negative integer');
        }
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const patch = await buildPatch(root, repoPath ?? null, target, filePath);
        const selection = extractHunkPatch(patch.patch, patch.path, {
          ...(hunkHash ? { hunkHash } : {}),
          ...(hunkIndex !== undefined ? { hunkIndex } : {}),
        });
        if (!selection) {
          throw new ToolError('diff_hunk_not_found', 'Diff hunk not found');
        }
        const truncation = truncateHead(selection.patch, {
          maxBytes: MAX_PATCH_BYTES,
          maxLines: MAX_PATCH_LINES,
        });
        return {
          ...patch,
          patch: truncation.content || '',
          truncated: truncation.truncated || truncation.firstLineExceedsLimit || patch.truncated,
          hunkIndex: selection.hunkIndex,
          hunkHash: selection.hunkHash,
        };
      },
      show: async (args, ctx): Promise<{ ok: true; panelId: string }> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseTarget(parsed['target']);
        const filePath = parseOptionalString(parsed['path'], 'path');
        const hunkHash = parseOptionalString(parsed['hunkHash'], 'hunkHash');
        const sessionHub = requireSessionHub(ctx);
        sessionHub.broadcastToAll({
          type: 'panel_event',
          panelId,
          panelType: 'diff',
          payload: {
            type: 'diff_show',
            instance_id: instanceId,
            ...(repoPath ? { repoPath } : {}),
            ...(target ? { target } : {}),
            ...(filePath ? { path: filePath } : {}),
            ...(hunkHash ? { hunkHash } : {}),
          },
        });
        return { ok: true, panelId };
      },
      'hunks-list': async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        return getDiffSnapshot(panelId);
      },
      'selection-get': async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        return getDiffSelection(panelId);
      },
      'comments-list': async (args): Promise<{ repoRoot: string; comments: unknown[] }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseReviewTarget(parsed['target']);
        if (!TARGETS.includes(target)) {
          throw new ToolError('invalid_arguments', 'target must be working or staged');
        }
        const pathFilter = parseOptionalString(parsed['path'], 'path');
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        const reviewStore = getReviewStore(instanceId);
        const normalizedPath = pathFilter
          ? normalizeRepoPathValue(root, repoRoot, pathFilter)
          : undefined;
        const comments = await reviewStore.listComments({
          repoRoot: repoRoot.root,
          branch: repoRoot.branch,
          ...(normalizedPath ? { path: normalizedPath } : {}),
          ...(target ? { target } : {}),
        });
        return {
          repoRoot: repoRoot.relative,
          comments: comments.map(serializeReviewComment),
        };
      },
      'comment-add': async (args, ctx): Promise<{ repoRoot: string; comment: unknown }> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const target = parseReviewTarget(parsed['target']);
        if (!TARGETS.includes(target)) {
          throw new ToolError('invalid_arguments', 'target must be working or staged');
        }
        const pathValue = requireNonEmptyString(parsed['path'], 'path');
        const hunkHash = requireNonEmptyString(parsed['hunkHash'], 'hunkHash');
        const body = requireNonEmptyString(parsed['body'], 'body');
        const header = parseOptionalString(parsed['header'], 'header');
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        const reviewStore = getReviewStore(instanceId);
        const normalizedPath = normalizeRepoPathValue(root, repoRoot, pathValue);
        const comment = await reviewStore.createComment({
          repoRoot: repoRoot.root,
          branch: repoRoot.branch,
          path: normalizedPath,
          target,
          hunkHash,
          ...(header ? { header } : {}),
          body,
        });
        const serialized = serializeReviewComment(comment);
        broadcastPanelUpdate(ctx, panelId, {
          action: 'comment_added',
          instance_id: instanceId,
          comment: serialized,
        });
        return { repoRoot: repoRoot.relative, comment: serialized };
      },
      'comment-update': async (args, ctx): Promise<{ repoRoot: string; comment: unknown }> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const id = requireNonEmptyString(parsed['id'], 'id');
        const body = parseOptionalString(parsed['body'], 'body');
        const status = parseReviewStatus(parsed['status']);
        if (!body && !status) {
          throw new ToolError('invalid_arguments', 'comment-update requires body or status');
        }
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        const reviewStore = getReviewStore(instanceId);
        const updated = await reviewStore.updateComment(id, repoRoot.root, repoRoot.branch, {
          ...(body !== undefined ? { body } : {}),
          ...(status ? { status } : {}),
        });
        if (!updated) {
          throw new ToolError('comment_not_found', `Comment not found: ${id}`);
        }
        const serialized = serializeReviewComment(updated);
        broadcastPanelUpdate(ctx, panelId, {
          action: 'comment_updated',
          instance_id: instanceId,
          comment: serialized,
        });
        return { repoRoot: repoRoot.relative, comment: serialized };
      },
      'comment-delete': async (args, ctx): Promise<{ ok: true }> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const id = requireNonEmptyString(parsed['id'], 'id');
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        const reviewStore = getReviewStore(instanceId);
        const deleted = await reviewStore.deleteComment(id, repoRoot.root, repoRoot.branch);
        if (!deleted) {
          throw new ToolError('comment_not_found', `Comment not found: ${id}`);
        }
        broadcastPanelUpdate(ctx, panelId, {
          action: 'comment_deleted',
          instance_id: instanceId,
          id,
        });
        return { ok: true };
      },
      stage: async (args, ctx): Promise<StatusResponse> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const patch = parseOptionalString(parsed['patch'], 'patch');
        const filePath = parseOptionalString(parsed['path'], 'path');
        if (!patch && !filePath) {
          throw new ToolError('invalid_arguments', 'stage requires patch or path');
        }
        if (patch && patch.length > MAX_STAGE_PATCH_BYTES) {
          throw new ToolError('invalid_arguments', 'Patch is too large to stage');
        }
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        if (patch) {
          const result = await runGitWithInput(repoRoot.root, ['apply', '--cached'], patch, {
            maxOutputBytes: 4096,
          });
          if (result.exitCode !== 0) {
            throw new ToolError(
              'stage_failed',
              result.stderr || result.stdout || 'Failed to stage patch',
            );
          }
        } else if (filePath) {
          const absolute = resolvePathWithinRoot(root, filePath);
          const relativePath = requireRelativePath(repoRoot.root, absolute);
          const result = await runGit(repoRoot.root, ['add', '--', relativePath], {
            maxOutputBytes: 4096,
          });
          if (result.exitCode !== 0) {
            throw new ToolError(
              'stage_failed',
              result.stderr || result.stdout || 'Failed to stage file',
            );
          }
        }
        const status = await listStatus(root, repoPath ?? null, 'working');
        broadcastPanelUpdate(ctx, panelId, {
          action: 'status_changed',
          instance_id: instanceId,
          ...status,
        });
        return status;
      },
      unstage: async (args, ctx): Promise<StatusResponse> => {
        const parsed = asObject(args);
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const instance = getInstanceConfig(instanceId);
        const repoPath = parseOptionalString(parsed['repoPath'], 'repoPath');
        const patch = parseOptionalString(parsed['patch'], 'patch');
        const filePath = parseOptionalString(parsed['path'], 'path');
        if (!patch && !filePath) {
          throw new ToolError('invalid_arguments', 'unstage requires patch or path');
        }
        if (patch && patch.length > MAX_STAGE_PATCH_BYTES) {
          throw new ToolError('invalid_arguments', 'Patch is too large to unstage');
        }
        const root = requireWorkspaceRoot(instance.config.workspaceRoot ?? null, instanceId);
        const repoRoot = await resolveRepo(root, repoPath ?? null);
        if ('error' in repoRoot) {
          throw new ToolError('diff_repo_not_found', repoRoot.error);
        }
        if (patch) {
          const result = await runGitWithInput(
            repoRoot.root,
            ['apply', '--cached', '--reverse'],
            patch,
            { maxOutputBytes: 4096 },
          );
          if (result.exitCode !== 0) {
            throw new ToolError(
              'unstage_failed',
              result.stderr || result.stdout || 'Failed to unstage patch',
            );
          }
        } else if (filePath) {
          const absolute = resolvePathWithinRoot(root, filePath);
          const relativePath = requireRelativePath(repoRoot.root, absolute);
          const result = await runGit(repoRoot.root, ['reset', '--', relativePath], {
            maxOutputBytes: 4096,
          });
          if (result.exitCode !== 0) {
            throw new ToolError(
              'unstage_failed',
              result.stderr || result.stdout || 'Failed to unstage file',
            );
          }
        }
        const status = await listStatus(root, repoPath ?? null, 'staged');
        broadcastPanelUpdate(ctx, panelId, {
          action: 'status_changed',
          instance_id: instanceId,
          ...status,
        });
        return status;
      },
    },
    async initialize(dataDir, pluginConfig): Promise<void> {
      baseDataDir = dataDir;
      instances = resolvePluginInstanceConfigs('diff', pluginConfig);
      instanceById = new Map(instances.map((instance) => [instance.id, instance]));
      reviewStores.clear();
    },
    async shutdown(): Promise<void> {
      baseDataDir = '';
      instances = [];
      instanceById = new Map();
      reviewStores.clear();
    },
  };
}
