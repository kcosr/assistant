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
  if (input.activePanelType !== 'chat') {
    return null;
  }

  const panelId = normalizeId(input.activePanelId);
  if (!panelId) {
    return null;
  }

  const sessionId = normalizeId(input.fixedSessionId) ?? normalizeId(input.inputSessionId);
  if (!sessionId) {
    return null;
  }

  return { panelId, sessionId };
}
