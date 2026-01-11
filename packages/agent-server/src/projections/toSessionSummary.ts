import type { ChatEvent } from '@assistant/shared';

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
    if (event.type === 'user_message') {
      const text = event.payload.text.trim();
      if (!text) {
        continue;
      }
      lastMessage = text;
      messageCount += 1;
    } else if (event.type === 'assistant_done') {
      const text = event.payload.text.trim();
      if (!text) {
        continue;
      }
      lastMessage = text;
      messageCount += 1;
    } else if (event.type === 'agent_callback') {
      const text = formatAgentCallbackText(
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
