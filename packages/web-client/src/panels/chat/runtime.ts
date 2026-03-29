import { ChatScrollManager } from '../../controllers/chatScroll';
import { ChatRenderer } from '../../controllers/chatRenderer';
import {
  setToolOutputBlockExpanded,
  setToolOutputBlockNearViewport,
} from '../../utils/toolOutputRenderer';
import type { ToolOutputPreferencesClient } from '../../utils/toolOutputPreferences';
import type { ThinkingPreferencesClient } from '../../utils/thinkingPreferences';
import type { InteractionResponseDraft } from '../../utils/interactionRenderer';

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
  getInteractionEnabled?: () => boolean;
  isMobileViewport?: () => boolean;
  sendInteractionResponse?: (options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    response: InteractionResponseDraft;
  }) => void;
}

export interface ChatRuntime {
  elements: ChatRuntimeElements;
  chatRenderer: ChatRenderer;
  chatScrollManager: ChatScrollManager;
  dispose: () => void;
}

const TOOL_OUTPUT_VIEWPORT_OVERSCAN_PX = 400;

function isToolOutputBlockNearViewport(block: HTMLDivElement, root: HTMLElement): boolean {
  const rootRect = root.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  return (
    rect.bottom >= rootRect.top - TOOL_OUTPUT_VIEWPORT_OVERSCAN_PX &&
    rect.top <= rootRect.bottom + TOOL_OUTPUT_VIEWPORT_OVERSCAN_PX
  );
}

interface ToolOutputViewportManager {
  refresh: () => void;
  dispose: () => void;
  hasIntersectionObserver: () => boolean;
}

function visitToolBlocksInSubtree(
  node: Node,
  visit: (block: HTMLDivElement) => void,
): void {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  if (node.matches('.tool-output-block')) {
    visit(node as HTMLDivElement);
  }
  for (const block of node.querySelectorAll<HTMLDivElement>('.tool-output-block')) {
    visit(block);
  }
}

function createToolOutputViewportManager(chatLog: HTMLElement): ToolOutputViewportManager {
  const observedToolBlocks = new Set<HTMLDivElement>();

  const syncToolOutputViewport = (block: HTMLDivElement): void => {
    setToolOutputBlockNearViewport(block, isToolOutputBlockNearViewport(block, chatLog));
  };

  const toolOutputIntersectionObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!(entry.target instanceof HTMLDivElement)) {
                continue;
              }
              setToolOutputBlockNearViewport(entry.target, entry.isIntersecting || entry.intersectionRatio > 0);
            }
          },
          {
            root: chatLog,
            rootMargin: `${TOOL_OUTPUT_VIEWPORT_OVERSCAN_PX}px 0px ${TOOL_OUTPUT_VIEWPORT_OVERSCAN_PX}px 0px`,
          },
        );

  const observeToolBlock = (block: HTMLDivElement): void => {
    if (observedToolBlocks.has(block)) {
      return;
    }
    observedToolBlocks.add(block);
    if (toolOutputIntersectionObserver) {
      toolOutputIntersectionObserver.observe(block);
      return;
    }
    syncToolOutputViewport(block);
  };

  const unobserveToolBlock = (block: HTMLDivElement): void => {
    if (!observedToolBlocks.delete(block)) {
      return;
    }
    toolOutputIntersectionObserver?.unobserve(block);
  };

  const toolOutputMutationObserver =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          for (const record of records) {
            record.addedNodes.forEach((node) => {
              visitToolBlocksInSubtree(node, observeToolBlock);
            });
            record.removedNodes.forEach((node) => {
              visitToolBlocksInSubtree(node, unobserveToolBlock);
            });
          }
        });

  toolOutputMutationObserver?.observe(chatLog, {
    childList: true,
    subtree: true,
  });
  for (const block of chatLog.querySelectorAll<HTMLDivElement>('.tool-output-block')) {
    observeToolBlock(block);
  }

  return {
    refresh: () => {
      for (const block of observedToolBlocks) {
        syncToolOutputViewport(block);
      }
    },
    dispose: () => {
      toolOutputMutationObserver?.disconnect();
      toolOutputIntersectionObserver?.disconnect();
      observedToolBlocks.clear();
    },
    hasIntersectionObserver: () => toolOutputIntersectionObserver !== null,
  };
}

export function createChatRuntime(options: ChatRuntimeOptions): ChatRuntime {
  const { elements, toolOutputPreferencesClient, thinkingPreferencesClient, autoScrollEnabled } =
    options;
  const toolOutputViewportManager = createToolOutputViewportManager(elements.chatLog);

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
        setToolOutputBlockExpanded(block, expand);
      }
      if (!toolOutputViewportManager.hasIntersectionObserver()) {
        toolOutputViewportManager.refresh();
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
    ...(options.getInteractionEnabled ? { getInteractionEnabled: options.getInteractionEnabled } : {}),
    getShouldAutoFocusQuestionnaire: () => !(options.isMobileViewport?.() ?? false),
    getShouldRestoreFocusAfterInteraction: () => !(options.isMobileViewport?.() ?? false),
    ...(options.sendInteractionResponse
      ? { sendInteractionResponse: options.sendInteractionResponse }
      : {}),
  });

  elements.chatLog.addEventListener('scroll', () => {
    chatScrollManager.handleScroll();
    if (!toolOutputViewportManager.hasIntersectionObserver()) {
      toolOutputViewportManager.refresh();
    }
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
    dispose: () => {
      toolOutputViewportManager.dispose();
    },
  };
}
