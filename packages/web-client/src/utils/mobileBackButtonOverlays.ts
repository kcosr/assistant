export function closeMobileBackButtonOverlay(
  root: ParentNode = document,
): boolean {
  const attachmentOverlay = root.querySelector<HTMLElement>(
    '.attachment-image-viewer-overlay',
  );
  if (attachmentOverlay) {
    attachmentOverlay.click();
    return true;
  }
  return false;
}
