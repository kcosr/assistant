import { apiFetch, getApiBaseUrl } from './api';

function clickObjectUrlAnchor(
  objectUrl: string,
  configureAnchor: (anchor: HTMLAnchorElement) => void,
): void {
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.style.display = 'none';
  configureAnchor(anchor);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}

export function resolveAttachmentUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (!trimmed.startsWith('/')) {
    return trimmed;
  }
  return `${getApiBaseUrl().replace(/\/+$/, '')}${trimmed}`;
}

export async function openHtmlAttachmentInBrowser(url: string): Promise<void> {
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to open attachment (${response.status})`);
  }

  const blob = await response.blob();
  const normalizedBlob =
    blob.type && blob.type.trim().length > 0
      ? blob
      : new Blob([blob], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(normalizedBlob);
  clickObjectUrlAnchor(objectUrl, (anchor) => {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  });
}
