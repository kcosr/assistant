import type { ClientSetModesMessage } from '@assistant/shared';
import { createSpeechInputController } from '../../controllers/speechInput';
import {
  ContextPreviewController,
  type ContextPreviewData,
} from '../../controllers/contextPreviewController';
import { PendingMessageListController } from '../../controllers/pendingMessageListController';
import { SpeechAudioController } from '../../controllers/speechAudioController';
import { TextInputController } from '../../controllers/textInputController';
import { initializeAudioResponsesCheckbox } from '../../utils/clientPreferences';
import type { ChatRuntime } from '../chat/runtime';

export interface InputRuntimeElements {
  contextPreviewEl: HTMLElement | null;
  pendingMessageListEl: HTMLElement | null;
  form: HTMLFormElement;
  inputEl: HTMLInputElement;
  clearButtonEl: HTMLButtonElement;
  contextToggleButtonEl: HTMLButtonElement | null;
  briefToggleButtonEl: HTMLButtonElement | null;
  micButtonEl: HTMLButtonElement;
  submitButtonEl?: HTMLButtonElement | null;
}

export interface InputRuntimeOptions {
  elements: InputRuntimeElements;
  getChatRuntime?: () => ChatRuntime | null;
  getSelectedSessionId: () => string | null;
  getChatRuntimeForSession: (sessionId: string) => ChatRuntime | null;
  getSocket: () => WebSocket | null;
  setStatus: (text: string) => void;
  setTtsStatus: (text: string) => void;
  showSessionTypingIndicator: (sessionId: string) => void;
  appendMessage: (
    container: HTMLElement,
    role: 'user' | 'assistant' | 'error',
    text: string,
    useMarkdown?: boolean,
  ) => HTMLDivElement;
  appendExternalSentIndicator: (container: HTMLElement) => HTMLDivElement;
  setAssistantBubbleTyping: (bubble: HTMLDivElement) => void;
  scrollMessageIntoView: (container: HTMLElement, element: HTMLElement) => void;
  buildContextLine: (
    contextItem: { type: string; id: string } | null,
    contextItemName: string | null,
    selectedItemIds: string[],
    contextItemDescription: string | null,
    options?: {
      mode?: 'brief' | null;
      panel?: { panelId: string; panelType: string } | null;
      contextAttributes?: Record<string, string> | null;
    },
    selectedItemTitles?: string[],
  ) => string;
  getActiveContextItem: () => { type: string; id: string } | null;
  getActiveContextItemName: () => string | null;
  getActiveContextItemDescription: () => string | null;
  getSelectedItemIds: () => string[];
  getSelectedItemTitles?: () => string[];
  getActivePanelContext: () => { panelId: string; panelType: string } | null;
  getActivePanelContextAttributes?: () => Record<string, string> | null;
  getContextPreviewData?: () => ContextPreviewData | null;
  onClearContextSelection?: () => void;
  getIsSessionExternal: (sessionId: string | null) => boolean;
  getAgentDisplayName: (agentId: string) => string;
  cancelQueuedMessage: (messageId: string) => void;
  audioResponsesCheckboxEl: HTMLInputElement;
  initialIncludePanelContext: boolean;
  initialBriefModeEnabled: boolean;
  onIncludePanelContextChange?: (enabled: boolean) => void;
  onBriefModeChange?: (enabled: boolean) => void;
  speechFeaturesEnabled: boolean;
  initialAudioResponsesEnabled: boolean;
  audioResponsesStorageKey: string;
  continuousListeningLongPressMs: number;
}

export interface InputRuntime {
  inputEl: HTMLInputElement;
  textInputController: TextInputController;
  speechAudioController: SpeechAudioController | null;
  pendingMessageListController: PendingMessageListController | null;
  contextPreviewController: ContextPreviewController | null;
  focusInput: () => void;
  updateClearInputButtonVisibility: () => void;
  updateContextAvailability: () => void;
  updateContextPreview: () => void;
  setSessionId: (sessionId: string | null) => void;
  setIncludePanelContext: (enabled: boolean) => void;
  setBriefModeEnabled: (enabled: boolean) => void;
  getSessionId: () => string | null;
  getIncludePanelContext: () => boolean;
  getBriefModeEnabled: () => boolean;
  sendModesUpdate: () => void;
  getAudioEnabled: () => boolean;
  enableAudioResponses: () => void;
  supportsAudioOutput: () => boolean;
}

export function createInputRuntime(options: InputRuntimeOptions): InputRuntime {
  const { elements } = options;
  let includePanelContext = options.initialIncludePanelContext;
  let briefModeEnabled = options.initialBriefModeEnabled;
  let isBound = Boolean(options.getSelectedSessionId());
  let hasSpeechInput = false;
  const basePlaceholder = elements.inputEl.getAttribute('placeholder') ?? '';

  const getActiveChatRuntime = (): ChatRuntime | null => {
    const direct = options.getChatRuntime?.() ?? null;
    if (direct) {
      return direct;
    }
    const sessionId = options.getSelectedSessionId();
    if (!sessionId) {
      return null;
    }
    return options.getChatRuntimeForSession(sessionId);
  };

  const applyIncludePanelContextState = (): void => {
    const disabled = !isBound;
    if (elements.contextToggleButtonEl) {
      elements.contextToggleButtonEl.classList.toggle('active', includePanelContext && !disabled);
      elements.contextToggleButtonEl.classList.toggle('disabled', disabled);
      elements.contextToggleButtonEl.setAttribute(
        'aria-pressed',
        !disabled && includePanelContext ? 'true' : 'false',
      );
      elements.contextToggleButtonEl.title = disabled
        ? 'Select a session to use this control'
        : includePanelContext
          ? 'Include panel context in messages'
          : 'Do not include panel context in messages';
      elements.contextToggleButtonEl.disabled = disabled;
    }
  };

  const setIncludePanelContext = (enabled: boolean, notify = false): void => {
    includePanelContext = enabled;
    applyIncludePanelContextState();
    if (notify) {
      options.onIncludePanelContextChange?.(enabled);
    }
  };

  const applyBriefModeState = (): void => {
    if (!elements.briefToggleButtonEl) {
      return;
    }
    elements.briefToggleButtonEl.disabled = !isBound;
    elements.briefToggleButtonEl.classList.toggle('active', !briefModeEnabled);
    elements.briefToggleButtonEl.setAttribute('aria-pressed', briefModeEnabled ? 'false' : 'true');
    elements.briefToggleButtonEl.title = briefModeEnabled
      ? 'Brief mode (click for normal)'
      : 'Normal mode (click for brief)';
  };

  const setBriefModeEnabled = (enabled: boolean, notify = false): void => {
    briefModeEnabled = enabled;
    applyBriefModeState();
    if (notify) {
      options.onBriefModeChange?.(enabled);
    }
  };

  if (elements.contextToggleButtonEl) {
    elements.contextToggleButtonEl.addEventListener('click', () => {
      elements.contextToggleButtonEl?.blur();
      setIncludePanelContext(!includePanelContext, true);
    });
  }

  if (elements.briefToggleButtonEl) {
    elements.briefToggleButtonEl.addEventListener('click', () => {
      if (!isBound) {
        return;
      }
      elements.briefToggleButtonEl?.blur();
      setBriefModeEnabled(!briefModeEnabled, true);
    });
  }

  let speechAudioController: SpeechAudioController | null = null;

  const textInputController = new TextInputController({
    form: elements.form,
    inputEl: elements.inputEl,
    clearInputButtonEl: elements.clearButtonEl,
    getChatLogEl: () => getActiveChatRuntime()?.elements.chatLog ?? null,
    appendMessage: options.appendMessage,
    appendExternalSentIndicator: options.appendExternalSentIndicator,
    setAssistantBubbleTyping: options.setAssistantBubbleTyping,
    scrollMessageIntoView: options.scrollMessageIntoView,
    showSessionTypingIndicator: options.showSessionTypingIndicator,
    buildContextLine: options.buildContextLine,
    getIncludePanelContext: () => includePanelContext,
    getActiveContextItem: options.getActiveContextItem,
    getActiveContextItemName: options.getActiveContextItemName,
    getActiveContextItemDescription: options.getActiveContextItemDescription,
    getSelectedItemIds: options.getSelectedItemIds,
    ...(options.getSelectedItemTitles
      ? { getSelectedItemTitles: options.getSelectedItemTitles }
      : {}),
    getActivePanelContext: options.getActivePanelContext,
    ...(options.getActivePanelContextAttributes
      ? { getActivePanelContextAttributes: options.getActivePanelContextAttributes }
      : {}),
    getSessionId: options.getSelectedSessionId,
    getSocket: options.getSocket,
    onBeforeSend: () => {
      speechAudioController?.stopPushToTalk();
    },
    onAfterSend: () => {
      // Clear context selection after sending message
      options.onClearContextSelection?.();
    },
    onClearContextSelection: () => {
      options.onClearContextSelection?.();
    },
    hasContextSelection: () => {
      const data = options.getContextPreviewData?.();
      return Boolean(data?.selectedText && data.selectedText.trim().length > 0);
    },
    getIsSessionExternal: options.getIsSessionExternal,
    getIsSpeechActive: () => speechAudioController?.isSpeechActive ?? false,
    stopPushToTalk: () => {
      speechAudioController?.stopPushToTalk();
    },
    startPushToTalk: async () => {
      if (!speechAudioController) {
        return;
      }
      await speechAudioController.startPushToTalk();
    },
    getBriefModeEnabled: () => briefModeEnabled,
  });
  textInputController.attach();

  const applyInputDisabledState = (): void => {
    const disabled = !isBound;
    elements.form.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    elements.inputEl.disabled = disabled;
    elements.clearButtonEl.disabled = disabled;
    elements.micButtonEl.disabled = disabled || !hasSpeechInput;
    if (elements.submitButtonEl) {
      elements.submitButtonEl.disabled = disabled;
    }
    if (disabled) {
      elements.inputEl.placeholder = basePlaceholder
        ? 'Select a session to chat...'
        : 'Select a session to chat...';
      elements.clearButtonEl.style.visibility = 'hidden';
    } else {
      elements.inputEl.placeholder = basePlaceholder;
      textInputController.updateClearInputButtonVisibility();
    }
  };

  const speechInputController = options.speechFeaturesEnabled
    ? createSpeechInputController()
    : null;
  hasSpeechInput = Boolean(speechInputController);
  applyInputDisabledState();
  applyIncludePanelContextState();
  applyBriefModeState();

  const supportsAudioOutput = (): boolean => {
    if (!options.speechFeaturesEnabled) {
      return false;
    }

    return !!(
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
  };

  const audioResponsesEnabled = initializeAudioResponsesCheckbox({
    checkbox: options.audioResponsesCheckboxEl,
    initialAudioResponsesEnabled: options.initialAudioResponsesEnabled,
    supportsAudioOutput: supportsAudioOutput(),
  });

  const sendModesUpdate = (): void => {
    const socket = options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const audioEnabled = speechAudioController?.isAudioResponsesEnabled ?? audioResponsesEnabled;
    const message: ClientSetModesMessage = {
      type: 'set_modes',
      outputMode: audioEnabled ? 'both' : 'text',
    };
    socket.send(JSON.stringify(message));
  };

  speechAudioController = new SpeechAudioController({
    speechFeaturesEnabled: options.speechFeaturesEnabled,
    speechInputController,
    micButtonEl: elements.micButtonEl,
    audioResponsesCheckboxEl: options.audioResponsesCheckboxEl,
    inputEl: elements.inputEl,
    getSocket: options.getSocket,
    getSessionId: options.getSelectedSessionId,
    setStatus: options.setStatus,
    setTtsStatus: options.setTtsStatus,
    sendUserText: (text) => textInputController.sendUserText(text),
    updateClearInputButtonVisibility: () => textInputController.updateClearInputButtonVisibility(),
    sendModesUpdate,
    supportsAudioOutput,
    isOutputActive: () => getActiveChatRuntime()?.chatRenderer.hasActiveOutput() ?? false,
    updateScrollButtonVisibility: () => {
      getActiveChatRuntime()?.chatScrollManager.updateScrollButtonVisibility();
    },
    audioResponsesStorageKey: options.audioResponsesStorageKey,
    continuousListeningLongPressMs: options.continuousListeningLongPressMs,
    initialAudioResponsesEnabled: audioResponsesEnabled,
  });
  speechAudioController.attach();

  const pendingMessageListController = elements.pendingMessageListEl
    ? new PendingMessageListController({
        container: elements.pendingMessageListEl,
        getSessionId: options.getSelectedSessionId,
        getAgentDisplayName: options.getAgentDisplayName,
        cancelQueuedMessage: options.cancelQueuedMessage,
      })
    : null;

  const contextPreviewController = elements.contextPreviewEl
    ? new ContextPreviewController({
        container: elements.contextPreviewEl,
        getIncludePanelContext: () => includePanelContext,
        onClearSelection: () => {
          options.onClearContextSelection?.();
        },
      })
    : null;

  const updateContextPreview = (): void => {
    if (!contextPreviewController) {
      return;
    }
    const data = options.getContextPreviewData?.() ?? null;
    contextPreviewController.update(data);
  };

  applyIncludePanelContextState();
  applyBriefModeState();

  return {
    inputEl: elements.inputEl,
    textInputController,
    speechAudioController,
    pendingMessageListController,
    contextPreviewController,
    focusInput: () => {
      elements.inputEl.focus();
    },
    updateClearInputButtonVisibility: () => textInputController.updateClearInputButtonVisibility(),
    updateContextAvailability: () => {
      applyIncludePanelContextState();
      updateContextPreview();
    },
    updateContextPreview,
    setSessionId: (sessionId: string | null) => {
      isBound = Boolean(sessionId);
      pendingMessageListController?.setSessionId(sessionId);
      applyInputDisabledState();
      applyIncludePanelContextState();
      applyBriefModeState();
    },
    setIncludePanelContext: (enabled: boolean) => {
      setIncludePanelContext(enabled);
    },
    setBriefModeEnabled: (enabled: boolean) => {
      setBriefModeEnabled(enabled);
    },
    getSessionId: options.getSelectedSessionId,
    getIncludePanelContext: () => includePanelContext,
    getBriefModeEnabled: () => briefModeEnabled,
    sendModesUpdate,
    getAudioEnabled: () => speechAudioController?.isAudioResponsesEnabled ?? audioResponsesEnabled,
    enableAudioResponses: () => {
      speechAudioController?.enableAudioResponses();
    },
    supportsAudioOutput,
  };
}
