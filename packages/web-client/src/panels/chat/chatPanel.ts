import type {
  PanelHandle,
  PanelModule,
  PanelFactory,
  PanelHost,
} from '../../controllers/panelRegistry';
import {
  createChatRuntime,
  type ChatRuntime,
  type ChatRuntimeElements,
  type ChatRuntimeOptions,
} from './runtime';
import type { InputRuntimeElements } from '../input/runtime';
import { cloneTemplate } from '../../utils/template';

export interface ChatPanelOptions {
  getRuntimeOptions: (host: PanelHost) => Omit<ChatRuntimeOptions, 'elements'>;
  onRuntimeReady?: (options: {
    runtime: ChatRuntime;
    dom: ChatPanelDom;
    host: PanelHost;
  }) => void | (() => void);
}

export interface ChatPanelDom {
  runtimeElements: ChatRuntimeElements;
  sessionLabelEl: HTMLButtonElement | null;
  modelSelectEl: HTMLSelectElement | null;
  inputElements: InputRuntimeElements;
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

function getChatPanelDom(container: HTMLElement): ChatPanelDom {
  const runtimeElements: ChatRuntimeElements = {
    chatPanel: container,
    chatLog: requireElement<HTMLElement>(container, '[data-role="chat-log"]', 'chat log'),
    scrollToBottomButtonEl: requireElement<HTMLButtonElement>(
      container,
      '[data-role="chat-scroll-to-bottom"]',
      'scroll to bottom button',
    ),
    toggleToolOutputButton: container.querySelector<HTMLButtonElement>(
      '[data-role="chat-toggle-tool-output"]',
    ),
    toggleToolExpandButton: container.querySelector<HTMLButtonElement>(
      '[data-role="chat-toggle-tool-expand"]',
    ),
    toggleThinkingButton: container.querySelector<HTMLButtonElement>(
      '[data-role="chat-toggle-thinking"]',
    ),
  };
  const inputElements: InputRuntimeElements = {
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
  return {
    runtimeElements,
    sessionLabelEl: container.querySelector<HTMLButtonElement>('[data-role="chat-session-label"]'),
    modelSelectEl: container.querySelector<HTMLSelectElement>('[data-role="chat-model-select"]'),
    inputElements,
  };
}

export function createChatPanel(options: ChatPanelOptions): PanelFactory {
  return (): PanelModule => ({
    mount(container: HTMLElement, host, _init): PanelHandle {
      container.innerHTML = '';
      const root = cloneTemplate('chat-panel-template');
      container.appendChild(root);
      const dom = getChatPanelDom(root);
      const runtime = createChatRuntime({
        elements: dom.runtimeElements,
        ...options.getRuntimeOptions(host),
      });
      const cleanup = options.onRuntimeReady?.({ runtime, dom, host }) ?? null;

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
