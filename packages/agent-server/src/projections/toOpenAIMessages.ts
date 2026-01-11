import type { ChatEvent } from '@assistant/shared';

import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
} from '../chatCompletionTypes';

function formatAgentCallbackText(event: ChatEvent & { type: 'agent_callback' }): string | null {
  const result = event.payload.result.trim();
  if (!result) {
    return null;
  }

  const fromAgentIdRaw = event.payload.fromAgentId;
  const fromAgentId =
    typeof fromAgentIdRaw === 'string' && fromAgentIdRaw.trim().length > 0
      ? fromAgentIdRaw.trim()
      : 'agent';

  return `[Callback from ${fromAgentId}]: ${result}`;
}

export function toOpenAIMessages(events: ChatEvent[]): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'user_message': {
        const text = event.payload.text.trim();
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
        const text = formatAgentCallbackText(
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
