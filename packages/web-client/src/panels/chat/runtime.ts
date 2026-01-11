import { ChatScrollManager } from '../../controllers/chatScroll';
import { ChatRenderer } from '../../controllers/chatRenderer';
import { getToolOutputToggleSymbol } from '../../utils/toolOutputRenderer';
import type { ToolOutputPreferencesClient } from '../../utils/toolOutputPreferences';
import type { ThinkingPreferencesClient } from '../../utils/thinkingPreferences';

export interface ChatRuntimeElements {
  chatPanel: HTMLElement | null;
  chatLog: HTMLElement;
  scrollToBottomButtonEl: HTMLButtonElement;
  toggleToolOutputButton: HTMLButtonElement | null;
  toggleToolExpandButton: HTMLButtonElement | null;
  toggleThinkingButton: HTMLButtonElement | null;
}

export interface ChatRuntimeOptions {
  elements: ChatRuntimeElements;
  toolOutputPreferencesClient: ToolOutputPreferencesClient;
  thinkingPreferencesClient: ThinkingPreferencesClient;
  autoScrollEnabled: boolean;
  getAgentDisplayName: (agentId: string) => string;
}

export interface ChatRuntime {
  elements: ChatRuntimeElements;
  chatRenderer: ChatRenderer;
  chatScrollManager: ChatScrollManager;
}

export function createChatRuntime(options: ChatRuntimeOptions): ChatRuntime {
  const { elements, toolOutputPreferencesClient, thinkingPreferencesClient, autoScrollEnabled } =
    options;

  const applyToolOutputVisibility = (show: boolean): void => {
    if (elements.chatPanel) {
      elements.chatPanel.classList.toggle('hide-tool-output', !show);
    }
    if (elements.toggleToolOutputButton) {
      elements.toggleToolOutputButton.classList.toggle('active', show);
      elements.toggleToolOutputButton.title = show ? 'Hide tool output' : 'Show tool output';
    }
  };

  applyToolOutputVisibility(toolOutputPreferencesClient.getShowToolOutput());

  if (elements.toggleToolOutputButton) {
    elements.toggleToolOutputButton.addEventListener('click', () => {
      elements.toggleToolOutputButton?.blur();
      void toolOutputPreferencesClient.toggleShowToolOutput().then((newValue) => {
        applyToolOutputVisibility(newValue);
      });
    });
  }

  const applyToolExpandState = (expand: boolean, updateExisting = false): void => {
    if (elements.toggleToolExpandButton) {
      elements.toggleToolExpandButton.classList.toggle('active', expand);
      elements.toggleToolExpandButton.title = expand
        ? 'Collapse tool output by default'
        : 'Expand tool output by default';
      const svg = elements.toggleToolExpandButton.querySelector('svg');
      if (svg) {
        svg.style.transform = expand ? 'rotate(180deg)' : '';
      }
    }

    if (updateExisting) {
      const toolBlocks = elements.chatLog.querySelectorAll<HTMLDivElement>('.tool-output-block');
      for (const block of toolBlocks) {
        block.classList.toggle('expanded', expand);
        const headerButton = block.querySelector<HTMLButtonElement>('.tool-output-header');
        if (headerButton) {
          headerButton.setAttribute('aria-expanded', expand ? 'true' : 'false');
        }
        const toggleIcon = block.querySelector<HTMLElement>('.tool-output-toggle');
        if (toggleIcon) {
          toggleIcon.textContent = getToolOutputToggleSymbol(expand);
        }
      }
    }
  };

  applyToolExpandState(toolOutputPreferencesClient.getExpandToolOutput());

  if (elements.toggleToolExpandButton) {
    elements.toggleToolExpandButton.addEventListener('click', () => {
      elements.toggleToolExpandButton?.blur();
      void toolOutputPreferencesClient.toggleExpandToolOutput().then((newValue) => {
        applyToolExpandState(newValue, true);
      });
    });
  }

  const applyThinkingVisibility = (show: boolean): void => {
    if (elements.chatPanel) {
      elements.chatPanel.classList.toggle('hide-thinking', !show);
    }
    if (elements.toggleThinkingButton) {
      elements.toggleThinkingButton.classList.toggle('active', show);
      elements.toggleThinkingButton.title = show ? 'Hide thinking' : 'Show thinking';
    }
  };

  applyThinkingVisibility(thinkingPreferencesClient.getShowThinking());

  if (elements.toggleThinkingButton) {
    elements.toggleThinkingButton.addEventListener('click', () => {
      elements.toggleThinkingButton?.blur();
      void thinkingPreferencesClient.toggleShowThinking().then((newValue) => {
        applyThinkingVisibility(newValue);
      });
    });
  }

  const chatScrollManager = new ChatScrollManager(
    elements.chatLog,
    elements.scrollToBottomButtonEl,
  );
  chatScrollManager.setAutoScrollEnabled(autoScrollEnabled);

  const chatRenderer = new ChatRenderer(elements.chatLog, {
    getAgentDisplayName: options.getAgentDisplayName,
    getExpandToolOutput: () => toolOutputPreferencesClient.getExpandToolOutput(),
  });

  elements.chatLog.addEventListener('scroll', () => {
    chatScrollManager.handleScroll();
  });

  elements.chatLog.addEventListener(
    'wheel',
    () => {
      chatScrollManager.handleUserScrollStart();
    },
    { passive: true },
  );

  elements.chatLog.addEventListener(
    'touchstart',
    () => {
      chatScrollManager.handleUserScrollStart();
    },
    { passive: true },
  );

  elements.scrollToBottomButtonEl.addEventListener('click', () => {
    chatScrollManager.scrollToBottom();
  });

  return {
    elements,
    chatRenderer,
    chatScrollManager,
  };
}
