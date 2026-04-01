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

  const contentType = response.headers.get('content-type')?.trim() || 'text/html;charset=utf-8';
  const bytes = await response.arrayBuffer();
  const blob = new Blob([bytes], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  clickObjectUrlAnchor(objectUrl, (anchor) => {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  });
}
