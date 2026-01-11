import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { spawn, type IPty } from 'node-pty';

import type { CombinedPluginManifest } from '@assistant/shared';

import type {
  PanelEventHandler,
  PanelEventHandlerContext,
  PluginConfig,
  PluginModule,
} from '../../../../agent-server/src/plugins/types';
import type { SessionIndex } from '../../../../agent-server/src/sessionIndex';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 2_000;
const MAX_SNAPSHOT_TIMEOUT_MS = 10_000;

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type TerminalPluginConfig = PluginConfig & {
  shell?: string;
  debug?: boolean;
};

type TerminalInstance = {
  key: string;
  scopeId: string;
  sessionId: string | null;
  connectionId: string;
  panelId: string;
  cols: number;
  rows: number;
  pty: IPty;
  dispose: (options?: { kill?: boolean }) => void;
};

type TerminalScope = {
  scopeId: string;
  sessionId: string | null;
  connectionId: string;
};

type TerminalStatusPayload =
  | { type: 'terminal_status'; state: 'ready' }
  | { type: 'terminal_status'; state: 'closed'; exitCode?: number | null; signal?: number | null }
  | { type: 'terminal_status'; state: 'error'; message: string };

type TerminalOutputPayload = { type: 'terminal_output'; data: string };

type TerminalSnapshot = {
  cols: number;
  rows: number;
  cursor: { x: number; y: number };
  bufferType: 'normal' | 'alternate';
  lines: string[];
  wrapped: boolean[];
  timestamp: string;
};

type TerminalPayload =
  | { type?: string }
  | TerminalOutputPayload
  | TerminalStatusPayload
  | { type: 'terminal_input'; text?: unknown }
  | { type: 'terminal_resize'; cols?: unknown; rows?: unknown }
  | { type: 'terminal_snapshot_request'; requestId?: unknown }
  | { type: 'terminal_snapshot_response'; requestId?: unknown; snapshot?: unknown }
  | { type: 'terminal_snapshot_error'; requestId?: unknown; message?: unknown }
  | { type: 'panel_lifecycle'; state?: 'opened' | 'closed' }
  | { type: 'panel_session_changed'; previousSessionId?: string | null; sessionId?: string | null };

const terminals = new Map<string, TerminalInstance>();
const pendingSizes = new Map<string, { cols: number; rows: number }>();
const lastActivePanelBySession = new Map<string, string>();
const pendingSnapshots = new Map<string, PendingSnapshot>();

let configuredShell: string | null = null;
let debugEnabled = false;

type PendingSnapshot = {
  requestId: string;
  sessionId: string | null;
  panelId: string;
  timeout: NodeJS.Timeout;
  resolve: (snapshot: TerminalSnapshot) => void;
  reject: (error: ToolError) => void;
  clearAbort?: () => void;
};

function logDebug(...args: unknown[]): void {
  if (!debugEnabled) {
    return;
  }
  console.log('[terminal]', ...args);
}

const SESSION_SCOPE_PREFIX = 'session:';
const CONNECTION_SCOPE_PREFIX = 'connection:';

function buildSessionScopeId(sessionId: string): string {
  return `${SESSION_SCOPE_PREFIX}${sessionId}`;
}

function buildConnectionScopeId(connectionId: string): string {
  return `${CONNECTION_SCOPE_PREFIX}${connectionId}`;
}

function buildTerminalKey(scopeId: string, panelId: string): string {
  return `${scopeId}::${panelId}`;
}

function resolveTerminalScope(
  ctx: PanelEventHandlerContext,
  sessionId?: string | null,
): TerminalScope {
  const trimmedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (trimmedSessionId) {
    return {
      scopeId: buildSessionScopeId(trimmedSessionId),
      sessionId: trimmedSessionId,
      connectionId: ctx.connectionId,
    };
  }
  return {
    scopeId: buildConnectionScopeId(ctx.connectionId),
    sessionId: null,
    connectionId: ctx.connectionId,
  };
}

function resolveShell(): string {
  if (configuredShell && configuredShell.trim().length > 0) {
    return configuredShell.trim();
  }
  const envShell = process.env['SHELL'];
  if (envShell && envShell.trim().length > 0) {
    return envShell.trim();
  }
  if (process.platform === 'win32') {
    return process.env['COMSPEC']?.trim() || 'powershell.exe';
  }
  return 'bash';
}

async function resolveWorkingDir(
  sessionId: string | null,
  sessionIndex: SessionIndex,
): Promise<string> {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!trimmed) {
    return process.cwd();
  }
  const summary = await sessionIndex.getSession(trimmed);
  const candidate = summary?.attributes?.core?.workingDir;
  if (typeof candidate === 'string' && candidate.trim().length > 0 && path.isAbsolute(candidate)) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // Fall through to default.
    }
  }
  return process.cwd();
}

function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env['TERM'] || env['TERM'].trim().length === 0) {
    env['TERM'] = 'xterm-256color';
  }
  if (!env['COLORTERM'] || env['COLORTERM'].trim().length === 0) {
    env['COLORTERM'] = 'truecolor';
  }
  return env;
}

function sendTerminalEvent(
  ctx: PanelEventHandlerContext,
  sessionId: string | null,
  panelId: string,
  payload: TerminalPayload,
): void {
  if (debugEnabled && payload.type !== 'terminal_output') {
    logDebug('send', { sessionId, panelId, type: payload.type ?? null });
  }
  const message = {
    type: 'panel_event',
    panelId,
    panelType: 'terminal',
    payload,
    ...(sessionId ? { sessionId } : {}),
  } as const;

  if (sessionId) {
    ctx.sendToSession(sessionId, message);
    return;
  }
  ctx.sendToClient(message);
}

function disposeTerminal(key: string, options?: { kill?: boolean }): void {
  const entry = terminals.get(key);
  if (!entry) {
    return;
  }
  logDebug('dispose', { key, kill: options?.kill ?? true });
  terminals.delete(key);
  if (entry.sessionId) {
    rejectSnapshotsForPanel(
      entry.sessionId,
      entry.panelId,
      'Terminal closed before snapshot was captured.',
    );
  }
  entry.dispose(options);
}

async function ensureTerminal(
  ctx: PanelEventHandlerContext,
  scope: TerminalScope,
  panelId: string,
): Promise<TerminalInstance | null> {
  const key = buildTerminalKey(scope.scopeId, panelId);
  const existing = terminals.get(key);
  if (existing) {
    if (existing.connectionId !== scope.connectionId) {
      existing.connectionId = scope.connectionId;
    }
    return existing;
  }

  const size = pendingSizes.get(key) ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  const cwd = await resolveWorkingDir(scope.sessionId, ctx.sessionIndex);
  const shell = resolveShell();

  let pty: IPty;
  try {
    logDebug('spawn', {
      sessionId: scope.sessionId,
      panelId,
      shell,
      cwd,
      cols: size.cols,
      rows: size.rows,
    });
    pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: buildEnv(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logDebug('spawn failed', { sessionId: scope.sessionId, panelId, shell, error: message });
    sendTerminalEvent(ctx, scope.sessionId, panelId, {
      type: 'terminal_status',
      state: 'error',
      message: `Failed to start shell (${shell}): ${message}`,
    });
    return null;
  }

  const onData = pty.onData((data) => {
    sendTerminalEvent(ctx, scope.sessionId, panelId, { type: 'terminal_output', data });
  });

  const onExit = pty.onExit(({ exitCode, signal }) => {
    logDebug('exit', { sessionId: scope.sessionId, panelId, exitCode, signal: signal ?? null });
    sendTerminalEvent(ctx, scope.sessionId, panelId, {
      type: 'terminal_status',
      state: 'closed',
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      signal: signal ?? null,
    });
    disposeTerminal(key, { kill: false });
  });

  const entry: TerminalInstance = {
    key,
    scopeId: scope.scopeId,
    sessionId: scope.sessionId,
    connectionId: scope.connectionId,
    panelId,
    cols: size.cols,
    rows: size.rows,
    pty,
    dispose: ({ kill = true } = {}) => {
      onData.dispose();
      onExit.dispose();
      if (kill) {
        try {
          pty.kill();
        } catch {
          // Ignore shutdown errors.
        }
      }
    },
  };

  terminals.set(key, entry);

  sendTerminalEvent(ctx, scope.sessionId, panelId, {
    type: 'terminal_status',
    state: 'ready',
  });

  return entry;
}

function handleResize(
  ctx: PanelEventHandlerContext,
  scope: TerminalScope,
  panelId: string,
  cols: unknown,
  rows: unknown,
): void {
  if (typeof cols !== 'number' || typeof rows !== 'number') {
    return;
  }
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return;
  }
  const nextCols = Math.max(2, Math.floor(cols));
  const nextRows = Math.max(2, Math.floor(rows));

  logDebug('resize', {
    sessionId: scope.sessionId,
    panelId,
    cols: nextCols,
    rows: nextRows,
  });

  const key = buildTerminalKey(scope.scopeId, panelId);
  pendingSizes.set(key, { cols: nextCols, rows: nextRows });

  const entry = terminals.get(key);
  if (!entry) {
    return;
  }
  if (entry.cols === nextCols && entry.rows === nextRows) {
    return;
  }
  entry.cols = nextCols;
  entry.rows = nextRows;
  entry.pty.resize(nextCols, nextRows);
}

function cleanupSessionTerminals(sessionId: string): void {
  logDebug('cleanup session', { sessionId });
  for (const [key, entry] of terminals.entries()) {
    if (entry.sessionId !== sessionId) {
      continue;
    }
    disposeTerminal(key);
  }
  rejectSnapshotsForSession(sessionId, 'Terminal session ended before snapshot was captured.');
  lastActivePanelBySession.delete(sessionId);
}

function rejectSnapshotsForPanel(sessionId: string, panelId: string, message: string): void {
  for (const [requestId, pending] of pendingSnapshots.entries()) {
    if (pending.sessionId !== sessionId || pending.panelId !== panelId) {
      continue;
    }
    pendingSnapshots.delete(requestId);
    clearTimeout(pending.timeout);
    pending.clearAbort?.();
    pending.reject(createToolError('terminal_snapshot_failed', message));
  }
}

function rejectSnapshotsForSession(sessionId: string, message: string): void {
  for (const [requestId, pending] of pendingSnapshots.entries()) {
    if (pending.sessionId !== sessionId) {
      continue;
    }
    pendingSnapshots.delete(requestId);
    clearTimeout(pending.timeout);
    pending.clearAbort?.();
    pending.reject(createToolError('terminal_snapshot_failed', message));
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function createToolError(code: string, message: string): ToolError {
  return new ToolError(code, message);
}

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw createToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

function requireSessionId(ctx: ToolContext): string {
  const sessionId = ctx.sessionId?.trim();
  if (!sessionId) {
    throw createToolError('invalid_session', 'Session id is required');
  }
  return sessionId;
}

function parseTerminalWriteArgs(raw: unknown): { text: string; panelId?: string } {
  const obj = asObject(raw);
  const textRaw = obj['text'];
  if (typeof textRaw !== 'string' || textRaw.length === 0) {
    throw createToolError('invalid_arguments', 'text is required and must be a non-empty string');
  }
  const panelRaw = obj['panelId'];
  if (panelRaw !== undefined && typeof panelRaw !== 'string') {
    throw createToolError('invalid_arguments', 'panelId must be a string when provided');
  }
  const panelId = typeof panelRaw === 'string' ? panelRaw.trim() : undefined;
  return { text: textRaw, ...(panelId ? { panelId } : {}) };
}

function parseTerminalReadArgs(raw: unknown): { panelId?: string; timeoutMs: number } {
  const obj = asObject(raw);
  const panelRaw = obj['panelId'];
  if (panelRaw !== undefined && typeof panelRaw !== 'string') {
    throw createToolError('invalid_arguments', 'panelId must be a string when provided');
  }
  const panelId = typeof panelRaw === 'string' ? panelRaw.trim() : undefined;

  let timeoutMs = DEFAULT_SNAPSHOT_TIMEOUT_MS;
  const timeoutRaw = obj['timeoutMs'];
  if (timeoutRaw !== undefined) {
    if (typeof timeoutRaw !== 'number' || !Number.isFinite(timeoutRaw) || timeoutRaw <= 0) {
      throw createToolError(
        'invalid_arguments',
        'timeoutMs must be a positive number when provided',
      );
    }
    timeoutMs = Math.min(Math.floor(timeoutRaw), MAX_SNAPSHOT_TIMEOUT_MS);
  }

  return { ...(panelId ? { panelId } : {}), timeoutMs };
}

function resolveTerminalEntry(
  sessionId: string,
  requestedPanelId?: string,
): TerminalInstance | null {
  if (requestedPanelId) {
    const sessionKey = buildTerminalKey(buildSessionScopeId(sessionId), requestedPanelId);
    const sessionEntry = terminals.get(sessionKey);
    if (sessionEntry) {
      return sessionEntry;
    }
    const matches = Array.from(terminals.values()).filter(
      (entry) => entry.panelId === requestedPanelId,
    );
    if (matches.length > 1) {
      logDebug('panelId collision', {
        panelId: requestedPanelId,
        matches: matches.map((entry) => ({
          sessionId: entry.sessionId,
          connectionId: entry.connectionId,
        })),
      });
    }
    return matches[0] ?? null;
  }

  const lastActive = lastActivePanelBySession.get(sessionId);
  if (lastActive) {
    const entry = terminals.get(buildTerminalKey(buildSessionScopeId(sessionId), lastActive));
    if (entry) {
      return entry;
    }
  }

  for (const entry of terminals.values()) {
    if (entry.sessionId === sessionId) {
      lastActivePanelBySession.set(sessionId, entry.panelId);
      return entry;
    }
  }

  return null;
}

async function requestSnapshot(
  ctx: ToolContext,
  entry: TerminalInstance,
  timeoutMs: number,
): Promise<TerminalSnapshot> {
  const sessionHub = requireSessionHub(ctx);
  const requestId = randomUUID();

  const payload: TerminalPayload = {
    type: 'terminal_snapshot_request',
    requestId,
  };

  const message = {
    type: 'panel_event',
    panelId: entry.panelId,
    panelType: 'terminal',
    payload,
  } as const;

  const deliveredToConnection =
    entry.connectionId && typeof sessionHub.sendToConnection === 'function'
      ? sessionHub.sendToConnection(entry.connectionId, message)
      : false;
  logDebug('snapshot request', {
    sessionId: entry.sessionId ?? null,
    panelId: entry.panelId,
    requestId,
    timeoutMs,
    connectionId: entry.connectionId ?? null,
    deliveredToConnection,
  });
  if (!deliveredToConnection) {
    if (entry.sessionId) {
      sessionHub.broadcastToSession(entry.sessionId, message);
    }
  }

  return new Promise<TerminalSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSnapshots.delete(requestId);
      clearAbort();
      logDebug('snapshot timeout', {
        sessionId: entry.sessionId ?? null,
        panelId: entry.panelId,
        requestId,
        timeoutMs,
      });
      reject(createToolError('terminal_snapshot_timeout', 'Terminal snapshot request timed out'));
    }, timeoutMs);

    const pending: PendingSnapshot = {
      requestId,
      sessionId: entry.sessionId ?? null,
      panelId: entry.panelId,
      timeout,
      resolve: (snapshot) => {
        clearTimeout(timeout);
        clearAbort();
        resolve(snapshot);
      },
      reject: (error) => {
        clearTimeout(timeout);
        clearAbort();
        reject(error);
      },
    };

    const clearAbort = () => {
      if (pending.clearAbort) {
        pending.clearAbort();
        delete pending.clearAbort;
      }
    };

    if (ctx.signal) {
      const abortHandler = () => {
        pendingSnapshots.delete(requestId);
        clearTimeout(timeout);
        reject(createToolError('tool_aborted', 'Terminal snapshot request was aborted'));
      };
      ctx.signal.addEventListener('abort', abortHandler, { once: true });
      pending.clearAbort = () => {
        ctx.signal.removeEventListener('abort', abortHandler);
      };
    }

    pendingSnapshots.set(requestId, pending);
  });
}

const handleTerminalEvent: PanelEventHandler = async (event, ctx) => {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const typed = payload as Record<string, unknown> & { type?: string };
  const rawSessionId = typeof ctx.sessionId === 'string' ? ctx.sessionId.trim() : '';
  const sessionId = rawSessionId || null;
  const scope = resolveTerminalScope(ctx, sessionId);
  const panelId = event.panelId;
  const payloadType = typed.type;

  logDebug('event', {
    sessionId,
    panelId,
    type: payloadType ?? null,
  });

  if (sessionId) {
    lastActivePanelBySession.set(sessionId, panelId);
  }

  if (payloadType === 'panel_lifecycle') {
    const lifecycle = typed as { state?: 'opened' | 'closed' };
    if (lifecycle.state === 'opened') {
      await ensureTerminal(ctx, scope, panelId);
      return;
    }
    if (lifecycle.state === 'closed') {
      disposeTerminal(buildTerminalKey(scope.scopeId, panelId));
      return;
    }
  }

  if (payloadType === 'panel_session_changed') {
    const sessionChange = typed as { previousSessionId?: unknown; sessionId?: unknown };
    const previousSessionId =
      typeof sessionChange.previousSessionId === 'string' ? sessionChange.previousSessionId : null;
    const nextSessionId =
      typeof sessionChange.sessionId === 'string' ? sessionChange.sessionId : sessionId;
    logDebug('session change', {
      panelId,
      previousSessionId,
      nextSessionId,
    });
    const previousScope = resolveTerminalScope(ctx, previousSessionId);
    const nextScope = resolveTerminalScope(ctx, nextSessionId);
    disposeTerminal(buildTerminalKey(previousScope.scopeId, panelId));
    await ensureTerminal(ctx, nextScope, panelId);
    return;
  }

  if (payloadType === 'terminal_snapshot_response') {
    const response = typed as { requestId?: unknown; snapshot?: unknown };
    const requestId = typeof response.requestId === 'string' ? response.requestId : '';
    if (!requestId) {
      return;
    }
    const pending = pendingSnapshots.get(requestId);
    logDebug('snapshot response', {
      sessionId,
      panelId,
      requestId,
      pending: Boolean(pending),
    });
    if (!pending) {
      return;
    }
    if (!response.snapshot || typeof response.snapshot !== 'object') {
      pendingSnapshots.delete(requestId);
      pending.reject(
        createToolError('terminal_snapshot_failed', 'Terminal snapshot response was invalid'),
      );
      return;
    }
    pendingSnapshots.delete(requestId);
    pending.resolve(response.snapshot as TerminalSnapshot);
    return;
  }

  if (payloadType === 'terminal_snapshot_error') {
    const response = typed as { requestId?: unknown; message?: unknown };
    const requestId = typeof response.requestId === 'string' ? response.requestId : '';
    if (!requestId) {
      return;
    }
    const pending = pendingSnapshots.get(requestId);
    logDebug('snapshot error', {
      sessionId,
      panelId,
      requestId,
      pending: Boolean(pending),
    });
    if (!pending) {
      return;
    }
    const message = typeof response.message === 'string' ? response.message : 'Unknown error';
    pendingSnapshots.delete(requestId);
    pending.reject(createToolError('terminal_snapshot_failed', message));
    return;
  }

  if (payloadType === 'terminal_resize') {
    const resizePayload = typed as { cols?: unknown; rows?: unknown };
    handleResize(ctx, scope, panelId, resizePayload.cols, resizePayload.rows);
    return;
  }

  if (payloadType === 'terminal_input') {
    const inputPayload = typed as { text?: unknown };
    const text = typeof inputPayload.text === 'string' ? inputPayload.text : '';
    if (!text) {
      return;
    }
    logDebug('input', { sessionId, panelId, length: text.length });
    const entry = await ensureTerminal(ctx, scope, panelId);
    entry?.pty.write(text);
  }
};

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    panelEventHandlers: {
      terminal: handleTerminalEvent,
    },
    operations: {
      write: async (args, ctx) => {
        const sessionId = requireSessionId(ctx);
        const parsed = parseTerminalWriteArgs(args);
        const entry = resolveTerminalEntry(sessionId, parsed.panelId);
        if (!entry) {
          const hasPanelId = Boolean(parsed.panelId);
          const reason = hasPanelId ? 'terminal_not_ready' : 'no_active_panel';
          logDebug('tool write failed', {
            sessionId,
            requestedPanelId: parsed.panelId ?? null,
            reason,
          });
          if (hasPanelId) {
            throw createToolError('terminal_not_ready', 'Terminal is not running for that panel');
          }
          throw createToolError('terminal_not_found', 'No active terminal panel found');
        }
        if (entry.sessionId && entry.sessionId !== sessionId) {
          logDebug('tool write session mismatch', {
            sessionId,
            panelId: entry.panelId,
            panelSessionId: entry.sessionId,
          });
        }
        logDebug('tool write', { sessionId, panelId: entry.panelId, bytes: parsed.text.length });
        entry.pty.write(parsed.text);
        return {
          ok: true,
          sessionId,
          panelId: entry.panelId,
          bytesWritten: parsed.text.length,
        };
      },
      'read-screen': async (args, ctx) => {
        const sessionId = requireSessionId(ctx);
        const parsed = parseTerminalReadArgs(args);
        const entry = resolveTerminalEntry(sessionId, parsed.panelId);
        logDebug('tool read request', {
          sessionId,
          requestedPanelId: parsed.panelId ?? null,
          resolvedPanelId: entry?.panelId ?? null,
          timeoutMs: parsed.timeoutMs,
        });
        if (!entry) {
          const hasPanelId = Boolean(parsed.panelId);
          const reason = hasPanelId ? 'terminal_not_ready' : 'no_active_panel';
          logDebug('tool read failed', {
            sessionId,
            requestedPanelId: parsed.panelId ?? null,
            reason,
          });
          if (hasPanelId) {
            throw createToolError('terminal_not_ready', 'Terminal is not running for that panel');
          }
          throw createToolError('terminal_not_found', 'No active terminal panel found');
        }
        if (entry.sessionId && entry.sessionId !== sessionId) {
          logDebug('tool read session mismatch', {
            sessionId,
            panelId: entry.panelId,
            panelSessionId: entry.sessionId,
          });
        }
        const snapshot = await requestSnapshot(ctx, entry, parsed.timeoutMs);
        return {
          sessionId,
          panelId: entry.panelId,
          snapshot,
        };
      },
    },
    async initialize(_dataDir: string, pluginConfig?: TerminalPluginConfig) {
      if (pluginConfig && typeof pluginConfig.shell === 'string' && pluginConfig.shell.trim()) {
        configuredShell = pluginConfig.shell.trim();
      }
      if (pluginConfig && pluginConfig.debug === true) {
        debugEnabled = true;
        logDebug('debug enabled');
      }
    },
    async shutdown() {
      for (const key of terminals.keys()) {
        disposeTerminal(key);
      }
      for (const pending of pendingSnapshots.values()) {
        pending.reject(
          createToolError('terminal_snapshot_failed', 'Terminal plugin shutting down'),
        );
      }
      pendingSnapshots.clear();
    },
    onSessionDeleted(sessionId: string) {
      logDebug('session deleted', { sessionId });
      cleanupSessionTerminals(sessionId);
    },
  };
}
