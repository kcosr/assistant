import type { ChatEvent } from '@assistant/shared';

import type { Tool } from './tools';
import type { AgentRegistry } from './agents';
import { getAgentCallbackText, getUserVisibleUserText } from './chatEventText';
import { buildSystemPrompt } from './systemPrompt';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
} from './chatCompletionTypes';

type AssistantMessage = ChatCompletionMessage & { role: 'assistant' };
type OpenAssistantTextSegment = {
  responseId: string;
  phase?: AssistantMessage['assistantTextPhase'];
  message: AssistantMessage;
};
type OpenAssistantToolCallSegment = {
  responseId?: string;
  message: AssistantMessage;
};

export function buildChatMessagesFromEvents(
  events: ChatEvent[],
  agentRegistry: AgentRegistry,
  agentId: string | undefined,
  tools?: Tool[],
  sessionId?: string,
  workingDir?: string,
  selectedInstructionSkillNames?: string[],
): ChatCompletionMessage[] {
  const interruptedResponseIds = new Set(
    events
      .filter((event) => event.type === 'interrupt')
      .map((event) => event.responseId?.trim())
      .filter((responseId): responseId is string => Boolean(responseId)),
  );

  const promptOptions = {
    agentRegistry,
    agentId,
    ...(tools !== undefined ? { tools } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(workingDir !== undefined ? { workingDir } : {}),
    ...(selectedInstructionSkillNames !== undefined ? { selectedInstructionSkillNames } : {}),
  };
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(promptOptions),
    },
  ];

  const openAssistantTextSegments = new Map<string, OpenAssistantTextSegment>();
  let openAssistantToolCallSegment: OpenAssistantToolCallSegment | undefined;
  const closeAssistantTextSegment = (responseId?: string): void => {
    if (!responseId) {
      return;
    }
    openAssistantTextSegments.delete(responseId);
  };
  const closeAssistantToolCallSegment = (): void => {
    openAssistantToolCallSegment = undefined;
  };
  const createAssistantMessage = (
    initialText: string,
    phase?: AssistantMessage['assistantTextPhase'],
    textSignature?: string,
  ): AssistantMessage => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: initialText,
      ...(phase ? { assistantTextPhase: phase } : {}),
      ...(textSignature ? { assistantTextSignature: textSignature } : {}),
    };
    messages.push(message);
    return message;
  };
  const ensureOpenAssistantTextSegment = (
    responseId: string,
    phase?: AssistantMessage['assistantTextPhase'],
  ): AssistantMessage => {
    const existing = openAssistantTextSegments.get(responseId);
    if (existing && existing.phase === phase) {
      return existing.message;
    }
    const message = createAssistantMessage('', phase);
    openAssistantTextSegments.set(responseId, { responseId, phase, message });
    return message;
  };

  for (const event of events) {
    switch (event.type) {
      case 'user_message':
      case 'user_audio': {
        closeAssistantToolCallSegment();
        const text = getUserVisibleUserText(event);
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'agent_message': {
        closeAssistantToolCallSegment();
        const text = event.payload.message.trim();
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'agent_callback': {
        closeAssistantToolCallSegment();
        const text = getAgentCallbackText(event);
        if (!text) {
          break;
        }
        messages.push({ role: 'user', content: text });
        break;
      }
      case 'assistant_chunk': {
        closeAssistantToolCallSegment();
        const responseId = event.responseId?.trim();
        if (!responseId) {
          break;
        }
        if (interruptedResponseIds.has(responseId)) {
          break;
        }
        const delta = event.payload.text;
        if (!delta) {
          break;
        }
        const message = ensureOpenAssistantTextSegment(responseId, event.payload.phase);
        message.content = `${message.content}${delta}`;
        if (event.payload.phase) {
          message.assistantTextPhase = event.payload.phase;
        }
        if (event.payload.textSignature) {
          message.assistantTextSignature = event.payload.textSignature;
        }
        break;
      }
      case 'assistant_done': {
        closeAssistantToolCallSegment();
        const responseId = event.responseId?.trim();
        if (!responseId) {
          break;
        }
        if (event.payload.interrupted === true) {
          break;
        }
        if (interruptedResponseIds.has(responseId)) {
          break;
        }
        const text = event.payload.text.trim();
        if (!text) {
          break;
        }
        const existing = openAssistantTextSegments.get(responseId);
        if (existing && existing.phase === event.payload.phase) {
          existing.message.content = text;
          if (event.payload.phase) {
            existing.message.assistantTextPhase = event.payload.phase;
          }
          if (event.payload.textSignature) {
            existing.message.assistantTextSignature = event.payload.textSignature;
          }
          closeAssistantTextSegment(responseId);
          break;
        }
        createAssistantMessage(text, event.payload.phase, event.payload.textSignature);
        break;
      }
      case 'thinking_chunk': {
        const responseId = event.responseId?.trim();
        if (responseId && interruptedResponseIds.has(responseId)) {
          break;
        }
        break;
      }
      case 'thinking_done': {
        const responseId = event.responseId?.trim();
        if (responseId && interruptedResponseIds.has(responseId)) {
          break;
        }
        break;
      }
      case 'tool_call': {
        closeAssistantTextSegment(event.responseId?.trim());
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
        const responseId = event.responseId?.trim();
        const openToolCallMessage =
          openAssistantToolCallSegment &&
          openAssistantToolCallSegment.message.tool_calls &&
          openAssistantToolCallSegment.responseId === responseId
            ? openAssistantToolCallSegment.message
            : undefined;
        if (openToolCallMessage?.tool_calls) {
          openToolCallMessage.tool_calls.push(toolCall);
        } else {
          const message: AssistantMessage = {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall],
          };
          messages.push(message);
          openAssistantToolCallSegment = {
            message,
            ...(responseId ? { responseId } : {}),
          };
        }
        break;
      }
      case 'tool_result': {
        closeAssistantToolCallSegment();
        closeAssistantTextSegment(event.responseId?.trim());
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
