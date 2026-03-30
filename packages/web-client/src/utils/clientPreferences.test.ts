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
  audioModeStorageKey: 'audio-mode',
  autoListenStorageKey: 'auto-listen',
  keyboardShortcutsStorageKey: 'shortcuts',
  keyboardShortcutsBindingsStorageKey: 'shortcut-bindings',
  autoFocusChatStorageKey: 'autofocus',
  autoScrollStorageKey: 'autoscroll',
  showContextStorageKey: 'show-context',
};

describe('loadClientPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    isCapacitorAndroid.mockReset();
    isCapacitorAndroid.mockReturnValue(false);
  });

  it('defaults audio responses off outside Capacitor Android', () => {
    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.audioMode).toBe('off');
    expect(preferences.autoListenEnabled).toBe(false);
  });

  it('defaults tool audio mode on in Capacitor Android when unset', () => {
    isCapacitorAndroid.mockReturnValue(true);

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.audioMode).toBe('tool');
    expect(preferences.autoListenEnabled).toBe(true);
  });

  it('respects an explicit stored response mode on Capacitor Android', () => {
    isCapacitorAndroid.mockReturnValue(true);
    localStorage.setItem(defaultOptions.audioModeStorageKey, 'response');

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.audioMode).toBe('response');
  });

  it('respects an explicit stored false auto-listen value on Capacitor Android', () => {
    isCapacitorAndroid.mockReturnValue(true);
    localStorage.setItem(defaultOptions.autoListenStorageKey, 'false');

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.autoListenEnabled).toBe(false);
  });
});
