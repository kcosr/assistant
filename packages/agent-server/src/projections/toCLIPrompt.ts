import type { ChatEvent } from '@assistant/shared';

function formatAgentCallbackLine(event: ChatEvent & { type: 'agent_callback' }): string | null {
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

function buildTranscript(events: ChatEvent[]): string {
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === 'user_message') {
      const text = event.payload.text.trim();
      if (!text) {
        continue;
      }
      lines.push(`User: ${text}`);
    } else if (event.type === 'assistant_done') {
      const text = event.payload.text.trim();
      if (!text) {
        continue;
      }
      lines.push(`Assistant: ${text}`);
    } else if (event.type === 'agent_callback') {
      const line = formatAgentCallbackLine(
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
