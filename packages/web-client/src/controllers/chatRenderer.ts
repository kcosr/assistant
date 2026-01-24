import type {
  AgentCallbackEvent,
  AgentMessageEvent,
  AssistantChunkEvent,
  AssistantDoneEvent,
  ChatEvent,
  CustomMessageEvent,
  ErrorEvent,
  InteractionRequestEvent,
  InteractionResponseEvent,
  ThinkingChunkEvent,
  ThinkingDoneEvent,
  ToolCallEvent,
  ToolInputChunkEvent,
  ToolOutputChunkEvent,
  ToolResultEvent,
  SummaryMessageEvent,
  TurnEndEvent,
  TurnStartEvent,
  InterruptEvent,
  UserAudioEvent,
  UserMessageEvent,
} from '@assistant/shared';
import { applyMarkdownToElement } from '../utils/markdown';
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
  getToolCallGroupState,
  getToolCallSummary,
  setToolOutputBlockInput,
  setToolOutputBlockPending,
  updateToolCallGroup,
  updateToolOutputBlockLabel,
  updateToolOutputBlockContent,
} from '../utils/toolOutputRenderer';
import { formatToolResultText } from '../utils/toolResultFormatting';
import {
  applyInteractionResponse,
  createInteractionElement,
  type InteractionResponseDraft,
} from '../utils/interactionRenderer';

export interface ChatRendererOptions {
  getAgentDisplayName?: (agentId: string) => string | undefined;
  getExpandToolOutput?: () => boolean;
  getInteractionEnabled?: () => boolean;
  sendInteractionResponse?: (options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    response: InteractionResponseDraft;
  }) => void;
}

export class ChatRenderer {
  private readonly container: HTMLElement;
  private readonly options: ChatRendererOptions;
  private typingIndicator: HTMLDivElement | null = null;
  private _isStreaming = false;
  private _isReplaying = false;

  private readonly turnElements = new Map<string, HTMLDivElement>();
  private readonly responseElements = new Map<string, HTMLDivElement>();
  private readonly assistantTextElements = new Map<string, HTMLDivElement>();
  private readonly assistantTextBuffers = new Map<string, string>();
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
  private readonly pendingInteractionIds = new Set<string>();
  private readonly pendingInteractionRequests = new Map<
    string,
    { payload: InteractionRequestEvent['payload']; sessionId: string }
  >();
  private readonly pendingInteractionResponses = new Map<
    string,
    InteractionResponseEvent['payload']
  >();
  // Track text segment index per response.
  private readonly textSegmentIndex = new Map<string, number>();
  private readonly needsNewTextSegment = new Set<string>();
  private debugEnabled: boolean | null = null;
  private suppressTypingIndicator = false;

  constructor(container: HTMLElement, options: ChatRendererOptions = {}) {
    this.container = container;
    this.options = options;
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
    if (!this.isDebugEnabled()) {
      return;
    }
    console.log(`[ChatRenderer] ${message}`, data);
  }

  hasActiveOutput(): boolean {
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
    if (this.suppressTypingIndicator) {
      return;
    }
    this._isStreaming = true;
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
    this._isStreaming = false;
    if (this.typingIndicator) {
      this.typingIndicator.classList.remove('visible');
    }
  }

  renderEvent(event: ChatEvent): void {
    if (
      event.type === 'tool_call' ||
      event.type === 'assistant_chunk' ||
      event.type === 'assistant_done' ||
      event.type === 'interaction_request'
    ) {
      const toolCallId =
        (event.type === 'tool_call' || event.type === 'interaction_request') &&
        event.payload &&
        typeof event.payload === 'object'
          ? (event.payload as { toolCallId?: string }).toolCallId ?? null
          : null;
      this.debugLog('event', {
        type: event.type,
        id: event.id,
        timestamp: event.timestamp,
        turnId: event.turnId ?? null,
        responseId: event.responseId ?? null,
        toolCallId,
      });
    }

    switch (event.type) {
      case 'turn_start':
        this.handleTurnStart(event);
        break;
      case 'turn_end':
        this.handleTurnEnd(event);
        break;
      case 'user_message':
        this.handleUserMessage(event);
        break;
      case 'user_audio':
        this.handleUserAudio(event);
        break;
      case 'assistant_chunk':
        this.handleAssistantChunk(event);
        break;
      case 'assistant_done':
        this.handleAssistantDone(event);
        break;
      case 'thinking_chunk':
        this.handleThinkingChunk(event);
        break;
      case 'thinking_done':
        this.handleThinkingDone(event);
        break;
      case 'custom_message':
        this.handleCustomMessage(event);
        break;
      case 'summary_message':
        this.handleSummaryMessage(event);
        break;
      case 'tool_call':
        this.handleToolCall(event);
        break;
      case 'tool_input_chunk':
        this.handleToolInputChunk(event);
        break;
      case 'tool_output_chunk':
        this.handleToolOutputChunk(event);
        break;
      case 'tool_result':
        this.handleToolResult(event);
        break;
      case 'interaction_request':
        this.handleInteractionRequest(event);
        break;
      case 'interaction_response':
        this.handleInteractionResponse(event);
        break;
      case 'agent_message':
        this.handleAgentMessage(event);
        break;
      case 'agent_callback':
        this.handleAgentCallback(event);
        break;
      case 'interrupt':
        this.handleInterrupt(event);
        break;
      case 'error':
        this.handleError(event);
        break;
      default:
        // Event types that are not currently rendered (agent_switch, audio_*).
        break;
    }
  }

  replayEvents(events: ChatEvent[]): void {
    this.clear();
    this._isReplaying = true;
    for (const event of events) {
      this.renderEvent(event);
    }
    this._isReplaying = false;
  }

  handleNewEvent(event: ChatEvent): void {
    this.renderEvent(event);
  }

  clear(): void {
    this.container.innerHTML = '';
    this.turnElements.clear();
    this.responseElements.clear();
    this.assistantTextElements.clear();
    this.assistantTextBuffers.clear();
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
    this.needsNewTextSegment.clear();
    this.interactionElements.clear();
    this.pendingInteractionRequests.clear();
    this.pendingInteractionResponses.clear();
    this.interactionByToolCall.clear();
    this.pendingInteractionIds.clear();
    this.suppressTypingIndicator = false;
  }

  private handleTurnStart(event: TurnStartEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    this.getOrCreateTurnContainer(turnId);
  }

  private handleTurnEnd(event: TurnEndEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.turnElements.get(turnId);
    if (turnEl) {
      turnEl.classList.add('turn-complete');
    }
  }

  private handleUserMessage(event: UserMessageEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId);

    const text = stripContextLine(event.payload.text);
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

    // Show typing indicator immediately after user message is rendered (live events only)
    if (!this._isReplaying) {
      this.showTypingIndicator();
    }
  }

  private handleUserAudio(event: UserAudioEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId);

    const transcription = event.payload.transcription;
    const bubble = appendMessage(turnEl, 'user', transcription);
    bubble.classList.add('user-audio');
    bubble.dataset['eventId'] = event.id;
    bubble.dataset['renderer'] = 'unified';
  }

  private handleAssistantChunk(event: AssistantChunkEvent): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
    );
    const textEl = this.getOrCreateAssistantTextElement(responseId, responseEl);

    // Use segment-aware buffer key
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const bufferKey = `${responseId}:${segmentIdx}`;

    const previous = this.assistantTextBuffers.get(bufferKey) ?? '';
    const combined = previous + event.payload.text;
    this.assistantTextBuffers.set(bufferKey, combined);

    applyMarkdownToElement(textEl, combined);
    textEl.dataset['eventId'] = event.id;
    textEl.dataset['renderer'] = 'unified';
  }

  private handleAssistantDone(event: AssistantDoneEvent): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
    );
    const textEl = this.getOrCreateAssistantTextElement(responseId, responseEl);

    // Use segment-aware buffer key
    const segmentIdx = this.textSegmentIndex.get(responseId) ?? 0;
    const bufferKey = `${responseId}:${segmentIdx}`;

    const text = event.payload.text;
    this.assistantTextBuffers.set(bufferKey, text);
    applyMarkdownToElement(textEl, text);
    textEl.dataset['eventId'] = event.id;
    textEl.dataset['renderer'] = 'unified';
  }

  private handleThinkingChunk(event: ThinkingChunkEvent): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
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

  private handleThinkingDone(event: ThinkingDoneEvent): void {
    const responseId = this.getResponseId(event.responseId);
    if (!responseId) {
      return;
    }

    this.ensureTextSegment(responseId);

    const responseEl = this.getOrCreateAssistantResponseContainer(
      event.turnId,
      event.id,
      responseId,
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

  private handleCustomMessage(event: CustomMessageEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId);
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

  private handleSummaryMessage(event: SummaryMessageEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId);
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

  private handleToolCall(event: ToolCallEvent): void {
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

    // Check if block was already created by tool_input_chunk streaming
    let block = this.toolCallElements.get(callId);
    const existingBlock = !!block;

    if (block) {
      // Block exists from streaming - update it with final args
      block.classList.remove('streaming-input');
      const inputSection = block.querySelector('.tool-output-input-body');
      if (inputSection) {
        inputSection.classList.remove('streaming');
      }
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
      const responseEl = this.getOrCreateToolCallContainer(event.id, event.turnId, callId, responseId);

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

  private handleToolInputChunk(event: ToolInputChunkEvent): void {
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

    // Get or create the tool block
    let block = this.toolCallElements.get(callId);
    if (!block) {
      // Create the block early so we can show streaming input
      const responseId = this.getResponseId(event.responseId);
      const responseEl = this.getOrCreateToolCallContainer(event.id, event.turnId, callId, responseId);

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
    const inputSection = block.querySelector('.tool-output-input-body');
    if (inputSection) {
      inputSection.textContent = newBuffer;
      inputSection.classList.add('streaming');
    }

    this.updateToolCallGroupForBlock(block);
  }

  private handleToolOutputChunk(event: ToolOutputChunkEvent): void {
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

    const displayToolName = this.getDisplayToolNameForOutput(block, eventToolName);

    // Update with streaming content, mark as still pending
    updateToolOutputBlockContent(block, displayToolName, newBuffer, {
      streaming: true,
      state: 'running',
    });

    this.updateToolCallGroupForBlock(block);
  }

  private handleToolResult(event: ToolResultEvent): void {
    const callId = event.payload.toolCallId;
    const responseId = this.getResponseId(event.responseId);

    // Clean up streaming state
    this.toolOutputBuffers.delete(callId);
    this.toolOutputOffsets.delete(callId);
    this.toolOutputToolNames.delete(callId);

    // Prefer existing tool-call element; if missing, create a minimal one.
    let block = this.toolCallElements.get(callId) ?? null;
    if (!block) {
      const responseEl = this.getOrCreateToolCallContainer(event.id, event.turnId, callId, responseId);

      block = createToolOutputBlock({
        callId,
        toolName: event.payload.toolCallId,
        expanded: this.shouldExpandToolOutput(),
      });
      block.dataset['toolCallId'] = callId;
      block.dataset['eventId'] = event.id;
      block.dataset['renderer'] = 'unified';
      this.appendToolCallBlock(responseEl, responseId ?? undefined, block, block.dataset['toolName'] ?? '');
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

  private handleInteractionRequest(event: InteractionRequestEvent): void {
    const payload = event.payload;
    const interactionId = payload.interactionId;
    const toolCallId = payload.toolCallId;
    const enabled = this.options.getInteractionEnabled?.() ?? true;
    const presentation = payload.presentation ?? 'tool';

    if (!this._isReplaying) {
      this.markInteractionPending(interactionId);
    }

    if (presentation === 'questionnaire') {
      this.renderStandaloneInteraction(event, enabled);
      return;
    }

    const block = this.toolCallElements.get(toolCallId);
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

  private handleInteractionResponse(event: InteractionResponseEvent): void {
    const payload = event.payload;
    const interactionId = payload.interactionId;
    if (!this._isReplaying) {
      this.resolveInteractionPending(interactionId, payload.action);
    }
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

  private markInteractionPending(interactionId: string): void {
    if (this.pendingInteractionIds.has(interactionId)) {
      return;
    }
    this.pendingInteractionIds.add(interactionId);
    this.updateTypingSuppression();
  }

  private resolveInteractionPending(
    interactionId: string,
    action: InteractionResponseEvent['payload']['action'],
  ): void {
    if (!this.pendingInteractionIds.delete(interactionId)) {
      return;
    }
    this.updateTypingSuppression();
    if (this.pendingInteractionIds.size > 0 || action === 'cancel') {
      return;
    }
    this.showTypingIndicator();
  }

  private updateTypingSuppression(): void {
    const shouldSuppress = this.pendingInteractionIds.size > 0;
    if (this.suppressTypingIndicator === shouldSuppress) {
      return;
    }
    this.suppressTypingIndicator = shouldSuppress;
    if (shouldSuppress) {
      this.hideTypingIndicator();
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

  private renderStandaloneInteraction(event: InteractionRequestEvent, enabled: boolean): void {
    const payload = event.payload;
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
      const container =
        responseId
          ? this.getOrCreateAssistantResponseContainer(event.turnId, event.id, responseId)
          : fallbackContainer ??
            this.getOrCreateToolCallContainer(
              event.id,
              event.turnId,
              payload.toolCallId,
              responseId,
            );
      container.appendChild(element);
    }
    this.interactionElements.set(payload.interactionId, element);
    this.interactionByToolCall.set(payload.toolCallId, payload.interactionId);

    const pendingResponse = this.pendingInteractionResponses.get(payload.interactionId);
    if (pendingResponse) {
      this.pendingInteractionResponses.delete(payload.interactionId);
      applyInteractionResponse(element, pendingResponse);
    }
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

  private handleAgentMessage(_event: AgentMessageEvent): void {
    // agents_message tool blocks handle the display for both sync and async modes.
    // Skip rendering agent_message events entirely - they're just for tracking.
    // The tool block will register the messageId when tool_result arrives.
  }

  private handleAgentCallback(event: AgentCallbackEvent): void {
    const messageId = event.payload.messageId;
    const messageEl = this.agentMessageElements.get(messageId);
    if (!messageEl) {
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

  // Interrupts and errors are rendered as indicators on the current turn.

  private handleInterrupt(event: InterruptEvent): void {
    // Mark any pending tool blocks as interrupted
    const hasInterruptedToolBlock = this.interruptPendingToolBlocks();

    // Only add turn-level indicator if no tool blocks were interrupted
    if (!hasInterruptedToolBlock) {
      const turnId = this.getTurnId(event.turnId, event.id);
      const turnEl = this.getOrCreateTurnContainer(turnId);

      const indicator = document.createElement('div');
      indicator.className = 'message-interrupted';
      indicator.dataset['eventId'] = event.id;
      indicator.textContent = 'Interrupted';

      turnEl.appendChild(indicator);
    }
  }

  private handleError(event: ErrorEvent): void {
    const turnId = this.getTurnId(event.turnId, event.id);
    const turnEl = this.getOrCreateTurnContainer(turnId);

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

  private getOrCreateTurnContainer(turnId: string): HTMLDivElement {
    const existing = this.turnElements.get(turnId);
    if (existing) {
      return existing;
    }

    const turnEl = document.createElement('div');
    turnEl.className = 'turn';
    turnEl.dataset['turnId'] = turnId;
    this.container.appendChild(turnEl);

    this.turnElements.set(turnId, turnEl);
    return turnEl;
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
  ): HTMLDivElement {
    if (responseId) {
      return this.getOrCreateAssistantResponseContainer(turnIdRaw, eventId, responseId);
    }

    const existing = this.toolCallContainers.get(toolCallId);
    if (existing) {
      return existing;
    }

    const turnId = this.getTurnId(turnIdRaw, eventId);
    const turnEl = this.getOrCreateTurnContainer(turnId);

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
  ): HTMLDivElement {
    const existing = this.responseElements.get(responseId);
    if (existing) {
      return existing;
    }

    const turnId = this.getTurnId(turnIdRaw, fallbackTurnKey);
    const turnEl = this.getOrCreateTurnContainer(turnId);

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
    responseEl.appendChild(textEl);

    this.assistantTextElements.set(segmentKey, textEl);
    return textEl;
  }

  /**
   * Called when a tool block is inserted to start a new text segment after it.
   */
  private advanceTextSegment(responseId: string): void {
    const current = this.textSegmentIndex.get(responseId) ?? 0;
    this.textSegmentIndex.set(responseId, current + 1);
  }

  private ensureTextSegment(responseId: string): void {
    if (!this.needsNewTextSegment.has(responseId)) {
      return;
    }
    this.advanceTextSegment(responseId);
    this.needsNewTextSegment.delete(responseId);
  }

  private markTextSegmentBreak(responseId: string): void {
    this.needsNewTextSegment.add(responseId);
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
    return toolName !== 'agents_message';
  }

  private appendToolCallBlock(
    responseEl: HTMLDivElement,
    responseId: string | undefined,
    block: HTMLDivElement,
    toolName: string,
  ): void {
    const toolCallsContainer = this.getOrCreateToolCallsContainer(responseEl, responseId);

    if (!this.isGroupableToolCall(toolName)) {
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
