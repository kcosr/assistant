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

  return appendFinalAssistantMessage(baseMessages, finalAssistantMessage);
}

function appendFinalAssistantMessage(
  baseMessages: ChatCompletionMessage[],
  finalAssistantMessage: ChatCompletionMessage & { role: 'assistant' },
): ChatCompletionMessage[] {
  if (!finalAssistantMessage) {
    return baseMessages;
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

function areEquivalentReplayMessages(
  left: ChatCompletionMessage | undefined,
  right: ChatCompletionMessage | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  if (left === right) {
    return true;
  }
  const leftToolCallId = left.role === 'tool' ? left.tool_call_id : undefined;
  const rightToolCallId = right.role === 'tool' ? right.tool_call_id : undefined;
  const leftHistoryTimestamp = 'historyTimestampMs' in left ? left.historyTimestampMs : undefined;
  const rightHistoryTimestamp = 'historyTimestampMs' in right ? right.historyTimestampMs : undefined;
  return (
    left.role === right.role &&
    left.content === right.content &&
    leftToolCallId === rightToolCallId &&
    leftHistoryTimestamp === rightHistoryTimestamp
  );
}

function isReplayPrefix(
  prefix: ChatCompletionMessage[],
  messages: ChatCompletionMessage[],
): boolean {
  if (prefix.length > messages.length) {
    return false;
  }
  return prefix.every((message, index) => areEquivalentReplayMessages(message, messages[index]));
}

export function resolveInterruptedPiSyncMessages(options: {
  baseMessages: ChatCompletionMessage[];
  replayMessages?: ChatCompletionMessage[];
  finalAssistantMessage?: ChatCompletionMessage & { role: 'assistant' };
}): {
  messages: ChatCompletionMessage[];
  droppedMessages: ChatCompletionMessage[];
} {
  const { baseMessages, replayMessages, finalAssistantMessage } = options;
  const replay = replayMessages ?? baseMessages;
  const droppedMessages =
    replay !== baseMessages && replay.length > baseMessages.length && isReplayPrefix(baseMessages, replay)
      ? replay.slice(baseMessages.length)
      : [];
  const safeMessages = droppedMessages.length > 0 ? baseMessages : replay;
  if (!finalAssistantMessage) {
    return {
      messages: safeMessages,
      droppedMessages,
    };
  }
  return {
    messages: appendFinalAssistantMessage(safeMessages, finalAssistantMessage),
    droppedMessages,
  };
}
