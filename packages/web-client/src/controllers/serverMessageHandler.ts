import type {
  ChatEvent,
  PanelEventEnvelope,
  PanelStatus,
  ServerChatEventMessage,
  ServerMessage,
  ServerMessageDequeuedMessage,
  ServerMessageQueuedMessage,
} from '@assistant/shared';
import { clearExternalSentIndicators } from '../utils/chatMessageRenderer';
import type { SpeechAudioController } from './speechAudioController';
import { openExternalUrl } from '../utils/capacitor';
import type { PendingMessageListController } from './pendingMessageListController';
import type { ChatRuntime } from '../panels/chat/runtime';
import { ensureEmptySessionHint } from '../utils/emptySessionHint';

interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  /**
   * Optional user-defined session name.
   */
  name?: string;
  /**
   * When set, indicates that the session is pinned in the UI.
   */
  pinnedAt?: string;
  /**
   * Optional session-scoped attributes for plugins/panels.
   */
  attributes?: Record<string, unknown>;
}

export interface ServerMessageHandlerOptions {
  statusEl: HTMLElement;
  sessionsWithPendingMessages: Set<string>;
  getSelectedSessionId: () => string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  getChatRuntimeForSession: (sessionId: string) => ChatRuntime | null;
  isChatPanelVisible: (sessionId: string) => boolean;
  getSessionSummaries: () => SessionSummary[];
  getSpeechAudioControllerForSession: (sessionId: string) => SpeechAudioController | null;
  getAudioEnabled: () => boolean;
  getAgentDisplayName: (agentId: string) => string;
  sendModesUpdate: () => void;
  supportsAudioOutput: () => boolean;
  enableAudioResponses: () => void;
  refreshSessions: (preferredSessionId?: string | null) => Promise<void>;
  loadSessionTranscript: (sessionId: string) => Promise<void>;
  renderAgentSidebar: () => void;
  appendMessage: (
    container: HTMLElement,
    role: 'user' | 'assistant' | 'error',
    text: string,
    useMarkdown?: boolean,
  ) => HTMLDivElement;
  scrollMessageIntoView: (container: HTMLElement, element: HTMLElement) => void;
  showSessionTypingIndicator: (sessionId: string) => void;
  hideSessionTypingIndicator: (sessionId: string) => void;
  setStatus: (element: HTMLElement, text: string) => void;
  setTtsStatus: (text: string) => void;
  focusInputForSession: (sessionId: string) => void;
  isMobileViewport: () => boolean;
  isSidebarFocused: () => boolean;
  getAutoFocusChatOnSessionReady: () => boolean;
  getExpandToolOutput: () => boolean;
  showBackgroundSessionActivityIndicator: (sessionId: string) => void;
  scheduleBackgroundSessionActivityIndicatorHide: (sessionId: string) => void;
  getPendingMessageListControllerForSession?: (
    sessionId: string,
  ) => PendingMessageListController | null;
  onSessionDeleted?: (sessionId: string) => void;
  onSessionUpdated?: (sessionId: string) => void;
  updateSessionModelForSession?: (options: {
    sessionId: string;
    availableModels?: string[];
    currentModel?: string;
  }) => void;
  updateSessionThinkingForSession?: (options: {
    sessionId: string;
    availableThinking?: string[];
    currentThinking?: string;
  }) => void;
  cancelQueuedMessage: (messageId: string) => void;
  editQueuedMessage: (messageId: string, text: string, sessionId: string) => void;
  handlePanelEvent?: (event: PanelEventEnvelope) => void;
  setChatPanelStatusForSession?: (sessionId: string, status: PanelStatus) => void;
  setSessionsPanelBadge?: (badge: string | undefined) => void;
}

export class ServerMessageHandler {
  private readonly queuedMessageBubbles = new Map<string, HTMLDivElement>();
  private readonly sessionsWithPendingInteractions = new Set<string>();

  constructor(private readonly options: ServerMessageHandlerOptions) {}

  private markSessionHasPendingMessages(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    this.options.sessionsWithPendingMessages.add(trimmed);
    this.updateSessionsPanelBadge();
    const indicator = document.querySelector(
      `.session-typing-indicator[data-session-id="${trimmed}"]`,
    );
    if (indicator) {
      indicator.classList.add('has-pending');
    }
  }

  private clearSessionPendingIndicator(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    this.options.sessionsWithPendingMessages.delete(trimmed);
    this.updateSessionsPanelBadge();
    const indicator = document.querySelector(
      `.session-typing-indicator[data-session-id="${trimmed}"]`,
    );
    if (indicator) {
      indicator.classList.remove('has-pending');
    }
  }

  private updateSessionsPanelBadge(): void {
    const count = this.options.sessionsWithPendingMessages.size;
    const badge = count > 0 ? String(count) : undefined;
    this.options.setSessionsPanelBadge?.(badge);
  }

  async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'chat_event': {
        const chatEventMessage = message as ServerChatEventMessage;
        const messageSessionId =
          typeof chatEventMessage.sessionId === 'string' ? chatEventMessage.sessionId.trim() : '';
        if (!messageSessionId) {
          console.warn('[client] chat_event missing sessionId', chatEventMessage);
          break;
        }
        const sessionId = messageSessionId;
        const event: ChatEvent = chatEventMessage.event;

        if (sessionId) {
          if (event.type === 'interaction_request') {
            this.sessionsWithPendingInteractions.add(sessionId);
            this.options.hideSessionTypingIndicator(sessionId);
          } else if (event.type === 'interaction_response') {
            this.sessionsWithPendingInteractions.delete(sessionId);
            if (event.payload.action !== 'cancel') {
              this.options.showSessionTypingIndicator(sessionId);
            } else {
              this.options.hideSessionTypingIndicator(sessionId);
            }
          } else if (
            event.type === 'assistant_chunk' ||
            event.type === 'thinking_chunk' ||
            event.type === 'tool_call'
          ) {
            if (!this.sessionsWithPendingInteractions.has(sessionId)) {
              this.options.showSessionTypingIndicator(sessionId);
            }
          } else if (
            event.type === 'assistant_done' ||
            event.type === 'turn_end' ||
            event.type === 'interrupt' ||
            event.type === 'error'
          ) {
            this.options.hideSessionTypingIndicator(sessionId);
          }
        }

        if (!this.options.isChatPanelVisible(sessionId)) {
          this.markSessionHasPendingMessages(sessionId);
          this.options.showBackgroundSessionActivityIndicator(sessionId);
        }

        if (!sessionId) {
          break;
        }

        const runtime = this.options.getChatRuntimeForSession(sessionId);
        if (!runtime) {
          break;
        }

        if (event.type === 'interaction_request') {
          runtime.chatRenderer.hideTypingIndicator();
          this.options.setChatPanelStatusForSession?.(sessionId, 'idle');
        } else if (event.type === 'interaction_response') {
          if (event.payload.action !== 'cancel') {
            runtime.chatRenderer.showTypingIndicator();
            this.options.setChatPanelStatusForSession?.(sessionId, 'busy');
          } else {
            runtime.chatRenderer.hideTypingIndicator();
            this.options.setChatPanelStatusForSession?.(sessionId, 'idle');
          }
        } else if (
          event.type === 'assistant_chunk' ||
          event.type === 'thinking_chunk' ||
          event.type === 'tool_call'
        ) {
          if (!this.sessionsWithPendingInteractions.has(sessionId)) {
            runtime.chatRenderer.showTypingIndicator();
            this.options.setChatPanelStatusForSession?.(sessionId, 'busy');
          }
        } else if (
          event.type === 'assistant_done' ||
          event.type === 'turn_end' ||
          event.type === 'interrupt' ||
          event.type === 'error'
        ) {
          runtime.chatRenderer.hideTypingIndicator();
          const status = event.type === 'error' ? 'error' : 'idle';
          this.options.setChatPanelStatusForSession?.(sessionId, status);
        }

        runtime.chatRenderer.handleNewEvent(event);
        if (this.options.isChatPanelVisible(sessionId)) {
          runtime.chatScrollManager.autoScrollIfEnabled();
        }
        this.options.getSpeechAudioControllerForSession(sessionId)?.syncMicButtonState();
        break;
      }

      case 'message_queued': {
        const queued = message as ServerMessageQueuedMessage;
        const rawSessionId = typeof queued.sessionId === 'string' ? queued.sessionId.trim() : '';
        if (!rawSessionId) {
          break;
        }
        const sessionId = rawSessionId;
        this.options
          .getPendingMessageListControllerForSession?.(sessionId)
          ?.handleMessageQueued(queued);
        if (!this.options.isChatPanelVisible(sessionId)) {
          this.markSessionHasPendingMessages(sessionId);
          this.options.showBackgroundSessionActivityIndicator(sessionId);
        }

        const clientMessageId = queued.clientMessageId;
        if (!clientMessageId) {
          break;
        }

        const runtime = this.options.getChatRuntimeForSession(sessionId);
        if (!runtime) {
          break;
        }

        const bubble = runtime.elements.chatLog.querySelector<HTMLDivElement>(
          `.message.user[data-client-message-id="${clientMessageId}"]`,
        );
        if (!bubble) {
          break;
        }

        bubble.classList.add('queued');
        bubble.dataset['queuedMessageId'] = queued.messageId;
        this.queuedMessageBubbles.set(queued.messageId, bubble);

        const content = bubble.querySelector<HTMLDivElement>('.message-content');
        if (!content) {
          break;
        }

        let indicator = content.querySelector<HTMLDivElement>('.queued-message-indicator');
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'queued-message-indicator';
          content.appendChild(indicator);
        } else {
          indicator.innerHTML = '';
        }

        const label = document.createElement('span');
        label.className = 'queued-message-label';
        label.textContent = queued.position > 1 ? `Queued (position ${queued.position})` : 'Queued';
        indicator.appendChild(label);

        const actions = document.createElement('div');
        actions.className = 'queued-message-actions';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'queued-message-action queued-message-edit';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.options.editQueuedMessage(queued.messageId, queued.text, sessionId);
        });
        actions.appendChild(editButton);

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'queued-message-action queued-message-cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.options.cancelQueuedMessage(queued.messageId);
        });
        actions.appendChild(cancelButton);

        indicator.appendChild(actions);

        break;
      }
      case 'message_dequeued': {
        const dequeued = message as ServerMessageDequeuedMessage;
        const rawSessionId =
          typeof dequeued.sessionId === 'string' ? dequeued.sessionId.trim() : '';
        const sessionId = rawSessionId || null;
        if (sessionId) {
          this.options
            .getPendingMessageListControllerForSession?.(sessionId)
            ?.handleMessageDequeued(dequeued);
        }
        const bubble = this.queuedMessageBubbles.get(dequeued.messageId) ?? null;
        if (!bubble) {
          break;
        }
        this.queuedMessageBubbles.delete(dequeued.messageId);
        bubble.classList.remove('queued');
        delete bubble.dataset['queuedMessageId'];
        const indicator = bubble.querySelector<HTMLDivElement>('.queued-message-indicator');
        if (indicator) {
          indicator.remove();
        }
        break;
      }
      case 'session_ready': {
        console.log('[client] session_ready received', { sessionId: message.sessionId });
        const selectedSessionId = this.options.getSelectedSessionId();
        if (!selectedSessionId) {
          this.options.setSelectedSessionId(message.sessionId);
        }
        if (typeof this.options.updateSessionModelForSession === 'function') {
          const anyMessage = message as {
            availableModels?: string[];
            currentModel?: string;
          };
          const payload: {
            sessionId: string;
            availableModels?: string[];
            currentModel?: string;
          } = {
            sessionId: message.sessionId,
            ...(Array.isArray(anyMessage.availableModels) && anyMessage.availableModels.length > 0
              ? { availableModels: anyMessage.availableModels }
              : {}),
            ...(typeof anyMessage.currentModel === 'string' &&
            anyMessage.currentModel.trim().length > 0
              ? { currentModel: anyMessage.currentModel.trim() }
              : {}),
          };
          this.options.updateSessionModelForSession(payload);
        }
        if (typeof this.options.updateSessionThinkingForSession === 'function') {
          const anyMessage = message as {
            availableThinking?: string[];
            currentThinking?: string;
          };
          const payload: {
            sessionId: string;
            availableThinking?: string[];
            currentThinking?: string;
          } = {
            sessionId: message.sessionId,
            ...(Array.isArray(anyMessage.availableThinking) &&
            anyMessage.availableThinking.length > 0
              ? { availableThinking: anyMessage.availableThinking }
              : {}),
            ...(typeof anyMessage.currentThinking === 'string' &&
            anyMessage.currentThinking.trim().length > 0
              ? { currentThinking: anyMessage.currentThinking.trim() }
              : {}),
          };
          this.options.updateSessionThinkingForSession(payload);
        }
        this.options.setStatus(
          this.options.statusEl,
          `Connected (session ${message.sessionId.slice(0, 8)})`,
        );

        const audioEnabled = this.options.getAudioEnabled();

        if (audioEnabled && message.outputMode === 'text') {
          this.options.sendModesUpdate();
        }

        if (this.options.supportsAudioOutput() && audioEnabled) {
          this.options.enableAudioResponses();
        }

        void this.options.refreshSessions(message.sessionId);
        void this.options.loadSessionTranscript(message.sessionId);

        if (
          this.options.getAutoFocusChatOnSessionReady() &&
          !this.options.isMobileViewport() &&
          !this.options.isSidebarFocused() &&
          (!selectedSessionId || selectedSessionId === message.sessionId)
        ) {
          console.log('[client] session_ready: focusing input');
          this.options.focusInputForSession(message.sessionId);
        }
        break;
      }
      case 'agent_callback_result': {
        // Legacy handler - agent_callback events are now handled via chat_event
        // Still hide the typing indicator for backward compatibility
        const rawSessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : '';
        if (rawSessionId) {
          this.options.hideSessionTypingIndicator(rawSessionId);
        }
        break;
      }
      case 'transcript_delta':
      case 'transcript_done':
      case 'modes_updated': {
        break;
      }
      case 'error': {
        // Ignore session_deleted errors when there's no selected session
        // (e.g., during delete all sessions)
        if (message.code === 'session_deleted' && !this.options.getSelectedSessionId()) {
          break;
        }
        const selectedSessionId = this.options.getSelectedSessionId();
        const runtime = selectedSessionId
          ? this.options.getChatRuntimeForSession(selectedSessionId)
          : null;
        if (runtime) {
          clearExternalSentIndicators(runtime.elements.chatLog);
        }
        this.options.setStatus(this.options.statusEl, `Error: ${message.code}`);
        if (runtime) {
          const bubble = this.options.appendMessage(
            runtime.elements.chatLog,
            'error',
            message.message,
          );
          this.options.scrollMessageIntoView(runtime.elements.chatLog, bubble);
        }
        if (selectedSessionId) {
          this.options.hideSessionTypingIndicator(selectedSessionId);
          runtime?.chatRenderer.hideTypingIndicator();
          this.options.setChatPanelStatusForSession?.(selectedSessionId, 'error');
          this.options.getSpeechAudioControllerForSession(selectedSessionId)?.syncMicButtonState();
        }
        break;
      }
      case 'output_cancelled': {
        const rawSessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : '';
        if (!rawSessionId) {
          break;
        }
        const sessionId = rawSessionId;
        if (!this.options.isChatPanelVisible(sessionId)) {
          this.markSessionHasPendingMessages(sessionId);
          this.options.hideSessionTypingIndicator(sessionId);
          this.options.scheduleBackgroundSessionActivityIndicatorHide(sessionId);
        }

        this.options.getSpeechAudioControllerForSession(sessionId)?.handleOutputCancelled();
        this.options.hideSessionTypingIndicator(sessionId);
        const runtime = this.options.getChatRuntimeForSession(sessionId);
        runtime?.chatRenderer.hideTypingIndicator();
        runtime?.chatRenderer.markOutputCancelled();
        this.options.setChatPanelStatusForSession?.(sessionId, 'idle');
        this.options.getSpeechAudioControllerForSession(sessionId)?.syncMicButtonState();
        break;
      }
      case 'open_url': {
        const url = message.url;
        if (typeof url !== 'string' || !url.trim()) {
          break;
        }
        void openExternalUrl(url.trim());
        break;
      }
      case 'session_cleared': {
        const sessionId = message.sessionId;
        if (sessionId) {
          const runtime = this.options.getChatRuntimeForSession(sessionId);
          if (runtime) {
            runtime.chatRenderer.clear();
            ensureEmptySessionHint(runtime.elements.chatLog);
            runtime.chatScrollManager.resetScrollState();
            runtime.chatScrollManager.updateScrollButtonVisibility();
            this.options.getSpeechAudioControllerForSession(sessionId)?.syncMicButtonState();
          }
        }

        void this.options.refreshSessions(this.options.getSelectedSessionId());
        break;
      }
      case 'session_deleted': {
        const sessionId = message.sessionId;
        if (this.options.getSelectedSessionId() === sessionId) {
          this.options.setSelectedSessionId(null);
        }
        this.clearSessionPendingIndicator(sessionId);
        this.options
          .getPendingMessageListControllerForSession?.(sessionId)
          ?.clearSession(sessionId);
        if (typeof this.options.onSessionDeleted === 'function') {
          this.options.onSessionDeleted(sessionId);
        }
        void this.options.refreshSessions(this.options.getSelectedSessionId());
        break;
      }
      case 'session_created': {
        // Refresh sessions to pick up the new session in the sidebar
        void this.options.refreshSessions(this.options.getSelectedSessionId());
        break;
      }
      case 'session_updated': {
        const session = this.options
          .getSessionSummaries()
          .find((summary) => summary.sessionId === message.sessionId);
        if (session) {
          session.updatedAt = message.updatedAt;
          const anyMessage = message as {
            name?: string | null;
            pinnedAt?: string | null;
            attributes?: Record<string, unknown> | null;
          };
          if (anyMessage.name !== undefined) {
            const rawName = anyMessage.name;
            if (typeof rawName === 'string' && rawName.trim().length > 0) {
              session.name = rawName.trim();
            } else {
              delete session.name;
            }
          }
          if (anyMessage.pinnedAt !== undefined) {
            if (anyMessage.pinnedAt === null) {
              delete session.pinnedAt;
            } else if (typeof anyMessage.pinnedAt === 'string') {
              session.pinnedAt = anyMessage.pinnedAt;
            }
          }
          if (anyMessage.attributes !== undefined) {
            if (anyMessage.attributes === null) {
              delete session.attributes;
            } else if (
              typeof anyMessage.attributes === 'object' &&
              !Array.isArray(anyMessage.attributes)
            ) {
              session.attributes = anyMessage.attributes;
            }
          }
          this.options.renderAgentSidebar();
          this.options.onSessionUpdated?.(message.sessionId);
        }
        break;
      }
      case 'panel_event': {
        if (this.options.handlePanelEvent) {
          this.options.handlePanelEvent(message);
        }
        break;
      }
      default:
        break;
    }
  }
}
