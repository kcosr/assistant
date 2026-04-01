import path from 'node:path';

export function inferAttachmentContentType(filePathOrName: string): string {
  const extension = path.extname(filePathOrName).toLowerCase();
  switch (extension) {
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    case '.xml':
      return 'application/xml';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'application/javascript';
    case '.ts':
    case '.tsx':
      return 'text/plain';
    case '.py':
      return 'text/x-python';
    case '.java':
      return 'text/x-java-source';
    case '.kt':
    case '.kts':
      return 'text/x-kotlin';
    case '.c':
    case '.h':
      return 'text/x-c';
    case '.cc':
    case '.cpp':
    case '.cxx':
    case '.hpp':
    case '.hxx':
      return 'text/x-c++src';
    case '.sh':
      return 'application/x-sh';
    case '.csv':
      return 'text/csv';
    case '.zip':
      return 'application/zip';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    case '.flac':
      return 'audio/flac';
    case '.pdf':
      return 'application/pdf';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'text/plain';
  }
}

export function inferAttachmentContentTypeFromCandidates(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    if (path.extname(trimmed)) {
      return inferAttachmentContentType(trimmed);
    }
  }
  return inferAttachmentContentType(candidates.find((candidate) => candidate?.trim()) ?? '');
}

export function stripAttachmentCharset(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function resolveAttachmentPreviewType(contentType: string): 'none' | 'text' | 'markdown' {
  const normalized = stripAttachmentCharset(contentType);
  if (normalized === 'text/markdown') {
    return 'markdown';
  }
  if (normalized === 'text/plain') {
    return 'text';
  }
  return 'none';
}

export function supportsAttachmentOpenInBrowser(contentType: string): boolean {
  return stripAttachmentCharset(contentType) === 'text/html';
}
