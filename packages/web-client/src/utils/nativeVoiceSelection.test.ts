import { describe, expect, it } from 'vitest';

import { resolveNativeVoiceSelectedSession } from './nativeVoiceSelection';

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
