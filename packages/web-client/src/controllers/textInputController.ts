import type { ClientTextInputMessage } from '@assistant/shared';

export interface TextInputControllerOptions {
  form: HTMLFormElement;
  inputEl: HTMLInputElement;
  clearInputButtonEl: HTMLButtonElement;
  getChatLogEl: () => HTMLElement | null;
  appendMessage: (
    container: HTMLElement,
    role: 'user' | 'assistant' | 'error',
    text: string,
    useMarkdown?: boolean,
  ) => HTMLDivElement;
  appendExternalSentIndicator: (container: HTMLElement) => HTMLDivElement;
  setAssistantBubbleTyping: (bubble: HTMLDivElement) => void;
  scrollMessageIntoView: (container: HTMLElement, element: HTMLElement) => void;
  showSessionTypingIndicator: (sessionId: string) => void;
  buildContextLine: (
    contextItem: { type: string; id: string } | null,
    contextItemName: string | null,
    selectedItemIds: string[],
    contextItemDescription: string | null,
    options?: {
      mode?: 'brief' | null;
      panel?: { panelId: string; panelType: string; panelTitle?: string | null } | null;
      contextAttributes?: Record<string, string> | null;
    },
    selectedItemTitles?: string[],
  ) => string;
  getIncludePanelContext: () => boolean;
  getActiveContextItem: () => { type: string; id: string } | null;
  getActiveContextItemName: () => string | null;
  getActiveContextItemDescription: () => string | null;
  getSelectedItemIds: () => string[];
  getSelectedItemTitles?: () => string[];
  getActivePanelContext: () => {
    panelId: string;
    panelType: string;
    panelTitle?: string | null;
  } | null;
  getActivePanelContextAttributes?: () => Record<string, string> | null;
  getSessionId: () => string | null;
  ensureChatPanelForSession?: (sessionId: string) => void;
  getSocket: () => WebSocket | null;
  onBeforeSend: () => void;
  onAfterSend?: () => void;
  onClearContextSelection?: () => void;
  hasContextSelection?: () => boolean;
  getIsSessionExternal: (sessionId: string | null) => boolean;
  getIsSpeechActive: () => boolean;
  stopPushToTalk: () => void;
  startPushToTalk: () => Promise<void>;
  getBriefModeEnabled: () => boolean;
}

export class TextInputController {
  constructor(private readonly options: TextInputControllerOptions) {}

  attach(): void {
    const { form, inputEl, clearInputButtonEl } = this.options;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.options.onBeforeSend();
      this.sendUserText(inputEl.value);
    });

    inputEl.addEventListener('input', () => {
      this.updateClearInputButtonVisibility();
    });

    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.handleEscape();
      }
    });

    clearInputButtonEl.addEventListener('click', () => {
      this.handleClearInput();
    });

    this.updateClearInputButtonVisibility();
  }

  private handleEscape(): void {
    const { inputEl } = this.options;

    // If there's text in the input, clear it
    if (inputEl.value.length > 0) {
      inputEl.value = '';
      this.updateClearInputButtonVisibility();
      return;
    }

    // If there's a context selection, clear it
    if (this.options.hasContextSelection?.()) {
      this.options.onClearContextSelection?.();
    }
  }

  updateClearInputButtonVisibility(): void {
    const hasContent = this.options.inputEl.value.length > 0;
    this.options.clearInputButtonEl.style.visibility = hasContent ? 'visible' : 'hidden';
  }

  sendUserText(rawText: string): void {
    const text = rawText.trim();
    const sessionId = this.options.getSessionId();
    const socket = this.options.getSocket();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN || !sessionId) {
      console.log('[client] sendUserText: cannot send', {
        hasText: !!text,
        hasSocket: !!socket,
        hasSession: !!sessionId,
        readyState: socket?.readyState,
        OPEN: WebSocket.OPEN,
      });
      return;
    }

    // User bubble is rendered by ChatRenderer when user_message event arrives
    // Show sidebar typing indicator while waiting for response
    // (Chat typing indicator is shown when first assistant event arrives,
    // after user_message is rendered, to maintain correct ordering)
    const isExternalSession = this.options.getIsSessionExternal(sessionId);
    if (!isExternalSession) {
      this.options.showSessionTypingIndicator(sessionId);
    }

    const isBrief = this.options.getBriefModeEnabled();
    const activePanel = this.options.getActivePanelContext();
    const includePanelContext = this.options.getIncludePanelContext();
    const activeContextItem = includePanelContext ? this.options.getActiveContextItem() : null;
    const useContextItem = includePanelContext && !!activeContextItem;
    const contextAttributes = includePanelContext
      ? (this.options.getActivePanelContextAttributes?.() ?? null)
      : null;
    const hasContextAttributes =
      includePanelContext && !!contextAttributes && Object.keys(contextAttributes).length > 0;
    const selectedItemTitles = this.options.getSelectedItemTitles
      ? this.options.getSelectedItemTitles()
      : [];
    const contextLine = this.options.buildContextLine(
      useContextItem ? activeContextItem : null,
      useContextItem ? this.options.getActiveContextItemName() : null,
      useContextItem ? this.options.getSelectedItemIds() : [],
      useContextItem ? this.options.getActiveContextItemDescription() : null,
      {
        mode: isBrief ? 'brief' : null,
        panel: activePanel,
        contextAttributes,
      },
      useContextItem ? selectedItemTitles : [],
    );

    const includeContext = Boolean(activePanel) || useContextItem || hasContextAttributes;
    const textWithContext = includeContext ? `${contextLine}\n${text}` : text;

    const clientMessageId =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `msg_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;

    const message: ClientTextInputMessage = {
      type: 'text_input',
      text: textWithContext,
      clientMessageId,
      sessionId,
    };

    socket.send(JSON.stringify(message));

    if (isExternalSession) {
      const chatLogEl = this.options.getChatLogEl();
      if (chatLogEl) {
        const indicator = this.options.appendExternalSentIndicator(chatLogEl);
        this.options.scrollMessageIntoView(chatLogEl, indicator);
      }
    }

    if (this.options.ensureChatPanelForSession) {
      this.options.ensureChatPanelForSession(sessionId);
    }

    this.options.inputEl.value = '';
    this.updateClearInputButtonVisibility();
    this.options.onAfterSend?.();
  }

  private handleClearInput(): void {
    const { inputEl } = this.options;

    if (this.options.getIsSpeechActive()) {
      this.options.stopPushToTalk();
      setTimeout(() => {
        inputEl.value = '';
        this.updateClearInputButtonVisibility();
        inputEl.focus();
        void this.options.startPushToTalk();
      }, 100);
      return;
    }

    inputEl.value = '';
    this.updateClearInputButtonVisibility();
    inputEl.focus();
  }
}
