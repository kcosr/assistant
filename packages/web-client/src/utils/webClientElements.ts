export interface WebClientElements {
  status: HTMLElement;
  controlsToggleButton: HTMLButtonElement;
  audioResponsesCheckbox: HTMLInputElement;
  includeContextCheckbox: HTMLInputElement | null;
  showContextCheckbox: HTMLInputElement | null;
  listInsertAtTopCheckbox: HTMLInputElement | null;
  listSingleClickSelectionCheckbox: HTMLInputElement | null;
  autoFocusChatCheckbox: HTMLInputElement;
  keyboardShortcutsCheckbox: HTMLInputElement;
  autoScrollCheckbox: HTMLInputElement;
  panelWorkspace: HTMLElement | null;
  settingsDropdown: HTMLElement | null;
  themeSelect: HTMLSelectElement | null;
  uiFontSelect: HTMLSelectElement | null;
  codeFontSelect: HTMLSelectElement | null;
  tagColorsSettingsButton: HTMLButtonElement | null;
  resetLayoutButton: HTMLButtonElement | null;
  resetPanelStateButton: HTMLButtonElement | null;
  layoutDropdownButton: HTMLButtonElement | null;
  layoutDropdown: HTMLElement | null;
  panelLauncherButton: HTMLButtonElement | null;
  panelLauncher: HTMLElement | null;
  panelLauncherList: HTMLElement | null;
  panelLauncherSearch: HTMLInputElement | null;
  panelLauncherCloseButton: HTMLButtonElement | null;
  panelHeaderDock: HTMLElement | null;
  commandPaletteButton: HTMLButtonElement | null;
  commandPalette: HTMLElement | null;
  commandPalettePanel: HTMLElement | null;
  commandPaletteInput: HTMLInputElement | null;
  commandPaletteGhost: HTMLElement | null;
  commandPaletteResults: HTMLElement | null;
  commandPaletteCloseButton: HTMLButtonElement | null;
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function getWebClientElements(): WebClientElements | null {
  const status = getElement<HTMLElement>('status');
  const controlsToggleButton = getElement<HTMLButtonElement>('controls-toggle-button');
  const audioResponsesCheckbox = getElement<HTMLInputElement>('audio-responses-checkbox');
  const includeContextCheckbox = getElement<HTMLInputElement>('include-context-checkbox');
  const showContextCheckbox = getElement<HTMLInputElement>('show-context-checkbox');
  const listInsertAtTopCheckbox = getElement<HTMLInputElement>('list-insert-at-top-checkbox');
  const listSingleClickSelectionCheckbox = getElement<HTMLInputElement>(
    'list-single-click-selection-checkbox',
  );
  const autoFocusChatCheckbox = getElement<HTMLInputElement>('autofocus-chat-checkbox');
  const keyboardShortcutsCheckbox = getElement<HTMLInputElement>('keyboard-shortcuts-checkbox');
  const autoScrollCheckbox = getElement<HTMLInputElement>('auto-scroll-checkbox');
  const panelWorkspace = getElement<HTMLElement>('panel-workspace');

  if (
    !status ||
    !controlsToggleButton ||
    !audioResponsesCheckbox ||
    !autoFocusChatCheckbox ||
    !keyboardShortcutsCheckbox ||
    !autoScrollCheckbox ||
    !panelWorkspace
  ) {
    console.error('Core UI elements not found');
    return null;
  }

  return {
    status,
    controlsToggleButton,
    audioResponsesCheckbox,
    includeContextCheckbox,
    showContextCheckbox,
    listInsertAtTopCheckbox,
    listSingleClickSelectionCheckbox,
    autoFocusChatCheckbox,
    keyboardShortcutsCheckbox,
    autoScrollCheckbox,
    panelWorkspace,
    settingsDropdown: getElement<HTMLElement>('settings-dropdown'),
    themeSelect: getElement<HTMLSelectElement>('theme-select'),
    uiFontSelect: getElement<HTMLSelectElement>('ui-font-select'),
    codeFontSelect: getElement<HTMLSelectElement>('code-font-select'),
    tagColorsSettingsButton: getElement<HTMLButtonElement>('tag-colors-settings-button'),
    resetLayoutButton: getElement<HTMLButtonElement>('reset-layout-button'),
    resetPanelStateButton: getElement<HTMLButtonElement>('reset-panel-state-button'),
    layoutDropdownButton: getElement<HTMLButtonElement>('layout-dropdown-button'),
    layoutDropdown: getElement<HTMLElement>('layout-dropdown'),
    panelLauncherButton: getElement<HTMLButtonElement>('panel-launcher-button'),
    panelLauncher: getElement<HTMLElement>('panel-launcher'),
    panelLauncherList: getElement<HTMLElement>('panel-launcher-list'),
    panelLauncherSearch: getElement<HTMLInputElement>('panel-launcher-search'),
    panelLauncherCloseButton: getElement<HTMLButtonElement>('panel-launcher-close'),
    panelHeaderDock: getElement<HTMLElement>('panel-header-dock'),
    commandPaletteButton: getElement<HTMLButtonElement>('command-palette-button'),
    commandPalette: getElement<HTMLElement>('command-palette'),
    commandPalettePanel: getElement<HTMLElement>('command-palette-panel'),
    commandPaletteInput: getElement<HTMLInputElement>('command-palette-input'),
    commandPaletteGhost: getElement<HTMLElement>('command-palette-ghost'),
    commandPaletteResults: getElement<HTMLElement>('command-palette-results'),
    commandPaletteCloseButton: getElement<HTMLButtonElement>('command-palette-close'),
  };
}
