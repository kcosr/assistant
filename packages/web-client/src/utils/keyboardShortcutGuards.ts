export function areKeyboardShortcutsBlockedByOverlay(): boolean {
  const blockingSelectors = [
    '.command-palette-overlay.open',
    '.workspace-switcher-overlay.open',
    '.session-picker-popover',
    '.panel-launcher-overlay.open',
    '.confirm-dialog-overlay',
    '#share-target-modal.visible',
  ];
  return blockingSelectors.some((selector) => Boolean(document.querySelector(selector)));
}
