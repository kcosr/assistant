export type VoiceRuntimeMode = 'thread' | 'realtime';

export function getDefaultVoiceRuntimeMode(): VoiceRuntimeMode {
  return 'thread';
}

export function normalizeVoiceRuntimeMode(
  value: string | null | undefined,
): VoiceRuntimeMode {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : '') {
    case 'realtime':
      return 'realtime';
    case 'thread':
      return 'thread';
    default:
      return getDefaultVoiceRuntimeMode();
  }
}
