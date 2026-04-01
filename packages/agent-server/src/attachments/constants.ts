export const MAX_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024;

export function formatAttachmentTooLargeMessage(size: number): string {
  return `Attachment exceeds the 4 MB limit (${size} bytes)`;
}
