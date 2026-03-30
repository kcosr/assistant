import type { ChatEvent } from '@assistant/shared';
import { getAgentCallbackText, getUserVisibleUserText } from '../chatEventText';

function isSummaryAssistantText(event: ChatEvent & { type: 'assistant_done' }): boolean {
  return event.payload.phase !== 'commentary' && event.payload.interrupted !== true;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const sliceLength = maxLength - 1;
  if (sliceLength <= 0) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, sliceLength)}…`;
}

export function toSessionSummary(events: ChatEvent[]): {
  lastMessage: string;
  messageCount: number;
} {
  let lastMessage = '';
  let messageCount = 0;

  for (const event of events) {
    if (event.type === 'user_message' || event.type === 'user_audio') {
      const text = getUserVisibleUserText(event);
      if (!text) {
        continue;
      }
      lastMessage = text;
      messageCount += 1;
    } else if (event.type === 'assistant_done') {
      if (
        !isSummaryAssistantText(
          event as ChatEvent & {
            type: 'assistant_done';
          },
        )
      ) {
        continue;
      }
      const text = event.payload.text.trim();
      if (!text) {
        continue;
      }
      lastMessage = text;
      messageCount += 1;
    } else if (event.type === 'agent_callback') {
      const text = getAgentCallbackText(
        event as ChatEvent & {
          type: 'agent_callback';
        },
      );
      if (!text) {
        continue;
      }
      lastMessage = text;
      messageCount += 1;
    }
    // Other event types (chunks, audio, tool calls/results, errors, etc.) are
    // not counted as user-visible messages for the session summary.
  }

  return {
    lastMessage: truncate(lastMessage, 120),
    messageCount,
  };
}
