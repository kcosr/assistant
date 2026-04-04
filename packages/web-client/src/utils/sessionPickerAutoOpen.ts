type AutoOpenSessionPickerOptions = {
  hasSession: boolean;
  shouldOpen: boolean;
  hasAnchor: boolean;
  alreadyOpened: boolean;
};

export function shouldAutoOpenSessionPicker(
  options: AutoOpenSessionPickerOptions,
): boolean {
  if (options.alreadyOpened) {
    return false;
  }
  if (options.hasSession) {
    return false;
  }
  if (!options.shouldOpen) {
    return false;
  }
  if (!options.hasAnchor) {
    return false;
  }
  return true;
}
