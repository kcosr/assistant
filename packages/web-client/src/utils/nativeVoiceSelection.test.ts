import { describe, expect, it } from 'vitest';

import { resolveNativeVoiceSelectedSession } from './nativeVoiceSelection';

describe('resolveNativeVoiceSelectedSession', () => {
  it('uses the active chat panel with the fixed session binding when present', () => {
    expect(
      resolveNativeVoiceSelectedSession({
        activePanelId: 'panel-1',
        activePanelType: 'chat',
        fixedSessionId: 'session-fixed',
        inputSessionId: 'session-input',
      }),
    ).toEqual({
      panelId: 'panel-1',
      sessionId: 'session-fixed',
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
    ).toBeNull();
  });
});
