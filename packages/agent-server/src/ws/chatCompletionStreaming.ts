import { randomUUID } from 'node:crypto';

import type OpenAI from 'openai';

import type { ChatCompletionMessage, ChatCompletionToolCallState } from '../chatCompletionTypes';

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        text += (part as { text: string }).text;
      }
    }
    return text;
  }

  return '';
}

export interface ToolCallStartInfo {
  id: string;
  name: string;
}

export interface ToolInputDeltaInfo {
  id: string;
  name: string;
  argumentsDelta: string;
  argumentsJson: string; // Cumulative arguments so far
}

export async function runChatCompletionIteration(options: {
  openaiClient: OpenAI;
  model: string;
  messages: ChatCompletionMessage[];
  tools: unknown[];
  abortSignal: AbortSignal;
  debug: boolean;
  onDeltaText: (deltaText: string, iterationText: string) => Promise<void> | void;
  onToolCallStart?: (info: ToolCallStartInfo) => Promise<void> | void;
  onToolInputDelta?: (info: ToolInputDeltaInfo) => Promise<void> | void;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; toolCalls: ChatCompletionToolCallState[] }> {
  const {
    openaiClient,
    model,
    messages,
    tools,
    abortSignal,
    debug,
    onDeltaText,
    onToolCallStart,
    onToolInputDelta,
    maxTokens,
    temperature,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    ...(tools.length > 0
      ? {
          tools,
          tool_choice: 'auto' as const,
        }
      : {}),
    ...(typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
      ? { max_tokens: maxTokens }
      : {}),
    ...(typeof temperature === 'number' && Number.isFinite(temperature) ? { temperature } : {}),
    stream: true,
  };

  if (debug) {
    console.log('[chat request]', JSON.stringify(body, null, 2));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI SDK streaming response type
  const stream: AsyncIterable<unknown> = await (openaiClient.chat.completions.create as any)(body, {
    signal: abortSignal,
  });

  let iterationText = '';
  const toolCallsByIndex = new Map<number, ChatCompletionToolCallState>();

  for await (const chunk of stream) {
    const chunkObj = chunk as { choices?: unknown[] };
    const choice = Array.isArray(chunkObj.choices) ? chunkObj.choices[0] : undefined;
    if (!choice) {
      continue;
    }

    const delta = (choice as { delta?: unknown }).delta as
      | {
          content?: unknown;
          tool_calls?: unknown;
        }
      | undefined;

    if (!delta) {
      continue;
    }

    const deltaText = extractTextFromContent(delta.content);

    if (deltaText.length > 0) {
      iterationText += deltaText;
      await onDeltaText(deltaText, iterationText);
    }

    const deltaToolCalls = (delta as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(deltaToolCalls)) {
      for (const toolCallDelta of deltaToolCalls) {
        if (!toolCallDelta || typeof toolCallDelta !== 'object') {
          continue;
        }

        const indexRaw = (toolCallDelta as { index?: unknown }).index;
        const index = typeof indexRaw === 'number' && Number.isFinite(indexRaw) ? indexRaw : 0;

        let state = toolCallsByIndex.get(index);
        const isNewToolCall = !state;

        if (!state) {
          const idRaw = (toolCallDelta as { id?: unknown }).id;
          const id = typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : randomUUID();
          const functionBlock = (
            toolCallDelta as {
              function?: {
                name?: unknown;
                arguments?: unknown;
              };
            }
          ).function;
          const name =
            functionBlock && typeof functionBlock.name === 'string' ? functionBlock.name : '';

          state = {
            id,
            name,
            argumentsJson: '',
          };
          toolCallsByIndex.set(index, state);
        }

        const functionBlock = (
          toolCallDelta as {
            function?: {
              arguments?: unknown;
            };
          }
        ).function;

        // Emit tool call start when we first see this tool call (and have a name)
        if (isNewToolCall && state.name && onToolCallStart) {
          await onToolCallStart({ id: state.id, name: state.name });
        }

        if (functionBlock && typeof functionBlock.arguments === 'string') {
          const argumentsDelta = functionBlock.arguments;
          state.argumentsJson += argumentsDelta;

          // Emit input delta
          if (onToolInputDelta && argumentsDelta.length > 0) {
            await onToolInputDelta({
              id: state.id,
              name: state.name,
              argumentsDelta,
              argumentsJson: state.argumentsJson,
            });
          }
        }
      }
    }
  }

  const toolCalls: ChatCompletionToolCallState[] = [];
  for (const state of toolCallsByIndex.values()) {
    if (state.name) {
      toolCalls.push(state);
    }
  }

  if (debug) {
    console.log('[chat response]', JSON.stringify({ text: iterationText, toolCalls }, null, 2));
  }

  return {
    text: iterationText,
    toolCalls,
  };
}
