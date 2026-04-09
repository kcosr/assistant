export type NativeVoiceSelectedSession = {
  panelId: string;
  sessionId: string;
};

export type NativeVoiceRuntimeState =
  | 'disabled'
  | 'connecting'
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'error'
  | null;

type NativeVoiceSelectionInput = {
  activePanelId?: string | null;
  activePanelType?: string | null;
  fixedSessionId?: string | null;
  inputSessionId?: string | null;
};

function normalizeId(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveNativeVoiceSelectedSession(
  input: NativeVoiceSelectionInput,
): NativeVoiceSelectedSession | null {
  const sessionId = normalizeId(input.inputSessionId) ?? normalizeId(input.fixedSessionId);
  if (!sessionId) {
    return null;
  }

  const panelId =
    input.activePanelType === 'chat' ? (normalizeId(input.activePanelId) ?? '') : '';

  return { panelId, sessionId };
}

type VoiceFabControllerInput<T> = {
  inputSessionId?: string | null;
  getControllerForSession: (sessionId: string) => T | null;
  activeController?: T | null;
  primaryController?: T | null;
  nativeRuntimeState?: NativeVoiceRuntimeState;
};

export function resolveVoiceFabController<T>(
  input: VoiceFabControllerInput<T>,
): T | null {
  if (
    input.nativeRuntimeState === 'speaking' ||
    input.nativeRuntimeState === 'listening'
  ) {
    return input.activeController ?? input.primaryController ?? null;
  }

  const selectedSessionId = normalizeId(input.inputSessionId);
  if (selectedSessionId) {
    const selectedController = input.getControllerForSession(selectedSessionId);
    if (selectedController) {
      return selectedController;
    }
  }

  return input.primaryController ?? input.activeController ?? null;
}
