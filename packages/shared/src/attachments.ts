import { z } from 'zod';

export const AttachmentPreviewTypeSchema = z.enum(['none', 'text', 'markdown']);
export type AttachmentPreviewType = z.infer<typeof AttachmentPreviewTypeSchema>;

export const AttachmentOpenModeSchema = z.enum(['browser_blob']);
export type AttachmentOpenMode = z.infer<typeof AttachmentOpenModeSchema>;

export const AttachmentDescriptorSchema = z.object({
  attachmentId: z.string(),
  fileName: z.string(),
  title: z.string().optional(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  downloadUrl: z.string(),
  openUrl: z.string().optional(),
  openMode: AttachmentOpenModeSchema.optional(),
  previewType: AttachmentPreviewTypeSchema,
  previewText: z.string().optional(),
  previewTruncated: z.boolean().optional(),
});
export type AttachmentDescriptor = z.infer<typeof AttachmentDescriptorSchema>;

export const AttachmentToolResultSchema = z.object({
  ok: z.literal(true),
  attachment: AttachmentDescriptorSchema,
});
export type AttachmentToolResult = z.infer<typeof AttachmentToolResultSchema>;

export function isAttachmentToolResult(value: unknown): value is AttachmentToolResult {
  return AttachmentToolResultSchema.safeParse(value).success;
}
