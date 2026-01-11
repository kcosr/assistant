import { applyMarkdownToElement } from '../utils/markdown';
import {
  createToolCallGroup,
  createToolOutputBlock,
  extractToolCallLabel,
  getToolCallGroupState,
  getToolCallSummary,
  setToolOutputBlockPending,
  updateToolCallGroup,
  updateToolOutputBlockContent,
} from '../utils/toolOutputRenderer';
import type { ToolOutputStatus } from '../utils/toolOutputRenderer';
import { extractTruncationStatusFromResult } from '../utils/toolTruncation';
import { buildToolHeaderLabel, formatToolResultText } from '../utils/toolResultFormatting';

type AgentExchangeId = string;

export type RenderableEvent =
  | {
      type: 'text_delta';
      responseId: string;
      delta: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'text_done';
      responseId: string;
      text: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'thinking_start';
      responseId: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'thinking_delta';
      responseId: string;
      delta: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'thinking_done';
      responseId: string;
      text: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'tool_call_start';
      callId: string;
      toolName: string;
      arguments: string;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'tool_output_delta';
      callId: string;
      toolName: string;
      delta: string;
      details?: Record<string, unknown>;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
      truncated?: boolean;
      truncatedBy?: 'lines' | 'bytes';
      totalLines?: number;
      totalBytes?: number;
      outputLines?: number;
      outputBytes?: number;
      sessionId?: string;
      timestamp?: string;
      agentExchangeId?: AgentExchangeId;
    }
  | {
      type: 'output_cancelled';
      responseId?: string;
      sessionId?: string;
      timestamp?: string;
    }
  | {
      type: 'agent_callback_result';
      responseId: string;
      result: string;
      sessionId?: string;
      timestamp?: string;
    };

export interface MessageRendererOptions {
  chatLogEl: HTMLElement;
  /**
   * Shared state used by serverMessageHandler; pass new instances for transcript replay.
   */
  responseElements?: Map<string, HTMLDivElement>;
  responseTexts?: Map<string, string>;
  toolOutputElements?: Map<string, HTMLDivElement>;
  toolOutputTexts?: Map<string, string>;
  thinkingElements?: Map<string, HTMLDivElement>;
  thinkingTexts?: Map<string, string>;
  currentTextSegments?: Map<string, HTMLDivElement>;
  segmentTexts?: Map<string, string>;
  needsNewSegment?: Set<string>;
  pendingAgentCallbackBlocks?: Map<string, HTMLDivElement>;
  getPendingAssistantBubble?: () => HTMLDivElement | null;
  setPendingAssistantBubble?: (bubble: HTMLDivElement | null) => void;
  appendMessage: (
    container: HTMLElement,
    role: 'user' | 'assistant' | 'error',
    text: string,
    useMarkdown?: boolean,
  ) => HTMLDivElement;
  getExpandToolOutput: () => boolean;
  appendInterruptedIndicator?: (container: HTMLElement) => HTMLDivElement;
  getInterruptedIndicatorContainer?: () => HTMLElement;
}

export class MessageRenderer {
  private readonly responseElements: Map<string, HTMLDivElement>;
  private readonly responseTexts: Map<string, string>;

  private readonly toolOutputElements: Map<string, HTMLDivElement>;
  private readonly toolOutputTexts: Map<string, string>;
  private readonly thinkingElements: Map<string, HTMLDivElement>;
  private readonly thinkingTexts: Map<string, string>;

  private readonly currentTextSegments: Map<string, HTMLDivElement>;
  private readonly segmentTexts: Map<string, string>;
  private readonly needsNewSegment: Set<string>;

  private readonly pendingAgentCallbackBlocks: Map<string, HTMLDivElement>;

  private unclaimedAssistantBubble: HTMLDivElement | null = null;
  private unclaimedNeedsNewSegment = false;

  constructor(private readonly options: MessageRendererOptions) {
    this.responseElements = options.responseElements ?? new Map<string, HTMLDivElement>();
    this.responseTexts = options.responseTexts ?? new Map<string, string>();
    this.toolOutputElements = options.toolOutputElements ?? new Map<string, HTMLDivElement>();
    this.toolOutputTexts = options.toolOutputTexts ?? new Map<string, string>();
    this.thinkingElements = options.thinkingElements ?? new Map<string, HTMLDivElement>();
    this.thinkingTexts = options.thinkingTexts ?? new Map<string, string>();
    this.currentTextSegments = options.currentTextSegments ?? new Map<string, HTMLDivElement>();
    this.segmentTexts = options.segmentTexts ?? new Map<string, string>();
    this.needsNewSegment = options.needsNewSegment ?? new Set<string>();
    this.pendingAgentCallbackBlocks =
      options.pendingAgentCallbackBlocks ?? new Map<string, HTMLDivElement>();
  }

  reset(): void {
    this.responseElements.clear();
    this.responseTexts.clear();
    this.toolOutputElements.clear();
    this.toolOutputTexts.clear();
    this.thinkingElements.clear();
    this.thinkingTexts.clear();
    this.currentTextSegments.clear();
    this.segmentTexts.clear();
    this.needsNewSegment.clear();
    this.pendingAgentCallbackBlocks.clear();
    this.unclaimedAssistantBubble = null;
    this.unclaimedNeedsNewSegment = false;
  }

  renderTranscript(records: RenderableEvent[]): void {
    for (const record of records) {
      this.handleEvent(record);
    }
  }

  handleEvent(event: RenderableEvent): void {
    switch (event.type) {
      case 'text_delta': {
        if (event.agentExchangeId) {
          // Agent exchanges are rendered by serverMessageHandler/sessionDataController.
          return;
        }
        this.handleTextDelta(event);
        return;
      }
      case 'text_done': {
        if (event.agentExchangeId) {
          return;
        }
        this.handleTextDone(event);
        return;
      }
      case 'thinking_start': {
        if (event.agentExchangeId) {
          return;
        }
        this.handleThinkingStart(event);
        return;
      }
      case 'thinking_delta': {
        if (event.agentExchangeId) {
          return;
        }
        this.handleThinkingDelta(event);
        return;
      }
      case 'thinking_done': {
        if (event.agentExchangeId) {
          return;
        }
        this.handleThinkingDone(event);
        return;
      }
      case 'tool_call_start': {
        if (event.agentExchangeId) {
          return;
        }
        this.handleToolCallStart(event);
        return;
      }
      case 'tool_output_delta': {
        if (event.agentExchangeId && !this.toolOutputElements.has(event.callId)) {
          return;
        }
        this.handleToolOutputDelta(event);
        return;
      }
      case 'tool_result': {
        if (event.agentExchangeId && !this.toolOutputElements.has(event.callId)) {
          return;
        }
        this.handleToolResult(event);
        return;
      }
      case 'output_cancelled': {
        this.handleOutputCancelled(event);
        return;
      }
      case 'agent_callback_result': {
        this.handleAgentCallbackResult(event);
        return;
      }
      default: {
        return;
      }
    }
  }

  private handleTextDelta(event: Extract<RenderableEvent, { type: 'text_delta' }>): void {
    if (!event.delta) {
      return;
    }

    const bubble = this.getOrCreateAssistantBubbleForResponse(event.responseId);
    this.setBubbleTyping(bubble, true);

    let segment = this.currentTextSegments.get(event.responseId);
    if (!segment || this.needsNewSegment.has(event.responseId)) {
      segment = document.createElement('div');
      segment.className = 'assistant-message-main';
      this.insertBeforeTypingIndicator(bubble, segment);
      this.currentTextSegments.set(event.responseId, segment);
      this.segmentTexts.set(event.responseId, '');
      this.needsNewSegment.delete(event.responseId);
    }

    const segmentText = (this.segmentTexts.get(event.responseId) ?? '') + event.delta;
    this.segmentTexts.set(event.responseId, segmentText);
    applyMarkdownToElement(segment, segmentText);

    const fullText = (this.responseTexts.get(event.responseId) ?? '') + event.delta;
    this.responseTexts.set(event.responseId, fullText);
  }

  private handleTextDone(event: Extract<RenderableEvent, { type: 'text_done' }>): void {
    const bubble = this.getOrCreateAssistantBubbleForResponse(event.responseId);
    this.setBubbleTyping(bubble, false);

    const mains = bubble.querySelectorAll<HTMLDivElement>(':scope > .assistant-message-main');
    if (mains.length <= 1) {
      const existing = mains.item(0);
      const segment = existing ?? this.createTextSegment(bubble);
      applyMarkdownToElement(segment, event.text);
    }

    this.responseTexts.delete(event.responseId);
    this.currentTextSegments.delete(event.responseId);
    this.segmentTexts.delete(event.responseId);
    this.needsNewSegment.delete(event.responseId);
  }

  private handleThinkingStart(event: Extract<RenderableEvent, { type: 'thinking_start' }>): void {
    const bubble = this.getOrCreateAssistantBubbleForResponse(event.responseId);
    this.setBubbleTyping(bubble, true);

    if (!this.thinkingTexts.has(event.responseId)) {
      this.thinkingTexts.set(event.responseId, '');
    }

    this.getOrCreateThinkingElement(event.responseId, bubble);
  }

  private handleThinkingDelta(event: Extract<RenderableEvent, { type: 'thinking_delta' }>): void {
    if (!event.delta) {
      return;
    }
    const bubble = this.getOrCreateAssistantBubbleForResponse(event.responseId);
    this.setBubbleTyping(bubble, true);

    const thinkingEl = this.getOrCreateThinkingElement(event.responseId, bubble);
    if (!thinkingEl) {
      return;
    }

    const currentText = (this.thinkingTexts.get(event.responseId) ?? '') + event.delta;
    this.thinkingTexts.set(event.responseId, currentText);
    thinkingEl.textContent = currentText;
  }

  private handleThinkingDone(event: Extract<RenderableEvent, { type: 'thinking_done' }>): void {
    const bubble = this.getOrCreateAssistantBubbleForResponse(event.responseId);
    this.setBubbleTyping(bubble, true);

    const thinkingEl = this.getOrCreateThinkingElement(event.responseId, bubble);
    if (!thinkingEl) {
      return;
    }

    this.thinkingTexts.set(event.responseId, event.text);
    thinkingEl.textContent = event.text;
  }

  private handleToolCallStart(event: Extract<RenderableEvent, { type: 'tool_call_start' }>): void {
    const callId = event.callId;
    if (!callId) {
      return;
    }

    const hostBubble = this.findHostAssistantBubbleForToolOutput();
    this.setBubbleTyping(hostBubble, true);

    const headerLabel = extractToolCallLabel(event.toolName, event.arguments);
    const expanded = this.options.getExpandToolOutput();
    const blockOptions: Parameters<typeof createToolOutputBlock>[0] = {
      callId,
      toolName: event.toolName,
      expanded,
    };
    if (headerLabel) {
      blockOptions.headerLabel = headerLabel;
    }

    const block = createToolOutputBlock(blockOptions);
    setToolOutputBlockPending(block, event.arguments);
    this.appendToolCallBlock(hostBubble, block, event.toolName);

    this.toolOutputElements.set(callId, block);
    this.toolOutputTexts.set(callId, '');

    const responseId = this.findResponseIdForBubble(hostBubble);
    if (responseId) {
      this.currentTextSegments.delete(responseId);
      this.segmentTexts.delete(responseId);
      this.needsNewSegment.add(responseId);
    } else {
      this.unclaimedNeedsNewSegment = true;
    }
  }

  private handleToolOutputDelta(
    event: Extract<RenderableEvent, { type: 'tool_output_delta' }>,
  ): void {
    const callId = event.callId;
    if (!callId) {
      return;
    }

    let block = this.toolOutputElements.get(callId);
    if (!block) {
      const hostBubble = this.findHostAssistantBubbleForToolOutput();
      this.setBubbleTyping(hostBubble, true);

      const toolHeaderLabel = buildToolHeaderLabel(event.toolName);
      const expanded = this.options.getExpandToolOutput();
      const blockOptions: Parameters<typeof createToolOutputBlock>[0] = {
        callId,
        toolName: event.toolName,
        expanded,
        ...(toolHeaderLabel ? { headerLabel: toolHeaderLabel } : {}),
      };
      block = createToolOutputBlock(blockOptions);
      this.appendToolCallBlock(hostBubble, block, event.toolName);

      this.toolOutputElements.set(callId, block);
      this.toolOutputTexts.set(callId, '');

      const responseId = this.findResponseIdForBubble(hostBubble);
      if (responseId) {
        this.currentTextSegments.delete(responseId);
        this.segmentTexts.delete(responseId);
        this.needsNewSegment.add(responseId);
      } else {
        this.unclaimedNeedsNewSegment = true;
      }
    }

    const currentText = (this.toolOutputTexts.get(callId) ?? '') + event.delta;
    this.toolOutputTexts.set(callId, currentText);
    updateToolOutputBlockContent(block, event.toolName, currentText);
    this.updateToolCallGroupForBlock(block);
  }

  private handleToolResult(event: Extract<RenderableEvent, { type: 'tool_result' }>): void {
    const callId = event.callId;
    if (!callId) {
      return;
    }

    let block = this.toolOutputElements.get(callId);
    if (!block) {
      const hostBubble = this.findHostAssistantBubbleForToolOutput();
      this.setBubbleTyping(hostBubble, true);

      const toolHeaderLabel = buildToolHeaderLabel(event.toolName);
      const expanded = this.options.getExpandToolOutput();
      const blockOptions: Parameters<typeof createToolOutputBlock>[0] = {
        callId,
        toolName: event.toolName,
        expanded,
        ...(toolHeaderLabel ? { headerLabel: toolHeaderLabel } : {}),
      };
      block = createToolOutputBlock(blockOptions);
      this.appendToolCallBlock(hostBubble, block, event.toolName);
      this.toolOutputElements.set(callId, block);
      this.toolOutputTexts.set(callId, '');
    }

    if (event.toolName === 'agents_message' && event.result && typeof event.result === 'object') {
      const resultObj = event.result as Record<string, unknown>;
      const mode =
        typeof resultObj['mode'] === 'string' ? (resultObj['mode'] as string) : undefined;
      const statusValue =
        typeof resultObj['status'] === 'string' ? (resultObj['status'] as string) : undefined;
      const responseIdValue =
        typeof resultObj['responseId'] === 'string' &&
        (resultObj['responseId'] as string).trim().length > 0
          ? (resultObj['responseId'] as string).trim()
          : undefined;

      if ((mode === 'async' || statusValue === 'queued') && responseIdValue) {
        this.pendingAgentCallbackBlocks.set(responseIdValue, block);
        block.dataset['systemAgentResponseId'] = responseIdValue;

        const outputSection = block.querySelector<HTMLElement>('.tool-output-result');
        if (outputSection) {
          outputSection.innerHTML = '';

          const label = document.createElement('div');
          label.className = 'tool-output-section-label';
          label.textContent = 'Received';
          outputSection.appendChild(label);

          const pendingIndicator = document.createElement('div');
          pendingIndicator.className = 'tool-output-pending';
          pendingIndicator.textContent =
            statusValue === 'queued'
              ? 'Queued – waiting for agent to become available…'
              : 'Waiting for response…';
          outputSection.appendChild(pendingIndicator);
        }

        block.classList.add('pending');
        this.updateToolCallGroupForBlock(block);
        return;
      }
    }

    const resultText = formatToolResultText({
      toolName: event.toolName,
      ok: event.ok,
      result: event.result,
      ...(event.error ? { error: event.error } : {}),
    });

    const status: ToolOutputStatus = {
      ok: event.ok,
      interrupted: event.error?.code === 'tool_interrupted',
    };

    // Prefer explicit truncation metadata (WS), otherwise derive from result (transcript).
    if (event.truncated === true) {
      status.truncated = true;
    }
    if (event.truncatedBy === 'lines' || event.truncatedBy === 'bytes') {
      status.truncatedBy = event.truncatedBy;
    }
    if (typeof event.totalLines === 'number') {
      status.totalLines = event.totalLines;
    }
    if (typeof event.totalBytes === 'number') {
      status.totalBytes = event.totalBytes;
    }
    if (typeof event.outputLines === 'number') {
      status.outputLines = event.outputLines;
    }
    if (typeof event.outputBytes === 'number') {
      status.outputBytes = event.outputBytes;
    }
    if (!status.truncated) {
      const derived = extractTruncationStatusFromResult(event.result);
      if (derived) {
        if (derived.truncated === true) {
          status.truncated = true;
        }
        if (derived.truncatedBy) {
          status.truncatedBy = derived.truncatedBy;
        }
        if (typeof derived.totalLines === 'number') {
          status.totalLines = derived.totalLines;
        }
        if (typeof derived.totalBytes === 'number') {
          status.totalBytes = derived.totalBytes;
        }
        if (typeof derived.outputLines === 'number') {
          status.outputLines = derived.outputLines;
        }
        if (typeof derived.outputBytes === 'number') {
          status.outputBytes = derived.outputBytes;
        }
      }
    }

    if (event.toolName === 'agents_message') {
      status.agentCallback = true;
      status.inputLabel = 'Sent';
      status.outputLabel = 'Received';
      const argsJson = block.dataset['argsJson'];
      if (argsJson) {
        try {
          const args = JSON.parse(argsJson) as Record<string, unknown>;
          if (typeof args['content'] === 'string') {
            status.inputText = args['content'];
          }
        } catch {
          // ignore
        }
      }
    }

    updateToolOutputBlockContent(block, event.toolName, resultText, status);
    this.updateToolCallGroupForBlock(block);
  }

  private handleOutputCancelled(
    event: Extract<RenderableEvent, { type: 'output_cancelled' }>,
  ): void {
    const responseId = event.responseId;

    // Remove any typing indicators in the chat.
    const allTypingIndicators = this.options.chatLogEl.querySelectorAll('.typing-indicator');
    allTypingIndicators.forEach((indicator) => indicator.remove());

    let bubble: HTMLDivElement | null = null;
    let bubbleIsPending = false;
    if (responseId) {
      bubble = this.responseElements.get(responseId) ?? null;
    }
    if (!bubble) {
      const pendingBubble = this.options.getPendingAssistantBubble?.() ?? null;
      if (pendingBubble) {
        bubble = pendingBubble;
        bubbleIsPending = true;
      } else if (this.unclaimedAssistantBubble) {
        bubble = this.unclaimedAssistantBubble;
        bubbleIsPending = true;
      }
    }
    if (!bubble) {
      // Fall back to last known assistant message bubble.
      for (const candidate of this.responseElements.values()) {
        bubble = candidate;
      }
    }

    if (bubble) {
      delete bubble.dataset['typing'];
      const hasContent =
        bubble.querySelector('.tool-output-block') !== null ||
        Boolean(bubble.querySelector('.assistant-message-main')?.textContent?.trim()) ||
        Boolean(bubble.querySelector('.thinking-content')?.textContent?.trim());

      if (this.options.getPendingAssistantBubble?.() === bubble) {
        this.options.setPendingAssistantBubble?.(null);
      }
      if (this.unclaimedAssistantBubble === bubble) {
        this.unclaimedAssistantBubble = null;
      }
      if (bubbleIsPending && !hasContent) {
        bubble.remove();
      }
    }

    this.appendInterruptedIndicator();

    if (responseId) {
      this.currentTextSegments.delete(responseId);
      this.segmentTexts.delete(responseId);
      this.needsNewSegment.delete(responseId);
    } else {
      this.unclaimedNeedsNewSegment = false;
    }
  }

  private handleAgentCallbackResult(
    event: Extract<RenderableEvent, { type: 'agent_callback_result' }>,
  ): void {
    const block = this.pendingAgentCallbackBlocks.get(event.responseId);
    if (!block) {
      return;
    }

    this.pendingAgentCallbackBlocks.delete(event.responseId);

    const toolName = block.dataset['toolName'] || 'agents_message';
    const callbackStatus: ToolOutputStatus = {
      ok: true,
      agentCallback: true,
      inputLabel: 'Sent',
      outputLabel: 'Received',
    };
    const argsJson = block.dataset['argsJson'];
    if (argsJson) {
      try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        if (typeof args['content'] === 'string') {
          callbackStatus.inputText = args['content'];
        }
      } catch {
        // ignore
      }
    }
    updateToolOutputBlockContent(block, toolName, event.result, callbackStatus);
    this.updateToolCallGroupForBlock(block);
  }

  private getOrCreateAssistantBubbleForResponse(responseId: string): HTMLDivElement {
    let bubble = this.responseElements.get(responseId);
    if (bubble) {
      return bubble;
    }

    const pendingBubble =
      this.options.getPendingAssistantBubble?.() ?? this.unclaimedAssistantBubble;
    if (pendingBubble) {
      bubble = pendingBubble;
      this.options.setPendingAssistantBubble?.(null);
      if (this.unclaimedAssistantBubble === pendingBubble) {
        this.unclaimedAssistantBubble = null;
      }
      this.responseElements.set(responseId, bubble);
      if (!this.responseTexts.has(responseId)) {
        this.responseTexts.set(responseId, '');
      }
      if (this.unclaimedNeedsNewSegment) {
        this.needsNewSegment.add(responseId);
        this.unclaimedNeedsNewSegment = false;
      }
      return bubble;
    }

    bubble = this.options.appendMessage(this.options.chatLogEl, 'assistant', '', false);
    this.responseElements.set(responseId, bubble);
    this.responseTexts.set(responseId, '');
    return bubble;
  }

  private findHostAssistantBubbleForToolOutput(): HTMLDivElement {
    const pendingBubble =
      this.options.getPendingAssistantBubble?.() ?? this.unclaimedAssistantBubble;
    if (pendingBubble) {
      this.unclaimedAssistantBubble = pendingBubble;
      return pendingBubble;
    }

    let lastResponseBubble: HTMLDivElement | null = null;
    for (const bubble of this.responseElements.values()) {
      lastResponseBubble = bubble;
    }
    if (lastResponseBubble) {
      return lastResponseBubble;
    }

    const assistantMessages =
      this.options.chatLogEl.querySelectorAll<HTMLDivElement>('.message.assistant');
    if (assistantMessages.length > 0) {
      const last = assistantMessages[assistantMessages.length - 1];
      if (last) {
        return last;
      }
    }

    const bubble = this.options.appendMessage(this.options.chatLogEl, 'assistant', '', false);
    this.unclaimedAssistantBubble = bubble;
    return bubble;
  }

  private createTextSegment(bubble: HTMLDivElement): HTMLDivElement {
    const segment = document.createElement('div');
    segment.className = 'assistant-message-main';
    this.insertBeforeTypingIndicator(bubble, segment);
    return segment;
  }

  private getOrCreateThinkingElement(
    responseId: string,
    bubble: HTMLDivElement,
  ): HTMLDivElement | null {
    let thinkingEl = this.thinkingElements.get(responseId) ?? null;
    if (!thinkingEl) {
      thinkingEl = document.createElement('div');
      thinkingEl.className = 'thinking-content';
      bubble.insertBefore(thinkingEl, bubble.firstChild);
      this.thinkingElements.set(responseId, thinkingEl);
      this.thinkingTexts.set(responseId, '');
    }
    return thinkingEl;
  }

  private setBubbleTyping(bubble: HTMLDivElement, typing: boolean): void {
    if (!typing) {
      const indicator = bubble.querySelector<HTMLElement>(':scope > .typing-indicator');
      if (indicator) {
        indicator.remove();
      }
      delete bubble.dataset['typing'];
      return;
    }

    bubble.dataset['typing'] = 'true';

    let indicator = bubble.querySelector<HTMLElement>(':scope > .typing-indicator');
    if (indicator) {
      return;
    }

    // If the indicator exists but is nested (legacy), move it out so markdown updates don't wipe it.
    const nested = bubble.querySelector<HTMLElement>('.typing-indicator');
    if (nested) {
      nested.remove();
    }

    indicator = document.createElement('span');
    indicator.className = 'typing-indicator';
    indicator.appendChild(document.createElement('span'));
    indicator.appendChild(document.createElement('span'));
    indicator.appendChild(document.createElement('span'));

    bubble.appendChild(indicator);
  }

  private insertBeforeTypingIndicator(bubble: HTMLDivElement, el: HTMLElement): void {
    const indicator = bubble.querySelector<HTMLElement>(':scope > .typing-indicator');
    if (indicator) {
      bubble.insertBefore(el, indicator);
    } else {
      bubble.appendChild(el);
    }
  }

  private isGroupableToolCall(toolName: string): boolean {
    return toolName !== 'agents_message';
  }

  private appendToolCallBlock(
    bubble: HTMLDivElement,
    block: HTMLDivElement,
    toolName: string,
  ): void {
    if (!this.isGroupableToolCall(toolName)) {
      this.insertBeforeTypingIndicator(bubble, block);
      return;
    }

    const lastChild = this.getLastBubbleChild(bubble);
    if (!lastChild) {
      this.insertBeforeTypingIndicator(bubble, block);
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
        const group = createToolCallGroup({ expanded: this.options.getExpandToolOutput() });
        bubble.replaceChild(group, lastChild);
        const groupContent = group.querySelector<HTMLDivElement>('.tool-call-group-content');
        if (groupContent) {
          groupContent.appendChild(lastChild);
          groupContent.appendChild(block);
        }
        this.refreshToolCallGroup(group);
        return;
      }
    }

    this.insertBeforeTypingIndicator(bubble, block);
  }

  private getLastBubbleChild(bubble: HTMLDivElement): HTMLElement | null {
    const last = bubble.lastElementChild as HTMLElement | null;
    if (!last) {
      return null;
    }
    if (last.classList.contains('typing-indicator')) {
      return last.previousElementSibling as HTMLElement | null;
    }
    return last;
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

  private findResponseIdForBubble(bubble: HTMLDivElement): string | null {
    for (const [responseId, known] of this.responseElements.entries()) {
      if (known === bubble) {
        return responseId;
      }
    }
    return null;
  }

  private appendInterruptedIndicator(): void {
    const container = this.options.getInterruptedIndicatorContainer?.() ?? this.options.chatLogEl;

    if (this.options.appendInterruptedIndicator) {
      this.options.appendInterruptedIndicator(container);
      return;
    }

    const indicator = document.createElement('div');
    indicator.className = 'message-interrupted';
    indicator.textContent = 'Interrupted';
    container.appendChild(indicator);
  }
}
