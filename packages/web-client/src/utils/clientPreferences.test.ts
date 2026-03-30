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
  audioResponsesStorageKey: 'audio',
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

    expect(preferences.audioResponsesEnabled).toBe(false);
  });

  it('defaults audio responses on in Capacitor Android when unset', () => {
    isCapacitorAndroid.mockReturnValue(true);

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.audioResponsesEnabled).toBe(true);
  });

  it('respects an explicit stored false value on Capacitor Android', () => {
    isCapacitorAndroid.mockReturnValue(true);
    localStorage.setItem(defaultOptions.audioResponsesStorageKey, 'false');

    const preferences = loadClientPreferences(defaultOptions);

    expect(preferences.audioResponsesEnabled).toBe(false);
  });
});
