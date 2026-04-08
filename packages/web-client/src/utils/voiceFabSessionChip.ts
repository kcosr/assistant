export type VoiceFabChipMode = 'idle' | 'speaking' | 'listening';

export interface VoiceFabSessionChipState {
  visible: boolean;
  interactive: boolean;
  title: string | null;
}

export interface ResolveVoiceFabSessionChipStateArgs {
  mode: VoiceFabChipMode;
  inputSessionId: string | null;
  nativeVoiceBridgeSelectedSessionId: string | null;
  nativeVoiceActiveSessionId: string | null;
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
    normalizeSessionId,
    resolveSessionTitle,
  } = args;

  if (mode === 'idle') {
    return { visible: false, interactive: false, title: null };
  }

  if (mode === 'speaking') {
    const sessionId =
      normalizeSessionId(nativeVoiceActiveSessionId) ??
      normalizeSessionId(inputSessionId) ??
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
    normalizeSessionId(nativeVoiceBridgeSelectedSessionId);
  return {
    visible: Boolean(sessionId),
    interactive: Boolean(sessionId),
    title: resolveSessionTitle(sessionId),
  };
}
