export const MAX_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_ATTACHMENT_PREVIEW_SNIPPET_CHARS = 512;

export function formatAttachmentTooLargeMessage(size: number): string {
  return `Attachment exceeds the 4 MB limit (${size} bytes)`;
}
