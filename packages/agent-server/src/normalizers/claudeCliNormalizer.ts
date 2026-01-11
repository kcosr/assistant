import { randomUUID } from 'node:crypto';

import type { ChatEvent } from '@assistant/shared';

import type { NormalizerContext, ProviderNormalizer } from './types';

type ClaudeCliStreamEvent = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractTextDelta(event: ClaudeCliStreamEvent): string | undefined {
  const eventField = event['event'];
  if (eventField && typeof eventField === 'object') {
    const nested = extractTextDelta(eventField as ClaudeCliStreamEvent);
    if (nested) {
      return nested;
    }
  }

  const type = event['type'];
  if (type === 'stream_event' || type === 'content_block_delta') {
    const maybeEvent = type === 'stream_event' ? event['event'] : event;
    if (maybeEvent && typeof maybeEvent === 'object') {
      const innerType = (maybeEvent as Record<string, unknown>)['type'];
      if (innerType === 'content_block_delta') {
        const innerDelta = (maybeEvent as Record<string, unknown>)['delta'];
        if (innerDelta && typeof innerDelta === 'object') {
          const deltaType = (innerDelta as Record<string, unknown>)['type'];
          const deltaText = (innerDelta as Record<string, unknown>)['text'];
          if (deltaType === 'text_delta' && isNonEmptyString(deltaText)) {
            return deltaText;
          }
        }
      }
    }
  }

  const delta = event['delta'];
  if (isNonEmptyString(delta)) {
    return delta;
  }

  if (delta && typeof delta === 'object') {
    const deltaText = (delta as Record<string, unknown>)['text'];
    if (isNonEmptyString(deltaText)) {
      return deltaText;
    }
  }

  const deltaText = event['deltaText'];
  if (isNonEmptyString(deltaText)) {
    return deltaText;
  }

  return undefined;
}

function extractFullText(event: ClaudeCliStreamEvent): string | undefined {
  const completion = event['completion'];
  if (isNonEmptyString(completion)) {
    return completion;
  }

  const text = event['text'];
  if (isNonEmptyString(text)) {
    return text;
  }

  const message = event['message'];
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>)['content'];
    if (isNonEmptyString(content)) {
      return content;
    }
    if (Array.isArray(content)) {
      const chunks: string[] = [];
      for (const block of content) {
        if (block && typeof block === 'object') {
          const blockType = (block as Record<string, unknown>)['type'];
          const blockText = (block as Record<string, unknown>)['text'];
          if (blockType === 'text' && isNonEmptyString(blockText)) {
            chunks.push(blockText);
          }
        }
      }
      if (chunks.length > 0) {
        return chunks.join('');
      }
    }
  }

  return undefined;
}

export class ClaudeCLINormalizer implements ProviderNormalizer {
  private fullText = '';

  private claudeTextOnly = '';

  private thinkingText = '';

  private thinkingStarted = false;

  private thinkingDone = false;

  private readonly toolCallIdByToolUseId = new Map<string, string>();

  private readonly emittedToolCallIds = new Set<string>();

  private readonly emittedToolResultIds = new Set<string>();

  normalize(line: string, ctx: NormalizerContext): ChatEvent[];
  normalize(chunk: unknown, ctx: NormalizerContext): ChatEvent[];
  normalize(chunk: unknown, ctx: NormalizerContext): ChatEvent[] {
    if (typeof chunk !== 'string') {
      throw new Error('ClaudeCLINormalizer expects chunk to be a string line');
    }

    const line = chunk.trim();
    if (!line) {
      return [];
    }

    let event: ClaudeCliStreamEvent;
    try {
      event = JSON.parse(line) as ClaudeCliStreamEvent;
    } catch {
      throw new Error(`Unexpected Claude CLI output (non-JSON): ${line}`);
    }

    const events: ChatEvent[] = [];
    this.processEvent(event, ctx, events);
    return events;
  }

  private processEvent(
    event: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    const coreEvent =
      event &&
      typeof event === 'object' &&
      (event as { type?: unknown }).type === 'stream_event' &&
      (event as { event?: unknown }).event &&
      typeof (event as { event?: unknown }).event === 'object'
        ? ((event as { event: ClaudeCliStreamEvent }).event as ClaudeCliStreamEvent)
        : event;

    const coreType = (coreEvent as { type?: unknown }).type;

    if (coreType === 'assistant') {
      this.handleAssistantMessage(coreEvent, ctx, outEvents);
      return;
    }

    if (coreType === 'user') {
      this.handleUserMessage(coreEvent, ctx, outEvents);
      return;
    }

    if (coreType === 'content_block_start') {
      this.handleContentBlockStart(coreEvent, ctx, outEvents);
    } else if (coreType === 'content_block_delta') {
      this.handleContentBlockDelta(coreEvent, ctx, outEvents);
    } else if (coreType === 'content_block_stop') {
      this.handleContentBlockStop(ctx, outEvents);
    } else if (coreType === 'message_stop') {
      this.finalizeThinking(ctx, outEvents);
    }

    const topLevelType = (event as { type?: unknown }).type;
    if (topLevelType === 'result') {
      this.handleResultSummary(event, ctx, outEvents);
      return;
    }

    const explicitDelta = extractTextDelta(event);
    if (explicitDelta) {
      this.fullText += explicitDelta;
      outEvents.push(
        this.createEvent(
          'assistant_chunk',
          {
            text: explicitDelta,
          },
          ctx,
        ),
      );
      return;
    }

    const nextFullText = extractFullText(event);
    if (nextFullText !== undefined) {
      if (nextFullText === this.claudeTextOnly) {
        return;
      }

      if (!nextFullText.startsWith(this.claudeTextOnly)) {
        this.claudeTextOnly = nextFullText;
        return;
      }

      const delta = nextFullText.slice(this.claudeTextOnly.length);
      this.claudeTextOnly = nextFullText;
      if (delta) {
        this.fullText += delta;
        outEvents.push(
          this.createEvent(
            'assistant_chunk',
            {
              text: delta,
            },
            ctx,
          ),
        );
      }
    }
  }

  private handleAssistantMessage(
    coreEvent: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    const message = (coreEvent as { message?: unknown }).message;
    if (!message || typeof message !== 'object') {
      return;
    }

    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return;
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const blockType = (block as { type?: unknown }).type;
      if (blockType === 'tool_use') {
        const nameRaw = (block as { name?: unknown }).name;
        const idRaw = (block as { id?: unknown }).id;
        const name = typeof nameRaw === 'string' ? nameRaw.trim() : undefined;
        const toolUseId =
          typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : undefined;
        const input = (block as { input?: unknown }).input;

        const options: {
          toolUseId?: string;
          name?: string;
          input: unknown;
          ctx: NormalizerContext;
          outEvents: ChatEvent[];
        } = {
          input,
          ctx,
          outEvents,
        };
        if (toolUseId) {
          options.toolUseId = toolUseId;
        }
        if (name) {
          options.name = name;
        }

        this.emitToolCall(options);
      }
    }
  }

  private handleUserMessage(
    coreEvent: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    const message = (coreEvent as { message?: unknown }).message;
    if (!message || typeof message !== 'object') {
      return;
    }

    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return;
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const blockType = (block as { type?: unknown }).type;
      if (blockType === 'tool_result') {
        const resultPayload =
          (block as { content?: unknown }).content ?? (block as { result?: unknown }).result;
        const toolUseIdRaw = (block as { tool_use_id?: unknown }).tool_use_id;
        const toolUseId =
          typeof toolUseIdRaw === 'string' && toolUseIdRaw.trim().length > 0
            ? toolUseIdRaw.trim()
            : undefined;

        const options: {
          toolUseId?: string;
          resultPayload: unknown;
          ctx: NormalizerContext;
          outEvents: ChatEvent[];
        } = {
          resultPayload,
          ctx,
          outEvents,
        };
        if (toolUseId) {
          options.toolUseId = toolUseId;
        }

        this.emitToolResult(options);
      }
    }
  }

  private handleContentBlockStart(
    coreEvent: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    const contentBlock = (coreEvent as { [key: string]: unknown })['content_block'];
    if (!contentBlock || typeof contentBlock !== 'object') {
      return;
    }

    const block = contentBlock as { [key: string]: unknown };
    const blockTypeRaw = block['type'];
    const blockType = typeof blockTypeRaw === 'string' ? blockTypeRaw : undefined;

    if (blockType === 'tool_use' || blockType === 'server_tool_use') {
      const nameRaw = block['name'];
      const idRaw = block['id'];
      const name = typeof nameRaw === 'string' ? nameRaw.trim() : undefined;
      const toolUseId =
        typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : undefined;

      const input = block['input'];
      const hasInput =
        input !== undefined &&
        input !== null &&
        !(typeof input === 'object' && Object.keys(input as object).length === 0);

      if (hasInput) {
        const options: {
          toolUseId?: string;
          name?: string;
          input: unknown;
          ctx: NormalizerContext;
          outEvents: ChatEvent[];
        } = {
          input,
          ctx,
          outEvents,
        };
        if (toolUseId) {
          options.toolUseId = toolUseId;
        }
        if (name) {
          options.name = name;
        }

        this.emitToolCall(options);
      }
    } else if (
      blockType === 'tool_result' ||
      (typeof blockType === 'string' && blockType.endsWith('_tool_result'))
    ) {
      const content = block['content'] ?? block['result'];
      const hasContent = content !== undefined && content !== null && content !== '';

      if (!hasContent) {
        return;
      }
      const toolUseIdRaw = block['tool_use_id'];
      const toolUseId =
        typeof toolUseIdRaw === 'string' && toolUseIdRaw.trim().length > 0
          ? toolUseIdRaw.trim()
          : undefined;

      const options: {
        toolUseId?: string;
        resultPayload: unknown;
        ctx: NormalizerContext;
        outEvents: ChatEvent[];
      } = {
        resultPayload: content,
        ctx,
        outEvents,
      };
      if (toolUseId) {
        options.toolUseId = toolUseId;
      }

      this.emitToolResult(options);
    }
  }

  private handleContentBlockDelta(
    coreEvent: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    const delta = (coreEvent as { [key: string]: unknown })['delta'];
    if (!delta || typeof delta !== 'object') {
      return;
    }

    const deltaObj = delta as { [key: string]: unknown };
    const deltaTypeRaw = deltaObj['type'];
    const deltaType = typeof deltaTypeRaw === 'string' ? deltaTypeRaw : undefined;
    if (deltaType === 'thinking_delta') {
      const thinkingRaw = deltaObj['thinking'];
      if (typeof thinkingRaw === 'string' && thinkingRaw.trim()) {
        const text = thinkingRaw;
        this.thinkingStarted = true;
        this.thinkingText += text;
        outEvents.push(
          this.createEvent(
            'thinking_chunk',
            {
              text,
            },
            ctx,
          ),
        );
      }
    }
  }

  private handleContentBlockStop(ctx: NormalizerContext, outEvents: ChatEvent[]): void {
    this.finalizeThinking(ctx, outEvents);
  }

  private handleResultSummary(
    event: ClaudeCliStreamEvent,
    ctx: NormalizerContext,
    outEvents: ChatEvent[],
  ): void {
    this.finalizeThinking(ctx, outEvents);

    const resultText = event['result'];
    const textValue = isNonEmptyString(resultText) ? resultText : this.fullText;
    if (!textValue) {
      return;
    }

    this.fullText = textValue;

    outEvents.push(
      this.createEvent(
        'assistant_done',
        {
          text: textValue,
        },
        ctx,
      ),
    );
  }

  private emitToolCall(options: {
    toolUseId?: string;
    name?: string;
    input: unknown;
    ctx: NormalizerContext;
    outEvents: ChatEvent[];
  }): void {
    const { toolUseId, name, input, ctx, outEvents } = options;

    const callId = this.getOrCreateToolCallId(toolUseId);
    if (this.emittedToolCallIds.has(callId)) {
      return;
    }
    this.emittedToolCallIds.add(callId);

    const finalName = name?.trim() || 'tool';

    let args: Record<string, unknown>;
    if (input && typeof input === 'object') {
      args = input as Record<string, unknown>;
    } else {
      args = {};
    }

    outEvents.push(
      this.createEvent(
        'tool_call',
        {
          toolCallId: callId,
          toolName: finalName,
          args,
        },
        ctx,
      ),
    );
  }

  private emitToolResult(options: {
    toolUseId?: string;
    resultPayload: unknown;
    ctx: NormalizerContext;
    outEvents: ChatEvent[];
  }): void {
    const { toolUseId, resultPayload, ctx, outEvents } = options;

    const callId = this.getOrCreateToolCallId(toolUseId);
    if (this.emittedToolResultIds.has(callId)) {
      return;
    }
    this.emittedToolResultIds.add(callId);

    outEvents.push(
      this.createEvent(
        'tool_result',
        {
          toolCallId: callId,
          result: resultPayload,
        },
        ctx,
      ),
    );
  }

  private getOrCreateToolCallId(toolUseId: string | undefined): string {
    if (toolUseId && toolUseId.trim().length > 0) {
      const existing = this.toolCallIdByToolUseId.get(toolUseId);
      if (existing) {
        return existing;
      }
      const callId = randomUUID();
      this.toolCallIdByToolUseId.set(toolUseId, callId);
      return callId;
    }
    return randomUUID();
  }

  private finalizeThinking(ctx: NormalizerContext, outEvents: ChatEvent[]): void {
    if (!this.thinkingStarted || this.thinkingDone) {
      return;
    }
    this.thinkingDone = true;

    outEvents.push(
      this.createEvent(
        'thinking_done',
        {
          text: this.thinkingText,
        },
        ctx,
      ),
    );
  }

  private createEvent(
    type: ChatEvent['type'],
    payload: ChatEvent['payload'],
    ctx: NormalizerContext,
  ): ChatEvent {
    return {
      id: ctx.generateEventId(),
      timestamp: ctx.timestamp(),
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      responseId: ctx.responseId,
      type,
      payload,
    } as ChatEvent;
  }
}
