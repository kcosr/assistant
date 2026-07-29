import type { ClientTextInputMessage } from '@assistant/shared';
import { resolveInputContext } from '../utils/inputContext';
import { autosizeTextarea } from '../utils/textareaAutosize';

export interface TextInputControllerOptions {
  form: HTMLFormElement;
  inputEl: HTMLTextAreaElement;
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
  getTurnOriginId?: () => string | null;
  resolveTurnOriginId?: () => Promise<string | null>;
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
  private turnOriginHydrationComplete = false;
  private turnOriginHydrationPending = false;

  private resizeObserver: ResizeObserver | null = null;
  private observedWidth: number | null = null;

  constructor(private readonly options: TextInputControllerOptions) {}

  attach(): void {
    const { form, inputEl, clearInputButtonEl } = this.options;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.options.onBeforeSend();
      this.sendUserText(inputEl.value);
    });

    inputEl.addEventListener('input', () => {
      this.updateInputPresentation();
    });

    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.handleEscape();
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    clearInputButtonEl.addEventListener('click', () => {
      this.handleClearInput();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (typeof width !== 'number' || width === this.observedWidth) {
          return;
        }
        this.observedWidth = width;
        this.autosizeInput();
      });
      this.resizeObserver.observe(inputEl.parentElement ?? inputEl);
    }

    this.updateInputPresentation();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private handleEscape(): void {
    const { inputEl } = this.options;

    // If there's text in the input, clear it
    if (inputEl.value.length > 0) {
      inputEl.value = '';
      this.updateInputPresentation();
      return;
    }

    // If there's a context selection, clear it
    if (this.options.hasContextSelection?.()) {
      this.options.onClearContextSelection?.();
    }
  }

  updateInputPresentation(): void {
    const hasContent = this.options.inputEl.value.length > 0;
    this.options.clearInputButtonEl.style.visibility = hasContent ? 'visible' : 'hidden';
    this.autosizeInput();
  }

  private autosizeInput(): void {
    const { inputEl } = this.options;
    if (inputEl.value.length === 0) {
      inputEl.style.height = '';
      return;
    }
    autosizeTextarea(inputEl);
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
    const turnOriginId = this.options.getTurnOriginId?.()?.trim() ?? '';
    if (turnOriginId) {
      this.turnOriginHydrationComplete = true;
    }
    if (!turnOriginId && this.options.resolveTurnOriginId && !this.turnOriginHydrationComplete) {
      if (this.turnOriginHydrationPending) {
        return;
      }
      this.turnOriginHydrationPending = true;
      const inputValueBeforeHydration = this.options.inputEl.value;
      void this.options
        .resolveTurnOriginId()
        .catch(() => null)
        .then(() => {
          this.turnOriginHydrationComplete = true;
          this.turnOriginHydrationPending = false;
          if (
            this.options.getSessionId() !== sessionId ||
            this.options.inputEl.value !== inputValueBeforeHydration
          ) {
            return;
          }
          this.sendUserText(rawText);
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
    const { enabled: includeContext, contextLine } = resolveInputContext({
      includePanelContext: this.options.getIncludePanelContext(),
      briefModeEnabled: isBrief,
      activePanel: this.options.getActivePanelContext(),
      activeContextItem: this.options.getActiveContextItem(),
      activeContextItemName: this.options.getActiveContextItemName(),
      activeContextItemDescription: this.options.getActiveContextItemDescription(),
      selectedItemIds: this.options.getSelectedItemIds(),
      selectedItemTitles: this.options.getSelectedItemTitles
        ? this.options.getSelectedItemTitles()
        : [],
      contextAttributes: this.options.getActivePanelContextAttributes?.() ?? null,
      buildContextLine: this.options.buildContextLine,
    });
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
      ...(turnOriginId ? { turnOriginId } : {}),
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
    this.updateInputPresentation();
    this.options.onAfterSend?.();
  }

  private handleClearInput(): void {
    const { inputEl } = this.options;

    if (this.options.getIsSpeechActive()) {
      this.options.stopPushToTalk();
      setTimeout(() => {
        inputEl.value = '';
        this.updateInputPresentation();
        inputEl.focus();
        void this.options.startPushToTalk();
      }, 100);
      return;
    }

    inputEl.value = '';
    this.updateInputPresentation();
    inputEl.focus();
  }
}
