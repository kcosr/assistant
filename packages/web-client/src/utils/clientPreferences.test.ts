// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isCapacitorAndroid } = vi.hoisted(() => ({
  isCapacitorAndroid: vi.fn<() => boolean>(),
}));

vi.mock('./capacitor', () => ({
  isCapacitorAndroid,
}));

import { loadClientPreferences } from './clientPreferences';

const defaultOptions = {
  voiceStorageKey: 'voice',
  keyboardShortcutsStorageKey: 'shortcuts',
  keyboardShortcutsBindingsStorageKey: 'shortcut-bindings',
  autoFocusChatStorageKey: 'autofocus',
  autoScrollStorageKey: 'autoscroll',
  showContextStorageKey: 'show-context',
  synthesizedPanelTitlesStorageKey: 'synthesized-panel-titles',
};

describe('loadClientPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    isCapacitorAndroid.mockReset();
    isCapacitorAndroid.mockReturnValue(false);
  });

  it('defaults audio responses off outside Capacitor Android', () => {
    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.voice.audioMode).toBe('off');
    expect(preferences.voice.autoListenEnabled).toBe(false);
    expect(preferences.voice.selectedMicDeviceId).toBe('');
    expect(preferences.voice.recognitionStartTimeoutMs).toBe(30000);
    expect(preferences.voice.recognitionCompletionTimeoutMs).toBe(60000);
    expect(preferences.voice.recognitionEndSilenceMs).toBe(1200);
    expect(preferences.synthesizedPanelTitlesEnabled).toBe(false);
  });

  it('defaults tool audio mode on in Capacitor Android when unset', () => {
    isCapacitorAndroid.mockReturnValue(true);

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.voice.audioMode).toBe('tool');
    expect(preferences.voice.autoListenEnabled).toBe(true);
    expect(preferences.voice.selectedMicDeviceId).toBe('');
  });

  it('respects an explicit stored response mode on Capacitor Android', () => {
    isCapacitorAndroid.mockReturnValue(true);
    localStorage.setItem(
      defaultOptions.voiceStorageKey,
      JSON.stringify({
        audioMode: 'response',
      }),
    );

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.voice.audioMode).toBe('response');
  });

  it('respects an explicit stored false auto-listen value on Capacitor Android', () => {
    isCapacitorAndroid.mockReturnValue(true);
    localStorage.setItem(
      defaultOptions.voiceStorageKey,
      JSON.stringify({
        autoListenEnabled: false,
      }),
    );

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.voice.autoListenEnabled).toBe(false);
  });

  it('normalizes persisted voice timing settings', () => {
    localStorage.setItem(
      defaultOptions.voiceStorageKey,
      JSON.stringify({
        recognitionStartTimeoutMs: '4500',
        recognitionCompletionTimeoutMs: 15000,
        recognitionEndSilenceMs: '900',
        selectedMicDeviceId: '11',
      }),
    );

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.voice.recognitionStartTimeoutMs).toBe(4500);
    expect(preferences.voice.recognitionCompletionTimeoutMs).toBe(15000);
    expect(preferences.voice.recognitionEndSilenceMs).toBe(900);
    expect(preferences.voice.selectedMicDeviceId).toBe('11');
  });

  it('loads synthesized panel title preference when enabled', () => {
    localStorage.setItem(defaultOptions.synthesizedPanelTitlesStorageKey, 'true');

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.synthesizedPanelTitlesEnabled).toBe(true);
  });
});
