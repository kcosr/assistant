import type {
  PanelHandle,
  PanelHost,
  PanelInitOptions,
} from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';

interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  source: 'tool' | 'http' | 'cli';
  sessionId: string | null;
  sessionTitle: string | null;
  tts: boolean;
}

type FilterMode = 'all' | 'unread';
type DensityMode = 'card' | 'compact';

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
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  moreVertical: 'M12 12h.01 M12 5h.01 M12 19h.01',
  volume: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.07',
  externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
  messageSquare: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
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
        <div class="notif-empty-icon">${createSvgIcon(ICON_PATHS.messageSquare, 'notif-icon notif-icon-lg').outerHTML}</div>
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

      const renderNotificationItem = (n: NotificationRecord): HTMLElement => {
        const isRead = n.readAt !== null;
        const isCompact = state.density === 'compact';
        const isExpanded = state.expandedIds.has(n.id);

        const item = document.createElement('div');
        item.className = `notif-item${isRead ? ' notif-item-read' : ''}${isCompact ? ' notif-item-compact' : ''}`;
        item.dataset.id = n.id;

        // Source icon
        const sourceIcon = document.createElement('div');
        sourceIcon.className = 'notif-source-icon';
        sourceIcon.title = n.source;
        sourceIcon.appendChild(createSvgIcon(ICON_PATHS[n.source] ?? ICON_PATHS.tool));
        item.appendChild(sourceIcon);

        // Content area
        const content = document.createElement('div');
        content.className = 'notif-content';

        // Title row
        const titleRow = document.createElement('div');
        titleRow.className = 'notif-title-row';

        const titleEl = document.createElement('span');
        titleEl.className = 'notif-title';
        titleEl.textContent = n.title;
        titleRow.appendChild(titleEl);

        // Unread dot
        if (!isRead) {
          const dot = document.createElement('span');
          dot.className = 'notif-unread-dot';
          titleRow.appendChild(dot);
        }

        // TTS indicator
        if (n.tts) {
          const ttsIcon = document.createElement('span');
          ttsIcon.className = 'notif-tts-icon';
          ttsIcon.title = 'TTS enabled';
          ttsIcon.appendChild(createSvgIcon(ICON_PATHS.volume, 'notif-icon notif-icon-xs'));
          titleRow.appendChild(ttsIcon);
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'notif-time';
        timeEl.textContent = formatRelativeTime(n.createdAt);
        titleRow.appendChild(timeEl);

        content.appendChild(titleRow);

        // Body (always shown in card mode, expanded-only in compact)
        if (!isCompact || isExpanded) {
          const bodyEl = document.createElement('div');
          bodyEl.className = 'notif-body-text';
          bodyEl.textContent = n.body;
          content.appendChild(bodyEl);

          // Session link
          if (n.sessionId) {
            const sessionLink = document.createElement('button');
            sessionLink.className = 'notif-session-link';
            sessionLink.textContent = n.sessionTitle ?? n.sessionId;
            sessionLink.title = 'Open session';
            sessionLink.addEventListener('click', (e) => {
              e.stopPropagation();
              openSession(n.sessionId!);
            });
            sessionLink.appendChild(
              createSvgIcon(ICON_PATHS.externalLink, 'notif-icon notif-icon-xs'),
            );
            content.appendChild(sessionLink);
          }
        }

        item.appendChild(content);

        // Compact expand chevron
        if (isCompact) {
          const expandBtn = document.createElement('button');
          expandBtn.className = 'notif-expand-btn';
          expandBtn.title = isExpanded ? 'Collapse' : 'Expand';
          expandBtn.appendChild(
            createSvgIcon(
              isExpanded ? ICON_PATHS.chevronUp : ICON_PATHS.chevronDown,
              'notif-icon notif-icon-xs',
            ),
          );
          expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
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
        item.addEventListener('click', () => {
          host.sendEvent({ type: 'toggle_read', id: n.id });
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
        // Try to find an existing chat panel bound to this session
        const layout = host.getContext('panel.layout') as
          | { panels?: Array<{ id: string; type: string; binding?: { mode: string; sessionId?: string } }> }
          | null;

        if (layout?.panels) {
          const existing = layout.panels.find(
            (p) =>
              p.type === 'chat' &&
              p.binding?.mode === 'fixed' &&
              p.binding?.sessionId === sessionId,
          );
          if (existing) {
            host.activatePanel(existing.id);
            return;
          }
        }

        host.openPanel('chat', {
          binding: { mode: 'fixed' as const, sessionId },
          focus: true,
        });
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
        notification?: NotificationRecord;
        id?: string;
        notifications?: NotificationRecord[];
      }): void => {
        switch (event.event) {
          case 'created':
            if (event.notification) {
              state.notifications.unshift(event.notification);
            }
            break;
          case 'updated':
            if (event.notification) {
              const idx = state.notifications.findIndex((n) => n.id === event.notification!.id);
              if (idx !== -1) {
                state.notifications[idx] = event.notification;
              }
            }
            break;
          case 'removed':
            if (event.id) {
              state.notifications = state.notifications.filter((n) => n.id !== event.id);
              state.expandedIds.delete(event.id);
            }
            break;
          case 'snapshot':
            if (event.notifications) {
              state.notifications = event.notifications;
              // Clean up expanded IDs for removed notifications
              const ids = new Set(state.notifications.map((n) => n.id));
              for (const id of state.expandedIds) {
                if (!ids.has(id)) {
                  state.expandedIds.delete(id);
                }
              }
            }
            break;
        }
        render();
      };

      // Request initial data
      host.sendEvent({ type: 'request_snapshot' });

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
              notification?: NotificationRecord;
              id?: string;
              notifications?: NotificationRecord[];
            });
          }
        },
        unmount(): void {
          document.removeEventListener('click', closeMenu);
          chromeController.destroy();
          container.innerHTML = '';
        },
      };
    },
  }));
})();
