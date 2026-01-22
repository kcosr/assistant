import type { PanelHost } from './panelRegistry';
import {
  InstanceDropdownController,
  type InstanceOption,
} from './instanceDropdownController';

type PanelChromeElements = {
  row: HTMLElement;
  main: HTMLElement;
  title: HTMLElement | null;
  pluginControls: HTMLElement;
  frameControls: HTMLElement;
  instanceActions: HTMLElement | null;
  instanceDropdownRoot: HTMLElement | null;
};

export type PanelChromeControllerOptions = {
  root: HTMLElement;
  host: PanelHost;
  title?: string;
  onInstanceChange?: (instanceIds: string[]) => void;
  instanceSelectionMode?: 'single' | 'multi';
  buffer?: number;
  hysteresis?: number;
};

const DEFAULT_BUFFER = 40;
const DEFAULT_HYSTERESIS = 16;

type ChromeLayoutState = 'default' | 'stage-1' | 'compact';

const resolveElements = (root: HTMLElement): PanelChromeElements => {
  const row = root.querySelector<HTMLElement>('[data-role="chrome-row"]');
  const main = root.querySelector<HTMLElement>('.panel-chrome-row .panel-header-main');
  const title = root.querySelector<HTMLElement>('[data-role="chrome-title"]');
  const pluginControls = root.querySelector<HTMLElement>('[data-role="chrome-plugin-controls"]');
  const frameControls = root.querySelector<HTMLElement>('[data-role="chrome-controls"]');
  const instanceActions = root.querySelector<HTMLElement>('[data-role="instance-actions"]');
  const instanceDropdownRoot = root.querySelector<HTMLElement>(
    '[data-role="instance-dropdown-container"]',
  );

  if (!row || !main || !pluginControls || !frameControls) {
    throw new Error('Panel chrome row elements missing.');
  }

  return {
    row,
    main,
    title,
    pluginControls,
    frameControls,
    instanceActions,
    instanceDropdownRoot,
  };
};

export class PanelChromeController {
  private readonly host: PanelHost;
  private readonly elements: PanelChromeElements;
  private readonly buffer: number;
  private readonly hysteresis: number;
  private readonly cleanupFns: Array<() => void> = [];
  private readonly instanceDropdown: InstanceDropdownController | null;
  private resizeObserver: ResizeObserver | null = null;
  private layoutScheduled = false;
  private layoutState: ChromeLayoutState = 'default';

  constructor(options: PanelChromeControllerOptions) {
    this.host = options.host;
    this.elements = resolveElements(options.root);
    this.buffer = options.buffer ?? DEFAULT_BUFFER;
    this.hysteresis = options.hysteresis ?? DEFAULT_HYSTERESIS;

    if (options.title && this.elements.title) {
      this.elements.title.textContent = options.title;
    }

    if (this.elements.instanceDropdownRoot && options.onInstanceChange) {
      this.instanceDropdown = new InstanceDropdownController({
        root: this.elements.instanceDropdownRoot,
        onSelect: options.onInstanceChange,
        selectionMode: options.instanceSelectionMode ?? 'single',
      });
    } else {
      this.instanceDropdown = null;
      if (this.elements.instanceActions) {
        this.elements.instanceActions.style.display = 'none';
      }
    }

    this.attachFrameControls();
    this.attachGlobalListeners();
    this.attachResizeObserver();
    this.runInitialLayoutChecks();
  }

  setTitle(title: string): void {
    if (!this.elements.title) {
      return;
    }
    this.elements.title.textContent = title;
    this.scheduleLayoutCheck();
  }

  setInstances(instances: InstanceOption[], selectedIds: string[]): void {
    if (!this.elements.instanceActions || !this.instanceDropdown) {
      return;
    }
    this.instanceDropdown.setInstances(instances, selectedIds);
    this.instanceDropdown.setVisible(instances.length > 1);
    this.scheduleLayoutCheck();
  }

  scheduleLayoutCheck(): void {
    if (this.layoutScheduled) {
      return;
    }
    this.layoutScheduled = true;
    requestAnimationFrame(() => {
      this.layoutScheduled = false;
      this.checkLayout();
    });
  }

  checkLayout(): void {
    const { row, main, pluginControls, frameControls } = this.elements;

    row.classList.remove('chrome-row-stage-1', 'chrome-row-compact');
    void row.offsetWidth;

    const rowWidth = row.clientWidth;
    const parseSize = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    const measureMainWidth = () => {
      const children = Array.from(main.children) as HTMLElement[];
      const visibleChildren = children.filter((child) => child.getClientRects().length > 0);
      if (visibleChildren.length === 0) {
        return main.scrollWidth;
      }
      const mainStyles = getComputedStyle(main);
      const gap = parseSize(mainStyles.columnGap || mainStyles.gap);
      let total = 0;
      let count = 0;

      for (const child of visibleChildren) {
        const rectWidth = child.getBoundingClientRect().width;
        if (rectWidth === 0) {
          continue;
        }
        const childStyles = getComputedStyle(child);
        const marginLeft = parseSize(childStyles.marginLeft);
        const marginRight = parseSize(childStyles.marginRight);
        total += rectWidth + marginLeft + marginRight;
        count += 1;
      }

      if (count > 1) {
        total += gap * (count - 1);
      }
      return total;
    };
    const measurePluginWidth = () => {
      const children = Array.from(pluginControls.children) as HTMLElement[];
      const visibleChildren = children.filter((child) => child.getClientRects().length > 0);
      if (visibleChildren.length === 0) {
        return pluginControls.scrollWidth;
      }
      const pluginStyles = getComputedStyle(pluginControls);
      const gap = parseSize(pluginStyles.columnGap || pluginStyles.gap);
      let total = 0;
      let count = 0;

      for (const child of visibleChildren) {
        const rectWidth = child.getBoundingClientRect().width;
        const scrollWidth = child.scrollWidth;
        let width = Math.max(rectWidth, scrollWidth);
        if (width === 0) {
          continue;
        }
        const childStyles = getComputedStyle(child);
        const flexGrow = parseSize(childStyles.flexGrow);
        if (flexGrow > 0) {
          const minWidthValue = childStyles.minWidth;
          const minWidth = parseSize(minWidthValue);
          if (minWidth > 0) {
            width = minWidth;
          }
        }
        const maxWidthValue = childStyles.maxWidth;
        if (maxWidthValue && maxWidthValue !== 'none') {
          const maxWidth = parseSize(maxWidthValue);
          if (maxWidth > 0) {
            width = Math.min(width, maxWidth);
          }
        }
        const marginLeft = parseSize(childStyles.marginLeft);
        const marginRight = parseSize(childStyles.marginRight);
        total += width + marginLeft + marginRight;
        count += 1;
      }

      if (count > 1) {
        total += gap * (count - 1);
      }
      return total;
    };
    const measure = () =>
      measureMainWidth() + measurePluginWidth() + frameControls.scrollWidth + this.buffer;
    const defaultWidth = measure();

    row.classList.add('chrome-row-stage-1');
    void row.offsetWidth;
    const stage1Width = measure();
    row.classList.remove('chrome-row-stage-1');

    const defaultFits = defaultWidth <= rowWidth;
    const stage1Fits = stage1Width <= rowWidth;
    let nextState = this.layoutState;

    if (this.layoutState === 'default') {
      if (!defaultFits) {
        nextState = stage1Fits ? 'stage-1' : 'compact';
      }
    } else if (this.layoutState === 'stage-1') {
      if (defaultWidth + this.hysteresis <= rowWidth) {
        nextState = 'default';
      } else if (!stage1Fits) {
        nextState = 'compact';
      }
    } else if (this.layoutState === 'compact') {
      if (stage1Width + this.hysteresis <= rowWidth) {
        nextState = 'stage-1';
      }
    }

    row.classList.toggle('chrome-row-stage-1', nextState === 'stage-1');
    row.classList.toggle('chrome-row-compact', nextState === 'compact');
    this.layoutState = nextState;
  }

  destroy(): void {
    this.instanceDropdown?.destroy();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
  }

  private attachFrameControls(): void {
    const { frameControls } = this.elements;

    const handleControlsClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('[data-action]');
      if (!button) {
        return;
      }
      const action = button.dataset['action'];
      if (!action) {
        return;
      }
      if (action === 'toggle') {
        event.preventDefault();
        event.stopPropagation();
        frameControls.classList.toggle('expanded');
        this.scheduleLayoutCheck();
        return;
      }
      if (action === 'close') {
        event.preventDefault();
        event.stopPropagation();
        this.host.closePanel(this.host.panelId());
        return;
      }
      if (action === 'menu') {
        event.preventDefault();
        event.stopPropagation();
        this.host.openPanelMenu?.(this.host.panelId(), button);
      }
    };

    const handleControlsPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('[data-action]');
      if (!button) {
        return;
      }
      const action = button.dataset['action'];
      if (!action) {
        return;
      }
      if (action === 'move') {
        event.preventDefault();
        event.stopPropagation();
        this.host.startPanelDrag?.(this.host.panelId(), event);
        return;
      }
      if (action === 'reorder') {
        event.preventDefault();
        event.stopPropagation();
        this.host.startPanelReorder?.(this.host.panelId(), event);
      }
    };

    frameControls.addEventListener('click', handleControlsClick);
    frameControls.addEventListener('pointerdown', handleControlsPointerDown);
    this.cleanupFns.push(() => {
      frameControls.removeEventListener('click', handleControlsClick);
      frameControls.removeEventListener('pointerdown', handleControlsPointerDown);
    });
  }

  private attachGlobalListeners(): void {
    const handleDocumentClick = (event: MouseEvent) => {
      if (this.instanceDropdown?.isOpen() && !this.instanceDropdown.contains(event.target)) {
        this.instanceDropdown.close();
      }
      if (
        this.elements.frameControls.classList.contains('expanded') &&
        !this.elements.frameControls.contains(event.target as Node)
      ) {
        this.elements.frameControls.classList.remove('expanded');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.scheduleLayoutCheck();
      }
    };

    const handleWindowResize = () => {
      this.scheduleLayoutCheck();
    };

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleWindowResize);
    this.cleanupFns.push(() => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleWindowResize);
    });
  }

  private attachResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleLayoutCheck();
    });
    this.resizeObserver.observe(this.elements.row);
  }

  private runInitialLayoutChecks(): void {
    this.checkLayout();
    requestAnimationFrame(() => this.checkLayout());
    setTimeout(() => this.checkLayout(), 50);
    setTimeout(() => this.checkLayout(), 200);
  }
}
