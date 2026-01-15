import type {
  LayoutNode,
  LayoutPersistence,
  PanelBinding,
  PanelTypeManifest,
} from '@assistant/shared';
import type { PanelHost } from './panelRegistry';
import { containsPanelId } from '../utils/layoutTree';
import { formatSessionLabel } from '../utils/sessionLabel';
import { PanelChromeController } from './panelChromeController';

type PanelActiveContext = {
  panelId: string;
  panelType: string;
} | null;

type SessionSummary = {
  sessionId: string;
  name?: string;
  agentId?: string;
  attributes?: Record<string, unknown>;
};

type WorkspaceRowAction = {
  label: string;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  isDanger?: boolean;
};

type TabRenderState = {
  isInactive: boolean;
  isActiveChild: boolean;
};

const SESSION_BOUND_PANEL_TYPES = new Set(['chat', 'session-info', 'terminal']);

function isSessionBoundPanelType(panelType: string): boolean {
  return SESSION_BOUND_PANEL_TYPES.has(panelType);
}

export type WorkspaceNavigatorHost = PanelHost;

export class WorkspaceNavigatorController {
  private layout: LayoutPersistence | null = null;
  private activePanelId: string | null = null;
  private manifests: PanelTypeManifest[] = [];
  private sessionSummaries: SessionSummary[] = [];
  private root: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private cleanup: (() => void) | null = null;
  private chromeController: PanelChromeController | null = null;
  private renderQueued = false;

  constructor(
    private readonly options: {
      container: HTMLElement;
      host: WorkspaceNavigatorHost;
      onPanelActivated?: (panelId: string) => void;
    },
  ) {}

  attach(): void {
    const header = document.createElement('div');
    header.className = 'panel-header panel-chrome-row workspace-navigator-header';
    header.setAttribute('data-role', 'chrome-row');
    header.innerHTML = `
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Navigator</span>
      </div>
      <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
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

    const body = document.createElement('div');
    body.className = 'panel-body workspace-navigator';

    const list = document.createElement('div');
    list.className = 'workspace-navigator-list';
    body.appendChild(list);

    this.options.container.replaceChildren(header, body);
    this.root = body;
    this.list = list;
    this.chromeController?.destroy();
    this.chromeController = new PanelChromeController({
      root: this.options.container,
      host: this.options.host,
      title: 'Navigator',
    });

    this.layout = this.parseLayout(this.options.host.getContext('panel.layout'));
    this.activePanelId = this.parseActivePanel(this.options.host.getContext('panel.active'));
    this.manifests = this.parseManifests(this.options.host.getContext('panel.manifests'));
    this.sessionSummaries = this.parseSessionSummaries(
      this.options.host.getContext('session.summaries'),
    );

    const unsubLayout = this.options.host.subscribeContext('panel.layout', (value) => {
      this.layout = this.parseLayout(value);
      this.scheduleRender();
    });
    const unsubActive = this.options.host.subscribeContext('panel.active', (value) => {
      this.activePanelId = this.parseActivePanel(value);
      this.scheduleRender();
    });
    const unsubManifests = this.options.host.subscribeContext('panel.manifests', (value) => {
      this.manifests = this.parseManifests(value);
      this.scheduleRender();
    });
    const unsubSessions = this.options.host.subscribeContext('session.summaries', (value) => {
      this.sessionSummaries = this.parseSessionSummaries(value);
      this.scheduleRender();
    });

    this.cleanup = () => {
      unsubLayout();
      unsubActive();
      unsubManifests();
      unsubSessions();
    };

    this.render();
  }

  refresh(): void {
    this.scheduleRender();
  }

  detach(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.chromeController?.destroy();
    this.chromeController = null;
    this.root = null;
    this.list = null;
  }

  private parseLayout(value: unknown): LayoutPersistence | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as LayoutPersistence;
    if (!record.layout || !record.panels) {
      return null;
    }
    return record;
  }

  private parseActivePanel(value: unknown): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const context = value as PanelActiveContext;
    if (!context?.panelId) {
      return null;
    }
    return context.panelId;
  }

  private parseManifests(value: unknown): PanelTypeManifest[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((manifest): manifest is PanelTypeManifest => {
      return Boolean(manifest && typeof manifest.type === 'string');
    });
  }

  private parseSessionSummaries(value: unknown): SessionSummary[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((summary): summary is SessionSummary => {
      return summary && typeof summary.sessionId === 'string';
    });
  }

  private scheduleRender(): void {
    if (this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    if (!this.list) {
      return;
    }

    this.list.innerHTML = '';

    if (!this.layout) {
      const empty = document.createElement('div');
      empty.className = 'workspace-navigator-empty';
      empty.textContent = 'Workspace layout not available yet.';
      this.list.appendChild(empty);
      this.chromeController?.scheduleLayoutCheck();
      return;
    }

    const manifestMap = new Map(this.manifests.map((manifest) => [manifest.type, manifest]));
    const panelTypeCounts = new Map<string, number>();
    for (const panel of Object.values(this.layout.panels)) {
      const count = panelTypeCounts.get(panel.panelType) ?? 0;
      panelTypeCounts.set(panel.panelType, count + 1);
    }
    const sessionLabels = new Map<string, string>();
    for (const summary of this.sessionSummaries) {
      sessionLabels.set(summary.sessionId, this.formatSessionLabel(summary));
    }

    const renderOptions = {
      manifestMap,
      panelTypeCounts,
      sessionLabels,
      activePanelId: this.activePanelId,
    };
    const rootNode = this.layout.layout;
    if (rootNode.kind === 'split') {
      this.renderNode(
        rootNode,
        0,
        renderOptions,
        { isInactive: false, isActiveChild: false },
        true,
      );
    } else {
      this.appendRow({
        kind: 'split',
        label: 'Root',
        depth: 0,
        isStatic: true,
      });
      this.renderNode(rootNode, 1, renderOptions, { isInactive: false, isActiveChild: false });
    }
    this.chromeController?.scheduleLayoutCheck();
  }

  private renderNode(
    node: LayoutNode,
    depth: number,
    options: {
      manifestMap: Map<string, PanelTypeManifest>;
      panelTypeCounts: Map<string, number>;
      sessionLabels: Map<string, string>;
      activePanelId: string | null;
    },
    tabState: TabRenderState,
    isRoot = false,
  ): void {
    if (node.kind === 'panel') {
      this.renderPanelRow(node.panelId, depth, options, tabState);
      return;
    }

    const splitLabel = this.buildSplitLabel(node, isRoot);
    this.appendRow({
      kind: 'split',
      label: splitLabel,
      depth,
      isStatic: true,
      actions: this.buildSplitActions(node),
      isTabActive: tabState.isActiveChild,
      isTabInactive: tabState.isInactive,
    });

    const isTabs = node.viewMode === 'tabs';
    const activeChild = isTabs ? this.resolveActiveTabNode(node.children, node.activeId) : null;

    node.children.forEach((child) => {
      const isActiveChild = isTabs ? child === activeChild : false;
      const isInactive = tabState.isInactive || (isTabs && child !== activeChild);
      this.renderNode(child, depth + 1, options, { isInactive, isActiveChild });
    });
  }

  private renderPanelRow(
    panelId: string,
    depth: number,
    options: {
      manifestMap: Map<string, PanelTypeManifest>;
      panelTypeCounts: Map<string, number>;
      sessionLabels: Map<string, string>;
      activePanelId: string | null;
    },
    tabState: TabRenderState,
  ): void {
    const panel = this.layout?.panels[panelId];
    if (!panel) {
      return;
    }
    const manifest = options.manifestMap.get(panel.panelType) ?? null;
    const label = this.buildPanelLabel(panelId, options.manifestMap, options.panelTypeCounts);
    const bindingLabel = isSessionBoundPanelType(panel.panelType)
      ? this.formatBinding(
          panel.binding ?? resolveDefaultBinding(manifest),
          options.sessionLabels,
          manifest,
        )
      : '';
    const rowOptions: Parameters<typeof this.appendRow>[0] = {
      kind: 'panel',
      label,
      depth,
      isActive: options.activePanelId === panelId,
      isTabActive: tabState.isActiveChild,
      isTabInactive: tabState.isInactive,
      actions: this.buildPanelActions(panelId),
      onClick: () => {
        this.activatePanel(panelId);
      },
    };
    if (bindingLabel) {
      rowOptions.detail = bindingLabel;
    }
    this.appendRow(rowOptions);
  }

  private buildSplitLabel(node: LayoutNode & { kind: 'split' }, isRoot: boolean): string {
    const direction = node.direction === 'horizontal' ? 'Horizontal' : 'Vertical';
    const prefix = isRoot ? 'Root ' : '';
    return `${prefix}Split (${direction})`;
  }

  private buildSplitActions(node: LayoutNode & { kind: 'split' }): WorkspaceRowAction[] {
    const actions: WorkspaceRowAction[] = [];
    if (this.options.host.toggleSplitViewMode) {
      const isTabs = node.viewMode === 'tabs';
      actions.push({
        label: isTabs ? 'Split' : 'Tabs',
        title: isTabs ? 'View as split' : 'View as tabs',
        ariaLabel: isTabs ? 'View split as split panes' : 'View split as tabs',
        onClick: () => {
          this.options.host.toggleSplitViewMode?.(node.splitId);
        },
      });
    }
    if (this.options.host.openPanelLauncher) {
      const targetPanelId = this.findLastPanelId(node);
      actions.push({
        label: '+',
        title: 'Add panel',
        ariaLabel: 'Add panel to split',
        onClick: () => {
          this.options.host.openPanelLauncher?.(
            targetPanelId ? { targetPanelId, defaultPlacement: { region: 'center' } } : undefined,
          );
        },
      });
    }
    if (this.options.host.closeSplit) {
      actions.push({
        label: 'x',
        title: 'Close split',
        ariaLabel: 'Close split',
        isDanger: true,
        onClick: () => {
          this.options.host.closeSplit?.(node.splitId);
        },
      });
    }
    return actions;
  }

  private buildPanelActions(panelId: string): WorkspaceRowAction[] {
    const actions: WorkspaceRowAction[] = [];
    if (this.options.host.openPanelLauncher) {
      actions.push({
        label: '+',
        title: 'Add panel',
        ariaLabel: 'Add panel to panel',
        onClick: () => {
          this.options.host.openPanelLauncher?.({
            targetPanelId: panelId,
            defaultPlacement: { region: 'center' },
          });
        },
      });
    }
    if (this.options.host.closePanel) {
      actions.push({
        label: 'x',
        title: 'Remove panel',
        ariaLabel: 'Remove panel',
        isDanger: true,
        onClick: () => {
          this.options.host.closePanel?.(panelId);
        },
      });
    }
    return actions;
  }

  private resolveActiveTabNode(tabs: LayoutNode[], activeId?: string | null): LayoutNode {
    const selected = activeId ? tabs.find((tab) => containsPanelId(tab, activeId)) : null;
    return selected ?? tabs[0]!;
  }

  private findLastPanelId(node: LayoutNode): string | null {
    if (node.kind === 'panel') {
      return node.panelId;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (!child) {
        continue;
      }
      const found = this.findLastPanelId(child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private buildPanelLabel(
    panelId: string,
    manifests: Map<string, PanelTypeManifest>,
    panelTypeCounts: Map<string, number>,
  ): string {
    const panel = this.layout?.panels[panelId];
    if (!panel) {
      return panelId;
    }
    const overrideTitle = panel.meta?.title;
    const manifest = manifests.get(panel.panelType);
    const baseTitle = overrideTitle || manifest?.title || panel.panelType;
    const count = panelTypeCounts.get(panel.panelType) ?? 0;
    if (count <= 1) {
      return baseTitle;
    }
    return `${baseTitle} · ${shortPanelId(panelId)}`;
  }

  private formatBinding(
    binding: PanelBinding | null,
    sessionLabels: Map<string, string>,
    manifest: PanelTypeManifest | null,
  ): string {
    if (!manifest || !isSessionBoundPanelType(manifest.type)) {
      return '';
    }
    const scope =
      manifest?.sessionScope ??
      (manifest?.defaultSessionBinding === 'global' ? 'global' : 'optional');
    if (scope === 'global') {
      return 'Global';
    }
    if (!binding || binding.mode === 'global') {
      return 'Unbound';
    }
    const label = sessionLabels.get(binding.sessionId);
    return label ? `fixed: ${label}` : 'fixed';
  }

  private formatSessionLabel(summary: SessionSummary): string {
    return formatSessionLabel(summary);
  }

  private appendRow(options: {
    kind: 'panel' | 'split';
    label: string;
    depth: number;
    detail?: string;
    isActive?: boolean;
    isStatic?: boolean;
    isTabActive?: boolean;
    isTabInactive?: boolean;
    actions?: WorkspaceRowAction[];
    onClick?: () => void;
  }): void {
    if (!this.list) {
      return;
    }
    const row = document.createElement('div');
    row.className = 'workspace-navigator-row';
    row.dataset['kind'] = options.kind;
    if (options.isActive) {
      row.classList.add('is-active');
    }
    if (options.isStatic) {
      row.classList.add('is-static');
    }
    if (options.isTabActive) {
      row.classList.add('is-tab-active');
    }
    if (options.isTabInactive) {
      row.classList.add('is-tab-inactive');
    }
    if (options.onClick) {
      row.classList.add('is-clickable');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
    }
    row.style.paddingLeft = `${options.depth * 14 + 8}px`;

    if (options.onClick) {
      row.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
          return;
        }
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target && target.closest('.workspace-navigator-actions')) {
          return;
        }
        options.onClick?.();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          options.onClick?.();
        }
      });
    }

    const info = document.createElement('div');
    info.className = 'workspace-navigator-info';
    row.appendChild(info);

    const label = document.createElement('span');
    label.className = 'workspace-navigator-label';
    label.textContent = options.label;
    info.appendChild(label);

    if (options.detail) {
      const detail = document.createElement('span');
      detail.className = 'workspace-navigator-detail';
      detail.textContent = options.detail;
      info.appendChild(detail);
    }

    if (options.actions && options.actions.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'workspace-navigator-actions';
      for (const action of options.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-navigator-action';
        if (action.isDanger) {
          button.classList.add('is-danger');
        }
        button.textContent = action.label;
        if (action.title) {
          button.title = action.title;
        }
        if (action.ariaLabel) {
          button.setAttribute('aria-label', action.ariaLabel);
        }
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          action.onClick();
        });
        actions.appendChild(button);
      }
      row.appendChild(actions);
    }

    this.list.appendChild(row);
  }

  private activatePanel(panelId: string): void {
    this.options.host.activatePanel(panelId);
    this.options.onPanelActivated?.(panelId);
  }
}

function resolveDefaultBinding(manifest: PanelTypeManifest | null): PanelBinding | null {
  if (!manifest || !isSessionBoundPanelType(manifest.type)) {
    return null;
  }
  const mode = manifest?.defaultSessionBinding ?? 'fixed';
  const scope =
    manifest?.sessionScope ??
    (manifest?.defaultSessionBinding === 'global' ? 'global' : 'optional');
  if (scope === 'global' || mode === 'global') {
    return { mode: 'global' };
  }
  return null;
}

function shortPanelId(panelId: string): string {
  if (panelId.length <= 6) {
    return panelId;
  }
  return panelId.slice(-6);
}
