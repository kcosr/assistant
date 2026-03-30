import type { ChatEvent } from '@assistant/shared';

export function getUserVisibleUserText(event: ChatEvent): string | null {
  switch (event.type) {
    case 'user_message': {
      const text = event.payload.text.trim();
      return text || null;
    }
    case 'user_audio': {
      const text = event.payload.transcription.trim();
      return text || null;
    }
    default:
      return null;
  }
}

export function getAgentCallbackText(event: ChatEvent & { type: 'agent_callback' }): string | null {
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
