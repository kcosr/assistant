import type { ChatEvent } from '@assistant/shared';

export interface NormalizerContext {
  sessionId: string;
  turnId: string;
  responseId: string;
  generateEventId: () => string;
  timestamp: () => number;
}

export interface ProviderNormalizer<TChunk = unknown> {
  normalize(chunk: TChunk, context: NormalizerContext): ChatEvent[];
}

type CodexCliEvent = Record<string, unknown>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJsonLine(line: string): CodexCliEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (err) {
    throw new Error(`Unexpected Codex CLI output (non-JSON): ${String(err)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  return parsed as CodexCliEvent;
}

function extractMessageFromEvent(event: CodexCliEvent): CodexCliEvent | undefined {
  if (event['type']) {
    return event;
  }
  return undefined;
}

export class CodexCLINormalizer implements ProviderNormalizer<string> {
  normalize(line: string, ctx: NormalizerContext): ChatEvent[] {
    const events: ChatEvent[] = [];

    const parsed = parseJsonLine(line);
    if (!parsed) {
      return events;
    }

    const msg = extractMessageFromEvent(parsed);
    if (!msg) {
      return events;
    }

    const msgType = msg['type'];
    if (!isNonEmptyString(msgType)) {
      return events;
    }

    if (msgType === 'item.completed') {
      this.handleItemCompleted(msg, ctx, events);
      return events;
    }

    if (msgType === 'agent_message_delta') {
      const delta = msg['delta'];
      if (isNonEmptyString(delta)) {
        events.push(this.createAssistantChunkEvent(ctx, delta));
      }
      return events;
    }

    if (msgType === 'function_call') {
      const toolCallEvent = this.createFunctionCallEvent(msg, ctx);
      if (toolCallEvent) {
        events.push(toolCallEvent);
      }
      return events;
    }

    return events;
  }

  private handleItemCompleted(
    msg: CodexCliEvent,
    ctx: NormalizerContext,
    events: ChatEvent[],
  ): void {
    const item = msg['item'];
    if (!item || typeof item !== 'object') {
      return;
    }

    const itemObj = item as Record<string, unknown>;
    const itemType = itemObj['type'];

    if (itemType === 'agent_message') {
      const text = itemObj['text'];
      if (!isNonEmptyString(text)) {
        return;
      }

      events.push(this.createAssistantChunkEvent(ctx, text));
      events.push(this.createAssistantDoneEvent(ctx, text));
      return;
    }

    if (itemType === 'reasoning') {
      const text = itemObj['text'];
      if (!isNonEmptyString(text)) {
        return;
      }

      events.push(this.createThinkingChunkEvent(ctx, text));
      events.push(this.createThinkingDoneEvent(ctx, text));
    }
  }

  private createBaseEvent(ctx: NormalizerContext) {
    return {
      id: ctx.generateEventId(),
      timestamp: ctx.timestamp(),
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      responseId: ctx.responseId,
    };
  }

  private createAssistantChunkEvent(ctx: NormalizerContext, text: string): ChatEvent {
    return {
      ...this.createBaseEvent(ctx),
      type: 'assistant_chunk',
      payload: { text },
    };
  }

  private createAssistantDoneEvent(ctx: NormalizerContext, text: string): ChatEvent {
    return {
      ...this.createBaseEvent(ctx),
      type: 'assistant_done',
      payload: { text },
    };
  }

  private createThinkingChunkEvent(ctx: NormalizerContext, text: string): ChatEvent {
    return {
      ...this.createBaseEvent(ctx),
      type: 'thinking_chunk',
      payload: { text },
    };
  }

  private createThinkingDoneEvent(ctx: NormalizerContext, text: string): ChatEvent {
    return {
      ...this.createBaseEvent(ctx),
      type: 'thinking_done',
      payload: { text },
    };
  }

  private createFunctionCallEvent(msg: CodexCliEvent, ctx: NormalizerContext): ChatEvent | null {
    const nameValue = msg['name'];
    const callIdValue = msg['call_id'];

    const toolName = isNonEmptyString(nameValue) ? nameValue : 'function_call';
    const toolCallId = isNonEmptyString(callIdValue) ? callIdValue : ctx.generateEventId();

    const argsRaw = msg['arguments'];
    let args: Record<string, unknown> = {};

    if (typeof argsRaw === 'string') {
      try {
        const parsed = JSON.parse(argsRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // Ignore parse errors for arguments, fall back to empty args
      }
    } else if (argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)) {
      args = argsRaw as Record<string, unknown>;
    }

    return {
      ...this.createBaseEvent(ctx),
      type: 'tool_call',
      payload: {
        toolCallId,
        toolName,
        args,
      },
    };
  }
}
