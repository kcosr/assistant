import { describe, expect, it } from 'vitest';
import { resolveVoiceFabSessionChipState } from './voiceFabSessionChip';

function normalizeSessionId(sessionId: string | null): string | null {
  const normalized = sessionId?.trim() ?? '';
  return normalized || null;
}

function resolveSessionTitle(sessionId: string | null): string | null {
  return sessionId ? `title:${sessionId}` : null;
}

describe('resolveVoiceFabSessionChipState', () => {
  it('prefers the native active session while listening', () => {
    expect(
      resolveVoiceFabSessionChipState({
        mode: 'listening',
        inputSessionId: 'selected-session',
        nativeVoiceBridgeSelectedSessionId: 'bridge-session',
        nativeVoiceActiveSessionId: 'active-session',
        normalizeSessionId,
        resolveSessionTitle,
      }),
    ).toEqual({
      visible: true,
      interactive: true,
      title: 'title:active-session',
    });
  });

  it('uses the native active session as a read-only chip while speaking', () => {
    expect(
      resolveVoiceFabSessionChipState({
        mode: 'speaking',
        inputSessionId: 'selected-session',
        nativeVoiceBridgeSelectedSessionId: 'bridge-session',
        nativeVoiceActiveSessionId: 'active-session',
        normalizeSessionId,
        resolveSessionTitle,
      }),
    ).toEqual({
      visible: true,
      interactive: false,
      title: 'title:active-session',
    });
  });

  it('falls back when no native active session is present', () => {
    expect(
      resolveVoiceFabSessionChipState({
        mode: 'listening',
        inputSessionId: 'selected-session',
        nativeVoiceBridgeSelectedSessionId: 'bridge-session',
        nativeVoiceActiveSessionId: null,
        normalizeSessionId,
        resolveSessionTitle,
      }),
    ).toEqual({
      visible: true,
      interactive: true,
      title: 'title:selected-session',
    });
  });
});
