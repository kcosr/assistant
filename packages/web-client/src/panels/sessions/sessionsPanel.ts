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
  onDeleteAll?: () => void;
}

function getSessionsPanelElements(container: HTMLElement): SessionsPanelElements {
  return {
    agentSidebar: container,
    agentSidebarSections: container.querySelector<HTMLElement>('#agent-sidebar-sections'),
    viewModeToggle: container.querySelector<HTMLButtonElement>('#sidebar-view-toggle'),
  };
}

export function createSessionsPanel(options: SessionsPanelOptions): PanelFactory {
  let runtime: SessionsRuntime | null = null;
  let elements: SessionsPanelElements | null = null;
  let cleanup: (() => void) | null = null;

  return (): PanelModule => ({
    mount(container: HTMLElement, _host, _init): PanelHandle {
      const resolvedElements = elements ?? getSessionsPanelElements(container);
      elements = resolvedElements;
      if (!runtime) {
        const baseOptions = options.getRuntimeOptions();
        runtime = createSessionsRuntime({
          agentSidebar: resolvedElements.agentSidebar,
          agentSidebarSections: resolvedElements.agentSidebarSections,
          viewModeToggle: resolvedElements.viewModeToggle,
          ...baseOptions,
        });
      }
      if (!runtime) {
        throw new Error('Sessions runtime not initialized');
      }
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
        },
      };
    },
  });
}
