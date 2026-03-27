import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage } from '../chatCompletionTypes';

export function attachPiSdkMessageToLastAssistant(options: {
  messages: ChatCompletionMessage[];
  piSdkMessage?: PiSdkMessage;
}): ChatCompletionMessage[] {
  const { messages, piSdkMessage } = options;
  if (!piSdkMessage || piSdkMessage.role !== 'assistant') {
    return messages;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') {
      continue;
    }
    if (message.piSdkMessage) {
      return messages;
    }
    const nextMessages = messages.slice();
    nextMessages[i] = { ...message, piSdkMessage };
    return nextMessages;
  }

  return messages;
}

export function buildMessagesForPiSync(options: {
  stateMessages: ChatCompletionMessage[];
  replayMessages?: ChatCompletionMessage[];
  finalAssistantMessage?: ChatCompletionMessage & { role: 'assistant' };
}): ChatCompletionMessage[] {
  const { stateMessages, replayMessages, finalAssistantMessage } = options;
  const baseMessages = replayMessages ?? stateMessages;
  if (!finalAssistantMessage) {
    return baseMessages;
  }

  // If replay messages alias live state, the final assistant message has
  // already been pushed onto stateMessages and must not be appended again.
  if (baseMessages === stateMessages) {
    return stateMessages;
  }

  const lastMessage = baseMessages[baseMessages.length - 1];
  if (lastMessage?.role === 'assistant') {
    if (
      finalAssistantMessage.piSdkMessage &&
      lastMessage.piSdkMessage === finalAssistantMessage.piSdkMessage
    ) {
      return baseMessages;
    }
    if (
      lastMessage.content === finalAssistantMessage.content &&
      !lastMessage.tool_calls &&
      !finalAssistantMessage.tool_calls
    ) {
      return baseMessages;
    }
  }

  return [...baseMessages, finalAssistantMessage];
}
