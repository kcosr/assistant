import type { HttpRouteHandler } from '../types';

function normalizeContentType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function encodeDispositionFilename(fileName: string): string {
  return fileName.replace(/["\\]/g, '_');
}

export const handleAttachmentRoutes: HttpRouteHandler = async (
  context,
  req,
  res,
  url,
  segments,
) => {
  if (
    req.method !== 'GET' ||
    segments.length !== 4 ||
    segments[0] !== 'api' ||
    segments[1] !== 'attachments'
  ) {
    return false;
  }

  const sessionId = decodeURIComponent(segments[2] ?? '');
  const attachmentId = decodeURIComponent(segments[3] ?? '');
  if (!sessionId || !attachmentId) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }

  const store = context.sessionHub.getAttachmentStore();
  if (!store) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }

  const file = await store.getAttachmentFile(sessionId, attachmentId);
  if (!file) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }

  const forceDownload = url.searchParams.get('download') === '1';
  const contentType = file.attachment.contentType;
  const normalizedContentType = normalizeContentType(contentType);
  const disposition =
    forceDownload || normalizedContentType === 'text/html' ? 'attachment' : 'inline';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', file.content.length);
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeDispositionFilename(file.attachment.fileName)}"`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(file.content);
  return true;
};
