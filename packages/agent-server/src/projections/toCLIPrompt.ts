import type { ChatEvent } from '@assistant/shared';
import { getAgentCallbackText, getUserVisibleUserText } from '../chatEventText';

function isPromptAssistantText(event: ChatEvent & { type: 'assistant_done' }): boolean {
  return event.payload.phase !== 'commentary' && event.payload.interrupted !== true;
}

function buildTranscript(events: ChatEvent[]): string {
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === 'user_message' || event.type === 'user_audio') {
      const text = getUserVisibleUserText(event);
      if (!text) {
        continue;
      }
      lines.push(`User: ${text}`);
    } else if (event.type === 'assistant_done') {
      if (
        !isPromptAssistantText(
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
      lines.push(`Assistant: ${text}`);
    } else if (event.type === 'agent_callback') {
      const line = getAgentCallbackText(
        event as ChatEvent & {
          type: 'agent_callback';
        },
      );
      if (!line) {
        continue;
      }
      lines.push(line);
    }
    // Other event types (chunks, audio, tool calls/results, errors, etc.) are
    // intentionally omitted from the plain-text CLI prompt.
  }

  return lines.join('\n');
}

export function toClaudeCLIPrompt(events: ChatEvent[]): string {
  return buildTranscript(events);
}

export function toCodexCLIPrompt(events: ChatEvent[]): string {
  return buildTranscript(events);
}
