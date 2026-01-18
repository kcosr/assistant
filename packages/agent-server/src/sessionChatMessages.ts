import type { ChatEvent } from '@assistant/shared';

import type { Tool } from './tools';
import type { AgentRegistry } from './agents';
import { buildSystemPrompt } from './systemPrompt';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
} from './chatCompletionTypes';

type AssistantMessage = ChatCompletionMessage & { role: 'assistant' };

export function buildChatMessagesFromEvents(
  events: ChatEvent[],
  agentRegistry: AgentRegistry,
  agentId: string | undefined,
  tools?: Tool[],
  sessionId?: string,
): ChatCompletionMessage[] {
  const promptOptions = {
    agentRegistry,
    agentId,
    ...(tools !== undefined ? { tools } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(promptOptions),
    },
  ];

  const assistantTextMessages = new Map<string, AssistantMessage>();
  const toolCallMessages = new Map<string, AssistantMessage>();

  const ensureAssistantMessage = (responseId: string, initialText: string): AssistantMessage => {
    const existing = assistantTextMessages.get(responseId);
    if (existing) {
      return existing;
    }
    const message: AssistantMessage = {
      role: 'assistant',
      content: initialText,
    };
    messages.push(message);
    assistantTextMessages.set(responseId, message);
    return message;
  };

  const ensureToolCallMessage = (responseKey: string): AssistantMessage => {
    const existing = toolCallMessages.get(responseKey);
    if (existing) {
      return existing;
    }
    const message: AssistantMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [],
    };
    messages.push(message);
    toolCallMessages.set(responseKey, message);
    return message;
  };

  for (const event of events) {
    switch (event.type) {
      case 'user_message': {
        const text = event.payload.text.trim();
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'user_audio': {
        const text = event.payload.transcription.trim();
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'agent_message': {
        const text = event.payload.message.trim();
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'agent_callback': {
        const text = event.payload.result.trim();
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'assistant_chunk': {
        const responseId = event.responseId?.trim();
        if (!responseId) {
          break;
        }
        const delta = event.payload.text;
        if (!delta) {
          break;
        }
        const message = ensureAssistantMessage(responseId, '');
        message.content = `${message.content}${delta}`;
        break;
      }
      case 'assistant_done': {
        const responseId = event.responseId?.trim();
        if (!responseId) {
          break;
        }
        const text = event.payload.text.trim();
        if (!text) {
          break;
        }
        const message = ensureAssistantMessage(responseId, text);
        message.content = text;
        break;
      }
      case 'tool_call': {
        const responseKey = event.responseId?.trim() || `event:${event.id}`;
        const toolMessage = ensureToolCallMessage(responseKey);
        let argsJson = '{}';
        try {
          argsJson = JSON.stringify(event.payload.args ?? {});
        } catch {
          argsJson = '{}';
        }
        const toolCall: ChatCompletionToolCallMessageToolCall = {
          id: event.payload.toolCallId,
          type: 'function',
          function: {
            name: event.payload.toolName,
            arguments: argsJson,
          },
        };
        if (!toolMessage.tool_calls) {
          toolMessage.tool_calls = [];
        }
        toolMessage.tool_calls.push(toolCall);
        break;
      }
      case 'tool_result': {
        const content = JSON.stringify({
          ok: !event.payload.error,
          result: event.payload.result,
          error: event.payload.error,
        });
        messages.push({
          role: 'tool',
          tool_call_id: event.payload.toolCallId,
          content,
        });
        break;
      }
      default:
        break;
    }
  }

  return messages;
}
