import type { ShortcutBindingOverrides } from './keyboardShortcuts';
import { isCapacitorAndroid } from './capacitor';
import {
  createDefaultVoiceSettings,
  normalizeVoiceSettings,
  type VoiceSettings,
} from './voiceSettings';

export interface ClientPreferencesState {
  voice: VoiceSettings;
  keyboardShortcutsEnabled: boolean;
  keyboardShortcutBindings: ShortcutBindingOverrides | null;
  autoFocusChatOnSessionReady: boolean;
  autoScrollEnabled: boolean;
  showContextEnabled: boolean;
  synthesizedPanelTitlesEnabled: boolean;
}

export function loadClientPreferences(options: {
  voiceStorageKey: string;
  keyboardShortcutsStorageKey: string;
  keyboardShortcutsBindingsStorageKey: string;
  autoFocusChatStorageKey: string;
  autoScrollStorageKey: string;
  showContextStorageKey: string;
  synthesizedPanelTitlesStorageKey: string;
}): ClientPreferencesState {
  let voice = createDefaultVoiceSettings({
    isCapacitorAndroid: isCapacitorAndroid(),
  });
  let keyboardShortcutsEnabled = true;
  let keyboardShortcutBindings: ShortcutBindingOverrides | null = null;
  let autoFocusChatOnSessionReady = true;
  let autoScrollEnabled = true;
  let showContextEnabled = false;
  let synthesizedPanelTitlesEnabled = false;

  try {
    const voiceStored = localStorage.getItem(options.voiceStorageKey);
    if (voiceStored) {
      voice = normalizeVoiceSettings(JSON.parse(voiceStored), {
        isCapacitorAndroid: isCapacitorAndroid(),
      });
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
    const synthesizedPanelTitlesStored = localStorage.getItem(
      options.synthesizedPanelTitlesStorageKey,
    );
    if (synthesizedPanelTitlesStored === 'true') {
      synthesizedPanelTitlesEnabled = true;
    }
  } catch {
    // Ignore localStorage errors
  }

  return {
    voice,
    keyboardShortcutsEnabled,
    keyboardShortcutBindings,
    autoFocusChatOnSessionReady,
    autoScrollEnabled,
    showContextEnabled,
    synthesizedPanelTitlesEnabled,
  };
}

export function wirePreferencesCheckboxes(options: {
  autoFocusChatCheckbox: HTMLInputElement;
  keyboardShortcutsCheckbox: HTMLInputElement;
  autoScrollCheckbox: HTMLInputElement;
  synthesizedPanelTitlesCheckbox: HTMLInputElement;
  initialAutoFocusChatOnSessionReady: boolean;
  initialKeyboardShortcutsEnabled: boolean;
  initialAutoScrollEnabled: boolean;
  initialSynthesizedPanelTitlesEnabled: boolean;
  autoFocusChatStorageKey: string;
  keyboardShortcutsStorageKey: string;
  autoScrollStorageKey: string;
  synthesizedPanelTitlesStorageKey: string;
  setAutoFocusChatOnSessionReady: (enabled: boolean) => void;
  setKeyboardShortcutsEnabled: (enabled: boolean) => void;
  setAutoScrollEnabled: (enabled: boolean) => void;
  setSynthesizedPanelTitlesEnabled: (enabled: boolean) => void;
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

  options.synthesizedPanelTitlesCheckbox.checked = options.initialSynthesizedPanelTitlesEnabled;
  options.synthesizedPanelTitlesCheckbox.addEventListener('change', () => {
    const enabled = options.synthesizedPanelTitlesCheckbox.checked;
    options.setSynthesizedPanelTitlesEnabled(enabled);
    try {
      localStorage.setItem(options.synthesizedPanelTitlesStorageKey, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors
    }
  });
}
