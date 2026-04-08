export type NativeVoiceSelectedSession = {
  panelId: string;
  sessionId: string;
};

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
