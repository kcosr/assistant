import type {
  AttachmentDescriptor,
  AttachmentToolResult,
  AssistantChunkEvent,
  AssistantDoneEvent,
  InteractionRequestEvent,
  InteractionResponseEvent,
  InteractionPendingEvent,
  QuestionnaireRepromptEvent,
  QuestionnaireRequestEvent,
  QuestionnaireSubmissionEvent,
  QuestionnaireUpdateEvent,
  ThinkingChunkEvent,
  ThinkingDoneEvent,
  ProjectedTranscriptEvent,
} from '@assistant/shared';
import {
  isAttachmentToolResult,
  parseQuestionnaireCallbackText,
  type QuestionnaireCallbackPayload,
} from '@assistant/shared';
import {
  downloadAttachment,
  fetchAttachmentTextContent,
  getAttachmentContentUrl,
  openHtmlAttachmentInBrowser,
} from '../utils/attachmentActions';
import { applyMarkdownToElement } from '../utils/markdown';
import { createCopyDropdown } from './markdownViewerController';
import { clearEmptySessionHint } from '../utils/emptySessionHint';
import {
  appendMessage,
  decorateUserMessageAsAgent,
  stripContextLine,
} from '../utils/chatMessageRenderer';
import {
  createToolCallGroup,
  createToolOutputBlock,
  extractToolCallLabel,
  formatByteSize,
  getToolCallGroupState,
  getToolCallSummary,
  setToolOutputBlockInput,
  setToolOutputBlockPending,
  updateToolOutputBlockStreamingInput,
  updateToolCallGroup,
  updateToolOutputBlockLabel,
  updateToolOutputBlockContent,
} from '../utils/toolOutputRenderer';
import { formatToolResultText } from '../utils/toolResultFormatting';
import {
  applyInteractionResponse,
  createInteractionElement,
  createQuestionnaireElement,
  type InteractionResponseDraft,
  type QuestionnaireRequestView,
} from '../utils/interactionRenderer';
import { dedupeProjectedTranscriptEvents } from '../utils/transcriptReplay';
export interface ChatRendererOptions {
  getAgentDisplayName?: (agentId: string) => string | undefined;
  getExpandToolOutput?: () => boolean;
  getInteractionEnabled?: () => boolean;
  getShouldAutoFocusQuestionnaire?: () => boolean;
  getShouldRestoreFocusAfterInteraction?: () => boolean;
  sendInteractionResponse?: (options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    response: InteractionResponseDraft;
  }) => void;
  sendQuestionnaireSubmit?: (options: {
    sessionId: string;
    questionnaireRequestId: string;
    answers: Record<string, unknown>;
  }) => void;
  sendQuestionnaireCancel?: (options: {
    sessionId: string;
    questionnaireRequestId: string;
    reason?: string;
  }) => void;
  onRequestDividerActivate?: (options: {
    requestId: string;
    timestamp: number;
    anchorEl: HTMLElement;
    hasBefore: boolean;
    hasAfter: boolean;
  }) => void;
}

export type ProjectedTranscriptApplyResult = 'applied' | 'ignored' | 'reload';

const VOICE_TOOL_NAMES = new Set(['voice_speak', 'voice_ask']);
const ATTACHMENT_TOOL_NAME = 'attachment_send';

type AttachmentExpansionState =
  | { status: 'loading' }
  | { status: 'ready'; fullText: string; expanded: boolean };

type RenderedTranscriptEvent<TPayload> = {
  id: string;
  timestamp: number;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  payload: TPayload;
  chatEventType: ProjectedTranscriptEvent['chatEventType'];
};

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getAttachmentToolResult(value: unknown): AttachmentToolResult | null {
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (isAttachmentToolResult(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = parseJsonRecord(candidate);
      if (parsed) {
        queue.push(parsed);
      }
      continue;
    }
    if (Array.isArray(candidate)) {
      queue.push(...candidate);
      continue;
    }
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    for (const key of ['result', 'content', 'output', 'toolUseResult', 'payload']) {
      if (key in record) {
        queue.push(record[key]);
      }
    }
    for (const [key, entryValue] of Object.entries(record)) {
      if (
        key !== 'result' &&
        key !== 'content' &&
        key !== 'output' &&
        key !== 'toolUseResult' &&
        key !== 'payload'
      ) {
        queue.push(entryValue);
      }
    }
  }
  return null;
}

export class ChatRenderer {
  private readonly container: HTMLElement;
  private readonly options: ChatRendererOptions;
  private typingIndicator: HTMLDivElement | null = null;
  private _isStreaming = false;
  private _isReplaying = false;
  private readonly activeRequestIds = new Set<string>();

  private readonly turnElements = new Map<string, HTMLDivElement>();
  private readonly responseElements = new Map<string, HTMLDivElement>();
  private readonly assistantTextElements = new Map<string, HTMLDivElement>();
  private readonly assistantTextBuffers = new Map<string, string>();
  private readonly assistantTextSegmentTokens = new Map<string, string>();
  private readonly thinkingElements = new Map<string, HTMLDivElement>();
  private readonly thinkingTextBuffers = new Map<string, string>();
  private readonly toolCallElements = new Map<string, HTMLDivElement>();
  private readonly toolCallContainers = new Map<string, HTMLDivElement>();
  private readonly toolInputBuffers = new Map<string, string>();
  private readonly toolInputOffsets = new Map<string, number>();
  private readonly toolOutputBuffers = new Map<string, string>();
  private readonly toolOutputOffsets = new Map<string, number>();
  private readonly toolOutputToolNames = new Map<string, string>();
  private readonly agentMessageElements = new Map<string, HTMLDivElement>();
  private readonly interactionElements = new Map<string, HTMLDivElement>();
  private readonly interactionByToolCall = new Map<string, string>();
  private readonly questionnaireToolCalls = new Set<string>();
  private readonly questionnaireRequests = new Map<string, QuestionnaireRequestEvent['payload']>();
  private readonly questionnaireReprompts = new Map<
    string,
    QuestionnaireRepromptEvent['payload']
  >();
  private readonly questionnaireResponses = new Map<string, InteractionResponseDraft>();
  private readonly standaloneToolCalls = new Set<string>();
  private readonly pendingInteractionToolCalls = new Set<string>();
  private readonly pendingInteractionRequests = new Map<
    string,
    { payload: InteractionRequestEvent['payload']; sessionId: string }
  >();
  private readonly pendingInteractionResponses = new Map<
    string,
    InteractionResponseEvent['payload']
  >();
  private readonly projectedTranscriptEvents = new Map<number, ProjectedTranscriptEvent>();
  private readonly attachmentExpansionStates = new WeakMap<HTMLDivElement, AttachmentExpansionState>();
  // Track text segment index per response.
  private readonly textSegmentIndex = new Map<string, number>();
  private readonly needsNewTextSegment = new Set<string>();
  private debugEnabled: boolean | null = null;
  private focusInputHandler: (() => void) | null = null;
  private requestDividerActionHandler:
    | ((options: {
        requestId: string;
        timestamp: number;
        anchorEl: HTMLElement;
        hasBefore: boolean;
        hasAfter: boolean;
      }) => void)
    | null;
  private readonly turnTimestampFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  private projectedTranscriptRevision: number | null = null;

  constructor(container: HTMLElement, options: ChatRendererOptions = {}) {
    this.container = container;
    this.options = options;
    this.requestDividerActionHandler = options.onRequestDividerActivate ?? null;
  }

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  private isDebugEnabled(): boolean {
    if (this.debugEnabled !== null) {
      return this.debugEnabled;
    }
    if (typeof window === 'undefined') {
      this.debugEnabled = false;
      return this.debugEnabled;
    }
    try {
      const stored = window.localStorage?.getItem('aiAssistantWsDebug');
      this.debugEnabled = stored === '1' || stored === 'true';
      return this.debugEnabled;
    } catch {
      this.debugEnabled = false;
      return this.debugEnabled;
    }
  }

  private debugLog(message: string, data: Record<string, unknown>): void {
    void message;
    void data;
  }

  private previewText(text: string | undefined): string {
    if (typeof text !== 'string') {
      return '';
    }
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
  }

  hasActiveOutput(): boolean {
    if (this.activeRequestIds.size > 0) {
      return true;
    }

    if (this._isStreaming) {
      return true;
    }

    for (const block of this.toolCallElements.values()) {
      const turnEl = block.closest<HTMLElement>('.turn');
      if (turnEl?.classList.contains('turn-complete')) {
        continue;
      }
      if (
        block.classList.contains('pending') ||
        block.classList.contains('streaming') ||
        block.classList.contains('streaming-input')
      ) {
        return true;
      }
    }

    return false;
  }

  markOutputCancelled(): void {
    this.interruptPendingToolBlocks();
  }

  private shouldExpandToolOutput(): boolean {
    return this.options.getExpandToolOutput?.() ?? false;
  }

  showTypingIndicator(): void {
    this.setTypingIndicatorVisible(true);
  }

  private setTypingIndicatorVisible(visible: boolean): void {
    this._isStreaming = visible;
    if (!visible) {
      if (this.typingIndicator) {
        this.typingIndicator.classList.remove('visible');
      }
      return;
    }
    if (!this.typingIndicator) {
      this.typingIndicator = document.createElement('div');
      this.typingIndicator.className = 'chat-typing-indicator';
      this.typingIndicator.innerHTML =
        '<span class="typing-indicator"><span></span><span></span><span></span></span>';
    }
    // Always move to end of container
    this.container.appendChild(this.typingIndicator);
    this.typingIndicator.classList.add('visible');
  }

  hideTypingIndicator(): void {
    this.setTypingIndicatorVisible(false);
  }

  private syncTypingIndicatorFromTurnState(): void {
    this.setTypingIndicatorVisible(this.activeRequestIds.size > 0);
  }

  renderProjectedEvent(event: ProjectedTranscriptEvent): void {
    if (
      event.chatEventType === 'tool_call' ||
      event.chatEventType === 'assistant_chunk' ||
      event.chatEventType === 'assistant_done' ||
      event.chatEventType === 'interaction_request' ||
      event.chatEventType === 'questionnaire_request'
    ) {
      this.debugLog('projected_event', {
        type: event.chatEventType,
        id: event.eventId,
        timestamp: event.timestamp,
        requestId: event.requestId,
        responseId: event.responseId ?? null,
        toolCallId: event.toolCallId ?? null,
        phase:
          event.chatEventType === 'assistant_chunk' || event.chatEventType === 'assistant_done'
            ? ((event.payload as { phase?: string }).phase ?? null)
            : null,
        textPreview:
          event.chatEventType === 'assistant_chunk' || event.chatEventType === 'assistant_done'
            ? this.previewText(
                typeof (event.payload as { text?: unknown }).text === 'string'
                  ? ((event.payload as { text: string }).text ?? '')
                  : '',
              )
            : null,
      });
    }

    const timestamp = Date.parse(event.timestamp);
    if (Number.isNaN(timestamp)) {
      return;
    }
    const projectedBase = {
      id: event.eventId,
      timestamp,
      sessionId: event.sessionId,
      turnId: event.requestId,
      chatEventType: event.chatEventType,
      ...(typeof event.responseId === 'string' && event.responseId.trim().length > 0
        ? { responseId: event.responseId }
        : {}),
    };

    switch (event.kind) {
      case 'request_start':
        this.handleTurnStart({
          ...projectedBase,
          payload: event.payload as { trigger?: string },
        });
        break;
      case 'request_end':
        this.handleTurnEnd({
          ...projectedBase,
          payload: event.payload as Record<string, unknown>,
        });
        break;
      case 'user_message':
        if (event.chatEventType === 'user_audio') {
          this.handleUserAudio({
            ...projectedBase,
            payload: event.payload as { transcription: string; durationMs: number },
          });
          break;
        }
        this.handleUserMessage({
          ...projectedBase,
          payload: event.payload as { text: string; fromAgentId?: string },
        });
        break;
      case 'assistant_message':
        if (event.chatEventType === 'assistant_chunk') {
          this.handleAssistantChunk({
            ...projectedBase,
            payload: event.payload as AssistantChunkEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'assistant_done') {
          this.handleAssistantDone({
            ...projectedBase,
            payload: event.payload as AssistantDoneEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'custom_message') {
          this.handleCustomMessage({
            ...projectedBase,
            payload: event.payload as { text?: string; label?: string },
          });
          break;
        }
        if (event.chatEventType === 'summary_message') {
          this.handleSummaryMessage({
            ...projectedBase,
            payload: event.payload as { text?: string; summaryType?: string },
          });
        }
        break;
      case 'thinking':
        if (event.chatEventType === 'thinking_done') {
          this.handleThinkingDone({
            ...projectedBase,
            payload: event.payload as ThinkingDoneEvent['payload'],
          });
          break;
        }
        this.handleThinkingChunk({
          ...projectedBase,
          payload: event.payload as ThinkingChunkEvent['payload'],
        });
        break;
      case 'tool_call':
        this.handleToolCall({
          ...projectedBase,
          payload: event.payload as { toolCallId: string; toolName: string; args?: Record<string, unknown> },
        });
        break;
      case 'tool_input':
        this.handleToolInputChunk({
          ...projectedBase,
          payload: event.payload as { toolCallId: string; toolName: string; chunk: string; offset: number },
        });
        break;
      case 'tool_output':
        this.handleToolOutputChunk({
          ...projectedBase,
          payload: event.payload as { toolCallId: string; toolName: string; chunk: string; offset: number },
        });
        break;
      case 'tool_result':
        this.handleToolResult({
          ...projectedBase,
          payload: event.payload as { toolCallId: string; result?: unknown; error?: { code: string; message: string } },
        });
        break;
      case 'interaction_request':
        if (event.chatEventType === 'questionnaire_request') {
          this.handleQuestionnaireRequest({
            ...projectedBase,
            payload: event.payload as QuestionnaireRequestEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'agent_message') {
          this.handleAgentMessage({
            ...projectedBase,
            payload: event.payload as Record<string, unknown>,
          });
          break;
        }
        this.handleInteractionRequest({
          ...projectedBase,
          payload: event.payload as InteractionRequestEvent['payload'],
        });
        break;
      case 'interaction_update':
        if (event.chatEventType === 'interaction_pending') {
          this.handleInteractionPending({
            ...projectedBase,
            payload: event.payload as InteractionPendingEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'questionnaire_reprompt') {
          this.handleQuestionnaireReprompt({
            ...projectedBase,
            payload: event.payload as QuestionnaireRepromptEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'questionnaire_update') {
          this.handleQuestionnaireUpdate({
            ...projectedBase,
            payload: event.payload as QuestionnaireUpdateEvent['payload'],
          });
        }
        break;
      case 'interaction_response':
        if (event.chatEventType === 'questionnaire_submission') {
          this.handleQuestionnaireSubmission({
            ...projectedBase,
            payload: event.payload as QuestionnaireSubmissionEvent['payload'],
          });
          break;
        }
        if (event.chatEventType === 'agent_callback') {
          this.handleAgentCallback({
            ...projectedBase,
            payload: event.payload as { messageId: string; fromAgentId: string; fromSessionId: string; result: string },
          });
          break;
        }
        this.handleInteractionResponse({
          ...projectedBase,
          payload: event.payload as InteractionResponseEvent['payload'],
        });
        break;
      case 'interrupt':
        this.handleInterrupt({
          ...projectedBase,
          payload: event.payload as { reason?: string },
        });
        break;
      case 'error':
        this.handleError({
          ...projectedBase,
          payload: event.payload as { code: string; message: string },
        });
        break;
    }
  }

  getHighestProjectedSequence(): number {
    let highest = -1;
    for (const sequence of this.projectedTranscriptEvents.keys()) {
      if (sequence > highest) {
        highest = sequence;
      }
    }
    return highest;
  }

  getProjectedTranscriptRevision(): number | null {
    return this.projectedTranscriptRevision;
  }

  private resetProjectedTranscriptState(): void {
    this.projectedTranscriptEvents.clear();
    this.projectedTranscriptRevision = null;
  }

  private resetRenderState(): void {
    this.container.innerHTML = '';
    this._isStreaming = false;
    this.turnElements.clear();
    this.responseElements.clear();
    this.assistantTextElements.clear();
    this.assistantTextBuffers.clear();
    this.assistantTextSegmentTokens.clear();
    this.thinkingElements.clear();
    this.thinkingTextBuffers.clear();
    this.toolCallElements.clear();
    this.toolCallContainers.clear();
    this.toolInputBuffers.clear();
    this.toolInputOffsets.clear();
    this.toolOutputBuffers.clear();
    this.toolOutputOffsets.clear();
    this.toolOutputToolNames.clear();
    this.agentMessageElements.clear();
    this.textSegmentIndex.clear();
    this.needsNewTextSegment.clear();
    this.interactionElements.clear();
    this.pendingInteractionRequests.clear();
    this.pendingInteractionResponses.clear();
    this.interactionByToolCall.clear();
    this.questionnaireToolCalls.clear();
    this.questionnaireRequests.clear();
    this.questionnaireReprompts.clear();
    this.questionnaireResponses.clear();
    this.standaloneToolCalls.clear();
    this.pendingInteractionToolCalls.clear();
    this.activeRequestIds.clear();
  }

  private renderStoredProjectedTranscript(): void {
    this.resetRenderState();
    this._isReplaying = true;
    const orderedEvents = [...this.projectedTranscriptEvents.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    for (const event of orderedEvents) {
      this.renderProjectedEvent(event);
    }
    this._isReplaying = false;
    this.syncTypingIndicatorFromTurnState();
  }

  replayProjectedEvents(
    events: ProjectedTranscriptEvent[],
    options: { reset?: boolean } = {},
  ): ProjectedTranscriptApplyResult {
    const normalized = dedupeProjectedTranscriptEvents(events);
    if (options.reset) {
      this.resetProjectedTranscriptState();
    }
    if (normalized.length === 0) {
      if (options.reset) {
        this.renderStoredProjectedTranscript();
      }
      return 'applied';
    }

    const revisions = Array.from(new Set(normalized.map((event) => event.revision))).sort(
      (left, right) => left - right,
    );
    if (revisions.length > 1) {
      return 'reload';
    }
    const incomingRevision = revisions[0] ?? null;
    if (incomingRevision === null) {
      return 'ignored';
    }
    if (
      this.projectedTranscriptRevision !== null &&
      incomingRevision < this.projectedTranscriptRevision
    ) {
      return 'ignored';
    }

    const revisionEvents = normalized;
    if (
      this.projectedTranscriptRevision === null ||
      incomingRevision > this.projectedTranscriptRevision ||
      options.reset
    ) {
      this.projectedTranscriptRevision = incomingRevision;
      this.projectedTranscriptEvents.clear();
      for (const event of revisionEvents) {
        this.projectedTranscriptEvents.set(event.sequence, event);
      }
      this.renderStoredProjectedTranscript();
      return 'applied';
    }

    const highestSequence = this.getHighestProjectedSequence();
    let expectedSequence = highestSequence + 1;
    let requiresReplay = false;
    let requiresRerender = false;
    const appendedEvents: ProjectedTranscriptEvent[] = [];

    for (const event of revisionEvents) {
      const existing = this.projectedTranscriptEvents.get(event.sequence);
      if (existing) {
        if (existing.eventId !== event.eventId) {
          this.projectedTranscriptEvents.set(event.sequence, event);
          requiresRerender = true;
        }
        continue;
      }
      this.projectedTranscriptEvents.set(event.sequence, event);
      if (!requiresReplay && event.sequence === expectedSequence) {
        appendedEvents.push(event);
        expectedSequence += 1;
        continue;
      }
      requiresReplay = true;
    }

    if (requiresReplay) {
      this.renderStoredProjectedTranscript();
      return 'reload';
    }

    if (requiresRerender) {
      this.renderStoredProjectedTranscript();
      return 'applied';
    }

    for (const event of appendedEvents) {
      this.renderProjectedEvent(event);
    }
    this.syncTypingIndicatorFromTurnState();
    return 'applied';
  }

  handleNewProjectedEvent(event: ProjectedTranscriptEvent): ProjectedTranscriptApplyResult {
    return this.replayProjectedEvents([event]);
  }

  clear(): void {
    this.resetRenderState();
    this.resetProjectedTranscriptState();
  }

  setFocusInputHandler(handler: (() => void) | null): void {
    this.focusInputHandler = handler;
  }

  setRequestDividerActionHandler(
    handler:
      | ((options: {
          requestId: string;
          timestamp: number;
          anchorEl: HTMLElement;
          hasBefore: boolean;
          hasAfter: boolean;
        }) => void)
      | null,
  ): void {
    this.requestDividerActionHandler = handler;
  }

  focusFirstQuestionnaireInput(): boolean {
    if (this.options.getShouldAutoFocusQuestionnaire?.() === false) {
      return false;
    }
    if (typeof document === 'undefined') {
      return false;
    }
    const active = document.activeElement;
    const panelRoot = this.container.closest('.chat-panel');
    if (active instanceof HTMLElement && panelRoot && !panelRoot.contains(active)) {
      return false;
    }
    if (active instanceof HTMLElement && active.closest('.interaction-questionnaire')) {
      return false;
    }
    const interactions = Array.from(
      this.container.querySelectorAll<HTMLDivElement>('.interaction-questionnaire'),
    ).filter((element) => !element.classList.contains('interaction-complete'));
    const target = interactions.length > 0 ? interactions[interactions.length - 1] : null;
    if (!target) {
      return false;
    }
    const input = target.querySelector<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
    );
    if (!input) {
      return false;
    }
    input.focus();
    return true;
  }

  private focusInputAfterInteraction(): void {
    if (this.options.getShouldRestoreFocusAfterInteraction?.() === false) {
      return;
    }
    this.focusInputHandler?.();
  }

  private handleTurnStart(event: RenderedTranscriptEvent<{ trigger?: string }>): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    this.getOrCreateTurnContainer(turnId, event.timestamp);
    this.activeRequestIds.add(turnId);
    if (!this._isReplaying) {
      this.syncTypingIndicatorFromTurnState();
    }
  }

  private handleTurnEnd(event: RenderedTranscriptEvent<Record<string, unknown>>): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.turnElements.get(turnId);
    if (turnEl) {
      turnEl.classList.add('turn-complete');
    }
    this.activeRequestIds.delete(turnId);
    if (!this._isReplaying) {
      this.syncTypingIndicatorFromTurnState();
    }
  }

  private handleUserMessage(
    event: RenderedTranscriptEvent<{ text: string; fromAgentId?: string }>,
  ): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);

    const text = this.getRenderableUserText(event);
    const bubble = appendMessage(turnEl, 'user', text);
    bubble.dataset['eventId'] = event.id;
    bubble.dataset['renderer'] = 'unified';
    const fromAgentId = event.payload.fromAgentId?.trim();
    if (fromAgentId) {
      const displayName =
        this.options.getAgentDisplayName?.(fromAgentId) ??
        fromAgentId
          .split(/[-_]/)
          .filter((part) => part.length > 0)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      decorateUserMessageAsAgent(bubble, displayName || fromAgentId);
    }

  }

  private handleUserAudio(
    event: RenderedTranscriptEvent<{ transcription: string; durationMs: number }>,
  ): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);

    const transcription = this.getRenderableUserText(event);
    const bubble = appendMessage(turnEl, 'user', transcription);
    bubble.classList.add('user-audio');
    bubble.dataset['inputType'] = 'audio';
    bubble.dataset['eventId'] = event.id;
    bubble.dataset['renderer'] = 'unified';
    const avatar = bubble.querySelector<HTMLDivElement>('.message-avatar');
    if (avatar) {
      avatar.classList.add('user-audio-avatar');
      avatar.replaceChildren(this.createVoiceEventIcon('microphone'));
      avatar.setAttribute('aria-hidden', 'true');
      avatar.title = 'Spoken message';
    }
    bubble.setAttribute('aria-label', 'Spoken user message');
  }

  private getRenderableUserText(
    event:
      | RenderedTranscriptEvent<{ text: string; fromAgentId?: string }>
      | RenderedTranscriptEvent<{ transcription: string; durationMs: number }>,
  ): string {
    const rawText =
      'transcription' in event.payload ? event.payload.transcription : event.payload.text;
    return stripContextLine(rawText);
  }

  private handleAssistantChunk(event: RenderedTranscriptEvent<AssistantChunkEvent['payload']>): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    const previousSegmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const previousToken = this.assistantTextSegmentTokens.get(responseId) ?? null;
    this.ensureAssistantTextSegment(responseId, event.payload.phase);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
      event.timestamp,
    );
    const textEl = this.getOrCreateAssistantTextElement(
      responseId,
      responseEl,
      event.payload.phase,
    );

    // Use segment-aware buffer key
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const bufferKey = `${responseId}:${segmentIdx}`;

    const previous = this.assistantTextBuffers.get(bufferKey) ?? '';
    const combined = previous + event.payload.text;
    this.assistantTextBuffers.set(bufferKey, combined);

    applyMarkdownToElement(textEl, combined);
    textEl.dataset['eventId'] = event.id;
    textEl.dataset['renderer'] = 'unified';

    this.debugLog('assistant_chunk_applied', {
      eventId: event.id,
      responseId,
      phase: event.payload.phase ?? null,
      previousSegmentIdx,
      nextSegmentIdx: segmentIdx,
      previousToken,
      nextToken: this.assistantTextSegmentTokens.get(responseId) ?? null,
      textLength: event.payload.text.length,
      textPreview: this.previewText(event.payload.text),
      combinedLength: combined.length,
      combinedPreview: this.previewText(combined),
    });
  }

  private handleAssistantDone(event: RenderedTranscriptEvent<AssistantDoneEvent['payload']>): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    const previousSegmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const previousToken = this.assistantTextSegmentTokens.get(responseId) ?? null;
    const currentBufferKey = `${responseId}:${previousSegmentIdx}`;
    const currentBuffer = this.assistantTextBuffers.get(currentBufferKey);
    const currentTextEl = this.assistantTextElements.get(currentBufferKey);
    const hasPendingSegmentBreak = this.needsNewTextSegment.has(responseId);
    const canFinalizeExistingSegment =
      !hasPendingSegmentBreak &&
      !!currentTextEl &&
      typeof currentBuffer === 'string' &&
      currentBuffer.length > 0 &&
      (event.payload.text === currentBuffer || event.payload.text.startsWith(currentBuffer));
    const canFinalizeClosedSegment =
      hasPendingSegmentBreak &&
      !!currentTextEl &&
      typeof currentBuffer === 'string' &&
      currentBuffer.length > 0 &&
      event.payload.text === currentBuffer;

    if ((canFinalizeExistingSegment || canFinalizeClosedSegment) && currentTextEl) {
      this.assistantTextBuffers.set(currentBufferKey, event.payload.text);
      applyMarkdownToElement(currentTextEl, event.payload.text);
      this.assistantTextBuffers.delete(currentBufferKey);
      this.assistantTextElements.delete(currentBufferKey);
      this.needsNewTextSegment.delete(responseId);
      this.assistantTextSegmentTokens.delete(responseId);
      if (event.payload.phase) {
        currentTextEl.dataset['phase'] = event.payload.phase;
      }
      currentTextEl.dataset['eventId'] = event.id;
      currentTextEl.dataset['renderer'] = 'unified';

      this.debugLog('assistant_done_finalize_existing_segment', {
        eventId: event.id,
        responseId,
        phase: event.payload.phase ?? null,
        segmentIdx: previousSegmentIdx,
        previousToken,
        textLength: event.payload.text.length,
        textPreview: this.previewText(event.payload.text),
      });
      return;
    }

    this.ensureAssistantTextSegment(responseId, event.payload.phase);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
      event.timestamp,
    );
    const textEl = this.getOrCreateAssistantTextElement(
      responseId,
      responseEl,
      event.payload.phase,
    );

    // Use segment-aware buffer key
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const bufferKey = `${responseId}:${segmentIdx}`;

    const text = event.payload.text;
    this.assistantTextBuffers.set(bufferKey, text);
    applyMarkdownToElement(textEl, text);
    this.assistantTextBuffers.delete(bufferKey);
    this.assistantTextElements.delete(bufferKey);
    textEl.dataset['eventId'] = event.id;
    textEl.dataset['renderer'] = 'unified';

    this.debugLog('assistant_done_applied', {
      eventId: event.id,
      responseId,
      phase: event.payload.phase ?? null,
      interrupted: event.payload.interrupted ?? false,
      previousSegmentIdx,
      nextSegmentIdx: segmentIdx,
      previousToken,
      nextToken: this.assistantTextSegmentTokens.get(responseId) ?? null,
      textLength: text.length,
      textPreview: this.previewText(text),
    });
  }

  private handleThinkingChunk(event: RenderedTranscriptEvent<ThinkingChunkEvent['payload']>): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
      event.timestamp,
    );
    const { segmentIdx, segmentKey } = this.getThinkingSegmentKey(responseId);
    const thinkingEl = this.getOrCreateThinkingElement(segmentKey, responseEl, segmentIdx);

    const previous = this.thinkingTextBuffers.get(segmentKey) ?? '';
    const combined = previous + event.payload.text;
    this.thinkingTextBuffers.set(segmentKey, combined);

    thinkingEl.textContent = combined;
    thinkingEl.dataset['eventId'] = event.id;
    thinkingEl.dataset['renderer'] = 'unified';
  }

  private handleThinkingDone(event: RenderedTranscriptEvent<ThinkingDoneEvent['payload']>): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
      event.timestamp,
    );
    const { segmentIdx, segmentKey } = this.getThinkingSegmentKey(responseId);
    const thinkingEl = this.getOrCreateThinkingElement(segmentKey, responseEl, segmentIdx);

    const text = event.payload.text;
    this.thinkingTextBuffers.set(segmentKey, text);
    thinkingEl.textContent = text;
    thinkingEl.dataset['eventId'] = event.id;
    thinkingEl.dataset['renderer'] = 'unified';
  }

  private renderInfoMessage(
    turnEl: HTMLElement,
    text: string,
    options: { className: string; label?: string; useMarkdown?: boolean },
  ): HTMLDivElement {
    clearEmptySessionHint(this.container);
    const wrapper = document.createElement('div');
    wrapper.className = `message ${options.className}`;

    const label = options.label?.trim();
    if (label) {
      const labelEl = document.createElement('div');
      labelEl.className = 'message-meta';
      labelEl.textContent = label;
      wrapper.appendChild(labelEl);
    }

    const body = document.createElement('div');
    body.className = 'message-body';
    if (options.useMarkdown) {
      applyMarkdownToElement(body, text);
    } else {
      body.textContent = text;
    }
    wrapper.appendChild(body);
    turnEl.appendChild(wrapper);
    return wrapper;
  }

  private handleCustomMessage(
    event: RenderedTranscriptEvent<{ text?: string; label?: string }>,
  ): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);
    const text = event.payload.text ?? '';
    const label = event.payload.label?.trim();
    const messageEl = this.renderInfoMessage(turnEl, text, {
      className: 'custom-message',
      ...(label ? { label } : {}),
      useMarkdown: true,
    });
    messageEl.dataset['eventId'] = event.id;
    messageEl.dataset['renderer'] = 'unified';
  }

  private handleSummaryMessage(
    event: RenderedTranscriptEvent<{ text?: string; summaryType?: string }>,
  ): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);
    const text = event.payload.text ?? '';
    const summaryType = event.payload.summaryType;
    const label =
      summaryType === 'compaction'
        ? 'Compaction summary'
        : summaryType === 'branch_summary'
          ? 'Branch summary'
          : 'Summary';
    const messageEl = this.renderInfoMessage(turnEl, text, {
      className: 'summary-message',
      label,
      useMarkdown: true,
    });
    if (summaryType) {
      messageEl.dataset['summaryType'] = summaryType;
    }
    messageEl.dataset['eventId'] = event.id;
    messageEl.dataset['renderer'] = 'unified';
  }

  private handleToolCall(
    event: RenderedTranscriptEvent<{
      toolCallId: string;
      toolName: string;
      args?: Record<string, unknown>;
    }>,
  ): void {
    const responseId = this.getResponseId(event.responseId);
    const callId = event.payload.toolCallId;
    const toolName = event.payload.toolName;
    const args = event.payload.args ?? {};
    const argsJson = (() => {
      try {
        return JSON.stringify(args);
      } catch {
        return '{}';
      }
    })();
    const isAgentMessageTool = toolName === 'agents_message';
    const agentArgs = isAgentMessageTool ? (args as Record<string, unknown>) : null;
    const agentId =
      isAgentMessageTool && typeof agentArgs?.['agentId'] === 'string'
        ? (agentArgs['agentId'] as string)
        : 'agent';
    const agentDisplayName =
      isAgentMessageTool && agentArgs
        ? (this.options.getAgentDisplayName?.(agentId) ??
          agentId.charAt(0).toUpperCase() + agentId.slice(1).toLowerCase() + ' Agent')
        : '';

    if (this.isVoiceToolName(toolName)) {
      let bubble = this.toolCallElements.get(callId) ?? null;
      if (!bubble) {
        const responseEl = this.getOrCreateToolCallContainer(
          event.id,
          event.turnId,
          callId,
          responseId,
          event.timestamp,
        );
        bubble = this.createVoiceToolBubble(callId, toolName);
        bubble.dataset['eventId'] = event.id;
        bubble.dataset['renderer'] = 'unified';
        const toolCallsContainer = this.getOrCreateToolCallsContainer(
          responseEl,
          responseId ?? undefined,
        );
        toolCallsContainer.appendChild(bubble);
        this.toolCallElements.set(callId, bubble);
        if (responseId) {
          this.markTextSegmentBreak(responseId);
        }
      }

      this.updateVoiceToolBubble(bubble, toolName, this.getVoiceToolText(args));
      this.toolInputBuffers.delete(callId);
      this.toolInputOffsets.delete(callId);
      return;
    }

    if (this.isAttachmentToolName(toolName)) {
      const bubble = this.getOrCreateAttachmentToolBubble({
        eventId: event.id,
        turnId: event.turnId,
        callId,
        responseId,
        timestamp: event.timestamp,
      });

      this.updatePendingAttachmentToolBubble(bubble, this.getPendingAttachmentSummary(args));
      this.toolInputBuffers.delete(callId);
      this.toolInputOffsets.delete(callId);
      return;
    }

    // Check if block was already created by tool_input_chunk streaming
    let block = this.toolCallElements.get(callId);
    const existingBlock = !!block;

    if (block) {
      // Block exists from streaming - update it with final args
      block.classList.remove('streaming-input');
      if (isAgentMessageTool) {
        const titleEl = block.querySelector<HTMLElement>('.tool-output-title');
        if (titleEl && agentDisplayName) {
          titleEl.textContent = agentDisplayName;
        }
        block.classList.add('agent-message-exchange');
        block.dataset['toolName'] = 'agents_message';
        setToolOutputBlockPending(block, argsJson, {
          pendingText: 'Sending…',
          statusLabel: 'Sending',
          state: 'running',
          outputLabel: 'Received',
        });
      } else {
        // Update the input with final args
        setToolOutputBlockInput(block, argsJson);
        // Update header label with final args
        const headerLabel = extractToolCallLabel(toolName, argsJson);
        if (headerLabel) {
          updateToolOutputBlockLabel(block, headerLabel);
        }
      }
    } else {
      // Create new block
      const responseEl = this.getOrCreateToolCallContainer(
        event.id,
        event.turnId,
        callId,
        responseId,
        event.timestamp,
      );

      // Use styled agent block for agents_message
      if (isAgentMessageTool) {
        const displayName = agentDisplayName || 'Agent';
        block = createToolOutputBlock({
          callId,
          toolName: displayName,
          expanded: this.shouldExpandToolOutput(),
        });
        block.classList.add('agent-message-exchange', 'pending');
        block.dataset['toolName'] = 'agents_message';
        // Show sending status in the result section
        setToolOutputBlockPending(block, argsJson, {
          pendingText: 'Sending…',
          statusLabel: 'Sending',
          state: 'running',
          outputLabel: 'Received',
        });
      } else {
        const headerLabel = extractToolCallLabel(toolName, argsJson);
        block = createToolOutputBlock({
          callId,
          toolName,
          expanded: this.shouldExpandToolOutput(),
          ...(headerLabel ? { headerLabel } : {}),
        });
        setToolOutputBlockPending(block, argsJson, { state: 'running' });
      }

      block.dataset['toolCallId'] = callId;
      block.dataset['toolName'] = toolName;
      block.dataset['eventId'] = event.id;
      block.dataset['renderer'] = 'unified';

      this.appendToolCallBlock(responseEl, responseId ?? undefined, block, toolName);
      this.toolCallElements.set(callId, block);
    }

    // Clean up tool input streaming state (args are now complete)
    this.toolInputBuffers.delete(callId);
    this.toolInputOffsets.delete(callId);

    const bufferedOutput = this.toolOutputBuffers.get(callId);
    if (block && bufferedOutput) {
      const bufferedToolName = this.toolOutputToolNames.get(callId);
      const displayToolName = this.getDisplayToolNameForOutput(block, bufferedToolName);
      updateToolOutputBlockContent(block, displayToolName, bufferedOutput, {
        streaming: true,
        state: 'running',
      });
    }

    if (block) {
      this.updateToolCallGroupForBlock(block);
    }

    if (block) {
      const pendingInteraction = this.pendingInteractionRequests.get(callId);
      if (pendingInteraction) {
        this.pendingInteractionRequests.delete(callId);
        if (pendingInteraction.payload.interactionType === 'approval') {
          this.standaloneToolCalls.add(callId);
          this.ungroupToolBlockIfNeeded(callId);
        }
        const enabled = this.options.getInteractionEnabled?.() ?? true;
        this.attachInteractionToToolBlock(
          block,
          pendingInteraction.payload,
          enabled,
          pendingInteraction.sessionId,
        );
        const pendingResponse = this.pendingInteractionResponses.get(
          pendingInteraction.payload.interactionId,
        );
        if (pendingResponse) {
          this.pendingInteractionResponses.delete(pendingInteraction.payload.interactionId);
          const element = this.interactionElements.get(pendingInteraction.payload.interactionId);
          if (element) {
            applyInteractionResponse(element, pendingResponse);
          }
        }
      }
    }

    // Mark text segment break so any text after this tool goes into a new element
    // (only if we created a new block - streaming blocks already handled)
    if (responseId && !existingBlock) {
      this.markTextSegmentBreak(responseId);
    }
  }

  private handleToolInputChunk(
    event: RenderedTranscriptEvent<{
      toolCallId: string;
      toolName: string;
      chunk: string;
      offset: number;
    }>,
  ): void {
    const callId = event.payload.toolCallId;
    const chunk = event.payload.chunk;
    const offset = event.payload.offset;
    const toolName = event.payload.toolName;

    // Dedup: ignore if we've already processed up to this offset
    const lastOffset = this.toolInputOffsets.get(callId) ?? 0;
    if (offset <= lastOffset) {
      return;
    }
    this.toolInputOffsets.set(callId, offset);

    // Accumulate input
    const currentBuffer = this.toolInputBuffers.get(callId) ?? '';
    const newBuffer = currentBuffer + chunk;
    this.toolInputBuffers.set(callId, newBuffer);

    if (this.isVoiceToolName(toolName)) {
      let bubble = this.toolCallElements.get(callId) ?? null;
      if (!bubble) {
        const responseId = this.getResponseId(event.responseId);
        const responseEl = this.getOrCreateToolCallContainer(
          event.id,
          event.turnId,
          callId,
          responseId,
          event.timestamp,
        );
        bubble = this.createVoiceToolBubble(callId, toolName);
        bubble.dataset['eventId'] = event.id;
        bubble.dataset['renderer'] = 'unified';
        const toolCallsContainer = this.getOrCreateToolCallsContainer(
          responseEl,
          responseId ?? undefined,
        );
        toolCallsContainer.appendChild(bubble);
        this.toolCallElements.set(callId, bubble);
        if (responseId) {
          this.markTextSegmentBreak(responseId);
        }
      }
      const parsedText = this.getVoiceToolTextFromArgsJson(newBuffer);
      if (parsedText !== null) {
        this.updateVoiceToolBubble(bubble, toolName, parsedText);
      }
      return;
    }

    if (this.isAttachmentToolName(toolName)) {
      const responseId = this.getResponseId(event.responseId);
      const bubble = this.getOrCreateAttachmentToolBubble({
        eventId: event.id,
        turnId: event.turnId,
        callId,
        responseId,
        timestamp: event.timestamp,
      });
      const pendingSummary = this.getPendingAttachmentSummaryFromArgsJson(newBuffer);
      if (pendingSummary) {
        this.updatePendingAttachmentToolBubble(bubble, pendingSummary);
      }
      return;
    }

    // Get or create the tool block
    let block = this.toolCallElements.get(callId);
    if (!block) {
      // Create the block early so we can show streaming input
      const responseId = this.getResponseId(event.responseId);
      const responseEl = this.getOrCreateToolCallContainer(
        event.id,
        event.turnId,
        callId,
        responseId,
        event.timestamp,
      );

      const headerLabel = extractToolCallLabel(toolName, '');
      block = createToolOutputBlock({
        callId,
        toolName,
        expanded: this.shouldExpandToolOutput(),
        ...(headerLabel ? { headerLabel } : {}),
      });
      block.dataset['toolCallId'] = callId;
      block.dataset['toolName'] = toolName;
      block.dataset['eventId'] = event.id;
      block.dataset['renderer'] = 'unified';
      block.classList.add('streaming-input');

      this.appendToolCallBlock(responseEl, responseId ?? undefined, block, toolName);
      this.toolCallElements.set(callId, block);

      // Show initial pending state
      setToolOutputBlockPending(block, '', { state: 'running' });

      // Mark text segment break for the next assistant text
      if (responseId) {
        this.markTextSegmentBreak(responseId);
      }
    }

    // Update the input section with streaming args
    updateToolOutputBlockStreamingInput(block, newBuffer);
    const headerLabel = extractToolCallLabel(toolName, newBuffer);
    if (headerLabel) {
      updateToolOutputBlockLabel(block, headerLabel);
    }

    this.updateToolCallGroupForBlock(block);
  }

  private handleToolOutputChunk(
    event: RenderedTranscriptEvent<{
      toolCallId: string;
      toolName: string;
      chunk: string;
      offset: number;
    }>,
  ): void {
    const callId = event.payload.toolCallId;
    const chunk = event.payload.chunk;
    const offset = event.payload.offset;
    const eventToolName = event.payload.toolName;

    // Dedup: ignore if we've already processed up to this offset
    const lastOffset = this.toolOutputOffsets.get(callId) ?? 0;
    if (offset <= lastOffset) {
      return;
    }
    this.toolOutputOffsets.set(callId, offset);
    this.toolOutputToolNames.set(callId, eventToolName);

    // Accumulate output
    const currentBuffer = this.toolOutputBuffers.get(callId) ?? '';
    const newBuffer = currentBuffer + chunk;
    this.toolOutputBuffers.set(callId, newBuffer);

    // Update the tool block if it exists
    const block = this.toolCallElements.get(callId);
    if (!block) {
      // Tool block not yet created - buffer will be used when it arrives
      return;
    }
    if (
      this.isVoiceToolName(block.dataset['toolName'] ?? '') ||
      this.isAttachmentToolName(block.dataset['toolName'] ?? '')
    ) {
      return;
    }

    const displayToolName = this.getDisplayToolNameForOutput(block, eventToolName);

    // Update with streaming content, mark as still pending
    updateToolOutputBlockContent(block, displayToolName, newBuffer, {
      streaming: true,
      state: 'running',
    });

    this.updateToolCallGroupForBlock(block);
  }

  private handleToolResult(
    event: RenderedTranscriptEvent<{
      toolCallId: string;
      result?: unknown;
      error?: { code: string; message: string };
    }>,
  ): void {
    const callId = event.payload.toolCallId;
    const responseId = this.getResponseId(event.responseId);

    // Clean up streaming state
    this.toolOutputBuffers.delete(callId);
    this.toolOutputOffsets.delete(callId);
    this.toolOutputToolNames.delete(callId);

    // Prefer existing tool-call element; if missing, create a minimal one.
    let block = this.toolCallElements.get(callId) ?? null;
    const existingToolName = block?.dataset['toolName'] ?? '';
    if (block && this.isVoiceToolName(existingToolName)) {
      if (event.payload.error) {
        const message = event.payload.error.message;
        this.updateVoiceToolBubbleError(block, message);
        this.finalizeInteractionForFailedToolCall(callId, message);
      } else {
        this.finalizeVoiceToolBubble(block);
      }
      return;
    }
    if (block && this.isAttachmentToolName(existingToolName)) {
      if (event.payload.error) {
        this.updateAttachmentToolBubbleError(block, event.payload.error.message);
      } else {
        const attachmentResult = getAttachmentToolResult(event.payload.result);
        if (attachmentResult) {
          this.renderAttachmentToolBubble(block, attachmentResult.attachment);
        } else {
          this.updateAttachmentToolBubbleError(block, 'Attachment result payload was invalid.');
        }
      }
      return;
    }
    if (!block) {
      if (this.questionnaireToolCalls.has(callId)) {
        return;
      }
      const attachmentResult = getAttachmentToolResult(event.payload.result);
      if (attachmentResult) {
        block = this.getOrCreateAttachmentToolBubble({
          eventId: event.id,
          turnId: event.turnId,
          callId,
          responseId,
          timestamp: event.timestamp,
        });
        this.renderAttachmentToolBubble(block, attachmentResult.attachment);
        return;
      }
      const responseEl = this.getOrCreateToolCallContainer(
        event.id,
        event.turnId,
        callId,
        responseId,
        event.timestamp,
      );

      block = createToolOutputBlock({
        callId,
        toolName: event.payload.toolCallId,
        expanded: this.shouldExpandToolOutput(),
      });
      block.dataset['toolCallId'] = callId;
      block.dataset['eventId'] = event.id;
      block.dataset['renderer'] = 'unified';
      this.appendToolCallBlock(
        responseEl,
        responseId ?? undefined,
        block,
        block.dataset['toolName'] ?? '',
      );
      this.toolCallElements.set(callId, block);

      if (responseId) {
        this.markTextSegmentBreak(responseId);
      }
    }

    if (!block) {
      return;
    }

    // Ensure the input section is populated if we have args stored on the event.
    const storedArgsJson = block.dataset['argsJson'];
    if (!storedArgsJson && event.payload.result && typeof event.payload.result === 'object') {
      const anyResult = event.payload.result as Record<string, unknown>;
      const args =
        typeof anyResult['args'] === 'string'
          ? (anyResult['args'] as string)
          : JSON.stringify(anyResult['args'] ?? {});
      setToolOutputBlockInput(block, args);
    }

    const toolName = block.dataset['toolName'] ?? 'tool';
    if (event.payload.error) {
      const message = event.payload.error.message;
      updateToolOutputBlockContent(block, toolName, message, { ok: false });
      this.finalizeInteractionForFailedToolCall(callId, message);
      this.updateToolCallGroupForBlock(block);
      return;
    }

    const result = event.payload.result;
    const isAgentMessage = toolName === 'agents_message';

    let handledAgentAsync = false;
    if (isAgentMessage && typeof result === 'object' && result !== null) {
      const resultObj = result as Record<string, unknown>;
      const mode = typeof resultObj['mode'] === 'string' ? resultObj['mode'] : undefined;
      const statusValue =
        typeof resultObj['status'] === 'string' ? (resultObj['status'] as string) : undefined;
      const isQueued = statusValue === 'queued';
      const isWaiting = mode === 'async' && (statusValue === 'started' || statusValue === 'queued');

      if (isQueued || isWaiting) {
        let rawJson: string | undefined;
        try {
          rawJson = JSON.stringify(result, null, 2);
        } catch {
          rawJson = undefined;
        }
        const waitingStatus: Parameters<typeof updateToolOutputBlockContent>[3] = {
          outputLabel: 'Received',
          state: isQueued ? 'queued' : 'waiting',
          statusLabel: isQueued ? 'Queued' : 'Waiting',
          pendingText: isQueued ? 'Queued — waiting for availability…' : 'Waiting for response…',
          ...(rawJson ? { rawJson } : {}),
        };
        updateToolOutputBlockContent(block, toolName, 'Waiting for response…', waitingStatus);
        handledAgentAsync = true;
      } else if (mode === 'async' && typeof resultObj['response'] === 'string') {
        // Fallback: async mode with response text already included
        updateToolOutputBlockContent(block, toolName, resultObj['response'], {
          ok: true,
          outputLabel: 'Received',
          state: 'complete',
        });
        handledAgentAsync = true;
      }
    }

    // Extract display text and optional raw JSON for toggle
    let text = '';
    let rawJson: string | undefined;
    let resultOk = true;

    if (!handledAgentAsync) {
      if (typeof result === 'object' && result !== null) {
        const resultObj = result as Record<string, unknown>;
        if (typeof resultObj['ok'] === 'boolean') {
          resultOk = resultObj['ok'] !== false;
        }
        try {
          rawJson = JSON.stringify(result, null, 2);
        } catch {
          rawJson = undefined;
        }
      }

      text = formatToolResultText({
        toolName,
        ok: resultOk,
        result,
      });

      if (!rawJson && typeof result === 'object' && result !== null) {
        try {
          rawJson = JSON.stringify(result);
        } catch {
          // Ignore serialization errors
        }
      }
    }

    if (!handledAgentAsync) {
      updateToolOutputBlockContent(block, toolName, text, {
        ok: resultOk,
        ...(isAgentMessage ? { outputLabel: 'Received' } : {}),
        ...(rawJson ? { rawJson } : {}),
        state: resultOk ? 'complete' : 'error',
      });
    }

    if (!handledAgentAsync && !resultOk) {
      this.finalizeInteractionForFailedToolCall(callId);
    }

    // For agents_message async mode, track the block for agent_callback updates
    if (
      typeof result === 'object' &&
      result !== null &&
      'messageId' in result &&
      typeof (result as Record<string, unknown>)['messageId'] === 'string' &&
      'mode' in result &&
      (result as Record<string, unknown>)['mode'] === 'async'
    ) {
      const messageId = (result as Record<string, unknown>)['messageId'] as string;
      this.agentMessageElements.set(messageId, block);
      block.dataset['messageId'] = messageId;
      // Store the intermediate tool result for the JSON toggle
      try {
        block.dataset['toolResultJson'] = JSON.stringify(result, null, 2);
      } catch {
        // Ignore serialization errors
      }
    }

    this.updateToolCallGroupForBlock(block);
  }

  private handleInteractionRequest(
    event: RenderedTranscriptEvent<InteractionRequestEvent['payload']>,
  ): void {
    const payload = event.payload;
    const interactionId = payload.interactionId;
    const toolCallId = payload.toolCallId;
    const enabled = this.options.getInteractionEnabled?.() ?? true;
    const presentation = payload.presentation ?? 'tool';

    if (presentation === 'questionnaire') {
      this.questionnaireToolCalls.add(toolCallId);
      this.standaloneToolCalls.add(toolCallId);
      this.renderStandaloneInteraction(event, enabled);
      return;
    }

    if (payload.interactionType === 'approval') {
      this.standaloneToolCalls.add(toolCallId);
      this.ungroupToolBlockIfNeeded(toolCallId);
    }

    let block = this.toolCallElements.get(toolCallId);
    if (!block) {
      if (this._isReplaying) {
        block = this.createToolBlockForInteraction(event) ?? undefined;
      }
      if (block) {
        this.toolCallElements.set(toolCallId, block);
      }
    }
    if (!block) {
      this.pendingInteractionRequests.set(toolCallId, {
        payload,
        sessionId: event.sessionId,
      });
      return;
    }

    this.attachInteractionToToolBlock(block, payload, enabled, event.sessionId);

    const pendingResponse = this.pendingInteractionResponses.get(interactionId);
    if (pendingResponse) {
      this.pendingInteractionResponses.delete(interactionId);
      const element = this.interactionElements.get(interactionId);
      if (element) {
        applyInteractionResponse(element, pendingResponse);
        const toolBlock = element.closest<HTMLDivElement>('.tool-output-block');
        if (toolBlock) {
          this.updateToolInteractionState(toolBlock);
        }
      }
    }
  }

  private handleInteractionResponse(
    event: RenderedTranscriptEvent<InteractionResponseEvent['payload']>,
  ): void {
    const payload = event.payload;
    const interactionId = payload.interactionId;
    const element = this.interactionElements.get(interactionId);
    if (element) {
      applyInteractionResponse(element, payload);
      const toolBlock = element.closest<HTMLDivElement>('.tool-output-block');
      if (toolBlock) {
        this.updateToolInteractionState(toolBlock);
      }
      return;
    }
    this.pendingInteractionResponses.set(interactionId, payload);
  }

  private handleInteractionPending(
    event: RenderedTranscriptEvent<InteractionPendingEvent['payload']>,
  ): void {
    if (this._isReplaying) {
      return;
    }
    const payload = event.payload;
    if (payload.pending) {
      this.pendingInteractionToolCalls.add(payload.toolCallId);
    } else {
      this.pendingInteractionToolCalls.delete(payload.toolCallId);
    }
  }

  private handleQuestionnaireRequest(
    event: RenderedTranscriptEvent<QuestionnaireRequestEvent['payload']>,
  ): void {
    const payload = event.payload;
    this.questionnaireRequests.set(payload.questionnaireRequestId, payload);
    this.questionnaireToolCalls.add(payload.toolCallId);
    this.standaloneToolCalls.add(payload.toolCallId);
    const completion = this.questionnaireResponses.get(payload.questionnaireRequestId);
    const reprompt = completion
      ? undefined
      : this.questionnaireReprompts.get(payload.questionnaireRequestId);
    const enabled = this.options.getInteractionEnabled?.() ?? true;
    this.renderStandaloneQuestionnaire({
      request: payload,
      ...(reprompt ? { reprompt } : {}),
      enabled: completion ? false : enabled,
      sessionId: event.sessionId,
      eventId: event.id,
      turnId: event.turnId,
      responseId: event.responseId,
      timestamp: event.timestamp,
    });
    if (completion) {
      this.applyQuestionnaireResponse(payload.questionnaireRequestId, completion);
    }
  }

  private handleQuestionnaireReprompt(
    event: RenderedTranscriptEvent<QuestionnaireRepromptEvent['payload']>,
  ): void {
    this.questionnaireReprompts.set(event.payload.questionnaireRequestId, event.payload);
    if (this.questionnaireResponses.has(event.payload.questionnaireRequestId)) {
      return;
    }
    const request = this.questionnaireRequests.get(event.payload.questionnaireRequestId);
    if (!request) {
      return;
    }
    const enabled = this.options.getInteractionEnabled?.() ?? true;
    this.renderStandaloneQuestionnaire({
      request,
      reprompt: event.payload,
      enabled,
      sessionId: event.sessionId,
      eventId: event.id,
      turnId: event.turnId,
      responseId: event.responseId,
      timestamp: event.timestamp,
    });
  }

  private handleQuestionnaireSubmission(
    event: RenderedTranscriptEvent<QuestionnaireSubmissionEvent['payload']>,
  ): void {
    const response: InteractionResponseDraft = {
      action: 'submit',
      input: event.payload.answers,
    };
    this.questionnaireResponses.set(event.payload.questionnaireRequestId, response);
    const element = this.interactionElements.get(event.payload.questionnaireRequestId);
    const request = this.questionnaireRequests.get(event.payload.questionnaireRequestId);
    if (!element && request) {
      this.renderStandaloneQuestionnaire({
        request,
        enabled: false,
        sessionId: event.sessionId,
        eventId: event.id,
        turnId: event.turnId,
        responseId: event.responseId,
        timestamp: event.timestamp,
      });
    }
    this.applyQuestionnaireResponse(event.payload.questionnaireRequestId, response, {
      toolCallId: event.payload.toolCallId,
    });
  }

  private handleQuestionnaireUpdate(
    event: RenderedTranscriptEvent<QuestionnaireUpdateEvent['payload']>,
  ): void {
    const response: InteractionResponseDraft = {
      action: 'cancel',
      ...(event.payload.reason ? { reason: event.payload.reason } : {}),
    };
    this.questionnaireResponses.set(event.payload.questionnaireRequestId, response);
    const element = this.interactionElements.get(event.payload.questionnaireRequestId);
    const request = this.questionnaireRequests.get(event.payload.questionnaireRequestId);
    if (!element && request) {
      this.renderStandaloneQuestionnaire({
        request,
        enabled: false,
        sessionId: event.sessionId,
        eventId: event.id,
        turnId: event.turnId,
        responseId: event.responseId,
        timestamp: event.timestamp,
      });
    }
    this.applyQuestionnaireResponse(event.payload.questionnaireRequestId, response, {
      toolCallId: event.payload.toolCallId,
    });
  }

  private applyQuestionnaireResponse(
    questionnaireRequestId: string,
    response: InteractionResponseDraft,
    overrides?: { toolCallId?: string },
  ): void {
    const element = this.interactionElements.get(questionnaireRequestId);
    if (!element) {
      return;
    }
    const toolCallId =
      overrides?.toolCallId ??
      this.questionnaireRequests.get(questionnaireRequestId)?.toolCallId ??
      '';
    applyInteractionResponse(element, {
      toolCallId,
      interactionId: questionnaireRequestId,
      ...response,
    });
    if (response.action === 'submit' || response.action === 'cancel') {
      this.questionnaireRequests.delete(questionnaireRequestId);
      this.questionnaireReprompts.delete(questionnaireRequestId);
      this.questionnaireResponses.delete(questionnaireRequestId);
    }
  }

  private attachInteractionToToolBlock(
    block: HTMLDivElement,
    payload: InteractionRequestEvent['payload'],
    enabled: boolean,
    sessionId: string,
  ): void {
    const outputSection = block.querySelector<HTMLDivElement>('.tool-output-result');
    if (!outputSection) {
      return;
    }

    const existingId =
      block.dataset['interactionId'] ?? this.interactionByToolCall.get(payload.toolCallId);
    if (existingId) {
      const existing = this.interactionElements.get(existingId);
      if (existing) {
        existing.remove();
        this.interactionElements.delete(existingId);
      }
    }

    const element = createInteractionElement({
      request: payload,
      enabled,
      onSubmit: (response) => {
        this.sendInteractionResponse(payload, response, sessionId);
        if (
          payload.presentation === 'questionnaire' &&
          payload.interactionType === 'input' &&
          (response.action === 'submit' || response.action === 'cancel')
        ) {
          this.focusInputAfterInteraction();
        }
      },
    });
    element.classList.add('tool-interaction');
    block.dataset['interactionId'] = payload.interactionId;
    element.dataset['sessionId'] = sessionId;
    this.interactionByToolCall.set(payload.toolCallId, payload.interactionId);

    if (payload.interactionType === 'approval') {
      const dock = this.getOrCreateInteractionDock(block);
      dock.innerHTML = '';
      dock.appendChild(element);
    } else {
      outputSection.insertBefore(element, outputSection.firstChild);
    }
    this.interactionElements.set(payload.interactionId, element);
    this.updateToolInteractionState(block);
  }

  private createToolBlockForInteraction(
    event: RenderedTranscriptEvent<InteractionRequestEvent['payload']>,
  ): HTMLDivElement | null {
    const payload = event.payload;
    const responseId = this.getResponseId(event.responseId);
    const responseEl = this.getOrCreateToolCallContainer(
      event.id,
      event.turnId,
      payload.toolCallId,
      responseId,
      event.timestamp,
    );
    const block = createToolOutputBlock({
      callId: payload.toolCallId,
      toolName: payload.toolName,
      expanded: this.shouldExpandToolOutput(),
    });

    block.dataset['toolCallId'] = payload.toolCallId;
    block.dataset['toolName'] = payload.toolName;
    block.dataset['eventId'] = event.id;
    block.dataset['renderer'] = 'unified';

    setToolOutputBlockPending(block, '{}', {
      pendingText: 'Awaiting approval…',
      statusLabel: 'Approval',
      state: 'running',
    });

    this.appendToolCallBlock(responseEl, responseId ?? undefined, block, payload.toolName);
    this.updateToolCallGroupForBlock(block);
    return block;
  }

  private renderStandaloneInteraction(
    event: RenderedTranscriptEvent<InteractionRequestEvent['payload']>,
    enabled: boolean,
  ): void {
    const payload = event.payload;
    this.ungroupToolBlockIfNeeded(payload.toolCallId);
    const responseId = this.getResponseId(event.responseId);
    const existingId = this.interactionByToolCall.get(payload.toolCallId);
    if (existingId) {
      const existing = this.interactionElements.get(existingId);
      if (existing) {
        existing.remove();
      }
      this.interactionElements.delete(existingId);
    }
    const element = createInteractionElement({
      request: payload,
      enabled,
      onSubmit: (response) => {
        this.sendInteractionResponse(payload, response, event.sessionId);
        if (
          payload.presentation === 'questionnaire' &&
          payload.interactionType === 'input' &&
          (response.action === 'submit' || response.action === 'cancel')
        ) {
          this.focusInputAfterInteraction();
        }
      },
    });
    element.classList.add('interaction-standalone');
    element.dataset['sessionId'] = event.sessionId;
    const toolBlock = this.toolCallElements.get(payload.toolCallId);
    this.debugLog('interaction placement', {
      interactionId: payload.interactionId,
      toolCallId: payload.toolCallId,
      responseId: responseId ?? null,
      hasToolBlock: Boolean(toolBlock),
    });
    if (toolBlock?.parentElement) {
      const nextSibling = toolBlock.nextSibling;
      if (nextSibling) {
        toolBlock.parentElement.insertBefore(element, nextSibling);
      } else {
        toolBlock.parentElement.appendChild(element);
      }
    } else {
      const fallbackContainer = toolBlock?.closest<HTMLDivElement>('.assistant-response');
      const container = responseId
        ? this.getOrCreateAssistantResponseContainer(
            event.turnId,
            event.id,
            responseId,
            event.timestamp,
          )
        : (fallbackContainer ??
          this.getOrCreateToolCallContainer(
            event.id,
            event.turnId,
            payload.toolCallId,
            responseId,
            event.timestamp,
          ));
      container.appendChild(element);
    }
    this.interactionElements.set(payload.interactionId, element);
    this.interactionByToolCall.set(payload.toolCallId, payload.interactionId);

    const pendingResponse = this.pendingInteractionResponses.get(payload.interactionId);
    if (pendingResponse) {
      this.pendingInteractionResponses.delete(payload.interactionId);
      applyInteractionResponse(element, pendingResponse);
    }
    if (enabled) {
      this.focusFirstQuestionnaireInput();
    }
  }

  private buildQuestionnaireView(
    request: QuestionnaireRequestEvent['payload'],
    reprompt?: QuestionnaireRepromptEvent['payload'],
  ): QuestionnaireRequestView {
    const initialValues = reprompt
      ? {
          ...(request.schema.initialValues ?? {}),
          ...reprompt.initialValues,
        }
      : request.schema.initialValues;
    return {
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(reprompt?.errorSummary ? { errorSummary: reprompt.errorSummary } : {}),
      ...(reprompt?.fieldErrors ? { fieldErrors: reprompt.fieldErrors } : {}),
      inputSchema: {
        ...request.schema,
        ...(initialValues ? { initialValues } : {}),
      },
    };
  }

  private renderStandaloneQuestionnaire(options: {
    request: QuestionnaireRequestEvent['payload'];
    reprompt?: QuestionnaireRepromptEvent['payload'];
    enabled: boolean;
    sessionId: string;
    eventId: string;
    turnId: string | undefined;
    responseId: string | undefined;
    timestamp: number;
  }): void {
    const { request, reprompt, enabled, sessionId, eventId, turnId, responseId, timestamp } =
      options;
    const questionnaireRequestId = request.questionnaireRequestId;
    this.ungroupToolBlockIfNeeded(request.toolCallId);

    const existingId = this.interactionByToolCall.get(request.toolCallId);
    if (existingId) {
      const existing = this.interactionElements.get(existingId);
      if (existing) {
        existing.remove();
      }
      this.interactionElements.delete(existingId);
    }

    const element = createQuestionnaireElement({
      request: this.buildQuestionnaireView(request, reprompt),
      enabled,
      onSubmit: (response) => {
        if (response.action === 'submit') {
          this.sendQuestionnaireSubmit(sessionId, questionnaireRequestId, response.input ?? {});
        } else if (response.action === 'cancel') {
          this.sendQuestionnaireCancel(sessionId, questionnaireRequestId);
        }
        this.focusInputAfterInteraction();
      },
    });
    element.classList.add('interaction-standalone');
    element.dataset['interactionId'] = questionnaireRequestId;
    element.dataset['questionnaireRequestId'] = questionnaireRequestId;
    element.dataset['sessionId'] = sessionId;
    const toolBlock = this.toolCallElements.get(request.toolCallId);
    this.debugLog('questionnaire placement', {
      questionnaireRequestId,
      toolCallId: request.toolCallId,
      responseId: responseId ?? null,
      hasToolBlock: Boolean(toolBlock),
    });
    if (toolBlock?.parentElement) {
      const nextSibling = toolBlock.nextSibling;
      if (nextSibling) {
        toolBlock.parentElement.insertBefore(element, nextSibling);
      } else {
        toolBlock.parentElement.appendChild(element);
      }
    } else {
      const fallbackContainer = toolBlock?.closest<HTMLDivElement>('.assistant-response');
      const container = responseId
        ? this.getOrCreateAssistantResponseContainer(turnId, eventId, responseId ?? null, timestamp)
        : (fallbackContainer ??
          this.getOrCreateToolCallContainer(
            eventId,
            turnId,
            request.toolCallId,
            responseId ?? null,
            timestamp,
          ));
      container.appendChild(element);
    }
    this.interactionElements.set(questionnaireRequestId, element);
    this.interactionByToolCall.set(request.toolCallId, questionnaireRequestId);

    if (enabled) {
      this.focusFirstQuestionnaireInput();
    }
  }

  private ungroupToolBlockIfNeeded(toolCallId: string): void {
    const block = this.toolCallElements.get(toolCallId);
    if (!block) {
      return;
    }
    const group = block.closest<HTMLDivElement>('.tool-call-group');
    if (!group) {
      return;
    }
    const groupContent = group.querySelector<HTMLDivElement>('.tool-call-group-content');
    const parent = group.parentElement;
    if (!groupContent || !parent) {
      return;
    }

    const blocks = Array.from(
      groupContent.querySelectorAll<HTMLDivElement>(':scope > .tool-output-block'),
    );
    const index = blocks.indexOf(block);
    if (index === -1) {
      return;
    }

    const beforeBlocks = blocks.slice(0, index);
    const afterBlocks = blocks.slice(index + 1);

    if (block.parentElement === groupContent) {
      groupContent.removeChild(block);
    }

    if (beforeBlocks.length === 0 && afterBlocks.length === 0) {
      parent.insertBefore(block, group);
      parent.removeChild(group);
      return;
    }

    if (beforeBlocks.length === 0) {
      if (afterBlocks.length === 1) {
        const remaining = afterBlocks[0];
        if (remaining) {
          parent.replaceChild(remaining, group);
          parent.insertBefore(block, remaining);
        }
      } else {
        this.refreshToolCallGroup(group);
        parent.insertBefore(block, group);
      }
      return;
    }

    if (afterBlocks.length === 0) {
      if (beforeBlocks.length === 1) {
        const remaining = beforeBlocks[0];
        if (remaining) {
          parent.replaceChild(remaining, group);
          parent.insertBefore(block, remaining.nextSibling);
        }
      } else {
        this.refreshToolCallGroup(group);
        parent.insertBefore(block, group.nextSibling);
      }
      return;
    }

    let afterContainer: HTMLElement;
    if (afterBlocks.length === 1) {
      const remaining = afterBlocks[0];
      if (!remaining) {
        this.refreshToolCallGroup(group);
        parent.insertBefore(block, group.nextSibling);
        return;
      }
      if (remaining.parentElement === groupContent) {
        groupContent.removeChild(remaining);
      }
      afterContainer = remaining;
    } else {
      const newGroup = createToolCallGroup({ expanded: this.shouldExpandToolOutput() });
      const newContent = newGroup.querySelector<HTMLDivElement>('.tool-call-group-content');
      if (newContent) {
        for (const afterBlock of afterBlocks) {
          newContent.appendChild(afterBlock);
        }
      }
      this.refreshToolCallGroup(newGroup);
      afterContainer = newGroup;
    }

    if (beforeBlocks.length === 1) {
      const remaining = beforeBlocks[0];
      if (remaining) {
        parent.replaceChild(remaining, group);
        parent.insertBefore(block, remaining.nextSibling);
      }
    } else {
      this.refreshToolCallGroup(group);
      parent.insertBefore(block, group.nextSibling);
    }

    parent.insertBefore(afterContainer, block.nextSibling);
  }

  private getOrCreateInteractionDock(block: HTMLDivElement): HTMLDivElement {
    let dock = block.querySelector<HTMLDivElement>('.tool-interaction-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'tool-interaction-dock';
      block.appendChild(dock);
    }
    return dock;
  }

  private updateToolInteractionState(block: HTMLDivElement): void {
    const hasPending = Boolean(
      block.querySelector('.interaction-block:not(.interaction-complete)'),
    );
    const hasPendingApproval = Boolean(
      block.querySelector('.interaction-approval:not(.interaction-complete)'),
    );
    block.classList.toggle('has-pending-interaction', hasPending);
    block.classList.toggle('has-pending-approval', hasPendingApproval);

    const group = block.closest<HTMLDivElement>('.tool-call-group');
    if (!group) {
      return;
    }
    const groupHasPending = Boolean(
      group.querySelector('.tool-output-block.has-pending-interaction'),
    );
    const groupHasPendingApproval = Boolean(
      group.querySelector('.tool-output-block.has-pending-approval'),
    );
    group.classList.toggle('has-pending-interaction', groupHasPending);
    group.classList.toggle('has-pending-approval', groupHasPendingApproval);
  }

  private finalizeInteractionForFailedToolCall(toolCallId: string, reason?: string): void {
    const interactionId = this.interactionByToolCall.get(toolCallId);
    if (interactionId) {
      const element = this.interactionElements.get(interactionId);
      if (element && !element.classList.contains('interaction-complete')) {
        applyInteractionResponse(element, {
          toolCallId,
          interactionId,
          action: 'cancel',
          ...(reason ? { reason } : {}),
        });
        const toolBlock = element.closest<HTMLDivElement>('.tool-output-block');
        if (toolBlock) {
          this.updateToolInteractionState(toolBlock);
        }
      }
    }

    this.pendingInteractionRequests.delete(toolCallId);

    if (this.pendingInteractionToolCalls.delete(toolCallId)) {
      // No typing state change here; turn lifecycle is the source of truth.
    }
  }

  private sendInteractionResponse(
    payload: InteractionRequestEvent['payload'],
    response: InteractionResponseDraft,
    sessionId: string,
  ): void {
    if (!this.options.sendInteractionResponse) {
      return;
    }
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    this.options.sendInteractionResponse({
      sessionId: trimmedSessionId,
      callId: payload.toolCallId,
      interactionId: payload.interactionId,
      response,
    });
  }

  private sendQuestionnaireSubmit(
    sessionId: string,
    questionnaireRequestId: string,
    answers: Record<string, unknown>,
  ): void {
    if (!this.options.sendQuestionnaireSubmit) {
      return;
    }
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const trimmedQuestionnaireRequestId = questionnaireRequestId.trim();
    if (!trimmedQuestionnaireRequestId) {
      return;
    }
    this.options.sendQuestionnaireSubmit({
      sessionId: trimmedSessionId,
      questionnaireRequestId: trimmedQuestionnaireRequestId,
      answers,
    });
  }

  private sendQuestionnaireCancel(
    sessionId: string,
    questionnaireRequestId: string,
    reason?: string,
  ): void {
    if (!this.options.sendQuestionnaireCancel) {
      return;
    }
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const trimmedQuestionnaireRequestId = questionnaireRequestId.trim();
    if (!trimmedQuestionnaireRequestId) {
      return;
    }
    this.options.sendQuestionnaireCancel({
      sessionId: trimmedSessionId,
      questionnaireRequestId: trimmedQuestionnaireRequestId,
      ...(reason ? { reason } : {}),
    });
  }

  private handleAgentMessage(_event: RenderedTranscriptEvent<Record<string, unknown>>): void {
    // agents_message tool blocks handle the display for both sync and async modes.
    // Skip rendering agent_message events entirely - they're just for tracking.
    // The tool block will register the messageId when tool_result arrives.
  }

  private handleAgentCallback(
    event: RenderedTranscriptEvent<{
      messageId: string;
      fromAgentId: string;
      fromSessionId: string;
      result: string;
    }>,
  ): void {
    const messageId = event.payload.messageId;
    const messageEl = this.agentMessageElements.get(messageId);
    if (!messageEl) {
      const questionnaireCallback = parseQuestionnaireCallbackText(event.payload.result);
      if (questionnaireCallback) {
        this.renderQuestionnaireCallbackMessage(event, questionnaireCallback);
        return;
      }
      console.warn('[ChatRenderer] agent_callback: no element found for messageId', messageId);
      return;
    }

    messageEl.classList.remove('pending');
    messageEl.classList.add('resolved');

    // Check if this is a tool block (agents_message) or agent-message element
    const isToolBlock = messageEl.classList.contains('tool-output-block');

    if (isToolBlock) {
      // Update tool block with callback result
      const toolName = messageEl.dataset['toolName'] ?? 'agents_message';
      const initialResultJson = messageEl.dataset['toolResultJson'];
      // Combine initial tool_result and callback into a single JSON view
      let combinedJson: string | undefined;
      if (initialResultJson) {
        try {
          const combined = {
            tool_result: JSON.parse(initialResultJson),
            agent_callback: {
              messageId: event.payload.messageId,
              fromAgentId: event.payload.fromAgentId,
              fromSessionId: event.payload.fromSessionId,
              result: event.payload.result,
            },
          };
          combinedJson = JSON.stringify(combined, null, 2);
        } catch {
          combinedJson = initialResultJson;
        }
      }
      updateToolOutputBlockContent(messageEl, toolName, event.payload.result, {
        ok: true,
        agentCallback: true,
        outputLabel: 'Received',
        ...(combinedJson ? { rawJson: combinedJson } : {}),
        state: 'complete',
      });
      this.updateToolCallGroupForBlock(messageEl);
    } else {
      // Update agent-message element
      let resultEl = messageEl.querySelector<HTMLDivElement>(':scope > .agent-result') ?? undefined;
      if (!resultEl) {
        resultEl = document.createElement('div');
        resultEl.className = 'agent-result';
        messageEl.appendChild(resultEl);
      }
      resultEl.dataset['eventId'] = event.id;
      resultEl.textContent = event.payload.result;

      const statusEl = messageEl.querySelector<HTMLDivElement>(':scope > .agent-message-status');
      if (statusEl) {
        statusEl.textContent = 'Complete';
      }
    }
  }

  private renderQuestionnaireCallbackMessage(
    event: RenderedTranscriptEvent<{
      messageId: string;
      fromAgentId: string;
      fromSessionId: string;
      result: string;
    }>,
    payload: QuestionnaireCallbackPayload,
  ): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);
    const indicator = document.createElement('div');
    indicator.className = 'questionnaire-submission-indicator';
    indicator.textContent = 'Submitted questionnaire answers';
    indicator.dataset['eventId'] = event.id;
    indicator.dataset['renderer'] = 'unified';
    indicator.dataset['questionnaireRequestId'] = payload.questionnaireRequestId;
    indicator.dataset['toolCallId'] = payload.toolCallId;
    if (payload.schemaTitle) {
      indicator.dataset['questionnaireTitle'] = payload.schemaTitle;
    }
    turnEl.appendChild(indicator);

  }

  // Interrupts and errors are rendered as indicators on the current turn.

  private handleInterrupt(event: RenderedTranscriptEvent<{ reason?: string }>): void {
    if (event.turnId) {
      this.activeRequestIds.delete(event.turnId);
    } else {
      this.activeRequestIds.clear();
    }
    if (!this._isReplaying) {
      this.syncTypingIndicatorFromTurnState();
    }
    // Mark any pending tool blocks as interrupted
    const hasInterruptedToolBlock = this.interruptPendingToolBlocks();

    // Only add turn-level indicator if no tool blocks were interrupted
    if (!hasInterruptedToolBlock) {
      const turnId = this.getTurnId(event.turnId, event.id);
      const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);

      const indicator = document.createElement('div');
      indicator.className = 'message-interrupted';
      indicator.dataset['eventId'] = event.id;
      indicator.textContent = 'Interrupted';

      turnEl.appendChild(indicator);
    }
  }

  private handleError(
    event: RenderedTranscriptEvent<{ code: string; message: string }>,
  ): void {
    if (event.turnId) {
      this.activeRequestIds.delete(event.turnId);
    } else {
      this.activeRequestIds.clear();
    }
    if (!this._isReplaying) {
      this.syncTypingIndicatorFromTurnState();
    }
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId, event.timestamp);

    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.dataset['eventId'] = event.id;
    errorEl.textContent = `Error: ${event.payload.code} – ${event.payload.message}`;

    turnEl.appendChild(errorEl);
  }

  private interruptPendingToolBlocks(): boolean {
    let hasInterruptedToolBlock = false;

    for (const block of this.toolCallElements.values()) {
      const isActive =
        block.classList.contains('pending') ||
        block.classList.contains('streaming') ||
        block.classList.contains('streaming-input');
      if (!isActive) {
        continue;
      }

      block.classList.remove('pending', 'streaming', 'streaming-input');
      block.classList.add('interrupted');
      block.dataset['status'] = 'interrupted';
      // Remove the pending indicator (spinner + "Running...")
      const pendingIndicator = block.querySelector('.tool-output-pending');
      if (pendingIndicator) {
        pendingIndicator.remove();
      }
      // Update status text in header
      const statusEl = block.querySelector('.tool-output-status');
      if (statusEl) {
        statusEl.textContent = 'Interrupted';
      }
      this.updateToolCallGroupForBlock(block);
      hasInterruptedToolBlock = true;
    }

    return hasInterruptedToolBlock;
  }

  private getOrCreateTurnContainer(turnId: string, timestamp?: number): HTMLDivElement {
    const existing = this.turnElements.get(turnId);
    if (existing) {
      this.ensureTurnTimestamp(existing, timestamp);
      return existing;
    }

    const turnEl = document.createElement('div');
    turnEl.className = 'turn';
    turnEl.dataset['turnId'] = turnId;
    this.ensureTurnTimestamp(turnEl, timestamp);
    this.container.appendChild(turnEl);

    this.turnElements.set(turnId, turnEl);
    return turnEl;
  }

  private ensureTurnTimestamp(turnEl: HTMLDivElement, timestamp?: number): void {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return;
    }
    if (turnEl.dataset['turnTimestamp']) {
      return;
    }
    turnEl.dataset['turnTimestamp'] = String(timestamp);

    const divider = document.createElement('div');
    divider.className = 'turn-divider';

    const leftLine = document.createElement('span');
    leftLine.className = 'turn-divider-line';
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'turn-divider-label turn-divider-button';
    label.textContent = this.turnTimestampFormatter.format(new Date(timestamp));
    label.setAttribute('aria-label', 'Request actions');
    label.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const requestId = turnEl.dataset['turnId'];
      if (!requestId || !this.requestDividerActionHandler) {
        return;
      }
      const previousTurn = turnEl.previousElementSibling;
      const nextTurn = turnEl.nextElementSibling;
      this.requestDividerActionHandler({
        requestId,
        timestamp,
        anchorEl: label,
        hasBefore: previousTurn instanceof HTMLElement && previousTurn.classList.contains('turn'),
        hasAfter: nextTurn instanceof HTMLElement && nextTurn.classList.contains('turn'),
      });
    });
    const rightLine = document.createElement('span');
    rightLine.className = 'turn-divider-line';

    divider.append(leftLine, label, rightLine);
    turnEl.prepend(divider);
  }

  private getDisplayToolNameForOutput(block: HTMLDivElement, eventToolName?: string): string {
    const blockToolName = block.dataset['toolName'] ?? 'tool';
    if (!eventToolName) {
      return blockToolName;
    }
    const isAgentMessageBlock = blockToolName === 'agents_message';
    if (isAgentMessageBlock && eventToolName.startsWith('agent:')) {
      return eventToolName.slice(6);
    }
    return blockToolName;
  }

  private getOrCreateToolCallContainer(
    eventId: string,
    turnIdRaw: string | undefined,
    toolCallId: string,
    responseId: string | null,
    timestamp?: number,
  ): HTMLDivElement {
    if (responseId) {
      return this.getOrCreateAssistantResponseContainer(turnIdRaw, eventId, responseId, timestamp);
    }

    const existing = this.toolCallContainers.get(toolCallId);
    if (existing) {
      return existing;
    }

    const turnId = this.getTurnId(turnIdRaw, eventId);
    const turnEl = this.getOrCreateTurnContainer(turnId, timestamp);

    const responseEl = document.createElement('div');
    responseEl.className = 'assistant-response tool-call-only';
    responseEl.dataset['toolCallId'] = toolCallId;
    responseEl.dataset['renderer'] = 'unified';

    turnEl.appendChild(responseEl);
    this.toolCallContainers.set(toolCallId, responseEl);

    return responseEl;
  }

  private getOrCreateAssistantResponseContainer(
    turnIdRaw: string | undefined,
    fallbackTurnKey: string,
    responseId: string,
    timestamp?: number,
  ): HTMLDivElement {
    const existing = this.responseElements.get(responseId);
    if (existing) {
      return existing;
    }

    const turnId = this.getTurnId(turnIdRaw, fallbackTurnKey);
    const turnEl = this.getOrCreateTurnContainer(turnId, timestamp);

    const responseEl = document.createElement('div');
    responseEl.className = 'assistant-response';
    responseEl.dataset['responseId'] = responseId;

    turnEl.appendChild(responseEl);
    this.responseElements.set(responseId, responseEl);

    return responseEl;
  }

  private getOrCreateAssistantTextElement(
    responseId: string,
    responseEl: HTMLDivElement,
    phase?: AssistantChunkEvent['payload']['phase'],
  ): HTMLDivElement {
    // Get current segment index (0 = before any tools, incremented after each tool block)
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const segmentKey = `${responseId}:${segmentIdx}`;

    const existing = this.assistantTextElements.get(segmentKey);
    if (existing) {
      return existing;
    }

    const textEl = document.createElement('div');
    textEl.className = 'assistant-text';
    textEl.dataset['segment'] = String(segmentIdx);
    if (phase) {
      textEl.dataset['phase'] = phase;
    }
    responseEl.appendChild(textEl);

    this.assistantTextElements.set(segmentKey, textEl);
    return textEl;
  }

  /**
   * Called when a tool block is inserted to start a new text segment after it.
   */
  private advanceTextSegment(responseId: string): void {
    this.finalizeCurrentAssistantTextSegment(responseId, true);
    const current = this.textSegmentIndex.get(responseId) ?? 0;
    this.textSegmentIndex.set(responseId, current + 1);
    this.debugLog('advance_text_segment', {
      responseId,
      from: current,
      to: current + 1,
    });
  }

  private ensureAssistantTextSegment(
    responseId: string,
    phase?: AssistantChunkEvent['payload']['phase'],
  ): void {
    this.ensureTextSegment(responseId);
    const nextToken = phase ?? 'default';
    const currentToken = this.assistantTextSegmentTokens.get(responseId);
    if (currentToken === nextToken) {
      return;
    }
    if (currentToken !== undefined) {
      this.advanceTextSegment(responseId);
    }
    this.assistantTextSegmentTokens.set(responseId, nextToken);
    this.debugLog('assistant_segment_token', {
      responseId,
      previousToken: currentToken ?? null,
      nextToken,
      segmentIdx: this.textSegmentIndex.get(responseId) ?? 0,
    });
  }

  private ensureTextSegment(responseId: string): void {
    if (!this.needsNewTextSegment.has(responseId)) {
      return;
    }
    this.advanceTextSegment(responseId);
    this.needsNewTextSegment.delete(responseId);
    this.assistantTextSegmentTokens.delete(responseId);
    this.debugLog('consume_text_segment_break', {
      responseId,
      segmentIdx: this.textSegmentIndex.get(responseId) ?? 0,
    });
  }

  private markTextSegmentBreak(responseId: string): void {
    this.finalizeCurrentAssistantTextSegment(responseId);
    this.needsNewTextSegment.add(responseId);
    this.debugLog('mark_text_segment_break', {
      responseId,
      segmentIdx: this.textSegmentIndex.get(responseId) ?? 0,
    });
  }

  private finalizeCurrentAssistantTextSegment(responseId: string, release = false): void {
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const segmentKey = `${responseId}:${segmentIdx}`;
    const textEl = this.assistantTextElements.get(segmentKey);
    const text = this.assistantTextBuffers.get(segmentKey);
    if (textEl && typeof text === 'string') {
      applyMarkdownToElement(textEl, text);
    }
    if (release) {
      this.assistantTextBuffers.delete(segmentKey);
      this.assistantTextElements.delete(segmentKey);
    }
  }

  private getThinkingSegmentKey(responseId: string): { segmentIdx: number; segmentKey: string } {
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const segmentKey = `${responseId}:${segmentIdx}`;
    return { segmentIdx, segmentKey };
  }

  private getOrCreateThinkingElement(
    segmentKey: string,
    responseEl: HTMLDivElement,
    segmentIdx: number,
  ): HTMLDivElement {
    const existing = this.thinkingElements.get(segmentKey);
    if (existing) {
      return existing;
    }

    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking-content';
    thinkingEl.dataset['segment'] = String(segmentIdx);
    responseEl.appendChild(thinkingEl);
    this.thinkingElements.set(segmentKey, thinkingEl);

    return thinkingEl;
  }

  private getOrCreateToolCallsContainer(
    responseEl: HTMLDivElement,
    responseId?: string,
  ): HTMLDivElement {
    // Get current segment index to create segment-specific tool container.
    const segmentIdx = responseId ? (this.textSegmentIndex.get(responseId) ?? 0) : 0;
    const containerClass = `tool-calls tool-calls-segment-${segmentIdx}`;

    // Look for existing container for this segment
    const existing = responseEl.querySelector<HTMLDivElement>(
      `:scope > .tool-calls-segment-${segmentIdx}`,
    );
    if (existing) {
      return existing;
    }

    const container = document.createElement('div');
    container.className = containerClass;
    // Insert before any later text segment so tool calls stay between segments.
    let inserted = false;
    const textSegments = responseEl.querySelectorAll<HTMLElement>('.assistant-text');
    for (const textEl of textSegments) {
      const segmentRaw = textEl.dataset['segment'];
      const segment = segmentRaw ? Number(segmentRaw) : Number.NaN;
      if (Number.isFinite(segment) && segment > segmentIdx) {
        responseEl.insertBefore(container, textEl);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      // Append at the end - text segments will be created after this
      responseEl.appendChild(container);
    }
    return container;
  }

  private isGroupableToolCall(toolName: string): boolean {
    return (
      toolName !== 'agents_message' &&
      !this.isVoiceToolName(toolName) &&
      !this.isAttachmentToolName(toolName)
    );
  }

  private isVoiceToolName(toolName: string): toolName is 'voice_speak' | 'voice_ask' {
    return VOICE_TOOL_NAMES.has(toolName);
  }

  private isAttachmentToolName(toolName: string): boolean {
    return toolName === ATTACHMENT_TOOL_NAME;
  }

  private getVoiceToolText(args: Record<string, unknown>): string {
    const text = args['text'];
    return typeof text === 'string' ? text : '';
  }

  private getVoiceToolTextFromArgsJson(argsJson: string): string | null {
    try {
      const parsed = JSON.parse(argsJson) as Record<string, unknown>;
      return this.getVoiceToolText(parsed);
    } catch {
      return null;
    }
  }

  private createVoiceToolBubble(
    callId: string,
    toolName: 'voice_speak' | 'voice_ask',
  ): HTMLDivElement {
    const bubble = document.createElement('div');
    bubble.className = `message assistant voice-tool-bubble ${toolName === 'voice_ask' ? 'voice-tool-ask' : 'voice-tool-speak'}`;
    bubble.dataset['toolCallId'] = callId;
    bubble.dataset['toolName'] = toolName;
    bubble.dataset['status'] = 'pending';
    bubble.style.display = 'flex';
    bubble.style.flexDirection = 'column';
    bubble.style.gap = '8px';
    bubble.style.padding = '12px 14px';
    bubble.style.borderRadius = '14px';
    bubble.style.border = '1px solid var(--color-border-subtle)';
    bubble.style.background = 'var(--color-bg-elevated)';
    bubble.style.maxWidth = '680px';

    const header = document.createElement('div');
    header.className = 'voice-tool-header';
    header.style.display = 'inline-flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.color = 'var(--color-text-secondary)';
    header.style.fontSize = '0.78em';
    header.style.fontWeight = '600';
    header.style.letterSpacing = '0.04em';
    header.style.textTransform = 'uppercase';
    header.appendChild(this.createVoiceEventIcon('speaker'));

    const label = document.createElement('span');
    label.className = 'voice-tool-label';
    header.appendChild(label);

    const body = document.createElement('div');
    body.className = 'voice-tool-body markdown-content';
    body.style.color = 'var(--color-message-assistant-text)';
    body.style.lineHeight = 'var(--line-height-relaxed)';

    bubble.append(header, body);
    return bubble;
  }

  private updateVoiceToolBubble(
    bubble: HTMLDivElement,
    toolName: 'voice_speak' | 'voice_ask',
    text: string,
  ): void {
    bubble.dataset['toolName'] = toolName;
    bubble.dataset['status'] = 'pending';
    bubble.classList.toggle('voice-tool-ask', toolName === 'voice_ask');
    bubble.classList.toggle('voice-tool-speak', toolName === 'voice_speak');
    const label = bubble.querySelector<HTMLElement>('.voice-tool-label');
    if (label) {
      label.textContent = toolName === 'voice_ask' ? 'Ask' : 'Speak';
    }
    const body = bubble.querySelector<HTMLDivElement>('.voice-tool-body');
    if (body) {
      applyMarkdownToElement(body, text);
    }
    bubble.querySelector('.voice-tool-error')?.remove();
    bubble.classList.remove('error');
    bubble.style.borderColor = 'var(--color-border-subtle)';
    bubble.style.background = 'var(--color-bg-elevated)';
  }

  private finalizeVoiceToolBubble(bubble: HTMLDivElement): void {
    bubble.dataset['status'] = 'complete';
    bubble.querySelector('.voice-tool-error')?.remove();
    bubble.classList.remove('pending', 'error');
  }

  private updateVoiceToolBubbleError(bubble: HTMLDivElement, message: string): void {
    this.finalizeVoiceToolBubble(bubble);
    bubble.dataset['status'] = 'error';
    bubble.classList.add('error');
    bubble.style.borderColor = 'var(--color-error-border)';
    bubble.style.background = 'var(--color-error-soft)';
    let errorEl = bubble.querySelector<HTMLDivElement>('.voice-tool-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'voice-tool-error';
      errorEl.style.fontSize = '0.9em';
      errorEl.style.color = 'var(--color-message-error-text)';
      bubble.appendChild(errorEl);
    }
    errorEl.textContent = message;
  }

  private getPendingAttachmentSummary(args: Record<string, unknown>): {
    fileName?: string;
    title?: string;
  } {
    return {
      ...(typeof args['fileName'] === 'string' && args['fileName'].trim()
        ? { fileName: args['fileName'].trim() }
        : {}),
      ...(typeof args['title'] === 'string' && args['title'].trim()
        ? { title: args['title'].trim() }
        : {}),
    };
  }

  private getPendingAttachmentSummaryFromArgsJson(
    argsJson: string,
  ): { fileName?: string; title?: string } | null {
    try {
      return this.getPendingAttachmentSummary(JSON.parse(argsJson) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private createAttachmentToolBubble(callId: string): HTMLDivElement {
    const bubble = document.createElement('div');
    bubble.className = 'message assistant attachment-tool-bubble';
    bubble.dataset['toolCallId'] = callId;
    bubble.dataset['toolName'] = ATTACHMENT_TOOL_NAME;
    bubble.dataset['status'] = 'pending';
    bubble.style.display = 'flex';
    bubble.style.flexDirection = 'column';
    bubble.style.gap = '8px';
    bubble.style.padding = '12px 14px';
    bubble.style.borderRadius = '14px';
    bubble.style.border = '1px solid var(--color-border-subtle)';
    bubble.style.background = 'var(--color-bg-elevated)';
    bubble.style.maxWidth = '680px';

    const header = document.createElement('div');
    header.className = 'attachment-tool-header';
    header.style.display = 'inline-flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.color = 'var(--color-text-secondary)';
    header.style.fontSize = '0.78em';
    header.style.fontWeight = '600';
    header.style.letterSpacing = '0.04em';
    header.style.textTransform = 'uppercase';
    header.appendChild(this.createAttachmentEventIcon());

    const label = document.createElement('span');
    label.className = 'attachment-tool-label';
    label.textContent = 'Attachment';
    header.appendChild(label);

    const title = document.createElement('div');
    title.className = 'attachment-tool-title';
    title.style.fontWeight = '600';
    title.style.color = 'var(--color-message-assistant-text)';

    const meta = document.createElement('div');
    meta.className = 'attachment-tool-meta';
    meta.style.color = 'var(--color-text-secondary)';
    meta.style.fontSize = '0.9em';

    const preview = document.createElement('div');
    preview.className = 'attachment-tool-preview';
    preview.style.display = 'none';
    preview.style.padding = '10px 12px';
    preview.style.borderRadius = '10px';
    preview.style.background = 'var(--color-bg-subtle)';
    preview.style.border = '1px solid var(--color-border-subtle)';

    const actions = document.createElement('div');
    actions.className = 'attachment-tool-actions';
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.flexWrap = 'wrap';

    bubble.append(header, title, meta, preview, actions);
    return bubble;
  }

  private createAttachmentActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'attachment-tool-action-button';
    button.style.padding = '0';
    button.style.border = 'none';
    button.style.background = 'transparent';
    button.style.color = 'var(--color-text-secondary)';
    button.style.font = 'inherit';
    button.style.fontWeight = '600';
    button.style.fontSize = '0.9em';
    button.style.lineHeight = '1.2';
    button.style.cursor = 'pointer';
    button.style.textAlign = 'left';
    button.style.textDecoration = 'none';
    button.style.appearance = 'none';
    button.addEventListener('click', onClick);
    return button;
  }

  private isAttachmentInlinePreviewable(attachment: AttachmentDescriptor): boolean {
    return attachment.previewType === 'text' || attachment.previewType === 'markdown';
  }

  private renderMarkdownAttachmentAsPlainText(markdownText: string): string {
    const temp = document.createElement('div');
    applyMarkdownToElement(temp, markdownText);
    temp.querySelectorAll('.markdown-code-copy-wrapper').forEach((element) => element.remove());
    return temp.textContent ?? '';
  }

  private async resolveAttachmentCopyText(
    bubble: HTMLDivElement,
    attachment: AttachmentDescriptor,
  ): Promise<string> {
    const expansionState = this.attachmentExpansionStates.get(bubble);
    if (expansionState?.status === 'ready') {
      return expansionState.fullText;
    }
    if (typeof attachment.previewText === 'string' && attachment.previewTruncated !== true) {
      return attachment.previewText;
    }
    return fetchAttachmentTextContent(getAttachmentContentUrl(attachment.downloadUrl));
  }

  private createAttachmentCopyDropdown(
    bubble: HTMLDivElement,
    attachment: AttachmentDescriptor,
  ): HTMLElement {
    return createCopyDropdown({
      classPrefix: 'attachment-tool-copy',
      compact: true,
      getPlainText: async () => {
        const fullText = await this.resolveAttachmentCopyText(bubble, attachment);
        return this.renderMarkdownAttachmentAsPlainText(fullText);
      },
      getMarkdown: async () => this.resolveAttachmentCopyText(bubble, attachment),
    });
  }

  private wireAttachmentCopyButton(
    bubble: HTMLDivElement,
    button: HTMLButtonElement,
    getText: () => Promise<string>,
  ): void {
    button.addEventListener('click', () => {
      const originalLabel = button.textContent ?? 'Copy';
      button.disabled = true;
      button.textContent = 'Copying…';
      void getText()
        .then((text) => navigator.clipboard.writeText(text))
        .then(() => {
          button.textContent = 'Copied';
          window.setTimeout(() => {
            button.disabled = false;
            button.textContent = originalLabel;
          }, 1500);
        })
        .catch((error) => {
          console.error('[attachments] Failed to copy attachment', error);
          button.disabled = false;
          button.textContent = originalLabel;
          this.showAttachmentToolActionError(button.closest<HTMLDivElement>('.attachment-tool-bubble') ?? bubble, 'Failed to copy attachment.');
        });
    });
  }

  private renderAttachmentPreviewContent(
    previewEl: HTMLDivElement,
    attachment: AttachmentDescriptor,
    contentText: string,
    options?: { truncated?: boolean; expanded?: boolean },
  ): void {
    const contentEl = document.createElement('div');
    previewEl.replaceChildren();
    previewEl.style.display = 'block';
    previewEl.classList.toggle('expanded', options?.expanded === true);

    if (attachment.previewType === 'markdown') {
      contentEl.className = 'attachment-tool-preview-content markdown-content';
      applyMarkdownToElement(contentEl, contentText);
    } else {
      contentEl.className = 'attachment-tool-preview-content';
      contentEl.textContent = contentText;
    }
    previewEl.appendChild(contentEl);

    if (options?.truncated) {
      const statusEl = document.createElement('div');
      statusEl.className = 'attachment-tool-preview-status';
      statusEl.textContent = 'Preview truncated. Expand to load the full attachment.';
      previewEl.appendChild(statusEl);
    }
  }

  private clearAttachmentToolActionError(bubble: HTMLDivElement): void {
    bubble.querySelector('.attachment-tool-action-error')?.remove();
  }

  private showAttachmentToolActionError(bubble: HTMLDivElement, message: string): void {
    let errorEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-action-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'attachment-tool-action-error';
      errorEl.style.fontSize = '0.9em';
      errorEl.style.color = 'var(--color-message-error-text)';
      bubble.appendChild(errorEl);
    }
    errorEl.textContent = message;
  }

  private updatePendingAttachmentToolBubble(
    bubble: HTMLDivElement,
    summary: { fileName?: string; title?: string },
  ): void {
    this.attachmentExpansionStates.delete(bubble);
    const summaryKey = `${summary.title ?? ''}\n${summary.fileName ?? ''}`;
    if (bubble.dataset['pendingSummaryKey'] === summaryKey) {
      return;
    }
    bubble.dataset['pendingSummaryKey'] = summaryKey;
    bubble.dataset['status'] = 'pending';
    bubble.classList.remove('error');
    bubble.style.borderColor = 'var(--color-border-subtle)';
    bubble.style.background = 'var(--color-bg-elevated)';
    bubble.querySelector('.attachment-tool-error')?.remove();
    this.clearAttachmentToolActionError(bubble);

    const titleEl = bubble.querySelector<HTMLElement>('.attachment-tool-title');
    if (titleEl) {
      titleEl.textContent = summary.title || summary.fileName || 'Preparing attachment…';
    }

    const metaEl = bubble.querySelector<HTMLElement>('.attachment-tool-meta');
    if (metaEl) {
      metaEl.textContent = summary.title && summary.fileName ? summary.fileName : 'Preparing attachment…';
    }

    const previewEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-preview');
    if (previewEl) {
      previewEl.style.display = 'none';
      previewEl.classList.remove('expanded');
      previewEl.replaceChildren();
    }

    const actionsEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-actions');
    if (actionsEl) {
      actionsEl.replaceChildren();
    }
  }

  private renderAttachmentToolBubble(
    bubble: HTMLDivElement,
    attachment: AttachmentDescriptor,
  ): void {
    delete bubble.dataset['pendingSummaryKey'];
    bubble.dataset['status'] = 'complete';
    bubble.classList.remove('error');
    bubble.style.borderColor = 'var(--color-border-subtle)';
    bubble.style.background = 'var(--color-bg-elevated)';
    bubble.querySelector('.attachment-tool-error')?.remove();
    this.clearAttachmentToolActionError(bubble);

    const titleEl = bubble.querySelector<HTMLElement>('.attachment-tool-title');
    if (titleEl) {
      titleEl.textContent = attachment.title || attachment.fileName;
    }

    const metaEl = bubble.querySelector<HTMLElement>('.attachment-tool-meta');
    if (metaEl) {
      const parts = [
        ...(attachment.title ? [attachment.fileName] : []),
        attachment.contentType,
        formatByteSize(attachment.size),
      ];
      metaEl.textContent = parts.join(' • ');
    }

    const previewEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-preview');
    const expansionState = this.attachmentExpansionStates.get(bubble);
    const expandedText =
      expansionState?.status === 'ready' && expansionState.expanded ? expansionState.fullText : undefined;
    if (previewEl) {
      previewEl.replaceChildren();
      previewEl.classList.remove('expanded');
      if (typeof expandedText === 'string') {
        this.renderAttachmentPreviewContent(previewEl, attachment, expandedText, { expanded: true });
      } else if (
        this.isAttachmentInlinePreviewable(attachment) &&
        typeof attachment.previewText === 'string'
      ) {
        this.renderAttachmentPreviewContent(
          previewEl,
          attachment,
          attachment.previewTruncated ? `${attachment.previewText}…` : attachment.previewText,
          { truncated: attachment.previewTruncated === true },
        );
      } else {
        previewEl.style.display = 'none';
      }
    }

    const actionsEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-actions');
    if (actionsEl) {
      actionsEl.replaceChildren();
      const canExpandInline =
        this.isAttachmentInlinePreviewable(attachment) && attachment.previewTruncated === true;
      const showExpandAction =
        canExpandInline &&
        (expansionState === undefined ||
          expansionState.status === 'loading' ||
          (expansionState.status === 'ready' && !expansionState.expanded));
      const showCollapseAction = expansionState?.status === 'ready' && expansionState.expanded;

      if (showExpandAction) {
        const isLoading = expansionState?.status === 'loading';
        const expandButton = this.createAttachmentActionButton(
          isLoading ? 'Expanding…' : 'Expand',
          () => {
            this.clearAttachmentToolActionError(bubble);
            if (expansionState?.status === 'ready') {
              this.attachmentExpansionStates.set(bubble, {
                status: 'ready',
                fullText: expansionState.fullText,
                expanded: true,
              });
              this.renderAttachmentToolBubble(bubble, attachment);
              return;
            }
            this.attachmentExpansionStates.set(bubble, { status: 'loading' });
            this.renderAttachmentToolBubble(bubble, attachment);
            void fetchAttachmentTextContent(getAttachmentContentUrl(attachment.downloadUrl))
              .then((fullText) => {
                this.attachmentExpansionStates.set(bubble, {
                  status: 'ready',
                  fullText,
                  expanded: true,
                });
                this.renderAttachmentToolBubble(bubble, attachment);
              })
              .catch((error) => {
                console.error('[attachments] Failed to expand attachment', error);
                this.attachmentExpansionStates.delete(bubble);
                this.renderAttachmentToolBubble(bubble, attachment);
                this.showAttachmentToolActionError(bubble, 'Failed to expand attachment.');
              });
          },
        );
        expandButton.disabled = isLoading;
        actionsEl.appendChild(expandButton);
      }

      if (showCollapseAction) {
        const collapseButton = this.createAttachmentActionButton('Collapse', () => {
          if (expansionState?.status !== 'ready') {
            return;
          }
          this.clearAttachmentToolActionError(bubble);
          this.attachmentExpansionStates.set(bubble, {
            status: 'ready',
            fullText: expansionState.fullText,
            expanded: false,
          });
          this.renderAttachmentToolBubble(bubble, attachment);
        });
        actionsEl.appendChild(collapseButton);
      }

      if (attachment.previewType === 'markdown') {
        actionsEl.appendChild(this.createAttachmentCopyDropdown(bubble, attachment));
      } else if (attachment.previewType === 'text') {
        const copyButton = this.createAttachmentActionButton('Copy', () => {});
        this.wireAttachmentCopyButton(bubble, copyButton, () =>
          this.resolveAttachmentCopyText(bubble, attachment),
        );
        actionsEl.appendChild(copyButton);
      }

      const downloadButton = this.createAttachmentActionButton('Download', () => {
        this.clearAttachmentToolActionError(bubble);
        void downloadAttachment(attachment.downloadUrl, attachment.fileName).catch((error) => {
          console.error('[attachments] Failed to download attachment', error);
          this.showAttachmentToolActionError(bubble, 'Failed to download attachment.');
        });
      });
      actionsEl.appendChild(downloadButton);

      if (attachment.openUrl && attachment.openMode === 'browser_blob') {
        const openButton = this.createAttachmentActionButton('Open', () => {
          this.clearAttachmentToolActionError(bubble);
          void openHtmlAttachmentInBrowser(attachment.openUrl!, attachment.fileName).catch((error) => {
            console.error('[attachments] Failed to open HTML attachment', error);
            this.showAttachmentToolActionError(bubble, 'Failed to open attachment.');
          });
        });
        actionsEl.appendChild(openButton);
      }
    }
  }

  private updateAttachmentToolBubbleError(bubble: HTMLDivElement, message: string): void {
    this.attachmentExpansionStates.delete(bubble);
    delete bubble.dataset['pendingSummaryKey'];
    bubble.dataset['status'] = 'error';
    bubble.classList.add('error');
    bubble.style.borderColor = 'var(--color-error-border)';
    bubble.style.background = 'var(--color-error-soft)';
    const actionsEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-actions');
    actionsEl?.replaceChildren();
    const previewEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-preview');
    if (previewEl) {
      previewEl.style.display = 'none';
      previewEl.classList.remove('expanded');
      previewEl.replaceChildren();
    }
    let errorEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'attachment-tool-error';
      errorEl.style.fontSize = '0.9em';
      errorEl.style.color = 'var(--color-message-error-text)';
      bubble.appendChild(errorEl);
    }
    errorEl.textContent = message;
  }

  private createVoiceEventIcon(kind: 'speaker' | 'microphone'): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = `voice-event-icon voice-event-icon-${kind}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '18px';
    icon.style.height = '18px';
    icon.innerHTML =
      kind === 'microphone'
        ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"></rect><path d="M12 19a6 6 0 0 0 6-6v-1h-2v1a4 4 0 0 1-8 0v-1H6v1a6 6 0 0 0 6 6z" fill="currentColor"></path><rect x="11" y="19" width="2" height="3" fill="currentColor"></rect><path d="M8 22h8a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2z" fill="currentColor"></path></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    return icon;
  }

  private createAttachmentEventIcon(): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = 'attachment-event-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '18px';
    icon.style.height = '18px';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 12.5 14.5 6a3.5 3.5 0 1 1 5 5l-8.5 8.5a5 5 0 0 1-7-7L12.5 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return icon;
  }

  private getOrCreateAttachmentToolBubble(options: {
    eventId: string;
    turnId: string | undefined;
    callId: string;
    responseId: string | null;
    timestamp: number;
  }): HTMLDivElement {
    const existing = this.toolCallElements.get(options.callId);
    if (existing) {
      return existing;
    }

    const responseEl = this.getOrCreateToolCallContainer(
      options.eventId,
      options.turnId,
      options.callId,
      options.responseId,
      options.timestamp,
    );
    const bubble = this.createAttachmentToolBubble(options.callId);
    bubble.dataset['eventId'] = options.eventId;
    bubble.dataset['renderer'] = 'unified';
    const toolCallsContainer = this.getOrCreateToolCallsContainer(
      responseEl,
      options.responseId ?? undefined,
    );
    toolCallsContainer.appendChild(bubble);
    this.toolCallElements.set(options.callId, bubble);
    if (options.responseId) {
      this.markTextSegmentBreak(options.responseId);
    }
    return bubble;
  }

  private appendToolCallBlock(
    responseEl: HTMLDivElement,
    responseId: string | undefined,
    block: HTMLDivElement,
    toolName: string,
  ): void {
    const toolCallsContainer = this.getOrCreateToolCallsContainer(responseEl, responseId);
    const callId = block.dataset['toolCallId'];

    if (!this.isGroupableToolCall(toolName)) {
      toolCallsContainer.appendChild(block);
      return;
    }

    if (callId && this.standaloneToolCalls.has(callId)) {
      toolCallsContainer.appendChild(block);
      return;
    }

    const lastChild = toolCallsContainer.lastElementChild as HTMLElement | null;
    if (!lastChild) {
      toolCallsContainer.appendChild(block);
      return;
    }

    if (lastChild.classList.contains('tool-call-group')) {
      const group = lastChild as HTMLDivElement;
      const groupContent = group.querySelector<HTMLDivElement>('.tool-call-group-content');
      if (groupContent) {
        groupContent.appendChild(block);
        this.refreshToolCallGroup(group);
        return;
      }
    }

    if (lastChild.classList.contains('tool-output-block')) {
      const lastToolName = lastChild.dataset['toolName'] ?? '';
      const lastCallId = lastChild.dataset['toolCallId'];
      if (lastCallId && this.standaloneToolCalls.has(lastCallId)) {
        toolCallsContainer.appendChild(block);
        return;
      }
      if (this.isGroupableToolCall(lastToolName)) {
        const group = createToolCallGroup({ expanded: this.shouldExpandToolOutput() });
        toolCallsContainer.replaceChild(group, lastChild);
        const groupContent = group.querySelector<HTMLDivElement>('.tool-call-group-content');
        if (groupContent) {
          groupContent.appendChild(lastChild);
          groupContent.appendChild(block);
        }
        this.refreshToolCallGroup(group);
        return;
      }
    }

    toolCallsContainer.appendChild(block);
  }

  private updateToolCallGroupForBlock(block: HTMLDivElement): void {
    const group = block.closest<HTMLDivElement>('.tool-call-group');
    if (group) {
      this.refreshToolCallGroup(group);
    }
  }

  private refreshToolCallGroup(group: HTMLDivElement): void {
    const content = group.querySelector<HTMLDivElement>('.tool-call-group-content');
    if (!content) {
      return;
    }

    const blocks = Array.from(
      content.querySelectorAll<HTMLDivElement>(':scope > .tool-output-block'),
    );
    const count = blocks.length;
    const lastBlock = blocks[blocks.length - 1];
    const summary = lastBlock ? getToolCallSummary(lastBlock) : '';
    const state = getToolCallGroupState(blocks);
    updateToolCallGroup(group, { count, summary, state });
  }

  private getOrCreateAgentMessagesContainer(responseEl: HTMLDivElement): HTMLDivElement {
    const existing = responseEl.querySelector<HTMLDivElement>(':scope > .agent-messages');
    if (existing) {
      return existing;
    }

    const container = document.createElement('div');
    container.className = 'agent-messages';
    responseEl.appendChild(container);

    return container;
  }

  private getTurnId(turnIdRaw: string | undefined, fallback: string): string {
    const candidate = typeof turnIdRaw === 'string' ? turnIdRaw.trim() : '';
    if (candidate) {
      return candidate;
    }
    const fallbackTrimmed = fallback.trim();
    if (fallbackTrimmed) {
      return fallbackTrimmed;
    }
    return 'default';
  }

  private getResponseId(responseIdRaw: string | undefined): string | null {
    if (typeof responseIdRaw !== 'string') {
      return null;
    }
    const trimmed = responseIdRaw.trim();
    return trimmed || null;
  }
}
