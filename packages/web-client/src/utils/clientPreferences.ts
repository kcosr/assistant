export interface ClientPreferencesState {
  audioResponsesEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
  autoFocusChatOnSessionReady: boolean;
  autoScrollEnabled: boolean;
  showContextEnabled: boolean;
}

export function loadClientPreferences(options: {
  audioResponsesStorageKey: string;
  keyboardShortcutsStorageKey: string;
  autoFocusChatStorageKey: string;
  autoScrollStorageKey: string;
  showContextStorageKey: string;
}): ClientPreferencesState {
  let audioResponsesEnabled = false;
  let keyboardShortcutsEnabled = true;
  let autoFocusChatOnSessionReady = true;
  let autoScrollEnabled = true;
  let showContextEnabled = false;

  try {
    audioResponsesEnabled = localStorage.getItem(options.audioResponsesStorageKey) === 'true';
    const shortcutsStored = localStorage.getItem(options.keyboardShortcutsStorageKey);
    if (shortcutsStored === 'false') {
      keyboardShortcutsEnabled = false;
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
    audioResponsesEnabled,
    keyboardShortcutsEnabled,
    autoFocusChatOnSessionReady,
    autoScrollEnabled,
    showContextEnabled,
  };
}

export function initializeAudioResponsesCheckbox(options: {
  checkbox: HTMLInputElement;
  initialAudioResponsesEnabled: boolean;
  supportsAudioOutput: boolean;
}): boolean {
  if (!options.supportsAudioOutput) {
    options.checkbox.disabled = true;
    options.checkbox.checked = false;
    return false;
  }

  options.checkbox.checked = options.initialAudioResponsesEnabled;
  return options.initialAudioResponsesEnabled;
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
