// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupVoiceFab } from './voiceFab';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('setupVoiceFab', () => {
  it('shows the session chip for active listening and hides it again when idle', async () => {
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
      getSessionChipState: (currentMode) => ({
        visible: currentMode === 'listening',
        interactive: currentMode === 'listening',
        title: currentMode === 'listening' ? 'Daily Assistant' : null,
      }),
      onSessionChipClick: vi.fn(),
    });

    button.click();
    await Promise.resolve();

    const chip = document.querySelector<HTMLButtonElement>('.voice-fab-session-chip');
    expect(startVoiceFromFab).toHaveBeenCalledTimes(1);
    expect(chip?.hidden).toBe(true);

    mode = 'listening';
    handle.update();
    expect(chip?.hidden).toBe(false);
    expect(chip?.textContent).toBe('Daily Assistant');
    expect(chip?.disabled).toBe(false);

    mode = 'idle';
    handle.update();
    expect(chip?.hidden).toBe(true);
    handle.destroy();
  });

  it('opens session selection from the title chip only while listening', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const onSessionChipClick = vi.fn();
    let mode: 'idle' | 'speaking' | 'listening' = 'listening';

    const handle = setupVoiceFab({
      button,
      isVisible: () => true,
      getSpeechController: () => ({
        getVoiceFabState: () => ({ enabled: true, mode }),
        startVoiceFromFab: vi.fn(async () => true),
        stopVoiceFromFab: vi.fn(() => true),
      }),
      getSessionChipState: (currentMode) => ({
        visible: currentMode === 'speaking' || currentMode === 'listening',
        interactive: currentMode === 'listening',
        title: 'Inbox Assistant',
      }),
      onSessionChipClick,
    });

    handle.update();
    const chip = document.querySelector<HTMLButtonElement>('.voice-fab-session-chip');
    chip?.click();

    expect(button.classList.contains('voice-fab-listening')).toBe(true);
    expect(onSessionChipClick).toHaveBeenCalledWith(chip);

    mode = 'speaking';
    handle.update();
    chip?.click();
    expect(button.classList.contains('voice-fab-speaking')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Stop voice playback');
    expect(chip?.disabled).toBe(true);
    expect(onSessionChipClick).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('keeps speaking state visible when the FAB resolves to a different controller wrapper', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    const handle = setupVoiceFab({
      button,
      isVisible: () => true,
      getSpeechController: () => ({
        getVoiceFabState: () => ({ enabled: true, mode: 'speaking' as const }),
        startVoiceFromFab: vi.fn(async () => true),
        stopVoiceFromFab: vi.fn(() => true),
      }),
      getSessionChipState: () => ({
        visible: true,
        interactive: false,
        title: 'Project Alpha',
      }),
      onSessionChipClick: vi.fn(),
    });

    handle.update();

    expect(button.classList.contains('voice-fab-speaking')).toBe(true);
    expect(button.classList.contains('voice-fab-disabled')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Stop voice playback');
    const chip = document.querySelector<HTMLButtonElement>('.voice-fab-session-chip');
    expect(chip?.hidden).toBe(false);
    expect(chip?.textContent).toBe('Project Alpha');
    expect(chip?.disabled).toBe(true);
    handle.destroy();
  });

  it('ignores rapid repeated start taps while a start is already in flight', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    let resolveStart: (value: boolean) => void = () => undefined;
    const startVoiceFromFab = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStart = resolve;
        }),
    );

    setupVoiceFab({
      button,
      isVisible: () => true,
      getSpeechController: () => ({
        getVoiceFabState: () => ({ enabled: true, mode: 'idle' as const }),
        startVoiceFromFab,
        stopVoiceFromFab: vi.fn(() => true),
      }),
      getSessionChipState: () => ({
        visible: false,
        interactive: false,
        title: null,
      }),
      onSessionChipClick: vi.fn(),
    });

    button.click();
    button.click();
    await Promise.resolve();

    expect(startVoiceFromFab).toHaveBeenCalledTimes(1);

    resolveStart(true);
    await Promise.resolve();
  });
});
