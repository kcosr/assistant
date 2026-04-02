import { apiFetch, getApiBaseUrl } from './api';
import { isCapacitorAndroid } from './capacitor';
import { isTauri } from './tauri';

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type AssistantAttachmentOpenArgs = {
  fileName: string;
  contentType: string;
  contentBase64: string;
};
type AssistantAttachmentOpenTarget = {
  openHtmlAttachment?: (args: AssistantAttachmentOpenArgs) => Promise<unknown> | unknown;
};

function getTauriInvoke(): TauriInvoke | null {
  const win = window as { __TAURI__?: { core?: { invoke?: TauriInvoke } } };
  return win.__TAURI__?.core?.invoke ?? null;
}

function getAssistantAttachmentOpenTarget(): AssistantAttachmentOpenTarget | null {
  const win = window as {
    AssistantAttachmentOpen?: AssistantAttachmentOpenTarget;
    Capacitor?: {
      Plugins?: {
        AssistantAttachmentOpen?: AssistantAttachmentOpenTarget;
      };
    };
  };
  return win.AssistantAttachmentOpen ?? win.Capacitor?.Plugins?.AssistantAttachmentOpen ?? null;
}

function normalizeHtmlContentType(contentType: string | null): string {
  const trimmed = typeof contentType === 'string' ? contentType.trim() : '';
  if (!trimmed) {
    return 'text/html';
  }
  return trimmed.split(';', 1)[0]?.trim().toLowerCase() || 'text/html';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

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

function normalizeAttachmentUrlInput(
  url: string,
): { value: string; isAbsolute: boolean; isRootRelative: boolean } | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  return {
    value: trimmed,
    isAbsolute: /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed),
    isRootRelative: trimmed.startsWith('/'),
  };
}

export function resolveAttachmentUrl(url: string): string {
  const normalized = normalizeAttachmentUrlInput(url);
  if (!normalized) {
    return '';
  }
  if (normalized.isAbsolute) {
    return normalized.value;
  }
  if (!normalized.isRootRelative) {
    return normalized.value;
  }
  return `${getApiBaseUrl().replace(/\/+$/, '')}${normalized.value}`;
}

export function getAttachmentContentUrl(url: string): string {
  const normalized = normalizeAttachmentUrlInput(url);
  if (!normalized) {
    return '';
  }

  const parsed = new URL(
    normalized.value,
    normalized.isAbsolute ? undefined : 'http://assistant.local',
  );
  parsed.searchParams.delete('download');

  if (normalized.isAbsolute) {
    return parsed.toString();
  }

  const contentUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (normalized.isRootRelative) {
    return contentUrl;
  }

  return contentUrl.replace(/^\/+/, '');
}

export async function fetchAttachmentTextContent(url: string): Promise<string> {
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment (${response.status})`);
  }
  return response.text();
}

export async function downloadAttachment(url: string, fileName: string): Promise<void> {
  const resolvedUrl = resolveAttachmentUrl(url);
  if (!resolvedUrl) {
    return;
  }
  if (isTauri()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      const savePath = await invoke<string | string[] | null>('plugin:dialog|save', {
        options: {
          defaultPath: fileName,
        },
      });
      const resolvedPath = Array.isArray(savePath) ? savePath[0] : savePath;
      if (!resolvedPath) {
        return;
      }

      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch attachment: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      await invoke('save_artifact_file', {
        path: resolvedPath,
        content_base64: base64,
      });
      return;
    }

    return;
  }

  const anchor = document.createElement('a');
  anchor.href = resolvedUrl;
  anchor.rel = 'noopener noreferrer';
  if (fileName.trim()) {
    anchor.download = fileName;
  }
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function openHtmlAttachmentInBrowser(
  url: string,
  fileName = 'attachment.html',
): Promise<void> {
  const resolvedUrl = resolveAttachmentUrl(url);
  if (!resolvedUrl) {
    return;
  }

  if (isCapacitorAndroid()) {
    const bridge = getAssistantAttachmentOpenTarget();
    if (!bridge || typeof bridge.openHtmlAttachment !== 'function') {
      throw new Error('Android attachment bridge unavailable');
    }

    const response = await apiFetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to open attachment (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    const contentType = normalizeHtmlContentType(response.headers.get('Content-Type'));
    await Promise.resolve(
      bridge.openHtmlAttachment({
        fileName,
        contentType,
        contentBase64: arrayBufferToBase64(buffer),
      }),
    );
    return;
  }

  if (isTauri()) {
    const invoke = getTauriInvoke();
    if (invoke) {
      await invoke('plugin:shell|open', { path: resolvedUrl });
      return;
    }
  }

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
