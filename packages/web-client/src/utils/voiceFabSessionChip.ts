export type VoiceFabChipMode = 'idle' | 'speaking' | 'listening';

export interface VoiceFabSessionChipState {
  visible: boolean;
  interactive: boolean;
  title: string | null;
}

export interface ResolveVoiceFabSessionChipStateArgs {
  inputSessionId: string | null;
  mode: VoiceFabChipMode;
  nativeVoiceBridgeSelectedSessionId: string | null;
  nativeVoiceActiveSessionId: string | null;
  nativeVoiceActiveDisplayTitle: string | null;
  preferredVoiceSessionId: string | null;
  normalizeSessionId: (sessionId: string | null) => string | null;
  resolveSessionTitle: (sessionId: string | null) => string | null;
}

export function resolveVoiceFabSessionChipState(
  args: ResolveVoiceFabSessionChipStateArgs,
): VoiceFabSessionChipState {
  const {
    mode,
    inputSessionId,
    nativeVoiceBridgeSelectedSessionId,
    nativeVoiceActiveSessionId,
    nativeVoiceActiveDisplayTitle,
    preferredVoiceSessionId,
    normalizeSessionId,
    resolveSessionTitle,
  } = args;

  if (mode === 'idle') {
    return { visible: false, interactive: false, title: null };
  }

  if (mode === 'speaking') {
    const displayTitle = nativeVoiceActiveDisplayTitle?.trim() ?? '';
    if (displayTitle) {
      return {
        visible: true,
        interactive: false,
        title: displayTitle,
      };
    }
    const sessionId =
      normalizeSessionId(nativeVoiceActiveSessionId) ??
      normalizeSessionId(inputSessionId) ??
      normalizeSessionId(preferredVoiceSessionId) ??
      normalizeSessionId(nativeVoiceBridgeSelectedSessionId);
    return {
      visible: Boolean(sessionId),
      interactive: false,
      title: resolveSessionTitle(sessionId),
    };
  }

  const sessionId =
    normalizeSessionId(nativeVoiceActiveSessionId) ??
    normalizeSessionId(inputSessionId) ??
    normalizeSessionId(preferredVoiceSessionId) ??
    normalizeSessionId(nativeVoiceBridgeSelectedSessionId);
  return {
    visible: Boolean(sessionId),
    interactive: Boolean(sessionId),
    title: resolveSessionTitle(sessionId),
  };
}
