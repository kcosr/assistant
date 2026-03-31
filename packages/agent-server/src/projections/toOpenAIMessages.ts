import type { ChatEvent } from '@assistant/shared';

import { getAgentCallbackText, getUserVisibleUserText } from '../chatEventText';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
} from '../chatCompletionTypes';

function isReplayableAssistantText(event: ChatEvent & { type: 'assistant_done' }): boolean {
  return event.payload.phase !== 'commentary' && event.payload.interrupted !== true;
}

export function toOpenAIMessages(events: ChatEvent[]): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'user_message':
      case 'user_audio': {
        const text = getUserVisibleUserText(event);
        if (!text) {
          break;
        }

        messages.push({
          role: 'user',
          content: text,
        });
        break;
      }

      case 'assistant_done': {
        if (
          !isReplayableAssistantText(
            event as ChatEvent & {
              type: 'assistant_done';
            },
          )
        ) {
          break;
        }
        const text = event.payload.text.trim();
        if (!text) {
          break;
        }

        messages.push({
          role: 'assistant',
          content: text,
        });
        break;
      }

      case 'tool_call': {
        const toolCall: ChatCompletionToolCallMessageToolCall = {
          id: event.payload.toolCallId,
          type: 'function',
          function: {
            name: event.payload.toolName,
            arguments: JSON.stringify(event.payload.args ?? {}),
          },
        };

        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant') {
          const existing = last.tool_calls;
          if (existing) {
            existing.push(toolCall);
          } else {
            last.tool_calls = [toolCall];
          }
        } else {
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [toolCall],
          });
        }
        break;
      }

      case 'tool_result': {
        const { toolCallId, result, error } = event.payload;

        const content = JSON.stringify({
          ok: !error,
          result,
          ...(error ? { error } : {}),
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content,
        });
        break;
      }

      case 'agent_callback': {
        const text = getAgentCallbackText(
          event as ChatEvent & {
            type: 'agent_callback';
          },
        );
        if (!text) {
          break;
        }

        messages.push({
          role: 'user',
          content: text,
        });
        break;
      }

      default:
        // Skip non-text / streaming / audio events for OpenAI context
        break;
    }
  }

  return messages;
}
