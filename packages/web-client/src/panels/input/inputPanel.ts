import type {
  PanelHandle,
  PanelModule,
  PanelFactory,
  PanelHost,
} from '../../controllers/panelRegistry';
import { cloneTemplate } from '../../utils/template';
import {
  createInputRuntime,
  type InputRuntime,
  type InputRuntimeElements,
  type InputRuntimeOptions,
} from './runtime';

export interface InputPanelOptions {
  getRuntimeOptions: () => Omit<InputRuntimeOptions, 'elements'>;
  onRuntimeReady?: (options: { runtime: InputRuntime; host: PanelHost }) => void | (() => void);
}

function requireElement<T extends HTMLElement>(
  container: HTMLElement,
  selector: string,
  label: string,
): T {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${label} element`);
  }
  return element;
}

function getInputPanelElements(container: HTMLElement): InputRuntimeElements {
  return {
    contextPreviewEl: container.querySelector<HTMLElement>('[data-role="context-preview"]'),
    pendingMessageListEl: container.querySelector<HTMLElement>(
      '[data-role="pending-message-list"]',
    ),
    form: requireElement<HTMLFormElement>(container, '[data-role="input-form"]', 'input form'),
    inputEl: requireElement<HTMLInputElement>(container, '[data-role="input-text"]', 'input text'),
    submitButtonEl: container.querySelector<HTMLButtonElement>('[data-role="input-submit"]'),
    clearButtonEl: requireElement<HTMLButtonElement>(
      container,
      '[data-role="input-clear"]',
      'clear',
    ),
    contextToggleButtonEl: container.querySelector<HTMLButtonElement>(
      '[data-role="input-context-toggle"]',
    ),
    briefToggleButtonEl: container.querySelector<HTMLButtonElement>(
      '[data-role="input-brief-toggle"]',
    ),
    micButtonEl: requireElement<HTMLButtonElement>(container, '[data-role="input-mic"]', 'mic'),
  };
}

export function createInputPanel(options: InputPanelOptions): PanelFactory {
  return (): PanelModule => ({
    mount(container: HTMLElement, host, _init): PanelHandle {
      container.innerHTML = '';
      const root = cloneTemplate('input-panel-template');
      container.appendChild(root);
      const elements = getInputPanelElements(root);
      const runtime = createInputRuntime({
        elements,
        ...options.getRuntimeOptions(),
      });
      const cleanup = options.onRuntimeReady?.({ runtime, host }) ?? null;

      return {
        unmount() {
          if (cleanup) {
            cleanup();
          }
          container.innerHTML = '';
        },
      };
    },
  });
}
