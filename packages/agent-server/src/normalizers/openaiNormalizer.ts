import { randomUUID } from 'node:crypto';

import type { ChatEvent } from '@assistant/shared';

import type { NormalizerContext, ProviderNormalizer } from './types';

interface ToolCallState {
  id: string;
  name: string;
  argumentsJson: string;
}

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

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore JSON parse errors and fall back to empty args object.
  }

  return {};
}

export class OpenAINormalizer implements ProviderNormalizer {
  private readonly textByChoiceIndex = new Map<number, string>();

  private readonly toolCallsByChoiceIndex = new Map<number, Map<number, ToolCallState>>();

  normalize(chunk: unknown, context: NormalizerContext): ChatEvent[] {
    const events: ChatEvent[] = [];

    if (!chunk || typeof chunk !== 'object') {
      return events;
    }

    const chunkWithChoices = chunk as { choices?: unknown };
    const choices = Array.isArray(chunkWithChoices.choices) ? chunkWithChoices.choices : [];

    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
      const rawChoice = choices[choiceIndex];
      if (!rawChoice || typeof rawChoice !== 'object') {
        continue;
      }

      const choice = rawChoice as {
        delta?: {
          content?: unknown;
          tool_calls?: unknown;
        };
        finish_reason?: unknown;
      };

      const delta = choice.delta;
      const finishReasonRaw = choice.finish_reason;
      const finishReason =
        typeof finishReasonRaw === 'string' && finishReasonRaw.length > 0
          ? finishReasonRaw
          : undefined;

      if (!delta && !finishReason) {
        continue;
      }

      if (delta) {
        const deltaText = extractTextFromContent(delta.content);
        if (deltaText) {
          const previousText = this.textByChoiceIndex.get(choiceIndex) ?? '';
          const newText = previousText + deltaText;
          this.textByChoiceIndex.set(choiceIndex, newText);

          events.push({
            id: context.generateEventId(),
            timestamp: context.timestamp(),
            sessionId: context.sessionId,
            turnId: context.turnId,
            responseId: context.responseId,
            type: 'assistant_chunk',
            payload: { text: deltaText },
          });
        }

        const deltaToolCalls = (delta as { tool_calls?: unknown }).tool_calls;
        if (Array.isArray(deltaToolCalls)) {
          for (const rawToolCall of deltaToolCalls) {
            if (!rawToolCall || typeof rawToolCall !== 'object') {
              continue;
            }

            const toolCall = rawToolCall as {
              index?: unknown;
              id?: unknown;
              function?: {
                name?: unknown;
                arguments?: unknown;
              };
            };

            const indexRaw = toolCall.index;
            const toolCallIndex =
              typeof indexRaw === 'number' && Number.isFinite(indexRaw) ? indexRaw : 0;

            let toolCallsForChoice = this.toolCallsByChoiceIndex.get(choiceIndex);
            if (!toolCallsForChoice) {
              toolCallsForChoice = new Map<number, ToolCallState>();
              this.toolCallsByChoiceIndex.set(choiceIndex, toolCallsForChoice);
            }

            let state = toolCallsForChoice.get(toolCallIndex);
            if (!state) {
              const idRaw = toolCall.id;
              const id = typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : randomUUID();

              const functionBlock = toolCall.function;
              const name =
                functionBlock && typeof functionBlock.name === 'string' ? functionBlock.name : '';

              state = {
                id,
                name,
                argumentsJson: '',
              };
              toolCallsForChoice.set(toolCallIndex, state);
            }

            const functionBlock = toolCall.function;
            if (functionBlock && typeof functionBlock.arguments === 'string') {
              state.argumentsJson += functionBlock.arguments;
            }
          }
        }
      }

      if (finishReason === 'stop') {
        const fullText = this.textByChoiceIndex.get(choiceIndex) ?? '';

        events.push({
          id: context.generateEventId(),
          timestamp: context.timestamp(),
          sessionId: context.sessionId,
          turnId: context.turnId,
          responseId: context.responseId,
          type: 'assistant_done',
          payload: { text: fullText },
        });
        this.textByChoiceIndex.delete(choiceIndex);
      } else if (finishReason === 'tool_calls') {
        const toolCallsForChoice = this.toolCallsByChoiceIndex.get(choiceIndex);
        if (toolCallsForChoice && toolCallsForChoice.size > 0) {
          const sortedIndices = [...toolCallsForChoice.keys()].sort((left, right) => left - right);

          for (const toolCallIndex of sortedIndices) {
            const state = toolCallsForChoice.get(toolCallIndex);
            if (!state || !state.name) {
              continue;
            }

            const args = parseToolArguments(state.argumentsJson);
            events.push({
              id: context.generateEventId(),
              timestamp: context.timestamp(),
              sessionId: context.sessionId,
              turnId: context.turnId,
              responseId: context.responseId,
              type: 'tool_call',
              payload: {
                toolCallId: state.id,
                toolName: state.name,
                args,
              },
            });
          }
        }

        this.toolCallsByChoiceIndex.delete(choiceIndex);
      }
    }

    return events;
  }
}
