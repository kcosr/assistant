import { createHash } from 'node:crypto';

import type { PanelEventEnvelope, ServerMessage } from '@assistant/shared';

import type {
  PanelEventHandler,
  PanelEventHandlerContext,
} from '../../../../agent-server/src/plugins/types';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
} from '../../../../agent-server/src/plugins/instances';
import type { DiffTarget } from './status';
import { getDiffStatus } from './status';
import { listWorkspaceEntries } from './workspace';
import {
  clearDiffPanelState,
  clearDiffSelection,
  getDiffSelection,
  getDiffSnapshot,
  updateDiffHunksSnapshot,
  updateDiffSelection,
} from './selectionStore';
import { getDiffPatch } from './patch';

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 10000;
const PING_TIMEOUT_MS = 15000;

type DiffWatchRegistration = {
  key: string;
  panelId: string;
  connectionId: string;
  connection: PanelEventHandlerContext['connection'];
  instanceId: string;
  target: DiffTarget;
  repoPath: string | null;
  workspaceRoot: string;
  intervalMs: number;
  lastStatusDigest: string | null;
  lastPatchDigest: string | null;
  lastFilesDigest: string | null;
  lastPingAt: number;
  timer: NodeJS.Timeout | null;
};

const registrations = new Map<string, DiffWatchRegistration>();

function buildKey(connectionId: string, panelId: string): string {
  return `${connectionId}:${panelId}`;
}

function clampInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_INTERVAL_MS;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, rounded));
}

function parseTarget(value: unknown): DiffTarget {
  if (value === 'staged') {
    return 'staged';
  }
  return 'working';
}

function parseInstanceId(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_PLUGIN_INSTANCE_ID;
  }
  const normalized = normalizePluginInstanceId(value);
  return normalized ?? DEFAULT_PLUGIN_INSTANCE_ID;
}

function sendPanelEvent(
  connection: PanelEventHandlerContext['connection'],
  panelId: string,
  payload: Record<string, unknown>,
): void {
  const message: ServerMessage = {
    type: 'panel_event',
    panelId,
    panelType: 'diff',
    payload,
  };
  connection.sendServerMessageFromHub(message);
}

function serializeDigest(
  entries: Array<{ path: string; status: string; renameFrom?: string }>,
): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('|');
    hash.update(entry.status);
    if (entry.renameFrom) {
      hash.update('|');
      hash.update(entry.renameFrom);
    }
    hash.update('\n');
  }
  return hash.digest('hex');
}

function serializeFilesDigest(entries: Array<{ path: string; type: string }>): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('|');
    hash.update(entry.type);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function resolveSelectedPath(panelId: string): string | null {
  const selection = getDiffSelection(panelId);
  if (selection?.path) {
    return selection.path;
  }
  const snapshot = getDiffSnapshot(panelId);
  if (snapshot?.path) {
    return snapshot.path;
  }
  const firstHunkPath = snapshot?.hunks[0]?.path;
  return firstHunkPath ?? null;
}

async function computeStatusDigest(registration: DiffWatchRegistration): Promise<{
  statusDigest: string | null;
  patchDigest: string | null;
  filesDigest: string | null;
  entries: Array<{ path: string; status: string; renameFrom?: string }>;
  repoRoot: string | null;
  repoRootAbsolute: string | null;
  branch: string | null;
  truncated: boolean;
  selectedPath: string | null;
  error?: string;
}> {
  const status = await getDiffStatus({
    workspaceRoot: registration.workspaceRoot,
    repoPath: registration.repoPath,
    target: registration.target,
  });
  if ('error' in status) {
    return {
      statusDigest: null,
      patchDigest: null,
      filesDigest: null,
      entries: [],
      repoRoot: null,
      repoRootAbsolute: null,
      branch: null,
      truncated: false,
      selectedPath: null,
      error: status.error,
    };
  }
  const statusDigest = serializeDigest(status.entries);
  let filesDigest: string | null = null;
  try {
    const fileResult = await listWorkspaceEntries({
      workspaceRoot: registration.workspaceRoot,
      path: null,
    });
    if (!('error' in fileResult)) {
      filesDigest = serializeFilesDigest(fileResult.entries);
    }
  } catch {
    filesDigest = null;
  }
  const selectedPath = resolveSelectedPath(registration.panelId);
  let patchDigest: string | null = null;
  if (selectedPath) {
    try {
      const patchResult = await getDiffPatch({
        workspaceRoot: registration.workspaceRoot,
        repoPath: registration.repoPath,
        target: registration.target,
        path: selectedPath,
      });
      if (!('error' in patchResult)) {
        const hash = createHash('sha256');
        hash.update(patchResult.patch);
        patchDigest = hash.digest('hex');
      }
    } catch {
      patchDigest = null;
    }
  }
  return {
    statusDigest,
    patchDigest,
    filesDigest,
    entries: status.entries,
    repoRoot: status.repoRoot.relative,
    repoRootAbsolute: status.repoRoot.root,
    branch: status.branch,
    truncated: status.truncated,
    selectedPath,
  };
}

function scheduleNext(registration: DiffWatchRegistration): void {
  if (registration.timer) {
    clearTimeout(registration.timer);
  }
  registration.timer = setTimeout(() => {
    tickRegistration(registration.key).catch(() => {});
  }, registration.intervalMs);
}

function unregister(key: string): void {
  const existing = registrations.get(key);
  if (!existing) {
    return;
  }
  if (existing.timer) {
    clearTimeout(existing.timer);
  }
  registrations.delete(key);
}

async function tickRegistration(key: string): Promise<void> {
  const registration = registrations.get(key);
  if (!registration) {
    return;
  }
  const now = Date.now();
  if (now - registration.lastPingAt > PING_TIMEOUT_MS) {
    unregister(key);
    return;
  }

  const result = await computeStatusDigest(registration);
  if (!result.statusDigest) {
    sendPanelEvent(registration.connection, registration.panelId, {
      type: 'panel_update',
      instance_id: registration.instanceId,
      action: 'status_error',
      message: result.error || 'Diff watch failed.',
    });
    unregister(key);
    return;
  }

  const statusChanged =
    registration.lastStatusDigest !== null && registration.lastStatusDigest !== result.statusDigest;
  const patchChanged =
    !statusChanged &&
    registration.lastPatchDigest !== null &&
    result.patchDigest !== null &&
    registration.lastPatchDigest !== result.patchDigest;
  const filesChanged =
    !statusChanged &&
    registration.lastFilesDigest !== null &&
    result.filesDigest !== null &&
    registration.lastFilesDigest !== result.filesDigest;

  if (statusChanged) {
    sendPanelEvent(registration.connection, registration.panelId, {
      type: 'panel_update',
      instance_id: registration.instanceId,
      action: 'status_changed',
      target: registration.target,
      repoPath: registration.repoPath,
      repoRoot: result.repoRoot,
      repoRootAbsolute: result.repoRootAbsolute ?? undefined,
      branch: result.branch ?? undefined,
      entries: result.entries,
      truncated: result.truncated,
    });
  } else if (patchChanged) {
    sendPanelEvent(registration.connection, registration.panelId, {
      type: 'panel_update',
      instance_id: registration.instanceId,
      action: 'patch_changed',
      target: registration.target,
      repoPath: registration.repoPath,
      ...(result.selectedPath ? { path: result.selectedPath } : {}),
    });
  } else if (filesChanged) {
    sendPanelEvent(registration.connection, registration.panelId, {
      type: 'panel_update',
      instance_id: registration.instanceId,
      action: 'files_changed',
      target: registration.target,
      repoPath: registration.repoPath,
    });
  }
  registration.lastStatusDigest = result.statusDigest;
  registration.lastPatchDigest = result.patchDigest;
  if (result.filesDigest !== null) {
    registration.lastFilesDigest = result.filesDigest;
  }
  scheduleNext(registration);
}

async function registerWatch(
  ctx: PanelEventHandlerContext,
  event: PanelEventEnvelope,
  payload: Record<string, unknown> | null,
  getWorkspaceRoot: (instanceId: string) => string | null,
): Promise<void> {
  const panelId = event.panelId;
  const target = parseTarget(payload?.['target']);
  const instanceId = parseInstanceId(payload?.['instance_id']);
  const intervalMs = clampInterval(payload?.['intervalMs']);
  const repoPathValue = payload?.['repoPath'];
  const repoPath = typeof repoPathValue === 'string' ? repoPathValue.trim() || null : null;

  const workspaceRoot = getWorkspaceRoot(instanceId);
  if (!workspaceRoot) {
    sendPanelEvent(ctx.connection, panelId, {
      type: 'panel_update',
      instance_id: instanceId,
      action: 'status_error',
      message: 'Diff workspace root is not configured.',
    });
    return;
  }

  const key = buildKey(ctx.connectionId, panelId);
  unregister(key);

  const registration: DiffWatchRegistration = {
    key,
    panelId,
    connectionId: ctx.connectionId,
    connection: ctx.connection,
    instanceId,
    target,
    repoPath,
    workspaceRoot,
    intervalMs,
    lastStatusDigest: null,
    lastPatchDigest: null,
    lastFilesDigest: null,
    lastPingAt: Date.now(),
    timer: null,
  };
  registrations.set(key, registration);

  const initial = await computeStatusDigest(registration);
  if (!initial.statusDigest) {
    sendPanelEvent(ctx.connection, panelId, {
      type: 'panel_update',
      instance_id: instanceId,
      action: 'status_error',
      message: initial.error || 'Diff watch failed.',
    });
    unregister(key);
    return;
  }
  registration.lastStatusDigest = initial.statusDigest;
  registration.lastPatchDigest = initial.patchDigest;
  if (initial.filesDigest !== null) {
    registration.lastFilesDigest = initial.filesDigest;
  }
  sendPanelEvent(ctx.connection, panelId, {
    type: 'panel_update',
    instance_id: instanceId,
    action: 'status_changed',
    target,
    repoPath,
    repoRoot: initial.repoRoot,
    repoRootAbsolute: initial.repoRootAbsolute ?? undefined,
    branch: initial.branch ?? undefined,
    entries: initial.entries,
    truncated: initial.truncated,
  });
  scheduleNext(registration);
}

function updatePing(event: PanelEventEnvelope, ctx: PanelEventHandlerContext) {
  const key = buildKey(ctx.connectionId, event.panelId);
  const registration = registrations.get(key);
  if (registration) {
    registration.lastPingAt = Date.now();
  }
}

function unregisterPanel(event: PanelEventEnvelope, ctx: PanelEventHandlerContext) {
  const key = buildKey(ctx.connectionId, event.panelId);
  unregister(key);
}

function handleLifecycle(
  payload: Record<string, unknown> | null,
  ctx: PanelEventHandlerContext,
  event: PanelEventEnvelope,
) {
  if (!payload) {
    return;
  }
  if (payload['type'] !== 'panel_lifecycle') {
    return;
  }
  if (payload['state'] === 'closed') {
    unregisterPanel(event, ctx);
    clearDiffPanelState(event.panelId);
  }
}

export function createDiffPanelEventHandler(
  getWorkspaceRoot: (instanceId: string) => string | null,
): PanelEventHandler {
  return async (event, ctx) => {
    const payload = event.payload as Record<string, unknown> | null;
    handleLifecycle(payload, ctx, event);

    const payloadType = payload?.['type'];
    if (payloadType === 'diff_watch_register') {
      await registerWatch(ctx, event, payload, getWorkspaceRoot);
      return;
    }
    if (payloadType === 'diff_watch_ping') {
      updatePing(event, ctx);
      return;
    }
    if (payloadType === 'diff_watch_unregister') {
      unregisterPanel(event, ctx);
      return;
    }
    if (payloadType === 'diff_hunks_snapshot') {
      updateDiffHunksSnapshot(event.panelId, payload);
      return;
    }
    if (payloadType === 'diff_hunk_selected') {
      updateDiffSelection(event.panelId, payload);
      return;
    }
    if (payloadType === 'diff_hunk_cleared') {
      clearDiffSelection(event.panelId);
      return;
    }
  };
}
