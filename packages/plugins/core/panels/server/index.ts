import type {
  CombinedPluginManifest,
  LayoutNode,
  PanelBinding,
  PanelEventEnvelope,
  PanelInventoryItem,
  PanelSize,
} from '@assistant/shared';
import { PanelBindingSchema, PanelSizeSchema } from '@assistant/shared';

import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import { ToolError, type ToolContext } from '../../../../agent-server/src/tools';
import {
  PanelInventoryWindowError,
  getSelectedPanels,
  listPanels,
  listPanelWindows,
  resolvePanelWindowTarget,
} from '../../../../agent-server/src/panels/panelInventoryStore';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type PanelsListArgs = {
  includeChat?: boolean;
  includeContext?: boolean;
  includeLayout?: boolean;
  windowId?: string;
};

type PanelSelectedArgs = PanelsListArgs;

type PanelTreeArgs = {
  includeChat?: boolean;
  includeContext?: boolean;
  format?: 'json' | 'text' | 'both';
  windowId?: string;
};

type PanelWindowsArgs = {
  windowId?: string;
};

type PanelEventArgs = {
  panelId: string;
  panelType: string;
  payload: unknown;
  sessionId?: string;
  scope?: 'session' | 'all';
  windowId?: string;
};

type PanelOpenArgs = {
  panelType: string;
  mode?: 'tab' | 'split' | 'header';
  targetPaneId?: string;
  targetPanelId?: string;
  afterPanelId?: string;
  direction?: 'left' | 'right' | 'top' | 'bottom';
  size?: PanelSize;
  focus?: boolean;
  binding?: PanelBinding;
  sessionId?: string;
  windowId?: string;
};

type PanelCloseArgs = {
  panelId: string;
  sessionId?: string;
  windowId?: string;
};

type PanelFocusArgs = {
  panelId: string;
  sessionId?: string;
  windowId?: string;
};

type PanelReplaceArgs = {
  panelId: string;
  panelType: string;
  binding?: PanelBinding;
  sessionId?: string;
  windowId?: string;
};

type PanelMoveArgs = {
  panelId: string;
  mode?: 'tab' | 'split';
  targetPaneId?: string;
  targetPanelId?: string;
  afterPanelId?: string;
  direction?: 'left' | 'right' | 'top' | 'bottom';
  size?: PanelSize;
  sessionId?: string;
  windowId?: string;
};

type PanelCloseSplitArgs = {
  splitId: string;
  sessionId?: string;
  windowId?: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (!(key in obj)) {
    return undefined;
  }
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ToolError('invalid_arguments', `${label} must be a string when provided`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${label} must not be empty`);
  }
  return trimmed;
}

function parseRequiredString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = parseOptionalString(obj, key, label);
  if (!value) {
    throw new ToolError('invalid_arguments', `${label} is required`);
  }
  return value;
}

function parseOptionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): boolean | undefined {
  if (!(key in obj)) {
    return undefined;
  }
  const raw = obj[key];
  if (typeof raw !== 'boolean') {
    throw new ToolError('invalid_arguments', `${label} must be a boolean when provided`);
  }
  return raw;
}

function parsePanelBinding(value: unknown): PanelBinding | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = PanelBindingSchema.safeParse(value);
  if (!parsed.success) {
    throw new ToolError('invalid_arguments', 'binding must be a valid panel binding');
  }
  return parsed.data;
}

function parsePanelDirection(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): 'left' | 'right' | 'top' | 'bottom' | undefined {
  if (!(key in obj)) {
    return undefined;
  }
  const raw = obj[key];
  if (raw === 'left' || raw === 'right' || raw === 'top' || raw === 'bottom') {
    return raw;
  }
  if (raw === undefined || raw === null) {
    return undefined;
  }
  throw new ToolError('invalid_arguments', `${label} must be left, right, top, or bottom`);
}

function parsePanelSize(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): PanelSize | undefined {
  if (!(key in obj)) {
    return undefined;
  }
  const parsed = PanelSizeSchema.safeParse(obj[key]);
  if (!parsed.success) {
    throw new ToolError('invalid_arguments', `${label} must be a valid panel size`);
  }
  return parsed.data;
}

function parsePanelsListArgs(raw: unknown): PanelsListArgs {
  const obj = asObject(raw);
  const args: PanelsListArgs = {};

  const includeChat = parseOptionalBoolean(obj, 'includeChat', 'includeChat');
  if (includeChat !== undefined) {
    args.includeChat = includeChat;
  }

  const includeContext = parseOptionalBoolean(obj, 'includeContext', 'includeContext');
  if (includeContext !== undefined) {
    args.includeContext = includeContext;
  }

  const includeLayout = parseOptionalBoolean(obj, 'includeLayout', 'includeLayout');
  if (includeLayout !== undefined) {
    args.includeLayout = includeLayout;
  }

  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  if (windowId) {
    args.windowId = windowId;
  }

  return args;
}

function parsePanelSelectedArgs(raw: unknown): PanelSelectedArgs {
  return parsePanelsListArgs(raw);
}

function parsePanelEventArgs(raw: unknown): PanelEventArgs {
  const obj = asObject(raw);

  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  const panelType = parseRequiredString(obj, 'panelType', 'panelType');

  if (!Object.prototype.hasOwnProperty.call(obj, 'payload')) {
    throw new ToolError('invalid_arguments', 'payload is required');
  }

  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');

  let scope: PanelEventArgs['scope'];
  if ('scope' in obj) {
    const scopeRaw = obj['scope'];
    if (scopeRaw === 'session' || scopeRaw === 'all') {
      scope = scopeRaw;
    } else if (scopeRaw !== undefined) {
      throw new ToolError('invalid_arguments', 'scope must be "session" or "all" when provided');
    }
  }

  return {
    panelId,
    panelType,
    payload: obj['payload'],
    ...(sessionId ? { sessionId } : {}),
    ...(scope ? { scope } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelTreeArgs(raw: unknown): PanelTreeArgs {
  const obj = asObject(raw);
  const args: PanelTreeArgs = {};

  const includeChat = parseOptionalBoolean(obj, 'includeChat', 'includeChat');
  if (includeChat !== undefined) {
    args.includeChat = includeChat;
  }

  const includeContext = parseOptionalBoolean(obj, 'includeContext', 'includeContext');
  if (includeContext !== undefined) {
    args.includeContext = includeContext;
  }

  if ('format' in obj) {
    const format = obj['format'];
    if (format === 'json' || format === 'text' || format === 'both') {
      args.format = format;
    } else if (format !== undefined) {
      throw new ToolError('invalid_arguments', 'format must be "json", "text", or "both"');
    }
  }

  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  if (windowId) {
    args.windowId = windowId;
  }

  return args;
}

function parsePanelWindowsArgs(raw: unknown): PanelWindowsArgs {
  const obj = asObject(raw);
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return windowId ? { windowId } : {};
}

function parsePanelOpenArgs(raw: unknown): PanelOpenArgs {
  const obj = asObject(raw);

  const panelType = parseOptionalString(obj, 'panelType', 'panelType') ?? 'empty';
  const modeRaw = parseOptionalString(obj, 'mode', 'mode');
  const mode =
    modeRaw === undefined
      ? undefined
      : modeRaw === 'tab' || modeRaw === 'split' || modeRaw === 'header'
        ? modeRaw
        : (() => {
            throw new ToolError('invalid_arguments', 'mode must be "tab", "split", or "header"');
          })();
  const targetPaneId = parseOptionalString(obj, 'targetPaneId', 'targetPaneId');
  const targetPanelId = parseOptionalString(obj, 'targetPanelId', 'targetPanelId');
  const afterPanelId = parseOptionalString(obj, 'afterPanelId', 'afterPanelId');
  const direction = parsePanelDirection(obj, 'direction', 'direction');
  const size = parsePanelSize(obj, 'size', 'size');
  const focus = parseOptionalBoolean(obj, 'focus', 'focus');
  const binding = parsePanelBinding(obj['binding']);
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  const targetCount = [targetPaneId, targetPanelId, afterPanelId].filter(Boolean).length;

  if (targetCount > 1) {
    throw new ToolError(
      'invalid_arguments',
      'Provide at most one of targetPaneId, targetPanelId, or afterPanelId',
    );
  }

  if (mode === 'split' && !direction) {
    throw new ToolError('invalid_arguments', 'direction is required when mode is "split"');
  }
  if (mode === 'tab' && (direction || size)) {
    throw new ToolError(
      'invalid_arguments',
      'tab mode does not accept direction or size',
    );
  }
  if (mode === 'header' && (targetPaneId || targetPanelId || afterPanelId || direction || size)) {
    throw new ToolError(
      'invalid_arguments',
      'header mode does not accept targetPaneId, targetPanelId, afterPanelId, direction, or size',
    );
  }

  return {
    panelType,
    ...(mode ? { mode } : {}),
    ...(targetPaneId ? { targetPaneId } : {}),
    ...(targetPanelId ? { targetPanelId } : {}),
    ...(afterPanelId ? { afterPanelId } : {}),
    ...(direction ? { direction } : {}),
    ...(size ? { size } : {}),
    ...(focus !== undefined ? { focus } : {}),
    ...(binding ? { binding } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelCloseArgs(raw: unknown): PanelCloseArgs {
  const obj = asObject(raw);
  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    panelId,
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelReplaceArgs(raw: unknown): PanelReplaceArgs {
  const obj = asObject(raw);
  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  const panelType = parseRequiredString(obj, 'panelType', 'panelType');
  const binding = parsePanelBinding(obj['binding']);
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    panelId,
    panelType,
    ...(binding ? { binding } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelFocusArgs(raw: unknown): PanelFocusArgs {
  const obj = asObject(raw);
  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    panelId,
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelMoveArgs(raw: unknown): PanelMoveArgs {
  const obj = asObject(raw);
  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  const modeRaw = parseOptionalString(obj, 'mode', 'mode');
  const mode =
    modeRaw === undefined
      ? undefined
      : modeRaw === 'tab' || modeRaw === 'split'
        ? modeRaw
        : (() => {
            throw new ToolError('invalid_arguments', 'mode must be "tab" or "split"');
          })();
  const targetPaneId = parseOptionalString(obj, 'targetPaneId', 'targetPaneId');
  const targetPanelId = parseOptionalString(obj, 'targetPanelId', 'targetPanelId');
  const afterPanelId = parseOptionalString(obj, 'afterPanelId', 'afterPanelId');
  const direction = parsePanelDirection(obj, 'direction', 'direction');
  const size = parsePanelSize(obj, 'size', 'size');
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  const targetCount = [targetPaneId, targetPanelId, afterPanelId].filter(Boolean).length;

  if (targetCount > 1) {
    throw new ToolError(
      'invalid_arguments',
      'Provide at most one of targetPaneId, targetPanelId, or afterPanelId',
    );
  }
  if (mode === 'split' && !direction) {
    throw new ToolError('invalid_arguments', 'direction is required when mode is "split"');
  }
  if (mode === 'tab' && (direction || size)) {
    throw new ToolError(
      'invalid_arguments',
      'tab mode does not accept direction or size',
    );
  }
  return {
    panelId,
    ...(mode ? { mode } : {}),
    ...(targetPaneId ? { targetPaneId } : {}),
    ...(targetPanelId ? { targetPanelId } : {}),
    ...(afterPanelId ? { afterPanelId } : {}),
    ...(direction ? { direction } : {}),
    ...(size ? { size } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelCloseSplitArgs(raw: unknown): PanelCloseSplitArgs {
  const obj = asObject(raw);
  const splitId = parseRequiredString(obj, 'splitId', 'splitId');
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    splitId,
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function formatWindowList(windows: Array<{ windowId: string }>): string {
  if (windows.length === 0) {
    return 'none';
  }
  return windows.map((entry) => entry.windowId).join(', ');
}

function resolveWindowTarget(windowId?: string): {
  connectionId?: string;
  windowId?: string;
} | null {
  const resolution = resolvePanelWindowTarget(windowId);
  if (resolution.status === 'resolved') {
    return {
      connectionId: resolution.connectionId,
      windowId: resolution.windowId,
    };
  }
  if (resolution.status === 'ambiguous') {
    throw new ToolError(
      'window_required',
      `Multiple windows are active. Provide windowId. Active windows: ${formatWindowList(
        resolution.windows,
      )}`,
    );
  }
  if (resolution.status === 'not_found') {
    throw new ToolError(
      'window_not_found',
      `Requested windowId is not active. Active windows: ${formatWindowList(
        resolution.windows,
      )}`,
    );
  }
  return null;
}

async function sendPanelEvent(args: unknown, ctx: ToolContext): Promise<{ ok: true }> {
  const parsed = parsePanelEventArgs(args);
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }

  if (parsed.scope === 'all') {
    if (parsed.windowId) {
      throw new ToolError(
        'invalid_arguments',
        'panels_event: windowId cannot be used when scope is "all"',
      );
    }
    if (parsed.sessionId) {
      throw new ToolError(
        'invalid_arguments',
        'panels_event: sessionId cannot be used when scope is "all"',
      );
    }

    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: parsed.panelId,
      panelType: parsed.panelType,
      payload: parsed.payload,
      sessionId: '*',
    };

    sessionHub.broadcastToAll(event);
    return { ok: true };
  }

  const targetSessionId = parsed.sessionId ?? ctx.sessionId;
  const windowTarget = resolveWindowTarget(parsed.windowId);
  if (!targetSessionId && !windowTarget) {
    throw new ToolError(
      'invalid_arguments',
      'panels_event: sessionId is required when no session context is available',
    );
  }

  const event: PanelEventEnvelope = {
    type: 'panel_event',
    panelId: parsed.panelId,
    panelType: parsed.panelType,
    payload: parsed.payload,
    sessionId: targetSessionId,
    ...(windowTarget?.windowId ? { windowId: windowTarget.windowId } : {}),
  };

  if (windowTarget?.connectionId) {
    const sent = sessionHub.sendToConnection(windowTarget.connectionId, event);
    if (!sent) {
      throw new ToolError(
        'window_not_found',
        `Requested windowId is not active.`,
      );
    }
    return { ok: true };
  }

  if (targetSessionId) {
    sessionHub.broadcastToSession(targetSessionId, event);
  }
  return { ok: true };
}

type PanelCommandPayload = {
  type: 'panel_command';
  command: string;
  [key: string]: unknown;
};

function sendPanelCommand(
  payload: PanelCommandPayload,
  ctx: ToolContext,
  sessionId?: string,
  windowId?: string,
): { ok: true } {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  const targetSessionId = sessionId ?? ctx.sessionId;
  const windowTarget = resolveWindowTarget(windowId);
  const event: PanelEventEnvelope = {
    type: 'panel_event',
    panelId: 'workspace',
    panelType: 'workspace',
    payload,
    ...(windowTarget?.windowId ? { windowId: windowTarget.windowId } : {}),
  };
  if (windowTarget?.connectionId) {
    const sent = sessionHub.sendToConnection(windowTarget.connectionId, event);
    if (!sent) {
      throw new ToolError(
        'window_not_found',
        `Requested windowId is not active.`,
      );
    }
    return { ok: true };
  }
  if (!targetSessionId || targetSessionId === 'http') {
    sessionHub.broadcastToAll({ ...event, sessionId: '*' });
    return { ok: true };
  }
  sessionHub.broadcastToSession(targetSessionId, { ...event, sessionId: targetSessionId });
  return { ok: true };
}

function findPaneById(
  node: LayoutNode | null,
  paneId: string,
): Extract<LayoutNode, { kind: 'pane' }> | null {
  if (!node) {
    return null;
  }
  if (node.kind === 'pane') {
    return node.paneId === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPaneById(child, paneId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findPaneContainingPanel(
  node: LayoutNode | null,
  panelId: string,
): Extract<LayoutNode, { kind: 'pane' }> | null {
  if (!node) {
    return null;
  }
  if (node.kind === 'pane') {
    return node.tabs.some((tab) => tab.panelId === panelId) ? node : null;
  }
  for (const child of node.children) {
    const found = findPaneContainingPanel(child, panelId);
    if (found) {
      return found;
    }
  }
  return null;
}

function collectPaneIds(node: LayoutNode | null): string[] {
  if (!node) {
    return [];
  }
  if (node.kind === 'pane') {
    return [node.paneId];
  }
  return node.children.flatMap((child) => collectPaneIds(child));
}

function createNextPaneId(layout: LayoutNode | null): string {
  const existing = new Set(collectPaneIds(layout));
  let index = existing.size + 1;
  let candidate = `pane-${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `pane-${index}`;
  }
  return candidate;
}

function resolveTargetPaneFromSelection(windowId?: string): {
  windowId?: string;
  paneId: string;
} | null {
  const selected = getSelectedPanels({
    includeChat: true,
    includeContext: false,
    includeLayout: true,
    windowId,
  });
  if (!selected.selectedPaneId) {
    return null;
  }
  return {
    ...(selected.windowId ? { windowId: selected.windowId } : {}),
    paneId: selected.selectedPaneId,
  };
}

function resolvePaneTarget(args: {
  targetPaneId?: string;
  targetPanelId?: string;
  afterPanelId?: string;
  windowId?: string;
}): { windowId?: string; paneId: string; anchorPanelId?: string } | null {
  if (args.targetPaneId || args.targetPanelId || args.afterPanelId) {
    const listing = listPanels({
      includeChat: true,
      includeContext: false,
      includeLayout: true,
      ...(args.windowId ? { windowId: args.windowId } : {}),
    });
    const layout = listing.layout ?? null;
    if (!layout) {
      throw new ToolError('invalid_arguments', 'No layout is available for the selected window');
    }
    if (args.targetPaneId) {
      const pane = findPaneById(layout, args.targetPaneId);
      if (!pane) {
        throw new ToolError(
          'invalid_arguments',
          `targetPaneId "${args.targetPaneId}" is not present in the selected window layout`,
        );
      }
      return {
        ...(listing.windowId ? { windowId: listing.windowId } : {}),
        paneId: pane.paneId,
      };
    }
    const anchorPanelId = args.afterPanelId ?? args.targetPanelId;
    if (anchorPanelId) {
      const pane = findPaneContainingPanel(layout, anchorPanelId);
      if (!pane) {
        const label = args.afterPanelId ? 'afterPanelId' : 'targetPanelId';
        throw new ToolError(
          'invalid_arguments',
          `${label} "${anchorPanelId}" is not present in the selected window layout`,
        );
      }
      return {
        ...(listing.windowId ? { windowId: listing.windowId } : {}),
        paneId: pane.paneId,
        anchorPanelId,
      };
    }
  }
  return resolveTargetPaneFromSelection(args.windowId);
}

function formatPanelLabel(panel: PanelInventoryItem | undefined): string {
  if (!panel) {
    return 'unknown';
  }
  const title = panel.panelTitle ? ` "${panel.panelTitle}"` : '';
  return `${panel.panelType}${title}`;
}

function renderLayoutNode(
  node: LayoutNode,
  panelsById: Map<string, PanelInventoryItem>,
  selectedPanelId: string | null,
  selectedChatPanelId: string | null,
  depth: number,
  lines: string[],
): void {
  const indent = '  '.repeat(depth);
  if (node.kind === 'pane') {
    const tabs = node.tabs
      .map((tab) => {
        const panel = panelsById.get(tab.panelId);
        const labels: string[] = [];
        if (tab.panelId === node.activePanelId) {
          labels.push('pane-active');
        }
        if (tab.panelId === selectedPanelId) {
          labels.push('selected');
        }
        if (tab.panelId === selectedChatPanelId) {
          labels.push('chat-selected');
        }
        const suffix = labels.length > 0 ? ` [${labels.join(', ')}]` : '';
        return `${tab.panelId} (${formatPanelLabel(panel)})${suffix}`;
      })
      .join(', ');
    lines.push(`${indent}- pane ${node.paneId}: ${tabs}`);
    return;
  }
  lines.push(`${indent}- split ${node.splitId} (${node.direction})`);
  for (const child of node.children) {
    renderLayoutNode(child, panelsById, selectedPanelId, selectedChatPanelId, depth + 1, lines);
  }
}

function renderPanelTree(options: {
  windowId?: string;
  layout: LayoutNode | null;
  headerPanels: string[];
  panels: PanelInventoryItem[];
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  selectedPaneId?: string | null;
}): string {
  const lines: string[] = [];
  const panelsById = new Map(options.panels.map((panel) => [panel.panelId, panel]));

  if (options.windowId) {
    lines.push(`Window: ${options.windowId}`);
  }
  lines.push(`Selected pane: ${options.selectedPaneId ?? '(none)'}`);
  lines.push(`Selected panel: ${options.selectedPanelId ?? '(none)'}`);
  lines.push(`Selected chat panel: ${options.selectedChatPanelId ?? '(none)'}`);
  lines.push('');

  lines.push('Header panels:');
  if (options.headerPanels.length === 0) {
    lines.push('- (none)');
  } else {
    for (const panelId of options.headerPanels) {
      const panel = panelsById.get(panelId);
      lines.push(`- ${panelId} (${formatPanelLabel(panel)})`);
    }
  }

  lines.push('Layout:');
  if (!options.layout) {
    lines.push('- (none)');
    return lines.join('\n');
  }

  renderLayoutNode(
    options.layout,
    panelsById,
    options.selectedPanelId,
    options.selectedChatPanelId,
    0,
    lines,
  );
  return lines.join('\n');
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      windows: async (args) => {
        const parsed = parsePanelWindowsArgs(args);
        if (parsed.windowId) {
          const resolution = resolvePanelWindowTarget(parsed.windowId);
          if (resolution.status === 'not_found') {
            throw new ToolError(
              'window_not_found',
              `Requested windowId is not active. Active windows: ${formatWindowList(
                resolution.windows,
              )}`,
            );
          }
        }
        const windows = listPanelWindows();
        return {
          windows: parsed.windowId
            ? windows.filter((entry) => entry.windowId === parsed.windowId)
            : windows,
        };
      },
      list: async (args) => {
        const parsed = parsePanelsListArgs(args);
        try {
          return listPanels({
            ...parsed,
            includeContext: parsed.includeContext ?? true,
          });
        } catch (err) {
          if (err instanceof PanelInventoryWindowError) {
            throw new ToolError(err.code, err.message);
          }
          throw err;
        }
      },
      selected: async (args) => {
        const parsed = parsePanelSelectedArgs(args);
        try {
          return getSelectedPanels({
            ...parsed,
            includeContext: parsed.includeContext ?? true,
          });
        } catch (err) {
          if (err instanceof PanelInventoryWindowError) {
            throw new ToolError(err.code, err.message);
          }
          throw err;
        }
      },
      event: async (args, ctx) => sendPanelEvent(args, ctx),
      tree: async (args) => {
        const parsed = parsePanelTreeArgs(args);
        const includeChat = parsed.includeChat ?? true;
        const includeContext = parsed.includeContext ?? true;
        const format = parsed.format ?? 'json';
        let listing;
        try {
          listing = listPanels({
            includeChat,
            includeContext,
            includeLayout: true,
            ...(parsed.windowId ? { windowId: parsed.windowId } : {}),
          });
        } catch (err) {
          if (err instanceof PanelInventoryWindowError) {
            throw new ToolError(err.code, err.message);
          }
          throw err;
        }
        const layout = listing.layout ?? null;
        const headerPanels = listing.headerPanels ?? [];
        const base = {
          ...(listing.windowId ? { windowId: listing.windowId } : {}),
          panels: listing.panels,
          layout,
          headerPanels,
          selectedPanelId: listing.selectedPanelId,
          selectedChatPanelId: listing.selectedChatPanelId,
          selectedPaneId: listing.selectedPaneId,
        };
        if (format === 'text') {
          return { text: renderPanelTree(base) };
        }
        if (format === 'both') {
          return { ...base, text: renderPanelTree(base) };
        }
        return base;
      },
      open: async (args, ctx) => {
        const parsed = parsePanelOpenArgs(args);
        const mode = parsed.mode ?? 'tab';
        let resolvedWindowId = parsed.windowId;
        let resolvedPaneId: string | undefined;
        let anchorPanelId: string | undefined;
        if (mode !== 'header') {
          let target;
          try {
            target = resolvePaneTarget(parsed);
          } catch (err) {
            if (err instanceof PanelInventoryWindowError) {
              throw new ToolError(err.code, err.message);
            }
            throw err;
          }
          if (!target) {
            throw new ToolError(
              'invalid_arguments',
              'No target pane is selected. Provide targetPaneId or targetPanelId, or focus a pane first.',
            );
          }
          resolvedWindowId = target.windowId ?? resolvedWindowId;
          resolvedPaneId = target.paneId;
          anchorPanelId = target.anchorPanelId;
        }

        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'open_panel',
          panelType: parsed.panelType,
          mode,
        };
        if (resolvedPaneId) {
          payload.targetPaneId = resolvedPaneId;
        }
        if (mode === 'tab' && (parsed.afterPanelId || anchorPanelId)) {
          payload.afterPanelId = parsed.afterPanelId ?? anchorPanelId;
        }
        if (mode === 'split' && parsed.direction) {
          payload.direction = parsed.direction;
        }
        if (parsed.size) {
          payload.size = parsed.size;
        }
        if (parsed.targetPanelId) {
          payload.targetPanelId = parsed.targetPanelId;
        }
        if (parsed.focus !== undefined) {
          payload.focus = parsed.focus;
        }
        if (parsed.binding) {
          payload.binding = parsed.binding;
        }
        if (mode === 'split') {
          let layoutListing;
          try {
            layoutListing = listPanels({
              includeChat: true,
              includeContext: false,
              includeLayout: true,
              ...(resolvedWindowId ? { windowId: resolvedWindowId } : {}),
            });
          } catch (err) {
            if (err instanceof PanelInventoryWindowError) {
              throw new ToolError(err.code, err.message);
            }
            throw err;
          }
          const newPaneId = createNextPaneId(layoutListing.layout ?? null);
          payload.paneId = newPaneId;
          sendPanelCommand(payload, ctx, parsed.sessionId, resolvedWindowId);
          return {
            ok: true,
            mode,
            ...(resolvedWindowId ? { windowId: resolvedWindowId } : {}),
            paneId: newPaneId,
            ...(resolvedPaneId ? { parentPaneId: resolvedPaneId } : {}),
          };
        }
        sendPanelCommand(payload, ctx, parsed.sessionId, resolvedWindowId);
        return {
          ok: true,
          mode,
          ...(resolvedWindowId ? { windowId: resolvedWindowId } : {}),
          ...(resolvedPaneId ? { paneId: resolvedPaneId } : {}),
        };
      },
      focus: async (args, ctx) => {
        const parsed = parsePanelFocusArgs(args);
        return sendPanelCommand(
          {
            type: 'panel_command',
            command: 'focus_panel',
            panelId: parsed.panelId,
          },
          ctx,
          parsed.sessionId,
          parsed.windowId,
        );
      },
      close: async (args, ctx) => {
        const parsed = parsePanelCloseArgs(args);
        return sendPanelCommand(
          {
            type: 'panel_command',
            command: 'close_panel',
            panelId: parsed.panelId,
          },
          ctx,
          parsed.sessionId,
          parsed.windowId,
        );
      },
      remove: async (args, ctx) => {
        const parsed = parsePanelCloseArgs(args);
        return sendPanelCommand(
          {
            type: 'panel_command',
            command: 'remove_panel',
            panelId: parsed.panelId,
          },
          ctx,
          parsed.sessionId,
          parsed.windowId,
        );
      },
      replace: async (args, ctx) => {
        const parsed = parsePanelReplaceArgs(args);
        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'replace_panel',
          panelId: parsed.panelId,
          panelType: parsed.panelType,
        };
        if (parsed.binding) {
          payload.binding = parsed.binding;
        }
        return sendPanelCommand(payload, ctx, parsed.sessionId, parsed.windowId);
      },
      move: async (args, ctx) => {
        const parsed = parsePanelMoveArgs(args);
        const mode = parsed.mode ?? 'tab';
        let target;
        try {
          target = resolvePaneTarget(parsed);
        } catch (err) {
          if (err instanceof PanelInventoryWindowError) {
            throw new ToolError(err.code, err.message);
          }
          throw err;
        }
        if (!target) {
          throw new ToolError(
            'invalid_arguments',
            'No target pane is selected. Provide targetPaneId or targetPanelId, or focus a pane first.',
          );
        }
        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'move_panel',
          panelId: parsed.panelId,
          mode,
          targetPaneId: target.paneId,
        };
        if (parsed.targetPanelId) {
          payload.targetPanelId = parsed.targetPanelId;
        }
        if (mode === 'tab' && (parsed.afterPanelId || target.anchorPanelId)) {
          payload.afterPanelId = parsed.afterPanelId ?? target.anchorPanelId;
        }
        if (mode === 'split' && parsed.direction) {
          payload.direction = parsed.direction;
          let layoutListing;
          try {
            layoutListing = listPanels({
              includeChat: true,
              includeContext: false,
              includeLayout: true,
              ...(target.windowId ? { windowId: target.windowId } : {}),
            });
          } catch (err) {
            if (err instanceof PanelInventoryWindowError) {
              throw new ToolError(err.code, err.message);
            }
            throw err;
          }
          payload.paneId = createNextPaneId(layoutListing.layout ?? null);
        }
        if (parsed.size) {
          payload.size = parsed.size;
        }
        sendPanelCommand(payload, ctx, parsed.sessionId, target.windowId);
        return {
          ok: true,
          mode,
          ...(target.windowId ? { windowId: target.windowId } : {}),
          paneId: mode === 'split' ? (payload.paneId as string) : target.paneId,
        };
      },
      'close-split': async (args, ctx) => {
        const parsed = parsePanelCloseSplitArgs(args);
        return sendPanelCommand(
          {
            type: 'panel_command',
            command: 'close_split',
            splitId: parsed.splitId,
          },
          ctx,
          parsed.sessionId,
          parsed.windowId,
        );
      },
    },
  };
}
