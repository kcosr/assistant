// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupVoiceFab } from './voiceFab';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('setupVoiceFab', () => {
  it('keeps the selected session chip visible while FAB-started listening remains active', async () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    document.body.appendChild(button);
    const startVoiceFromFab = vi.fn(async () => true);
    let mode: 'idle' | 'speaking' | 'listening' = 'idle';

    const handle = setupVoiceFab({
      button,
      isVisible: () => true,
      getSpeechController: () => ({
        getVoiceFabState: () => ({ enabled: true, mode }),
        startVoiceFromFab,
        stopVoiceFromFab: vi.fn(() => false),
      }),
      getSessionTitle: () => 'Daily Assistant',
      onSessionChipClick: vi.fn(),
    });

    button.click();
    await Promise.resolve();

    const chip = document.querySelector<HTMLButtonElement>('.voice-fab-session-chip');
    expect(startVoiceFromFab).toHaveBeenCalledTimes(1);
    expect(chip?.hidden).toBe(false);
    expect(chip?.textContent).toBe('Daily Assistant');

    mode = 'listening';
    handle.update();
    await vi.advanceTimersByTimeAsync(2600);
    expect(chip?.hidden).toBe(false);

    mode = 'idle';
    handle.update();
    expect(chip?.hidden).toBe(true);
    handle.destroy();
  });

  it('opens session selection from the title chip and renders speaking state', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onSessionChipClick = vi.fn();

    const handle = setupVoiceFab({
      button,
      isVisible: () => true,
      getSpeechController: () => ({
        getVoiceFabState: () => ({ enabled: true, mode: 'speaking' as const }),
        startVoiceFromFab: vi.fn(async () => true),
        stopVoiceFromFab: vi.fn(() => true),
      }),
      getSessionTitle: () => 'Inbox Assistant',
      onSessionChipClick,
    });

    handle.showSessionChip();
    const chip = document.querySelector<HTMLButtonElement>('.voice-fab-session-chip');
    chip?.click();

    expect(button.classList.contains('voice-fab-speaking')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Stop voice playback');
    expect(onSessionChipClick).toHaveBeenCalledWith(chip);
    handle.destroy();
  });
});
