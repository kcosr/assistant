import type { PanelHandle, PanelModule, PanelFactory } from '../../controllers/panelRegistry';
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

function buildSessionsPanelMarkup(container: HTMLElement): SessionsPanelElements {
  container.classList.add('agent-sidebar');
  container.classList.remove('hidden');
  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'panel-header';

  const headerLabel = document.createElement('span');
  headerLabel.className = 'sidebar-header-label';
  headerLabel.textContent = 'Agents';
  header.appendChild(headerLabel);

  const headerActions = document.createElement('div');
  headerActions.className = 'panel-header-actions';

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

    return {
      mount(container: HTMLElement, _host, _init): PanelHandle {
        const resolvedElements = ensureSessionsPanelElements(container);
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
            }
          },
          onSessionChange: () => {
            runtime?.render();
          },
          unmount() {
            cleanup?.();
            cleanup = null;
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
