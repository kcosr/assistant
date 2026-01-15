import type { PanelHandle, PanelModule, PanelFactory } from '../../controllers/panelRegistry';
import { PanelChromeController } from '../../controllers/panelChromeController';
import {
  createSessionsRuntime,
  type SessionsRuntime,
  type SessionsRuntimeOptions,
} from './runtime';

export interface SessionsPanelElements {
  agentSidebar: HTMLElement | null;
  agentSidebarSections: HTMLElement | null;
  viewModeToggle: HTMLButtonElement | null;
}

export interface SessionsPanelOptions {
  getRuntimeOptions: () => Omit<
    SessionsRuntimeOptions,
    'agentSidebar' | 'agentSidebarSections' | 'viewModeToggle'
  >;
  onRuntimeReady?: (runtime: SessionsRuntime) => void;
  onRuntimeRemoved?: (runtime: SessionsRuntime) => void;
  onDeleteAll?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function getSessionsPanelElements(container: HTMLElement): SessionsPanelElements {
  return {
    agentSidebar: container,
    agentSidebarSections: container.querySelector<HTMLElement>('#agent-sidebar-sections'),
    viewModeToggle: container.querySelector<HTMLButtonElement>('#sidebar-view-toggle'),
  };
}

function createIcon(pathD: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon icon-sm');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

function createMenuIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon icon-sm');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const circles = [5, 12, 19];
  for (const cy of circles) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '1.5');
    circle.setAttribute('fill', 'currentColor');
    circle.setAttribute('stroke', 'none');
    svg.appendChild(circle);
  }
  return svg;
}

function createChromeButton(options: {
  action: string;
  label: string;
  title: string;
  icon: SVGSVGElement;
  className?: string;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.className
    ? `panel-chrome-button ${options.className}`
    : 'panel-chrome-button';
  button.dataset['action'] = options.action;
  button.setAttribute('aria-label', options.label);
  button.setAttribute('title', options.title);
  button.appendChild(options.icon);
  return button;
}

function buildSessionsPanelMarkup(container: HTMLElement): SessionsPanelElements {
  container.classList.add('agent-sidebar');
  container.classList.remove('hidden');
  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'panel-header panel-chrome-row agent-sidebar-header';
  header.setAttribute('data-role', 'chrome-row');

  const headerMain = document.createElement('div');
  headerMain.className = 'panel-header-main';

  const headerLabel = document.createElement('span');
  headerLabel.className = 'panel-header-label sidebar-header-label';
  headerLabel.setAttribute('data-role', 'chrome-title');
  headerLabel.textContent = 'Agents';
  headerMain.appendChild(headerLabel);
  header.appendChild(headerMain);

  const headerActions = document.createElement('div');
  headerActions.className = 'panel-chrome-plugin-controls agent-sidebar-controls';
  headerActions.setAttribute('data-role', 'chrome-plugin-controls');

  const viewToggle = document.createElement('button');
  viewToggle.type = 'button';
  viewToggle.id = 'sidebar-view-toggle';
  viewToggle.className = 'sidebar-view-toggle-button';
  viewToggle.setAttribute('aria-label', 'Show all sessions together');
  viewToggle.setAttribute('title', 'Show all');
  viewToggle.appendChild(createIcon('M4 6h16M4 12h16M4 18h16'));
  headerActions.appendChild(viewToggle);

  const dropdownWrapper = document.createElement('div');
  dropdownWrapper.className = 'agent-add-dropdown-wrapper';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.id = 'sidebar-agent-add-button';
  addButton.className = 'panel-close-button';
  addButton.setAttribute('aria-label', 'New session');
  addButton.setAttribute('title', 'New session');
  addButton.setAttribute('aria-haspopup', 'true');
  addButton.setAttribute('aria-expanded', 'false');
  addButton.appendChild(createIcon('M12 5v14M5 12h14'));
  dropdownWrapper.appendChild(addButton);

  const dropdown = document.createElement('div');
  dropdown.id = 'agent-add-dropdown';
  dropdown.className = 'agent-add-dropdown';
  dropdown.setAttribute('role', 'menu');
  dropdown.setAttribute('aria-label', 'Create new session');

  const dropdownHeader = document.createElement('div');
  dropdownHeader.className = 'agent-add-dropdown-header';
  dropdownHeader.textContent = 'New session';
  dropdown.appendChild(dropdownHeader);

  const dropdownList = document.createElement('div');
  dropdownList.id = 'agent-add-dropdown-list';
  dropdownList.className = 'agent-add-dropdown-list';
  dropdown.appendChild(dropdownList);

  dropdownWrapper.appendChild(dropdown);
  headerActions.appendChild(dropdownWrapper);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.id = 'sidebar-delete-all';
  deleteButton.className = 'panel-close-button';
  deleteButton.setAttribute('aria-label', 'Delete all sessions');
  deleteButton.setAttribute('title', 'Delete all sessions');
  deleteButton.appendChild(
    createIcon(
      'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14',
    ),
  );
  headerActions.appendChild(deleteButton);

  header.appendChild(headerActions);

  const frameControls = document.createElement('div');
  frameControls.className = 'panel-chrome-frame-controls';
  frameControls.setAttribute('data-role', 'chrome-controls');

  const toggleButton = createChromeButton({
    action: 'toggle',
    label: 'Panel controls',
    title: 'Panel controls',
    icon: createIcon('M15 18l-6-6 6-6'),
    className: 'panel-chrome-toggle',
  });

  const frameButtons = document.createElement('div');
  frameButtons.className = 'panel-chrome-frame-buttons';
  frameButtons.appendChild(
    createChromeButton({
      action: 'move',
      label: 'Move panel',
      title: 'Move',
      icon: createIcon(
        'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
      ),
    }),
  );
  frameButtons.appendChild(
    createChromeButton({
      action: 'reorder',
      label: 'Reorder panel',
      title: 'Reorder',
      icon: createIcon('M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4'),
    }),
  );
  frameButtons.appendChild(
    createChromeButton({
      action: 'menu',
      label: 'More actions',
      title: 'More actions',
      icon: createMenuIcon(),
    }),
  );

  const closeButton = createChromeButton({
    action: 'close',
    label: 'Close panel',
    title: 'Close',
    icon: createIcon('M18 6L6 18M6 6l12 12'),
    className: 'panel-chrome-close',
  });

  frameControls.appendChild(toggleButton);
  frameControls.appendChild(frameButtons);
  frameControls.appendChild(closeButton);
  header.appendChild(frameControls);
  container.appendChild(header);

  const body = document.createElement('div');
  body.className = 'panel-body';
  const sections = document.createElement('div');
  sections.id = 'agent-sidebar-sections';
  sections.className = 'agent-sidebar-sections';
  body.appendChild(sections);
  container.appendChild(body);

  return getSessionsPanelElements(container);
}

function ensureSessionsPanelElements(container: HTMLElement): SessionsPanelElements {
  const elements = getSessionsPanelElements(container);
  if (elements.agentSidebarSections && elements.viewModeToggle) {
    return elements;
  }
  return buildSessionsPanelMarkup(container);
}

export function createSessionsPanel(options: SessionsPanelOptions): PanelFactory {
  return (): PanelModule => {
    let runtime: SessionsRuntime | null = null;
    let cleanup: (() => void) | null = null;
    let chromeController: PanelChromeController | null = null;

    return {
      mount(container: HTMLElement, host, _init): PanelHandle {
        const resolvedElements = ensureSessionsPanelElements(container);
        chromeController = new PanelChromeController({
          root: container,
          host,
          title: 'Agents',
        });
        const baseOptions = options.getRuntimeOptions();
        runtime = createSessionsRuntime({
          agentSidebar: resolvedElements.agentSidebar,
          agentSidebarSections: resolvedElements.agentSidebarSections,
          viewModeToggle: resolvedElements.viewModeToggle,
          ...baseOptions,
        });
        options.onRuntimeReady?.(runtime);
        runtime.render();

        cleanup?.();
        const abortController = new AbortController();
        const deleteAllButton = container.querySelector<HTMLButtonElement>('#sidebar-delete-all');
        if (deleteAllButton && options.onDeleteAll) {
          deleteAllButton.addEventListener(
            'click',
            () => {
              deleteAllButton.blur();
              options.onDeleteAll?.();
            },
            { signal: abortController.signal },
          );
        }
        cleanup = () => abortController.abort();

        return {
          onVisibilityChange: (visible) => {
            if (visible) {
              runtime?.render();
              chromeController?.scheduleLayoutCheck();
            }
          },
          onSessionChange: () => {
            runtime?.render();
          },
          unmount() {
            cleanup?.();
            cleanup = null;
            chromeController?.destroy();
            chromeController = null;
            if (runtime) {
              options.onRuntimeRemoved?.(runtime);
            }
            runtime = null;
          },
        };
      },
    };
  };
}
