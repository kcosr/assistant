import type { LayoutPersistence } from '@assistant/shared';
import type {
  PanelHandle,
  PanelHost,
  PanelInitOptions,
} from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';
import {
  resolveAutoTitle,
  resolveSessionBaseLabel,
  type AgentLabelSummary,
  type SessionLabelSummary,
} from '../../../../web-client/src/utils/sessionLabel';

interface NotificationRecord {
  id: string;
  kind: 'session_attention' | 'notification';
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  source: 'tool' | 'http' | 'cli' | 'system';
  sessionId: string | null;
  sessionTitle: string | null;
  tts: boolean;
  voiceMode: 'none' | 'speak' | 'speak_then_listen';
  ttsText: string | null;
  sourceEventId: string | null;
  sessionActivitySeq: number | null;
}

type SessionSummary = SessionLabelSummary & {
  lastSnippet?: string;
};

interface AssistantNativeVoiceBridgeTarget {
  performNotificationSpeaker?: (args: { notification: NotificationRecord }) => void | Promise<void>;
  performNotificationMic?: (args: { notification: NotificationRecord }) => void | Promise<void>;
}

interface AssistantNativeVoiceBridgeHost {
  AssistantNativeVoice?: AssistantNativeVoiceBridgeTarget;
  Capacitor?: {
    Plugins?: {
      AssistantNativeVoice?: AssistantNativeVoiceBridgeTarget;
    };
    getPlatform?: () => string;
  };
}

type FilterMode = 'all' | 'unread';
type DensityMode = 'card' | 'compact';
const SNAPSHOT_RETRY_DELAY_MS = 1000;
const SNAPSHOT_RETRY_LIMIT = 10;

type LayoutPanelEntry = {
  panelType?: string;
  binding?: { mode?: string; sessionId?: string } | null;
};

interface PanelState {
  notifications: NotificationRecord[];
  filter: FilterMode;
  density: DensityMode;
  expandedIds: Set<string>;
  menuOpen: boolean;
}

// --- Icons (Lucide-style SVG paths) ---

const ICON_PATHS: Record<string, string> = {
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  http: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  cli: 'M4 17l6-6-6-6 M12 19h8',
  system: 'M12 2l7 4v6c0 5-3.4 9.4-7 10-3.6-.6-7-5-7-10V6l7-4z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  moreVertical: 'M12 12h.01 M12 5h.01 M12 19h.01',
  stop: 'M8 8h8v8H8z',
  volume: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.07',
  externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
  inbox: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M22 12h-4l-3 3h-6l-3-3H2',
  attention: 'M12 9v4 M12 17h.01 M10.29 3.86l-7.5 13A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.71-3l-7.5-13a2 2 0 0 0-3.42 0z',
  close: 'M18 6L6 18 M6 6l12 12',
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v1a7 7 0 0 1-14 0v-1 M12 18v4 M8 22h8',
};

function createSvgIcon(pathD: string, className = 'notif-icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of pathD.split(' M')) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d.startsWith('M') ? d : `M${d}`);
    svg.appendChild(path);
  }
  return svg;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getNativeVoiceBridgeTarget(): AssistantNativeVoiceBridgeTarget | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const host = window as unknown as AssistantNativeVoiceBridgeHost;
  return host.AssistantNativeVoice ?? host.Capacitor?.Plugins?.AssistantNativeVoice ?? null;
}

function isAndroidNativeVoiceAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window as unknown as AssistantNativeVoiceBridgeHost;
  const target = getNativeVoiceBridgeTarget();
  if (!target) {
    return false;
  }
  const platform = host.Capacitor?.getPlatform?.();
  return !platform || platform === 'android';
}

function invokeNativeVoiceAction(
  methodName: keyof AssistantNativeVoiceBridgeTarget,
  notification: NotificationRecord,
): boolean {
  console.info(
    `[notifications] invoking ${String(methodName)} id=${notification.id} sessionId=${notification.sessionId ?? ''} kind=${notification.kind} voiceMode=${notification.voiceMode}`,
  );
  const target = getNativeVoiceBridgeTarget();
  const method = target?.[methodName];
  if (typeof method !== 'function') {
    console.warn(
      `[notifications] ${String(methodName)} unavailable id=${notification.id} sessionId=${notification.sessionId ?? ''}`,
    );
    return false;
  }
  try {
    const result = method({ notification });
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result)
        .then(() => {
          console.info(
            `[notifications] ${String(methodName)} resolved id=${notification.id} sessionId=${notification.sessionId ?? ''}`,
          );
        })
        .catch((error: unknown) => {
          console.warn(`[notifications] ${String(methodName)} failed`, error);
        });
    } else {
      console.info(
        `[notifications] ${String(methodName)} dispatched synchronously id=${notification.id} sessionId=${notification.sessionId ?? ''}`,
      );
    }
    return true;
  } catch (error) {
    console.warn(`[notifications] ${String(methodName)} failed`, error);
    return false;
  }
}

function resolveSpokenText(notification: NotificationRecord): string {
  if (notification.ttsText && notification.ttsText.trim()) {
    return notification.ttsText.trim();
  }
  if (notification.body.trim()) {
    return notification.body.trim();
  }
  return notification.title.trim();
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(
      target.closest('.notif-action-btn, .notif-dismiss-btn, .notif-expand-btn'),
    );
}

function resolveClientSessionLabel(
  summary: SessionSummary | null,
  agentSummaries: AgentLabelSummary[],
): string {
  if (!summary) {
    return '';
  }
  return resolveSessionBaseLabel(summary, agentSummaries);
}

(function () {
  if (!window.ASSISTANT_PANEL_REGISTRY) {
    return;
  }

  window.ASSISTANT_PANEL_REGISTRY.registerPanel('notifications', () => ({
    mount(container: HTMLElement, host: PanelHost, _init: PanelInitOptions): PanelHandle {
      const state: PanelState = {
        notifications: [],
        filter: 'all',
        density: 'card',
        expandedIds: new Set(),
        menuOpen: false,
      };

      // Monotonic revision counter from the server. Used to discard
      // stale snapshots that arrive after newer incremental events.
      let knownRevision = -1;
      let initialSnapshotReceived = false;
      let snapshotRetryCount = 0;
      let snapshotRetryTimer: number | null = null;
      // Load persisted state
      const persisted = host.loadPanelState() as {
        filter?: FilterMode;
        density?: DensityMode;
      } | null;
      if (persisted) {
        if (persisted.filter === 'all' || persisted.filter === 'unread') {
          state.filter = persisted.filter;
        }
        if (persisted.density === 'card' || persisted.density === 'compact') {
          state.density = persisted.density;
        }
      }

      // --- Build DOM ---

      // Chrome header
      const header = document.createElement('div');
      header.className = 'panel-header panel-chrome-row';
      header.setAttribute('data-role', 'chrome-row');
      header.innerHTML = `
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Notifications</span>
        </div>
        <div class="panel-chrome-plugin-controls notif-header-controls" data-role="chrome-plugin-controls"></div>
        <div class="panel-chrome-frame-controls" data-role="chrome-controls">
          <button type="button" class="panel-chrome-button panel-chrome-toggle" data-action="toggle" aria-label="Panel controls" title="Panel controls">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <div class="panel-chrome-frame-buttons">
            <button type="button" class="panel-chrome-button" data-action="move" aria-label="Move panel" title="Move">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
              </svg>
            </button>
            <button type="button" class="panel-chrome-button" data-action="reorder" aria-label="Reorder panel" title="Reorder">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
              </svg>
            </button>
            <button type="button" class="panel-chrome-button" data-action="menu" aria-label="More actions" title="More actions">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/>
                <circle cx="12" cy="12" r="1.5"/>
                <circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
          </div>
          <button type="button" class="panel-chrome-button panel-chrome-close" data-action="close" aria-label="Close panel" title="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      `;
      container.appendChild(header);

      const controlsEl = header.querySelector<HTMLElement>(
        '[data-role="chrome-plugin-controls"]',
      )!;

      // Filter toggle
      const filterBtn = document.createElement('button');
      filterBtn.className = 'notif-toggle-btn';
      filterBtn.title = 'Toggle All / Unread';
      controlsEl.appendChild(filterBtn);

      // Density toggle
      const densityBtn = document.createElement('button');
      densityBtn.className = 'notif-toggle-btn';
      densityBtn.title = 'Toggle Card / Compact';
      controlsEl.appendChild(densityBtn);

      // Overflow menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'notif-toggle-btn notif-menu-btn';
      menuBtn.title = 'More actions';
      menuBtn.appendChild(createSvgIcon(ICON_PATHS.moreVertical));
      controlsEl.appendChild(menuBtn);

      // Overflow menu dropdown
      const menuDropdown = document.createElement('div');
      menuDropdown.className = 'notif-menu-dropdown';
      menuDropdown.style.display = 'none';

      const markAllReadBtn = document.createElement('button');
      markAllReadBtn.className = 'notif-menu-item';
      markAllReadBtn.textContent = 'Mark all read';
      menuDropdown.appendChild(markAllReadBtn);

      const clearAllBtn = document.createElement('button');
      clearAllBtn.className = 'notif-menu-item notif-menu-item-danger';
      clearAllBtn.textContent = 'Clear all';
      menuDropdown.appendChild(clearAllBtn);

      controlsEl.appendChild(menuDropdown);

      // Chrome controller
      const chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'Notifications',
      });

      // Body
      const body = document.createElement('div');
      body.className = 'panel-body notif-body';
      container.appendChild(body);

      const emptyState = document.createElement('div');
      emptyState.className = 'notif-empty';
      emptyState.innerHTML = `
        <div class="notif-empty-icon">${createSvgIcon(ICON_PATHS.inbox, 'notif-icon notif-icon-lg').outerHTML}</div>
        <div class="notif-empty-text">No notifications</div>
      `;
      body.appendChild(emptyState);

      const listEl = document.createElement('div');
      listEl.className = 'notif-list';
      body.appendChild(listEl);

      // --- Rendering ---

      const getFilteredNotifications = (): NotificationRecord[] => {
        if (state.filter === 'unread') {
          return state.notifications.filter((n) => n.readAt === null);
        }
        return state.notifications;
      };

      const updateBadge = (): void => {
        const unreadCount = state.notifications.filter((n) => n.readAt === null).length;
        host.setPanelMetadata({
          badge: unreadCount > 0 ? String(unreadCount) : undefined,
        });
      };

      const updateFilterButton = (): void => {
        filterBtn.textContent = state.filter === 'all' ? 'All' : 'Unread';
      };

      const updateDensityButton = (): void => {
        densityBtn.textContent = state.density === 'card' ? 'Card' : 'Compact';
      };

      const persistState = (): void => {
        host.persistPanelState({ filter: state.filter, density: state.density });
      };

      const clearSnapshotRetry = (): void => {
        if (snapshotRetryTimer !== null) {
          window.clearTimeout(snapshotRetryTimer);
          snapshotRetryTimer = null;
        }
      };

      const requestSnapshot = (): void => {
        console.info('[notifications] request_snapshot', {
          attempt: snapshotRetryCount + 1,
          hasSnapshot: initialSnapshotReceived,
        });
        host.sendEvent({ type: 'request_snapshot' });
      };

      const closeTransientPanelIfNeeded = (): void => {
        const layout = host.getContext('panel.layout') as LayoutPersistence | null;
        const panelId = host.panelId();
        const isHeaderPanel = Array.isArray(layout?.headerPanels) && layout.headerPanels.includes(panelId);
        const isModalPanel = Array.from(
          document.querySelectorAll<HTMLElement>('.panel-modal-overlay.open .panel-frame[data-panel-id]'),
        ).some((frame) => frame.dataset['panelId'] === panelId);
        if (isHeaderPanel) {
          document.body.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        if (isModalPanel) {
          host.closePanel(panelId);
        }
      };

      const scheduleSnapshotRetry = (): void => {
        clearSnapshotRetry();
        if (initialSnapshotReceived || snapshotRetryCount >= SNAPSHOT_RETRY_LIMIT) {
          return;
        }
        snapshotRetryTimer = window.setTimeout(() => {
          snapshotRetryTimer = null;
          if (initialSnapshotReceived) {
            return;
          }
          snapshotRetryCount += 1;
          requestSnapshot();
          scheduleSnapshotRetry();
        }, SNAPSHOT_RETRY_DELAY_MS);
      };

      const getSessionSummaries = (): SessionSummary[] => {
        const raw = host.getContext('session.summaries');
        return Array.isArray(raw) ? (raw as SessionSummary[]) : [];
      };

      const getAgentSummaries = (): AgentLabelSummary[] => {
        const raw = host.getContext('agent.summaries');
        if (!Array.isArray(raw)) {
          return [];
        }
        const summaries: AgentLabelSummary[] = [];
        for (const entry of raw) {
          if (!entry || typeof entry !== 'object') {
            continue;
          }
          const typed = entry as { agentId?: unknown; displayName?: unknown };
          const agentId = typeof typed.agentId === 'string' ? typed.agentId.trim() : '';
          if (!agentId) {
            continue;
          }
          const displayName = typeof typed.displayName === 'string' ? typed.displayName.trim() : '';
          summaries.push({ agentId, displayName: displayName || agentId });
        }
        return summaries;
      };

      const renderNotificationItem = (n: NotificationRecord): HTMLElement => {
        const isRead = n.readAt !== null;
        const isCompact = state.density === 'compact';
        const isExpanded = state.expandedIds.has(n.id);
        const nativeVoiceAvailable = isAndroidNativeVoiceAvailable();
        const spokenText = resolveSpokenText(n);
        const agentSummaries = getAgentSummaries();
        const matchingSession = n.sessionId
          ? getSessionSummaries().find((summary) => summary.sessionId === n.sessionId) ?? null
          : null;
        const clientName = typeof matchingSession?.name === 'string' ? matchingSession.name.trim() : '';
        const clientAutoTitle = resolveAutoTitle(matchingSession?.attributes);
        const clientSessionLabel = resolveClientSessionLabel(matchingSession, agentSummaries);
        const displayTitle =
          n.kind === 'session_attention'
            ? clientSessionLabel || n.sessionTitle?.trim() || n.sessionId?.trim() || n.title
            : n.title;
        if (n.sessionId) {
          console.info('[notifications] title render', {
            notificationId: n.id,
            sessionId: n.sessionId,
            kind: n.kind,
            notificationTitle: n.title,
            notificationSessionTitle: n.sessionTitle,
            clientSessionName: clientName || null,
            clientSessionAutoTitle: clientAutoTitle || null,
            clientSessionLabel: clientSessionLabel || null,
            clientLastSnippet:
              typeof matchingSession?.lastSnippet === 'string' ? matchingSession.lastSnippet : null,
            chosenDisplayTitle: displayTitle,
          });
        }
        const canSpeak = nativeVoiceAvailable && spokenText.length > 0;
        const canListen = nativeVoiceAvailable && !!n.sessionId;

        const item = document.createElement('div');
        item.className = `notif-item${isRead ? ' notif-item-read' : ''}${isCompact ? ' notif-item-compact' : ''}${n.sessionId ? ' notif-item-linkable' : ''}`;
        item.dataset.id = n.id;

        const markInteractivePress = (event: Event): void => {
          item.classList.add('notif-item-suppress-press');
          event.stopPropagation();
        };
        const clearInteractivePress = (): void => {
          item.classList.remove('notif-item-suppress-press');
        };
        const stopInteractiveClick = (event: Event): void => {
          clearInteractivePress();
          if (event.cancelable) {
            event.preventDefault();
          }
          event.stopPropagation();
        };

        // Source icon
        const sourceIcon = document.createElement('div');
        sourceIcon.className = 'notif-source-icon';
        sourceIcon.title = n.source;
        sourceIcon.appendChild(
          createSvgIcon(
            n.kind === 'session_attention' ? ICON_PATHS.inbox : (ICON_PATHS[n.source] ?? ICON_PATHS.tool),
          ),
        );
        item.appendChild(sourceIcon);

        // Content area
        const content = document.createElement('div');
        content.className = 'notif-content';

        // Title row
        const titleRow = document.createElement('div');
        titleRow.className = 'notif-title-row';

        const titleEl = document.createElement('span');
        titleEl.className = 'notif-title';
        titleEl.textContent = displayTitle;
        titleRow.appendChild(titleEl);

        // Unread dot
        if (!isRead) {
          const dot = document.createElement('span');
          dot.className = 'notif-unread-dot';
          titleRow.appendChild(dot);
        }

        const appendActionButton = (
          parent: HTMLElement,
          options: {
            className?: string;
            title: string;
            ariaLabel: string;
            iconPath: string;
            label?: string;
            onPointerDownLog: string;
            onClickLog: string;
            onClick: () => void;
          },
        ): void => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = options.className ?? 'notif-action-btn';
          button.title = options.title;
          button.setAttribute('aria-label', options.ariaLabel);
          button.appendChild(createSvgIcon(options.iconPath, 'notif-icon notif-icon-xs'));
          if (options.label) {
            const label = document.createElement('span');
            label.textContent = options.label;
            button.appendChild(label);
          }
          button.addEventListener('pointerdown', (e) => {
            markInteractivePress(e);
            console.info(options.onPointerDownLog);
          });
          button.addEventListener('pointerup', clearInteractivePress);
          button.addEventListener('pointercancel', clearInteractivePress);
          button.addEventListener('click', (e) => {
            stopInteractiveClick(e);
            console.info(options.onClickLog);
            options.onClick();
          });
          parent.appendChild(button);
        };

        if (isCompact && (canSpeak || canListen)) {
          const compactActionsEl = document.createElement('div');
          compactActionsEl.className = 'notif-compact-actions';
          if (canSpeak) {
            appendActionButton(compactActionsEl, {
              className: 'notif-action-btn notif-action-btn-compact',
              title: 'Play notification',
              ariaLabel: 'Play notification',
              iconPath: ICON_PATHS.volume,
              onPointerDownLog: `[notifications] speaker pointerdown id=${n.id} sessionId=${n.sessionId ?? ''}`,
              onClickLog: `[notifications] speaker click id=${n.id} sessionId=${n.sessionId ?? ''}`,
              onClick: () => invokeNativeVoiceAction('performNotificationSpeaker', n),
            });
          }
          if (canListen) {
            appendActionButton(compactActionsEl, {
              className: 'notif-action-btn notif-action-btn-compact',
              title: 'Speak now',
              ariaLabel: 'Speak now',
              iconPath: ICON_PATHS.mic,
              onPointerDownLog: `[notifications] mic pointerdown id=${n.id} sessionId=${n.sessionId ?? ''}`,
              onClickLog: `[notifications] mic click id=${n.id} sessionId=${n.sessionId ?? ''}`,
              onClick: () => invokeNativeVoiceAction('performNotificationMic', n),
            });
          }
          titleRow.appendChild(compactActionsEl);
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'notif-time';
        timeEl.textContent = formatRelativeTime(n.createdAt);
        titleRow.appendChild(timeEl);

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'notif-dismiss-btn';
        dismissBtn.title = 'Dismiss notification';
        dismissBtn.setAttribute('aria-label', 'Dismiss notification');
        dismissBtn.appendChild(createSvgIcon(ICON_PATHS.close, 'notif-icon notif-icon-xs'));
        dismissBtn.addEventListener('click', (e) => {
          stopInteractiveClick(e);
          host.sendEvent({ type: 'clear', id: n.id });
        });
        titleRow.appendChild(dismissBtn);

        content.appendChild(titleRow);

        // Body (always shown in card mode, expanded-only in compact)
        if (!isCompact || isExpanded) {
          const bodyEl = document.createElement('div');
          bodyEl.className = 'notif-body-text';
          bodyEl.textContent = n.body;
          content.appendChild(bodyEl);

          if (canSpeak || canListen) {
            const actionsEl = document.createElement('div');
            actionsEl.className = 'notif-actions';

            if (canSpeak) {
              appendActionButton(actionsEl, {
                title: 'Play notification',
                ariaLabel: 'Play notification',
                iconPath: ICON_PATHS.volume,
                label: 'Play',
                onPointerDownLog: `[notifications] speaker pointerdown id=${n.id} sessionId=${n.sessionId ?? ''}`,
                onClickLog: `[notifications] speaker click id=${n.id} sessionId=${n.sessionId ?? ''}`,
                onClick: () => invokeNativeVoiceAction('performNotificationSpeaker', n),
              });
            }

            if (canListen) {
              appendActionButton(actionsEl, {
                title: 'Speak now',
                ariaLabel: 'Speak now',
                iconPath: ICON_PATHS.mic,
                label: 'Speak',
                onPointerDownLog: `[notifications] mic pointerdown id=${n.id} sessionId=${n.sessionId ?? ''}`,
                onClickLog: `[notifications] mic click id=${n.id} sessionId=${n.sessionId ?? ''}`,
                onClick: () => invokeNativeVoiceAction('performNotificationMic', n),
              });
            }

            content.appendChild(actionsEl);
          }
        }

        item.appendChild(content);

        // Compact expand chevron
        if (isCompact) {
          const expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'notif-expand-btn';
          expandBtn.title = isExpanded ? 'Collapse' : 'Expand';
          expandBtn.appendChild(
            createSvgIcon(
              isExpanded ? ICON_PATHS.chevronUp : ICON_PATHS.chevronDown,
              'notif-icon notif-icon-xs',
            ),
          );
          expandBtn.addEventListener('click', (e) => {
            stopInteractiveClick(e);
            if (state.expandedIds.has(n.id)) {
              state.expandedIds.delete(n.id);
            } else {
              state.expandedIds.add(n.id);
            }
            render();
          });
          item.appendChild(expandBtn);
        }

        // Main item tap toggles read/unread
        item.addEventListener('click', (event) => {
          clearInteractivePress();
          if (isInteractiveTarget(event.target)) {
            return;
          }
          if (n.sessionId) {
            openSession(n.sessionId);
          }
        });

        return item;
      };

      const render = (): void => {
        const filtered = getFilteredNotifications();
        listEl.innerHTML = '';

        if (filtered.length === 0) {
          emptyState.style.display = '';
          listEl.style.display = 'none';
        } else {
          emptyState.style.display = 'none';
          listEl.style.display = '';
          for (const n of filtered) {
            listEl.appendChild(renderNotificationItem(n));
          }
        }

        updateFilterButton();
        updateDensityButton();
        updateBadge();
      };

      // --- Session navigation ---

      const openSession = (sessionId: string): void => {
        console.info(`[notifications] openSession sessionId=${sessionId}`);
        const layout = host.getContext('panel.layout') as LayoutPersistence | null;
        const panels = layout?.panels as Record<string, LayoutPanelEntry> | undefined;

        if (panels) {
          for (const [panelId, panel] of Object.entries(panels)) {
            if (panel.panelType !== 'chat') {
              continue;
            }
            if (panel.binding?.mode === 'fixed' && panel.binding.sessionId === sessionId) {
              console.info(
                `[notifications] activating existing session panel panelId=${panelId} sessionId=${sessionId}`,
              );
              host.activatePanel(panelId);
              closeTransientPanelIfNeeded();
              return;
            }
          }

        }

        console.info(`[notifications] opening new session panel sessionId=${sessionId}`);
        host.openPanel('chat', {
          binding: { mode: 'fixed' as const, sessionId },
          focus: true,
        });
        closeTransientPanelIfNeeded();
      };

      // --- Event handlers ---

      filterBtn.addEventListener('click', () => {
        state.filter = state.filter === 'all' ? 'unread' : 'all';
        persistState();
        render();
      });

      densityBtn.addEventListener('click', () => {
        state.density = state.density === 'card' ? 'compact' : 'card';
        state.expandedIds.clear();
        persistState();
        render();
      });

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.menuOpen = !state.menuOpen;
        menuDropdown.style.display = state.menuOpen ? '' : 'none';
      });

      markAllReadBtn.addEventListener('click', () => {
        state.menuOpen = false;
        menuDropdown.style.display = 'none';
        host.sendEvent({ type: 'mark_all_read' });
      });

      clearAllBtn.addEventListener('click', () => {
        state.menuOpen = false;
        menuDropdown.style.display = 'none';
        host.sendEvent({ type: 'clear_all' });
      });

      // Close menu when clicking outside
      const closeMenu = (): void => {
        if (state.menuOpen) {
          state.menuOpen = false;
          menuDropdown.style.display = 'none';
        }
      };
      document.addEventListener('click', closeMenu);

      // --- Process server events ---

      const processEvent = (event: {
        event: string;
        revision?: number;
        notification?: NotificationRecord;
        id?: string;
        notifications?: NotificationRecord[];
      }): void => {
        console.info('[notifications] panel event', {
          event: event.event,
          revision: event.revision ?? null,
          notificationId: event.notification?.id ?? null,
          sessionId: event.notification?.sessionId ?? null,
          title: event.notification?.title ?? null,
          sessionTitle: event.notification?.sessionTitle ?? null,
          notificationsCount: Array.isArray(event.notifications) ? event.notifications.length : null,
        });
        const eventRevision = typeof event.revision === 'number' ? event.revision : -1;
        const upsertNotification = (notification: NotificationRecord): void => {
          state.notifications = state.notifications.filter((existing) => {
            if (existing.id === notification.id) {
              return false;
            }
            return !(
              notification.kind === 'session_attention' &&
              existing.kind === 'session_attention' &&
              existing.sessionId === notification.sessionId
            );
          });
          state.notifications.unshift(notification);
        };

        switch (event.event) {
          case 'created':
            if (event.notification) {
              upsertNotification(event.notification);
            }
            if (eventRevision > knownRevision) {
              knownRevision = eventRevision;
            }
            break;
          case 'upserted':
            if (event.notification) {
              upsertNotification(event.notification);
            }
            if (eventRevision > knownRevision) {
              knownRevision = eventRevision;
            }
            break;
          case 'updated':
            if (event.notification) {
              const idx = state.notifications.findIndex((n) => n.id === event.notification!.id);
              if (idx !== -1) {
                state.notifications[idx] = event.notification;
              }
            }
            if (eventRevision > knownRevision) {
              knownRevision = eventRevision;
            }
            break;
          case 'removed':
            if (event.id) {
              state.notifications = state.notifications.filter((n) => n.id !== event.id);
              state.expandedIds.delete(event.id);
            }
            if (eventRevision > knownRevision) {
              knownRevision = eventRevision;
            }
            break;
          case 'snapshot':
            // Discard stale snapshots that arrive after newer incremental events.
            if (eventRevision >= 0 && eventRevision < knownRevision) {
              return;
            }
            initialSnapshotReceived = true;
            clearSnapshotRetry();
            if (event.notifications) {
              state.notifications = event.notifications;
              const ids = new Set(state.notifications.map((n) => n.id));
              for (const id of state.expandedIds) {
                if (!ids.has(id)) {
                  state.expandedIds.delete(id);
                }
              }
            }
            if (eventRevision > knownRevision) {
              knownRevision = eventRevision;
            }
            break;
        }
        render();
      };

      // Request initial data. Retry until the first snapshot arrives so
      // startup timing does not leave the panel empty after app launch.
      requestSnapshot();
      scheduleSnapshotRetry();

      const unsubscribeSessionSummaries = host.subscribeContext('session.summaries', () => {
        console.info('[notifications] session summaries updated');
        render();
      });
      const unsubscribeAgentSummaries = host.subscribeContext('agent.summaries', () => {
        console.info('[notifications] agent summaries updated');
        render();
      });

      // Initial render
      render();

      return {
        onEvent(event: { payload?: unknown }): void {
          const payload = event.payload as Record<string, unknown> | undefined;
          if (
            payload &&
            typeof payload === 'object' &&
            payload['type'] === 'notification_update' &&
            typeof payload['event'] === 'string'
          ) {
            processEvent(payload as unknown as {
              event: string;
              revision?: number;
              notification?: NotificationRecord;
              id?: string;
              notifications?: NotificationRecord[];
            });
          }
        },
        unmount(): void {
          clearSnapshotRetry();
          unsubscribeSessionSummaries();
          unsubscribeAgentSummaries();
          document.removeEventListener('click', closeMenu);
          chromeController.destroy();
          container.innerHTML = '';
        },
      };
    },
  }));
})();
