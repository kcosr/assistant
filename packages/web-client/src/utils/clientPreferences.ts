import type { ShortcutBindingOverrides } from './keyboardShortcuts';
import { normalizeAudioMode, type AudioMode } from './audioMode';
import { isCapacitorAndroid } from './capacitor';

export interface ClientPreferencesState {
  audioMode: AudioMode;
  autoListenEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
  keyboardShortcutBindings: ShortcutBindingOverrides | null;
  autoFocusChatOnSessionReady: boolean;
  autoScrollEnabled: boolean;
  showContextEnabled: boolean;
}

export function loadClientPreferences(options: {
  audioModeStorageKey: string;
  autoListenStorageKey: string;
  keyboardShortcutsStorageKey: string;
  keyboardShortcutsBindingsStorageKey: string;
  autoFocusChatStorageKey: string;
  autoScrollStorageKey: string;
  showContextStorageKey: string;
}): ClientPreferencesState {
  let audioMode = normalizeAudioMode(null);
  let autoListenEnabled = isCapacitorAndroid();
  let keyboardShortcutsEnabled = true;
  let keyboardShortcutBindings: ShortcutBindingOverrides | null = null;
  let autoFocusChatOnSessionReady = true;
  let autoScrollEnabled = true;
  let showContextEnabled = false;

  try {
    audioMode = normalizeAudioMode(localStorage.getItem(options.audioModeStorageKey));
    const autoListenStored = localStorage.getItem(options.autoListenStorageKey);
    if (autoListenStored === 'true') {
      autoListenEnabled = true;
    } else if (autoListenStored === 'false') {
      autoListenEnabled = false;
    }
    const shortcutsStored = localStorage.getItem(options.keyboardShortcutsStorageKey);
    if (shortcutsStored === 'false') {
      keyboardShortcutsEnabled = false;
    }
    const bindingsStored = localStorage.getItem(options.keyboardShortcutsBindingsStorageKey);
    if (bindingsStored) {
      const parsed = JSON.parse(bindingsStored) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        keyboardShortcutBindings = parsed as ShortcutBindingOverrides;
      }
    }
    const autoFocusStored = localStorage.getItem(options.autoFocusChatStorageKey);
    if (autoFocusStored === 'false') {
      autoFocusChatOnSessionReady = false;
    }
    const autoScrollStored = localStorage.getItem(options.autoScrollStorageKey);
    if (autoScrollStored === 'false') {
      autoScrollEnabled = false;
    }
    const showContextStored = localStorage.getItem(options.showContextStorageKey);
    if (showContextStored === 'true') {
      showContextEnabled = true;
    }
  } catch {
    // Ignore localStorage errors
  }

  return {
    audioMode,
    autoListenEnabled,
    keyboardShortcutsEnabled,
    keyboardShortcutBindings,
    autoFocusChatOnSessionReady,
    autoScrollEnabled,
    showContextEnabled,
  };
}

export function initializeAudioModeSelect(options: {
  select: HTMLSelectElement;
  initialAudioMode: AudioMode;
  supportsAudioOutput: boolean;
}): AudioMode {
  if (!options.supportsAudioOutput) {
    options.select.disabled = true;
    options.select.value = 'off';
    return 'off';
  }

  options.select.value = options.initialAudioMode;
  return options.initialAudioMode;
}

export function initializeAutoListenCheckbox(options: {
  checkbox: HTMLInputElement;
  initialAutoListenEnabled: boolean;
  supportsAudioOutput: boolean;
}): boolean {
  if (!options.supportsAudioOutput) {
    options.checkbox.disabled = true;
    options.checkbox.checked = false;
    return false;
  }

  options.checkbox.checked = options.initialAutoListenEnabled;
  return options.initialAutoListenEnabled;
}

export function wirePreferencesCheckboxes(options: {
  autoFocusChatCheckbox: HTMLInputElement;
  keyboardShortcutsCheckbox: HTMLInputElement;
  autoScrollCheckbox: HTMLInputElement;
  initialAutoFocusChatOnSessionReady: boolean;
  initialKeyboardShortcutsEnabled: boolean;
  initialAutoScrollEnabled: boolean;
  autoFocusChatStorageKey: string;
  keyboardShortcutsStorageKey: string;
  autoScrollStorageKey: string;
  setAutoFocusChatOnSessionReady: (enabled: boolean) => void;
  setKeyboardShortcutsEnabled: (enabled: boolean) => void;
  setAutoScrollEnabled: (enabled: boolean) => void;
}): void {
  options.autoFocusChatCheckbox.checked = options.initialAutoFocusChatOnSessionReady;
  options.autoFocusChatCheckbox.addEventListener('change', () => {
    const enabled = options.autoFocusChatCheckbox.checked;
    options.setAutoFocusChatOnSessionReady(enabled);
    try {
      localStorage.setItem(options.autoFocusChatStorageKey, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors
    }
  });

  options.keyboardShortcutsCheckbox.checked = options.initialKeyboardShortcutsEnabled;
  options.keyboardShortcutsCheckbox.addEventListener('change', () => {
    const enabled = options.keyboardShortcutsCheckbox.checked;
    options.setKeyboardShortcutsEnabled(enabled);
    try {
      localStorage.setItem(options.keyboardShortcutsStorageKey, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors
    }
  });

  options.autoScrollCheckbox.checked = options.initialAutoScrollEnabled;
  options.autoScrollCheckbox.addEventListener('change', () => {
    const enabled = options.autoScrollCheckbox.checked;
    options.setAutoScrollEnabled(enabled);
    try {
      localStorage.setItem(options.autoScrollStorageKey, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors
    }
  });
}
