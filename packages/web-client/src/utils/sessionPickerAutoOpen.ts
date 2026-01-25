type AutoOpenSessionPickerOptions = {
  hasSession: boolean;
  isActive: boolean;
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
  if (!options.isActive) {
    return false;
  }
  if (!options.hasAnchor) {
    return false;
  }
  return true;
}
