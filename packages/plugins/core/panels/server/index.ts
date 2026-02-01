import type {
  CombinedPluginManifest,
  LayoutNode,
  PanelBinding,
  PanelEventEnvelope,
  PanelInventoryItem,
  PanelPlacement,
} from '@assistant/shared';
import { PanelBindingSchema, PanelPlacementSchema } from '@assistant/shared';

import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import { ToolError, type ToolContext } from '../../../../agent-server/src/tools';
import {
  PanelInventoryWindowError,
  getSelectedPanels,
  listPanels,
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
  targetPanelId?: string;
  placement?: PanelPlacement;
  focus?: boolean;
  pinToHeader?: boolean;
  binding?: PanelBinding;
  sessionId?: string;
  windowId?: string;
};

type PanelCloseArgs = {
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
  placement: PanelPlacement;
  targetPanelId?: string;
  sessionId?: string;
  windowId?: string;
};

type PanelToggleSplitViewArgs = {
  splitId?: string;
  panelId?: string;
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

function normalizePanelPlacement(value: unknown): unknown {
  if (typeof value === 'string') {
    return { region: value };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const region =
    typeof record['region'] === 'string'
      ? record['region']
      : typeof record['position'] === 'string'
        ? record['position']
        : null;
  if (!region) {
    return value;
  }
  const normalized: Record<string, unknown> = { region };
  if (record['size'] !== undefined) {
    normalized['size'] = record['size'];
  }
  return normalized;
}

function parsePanelPlacement(value: unknown, label: string): PanelPlacement {
  const normalized = normalizePanelPlacement(value);
  const parsed = PanelPlacementSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ToolError('invalid_arguments', `${label} must be a valid panel placement`);
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

function parsePanelOpenArgs(raw: unknown): PanelOpenArgs {
  const obj = asObject(raw);

  const panelType = parseOptionalString(obj, 'panelType', 'panelType') ?? 'empty';
  const targetPanelId = parseOptionalString(obj, 'targetPanelId', 'targetPanelId');
  const focus = parseOptionalBoolean(obj, 'focus', 'focus');
  const pinToHeader = parseOptionalBoolean(obj, 'pinToHeader', 'pinToHeader');
  const placement =
    obj['placement'] !== undefined ? parsePanelPlacement(obj['placement'], 'placement') : undefined;
  const binding = parsePanelBinding(obj['binding']);
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');

  return {
    panelType,
    ...(targetPanelId ? { targetPanelId } : {}),
    ...(placement ? { placement } : {}),
    ...(focus !== undefined ? { focus } : {}),
    ...(pinToHeader !== undefined ? { pinToHeader } : {}),
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

function parsePanelMoveArgs(raw: unknown): PanelMoveArgs {
  const obj = asObject(raw);
  const panelId = parseRequiredString(obj, 'panelId', 'panelId');
  if (!('placement' in obj)) {
    throw new ToolError('invalid_arguments', 'placement is required');
  }
  const placement = parsePanelPlacement(obj['placement'], 'placement');
  const targetPanelId = parseOptionalString(obj, 'targetPanelId', 'targetPanelId');
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    panelId,
    placement,
    ...(targetPanelId ? { targetPanelId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

function parsePanelToggleSplitViewArgs(raw: unknown): PanelToggleSplitViewArgs {
  const obj = asObject(raw);
  const splitId = parseOptionalString(obj, 'splitId', 'splitId');
  const panelId = parseOptionalString(obj, 'panelId', 'panelId');
  if (!splitId && !panelId) {
    throw new ToolError('invalid_arguments', 'splitId or panelId is required');
  }
  const sessionId = parseOptionalString(obj, 'sessionId', 'sessionId');
  const windowId = parseOptionalString(obj, 'windowId', 'windowId');
  return {
    ...(splitId ? { splitId } : {}),
    ...(panelId ? { panelId } : {}),
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
  if (node.kind === 'panel') {
    const panel = panelsById.get(node.panelId);
    let activeLabel = '';
    if (node.panelId === selectedPanelId) {
      activeLabel = ' [active]';
    } else if (node.panelId === selectedChatPanelId) {
      activeLabel = ' [chat-active]';
    }
    lines.push(`${indent}- panel ${node.panelId} (${formatPanelLabel(panel)})${activeLabel}`);
    return;
  }
  const viewMode = node.viewMode ?? 'split';
  const active = node.activeId ? ` active=${node.activeId}` : '';
  lines.push(`${indent}- split ${node.splitId} (${node.direction}, ${viewMode}${active})`);
  for (const child of node.children) {
    renderLayoutNode(child, panelsById, selectedPanelId, selectedChatPanelId, depth + 1, lines);
  }
}

function renderPanelTree(options: {
  layout: LayoutNode | null;
  headerPanels: string[];
  panels: PanelInventoryItem[];
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
}): string {
  const lines: string[] = [];
  const panelsById = new Map(options.panels.map((panel) => [panel.panelId, panel]));

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
        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'open_panel',
          panelType: parsed.panelType,
        };
        if (parsed.targetPanelId) {
          payload.targetPanelId = parsed.targetPanelId;
        }
        if (parsed.placement) {
          payload.placement = parsed.placement;
        }
        if (parsed.focus !== undefined) {
          payload.focus = parsed.focus;
        }
        if (parsed.pinToHeader !== undefined) {
          payload.pinToHeader = parsed.pinToHeader;
        }
        if (parsed.binding) {
          payload.binding = parsed.binding;
        }
        return sendPanelCommand(payload, ctx, parsed.sessionId, parsed.windowId);
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
        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'move_panel',
          panelId: parsed.panelId,
          placement: parsed.placement,
        };
        if (parsed.targetPanelId) {
          payload.targetPanelId = parsed.targetPanelId;
        }
        return sendPanelCommand(payload, ctx, parsed.sessionId, parsed.windowId);
      },
      'toggle-split-view': async (args, ctx) => {
        const parsed = parsePanelToggleSplitViewArgs(args);
        const payload: PanelCommandPayload = {
          type: 'panel_command',
          command: 'toggle_split_view',
        };
        if (parsed.splitId) {
          payload.splitId = parsed.splitId;
        }
        if (parsed.panelId) {
          payload.panelId = parsed.panelId;
        }
        return sendPanelCommand(payload, ctx, parsed.sessionId, parsed.windowId);
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
