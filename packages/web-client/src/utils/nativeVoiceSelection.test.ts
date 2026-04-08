import { describe, expect, it } from 'vitest';

import { resolveNativeVoiceSelectedSession, resolveVoiceFabController } from './nativeVoiceSelection';

describe('resolveNativeVoiceSelectedSession', () => {
  it('prefers the selected input session over the active chat binding when both are present', () => {
    expect(
      resolveNativeVoiceSelectedSession({
        activePanelId: 'panel-1',
        activePanelType: 'chat',
        fixedSessionId: 'session-fixed',
        inputSessionId: 'session-input',
      }),
    ).toEqual({
      panelId: 'panel-1',
      sessionId: 'session-input',
    });
  });

  it('falls back to the active chat panel with the input session when no fixed binding exists', () => {
    expect(
      resolveNativeVoiceSelectedSession({
        activePanelId: 'panel-1',
        activePanelType: 'chat',
        fixedSessionId: null,
        inputSessionId: 'session-input',
      }),
    ).toEqual({
      panelId: 'panel-1',
      sessionId: 'session-input',
    });
  });

  it('returns null when the active panel is not a chat panel', () => {
    expect(
      resolveNativeVoiceSelectedSession({
        activePanelId: 'panel-1',
        activePanelType: 'note',
        fixedSessionId: 'session-fixed',
        inputSessionId: 'session-input',
      }),
    ).toEqual({
      panelId: '',
      sessionId: 'session-input',
    });
  });

  it('keeps the selected input session even when no chat panel is active', () => {
    expect(
      resolveNativeVoiceSelectedSession({
        activePanelId: null,
        activePanelType: 'list',
        fixedSessionId: null,
        inputSessionId: 'session-input',
      }),
    ).toEqual({
      panelId: '',
      sessionId: 'session-input',
    });
  });
});

describe('resolveVoiceFabController', () => {
  it('uses the selected session controller when available', () => {
    const selected = { id: 'selected' };
    const active = { id: 'active' };

    expect(
      resolveVoiceFabController({
        inputSessionId: 'session-selected',
        getControllerForSession: (sessionId) =>
          sessionId === 'session-selected' ? selected : null,
        activeController: active,
        primaryController: active,
        nativeRuntimeState: 'idle',
      }),
    ).toBe(selected);
  });

  it('falls back to an active controller while native listening is active', () => {
    const active = { id: 'active' };

    expect(
      resolveVoiceFabController({
        inputSessionId: 'session-missing',
        getControllerForSession: () => null,
        activeController: active,
        primaryController: null,
        nativeRuntimeState: 'listening',
      }),
    ).toBe(active);
  });

  it('falls back to the primary controller while native speaking is active', () => {
    const primary = { id: 'primary' };

    expect(
      resolveVoiceFabController({
        inputSessionId: 'session-missing',
        getControllerForSession: () => null,
        activeController: null,
        primaryController: primary,
        nativeRuntimeState: 'speaking',
      }),
    ).toBe(primary);
  });

  it('returns null when the selected session has no controller and native voice is idle', () => {
    expect(
      resolveVoiceFabController({
        inputSessionId: 'session-missing',
        getControllerForSession: () => null,
        activeController: { id: 'active' },
        primaryController: { id: 'primary' },
        nativeRuntimeState: 'idle',
      }),
    ).toBeNull();
  });
});
