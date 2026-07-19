/**
 * Prefix for ToolContext.sessionId values used by Realtime voice tool execution.
 * Keep in sync with VoiceService.executeToolCall context creation.
 */
export const VOICE_TOOL_SESSION_PREFIX = 'voice:';

export function isRealtimeToolSessionId(sessionId: string | undefined | null): boolean {
  if (!sessionId) {
    return false;
  }
  return sessionId.startsWith(VOICE_TOOL_SESSION_PREFIX);
}

export function realtimeToolSessionId(conversationId: string): string {
  return `${VOICE_TOOL_SESSION_PREFIX}${conversationId}`;
}
