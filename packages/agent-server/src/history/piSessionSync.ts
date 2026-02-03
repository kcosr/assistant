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
