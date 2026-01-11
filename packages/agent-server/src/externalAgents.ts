import { randomUUID } from 'node:crypto';

export function buildExternalCallbackUrl(options: {
  callbackBaseUrl: string;
  sessionId: string;
}): string {
  const { callbackBaseUrl, sessionId } = options;
  const url = new URL(callbackBaseUrl);

  const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const sessionPath = `/external/sessions/${encodeURIComponent(sessionId)}/messages`;
  const joined = `${basePath}${sessionPath.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');

  url.pathname = joined;
  return url.toString();
}

export type ExternalUserInputPayload = {
  sessionId: string;
  agentId: string;
  callbackUrl: string;
  message: {
    type: 'user';
    text: string;
    createdAt: string;
  };
};

export async function postExternalUserInput(options: {
  inputUrl: string;
  payload: ExternalUserInputPayload;
  timeoutMs?: number;
}): Promise<void> {
  const { inputUrl, payload, timeoutMs = 5000 } = options;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort('timeout'), timeoutMs);

  try {
    const response = await fetch(inputUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const details = text && text.length <= 2000 ? `: ${text}` : '';
      throw new Error(`inputUrl returned ${response.status}${details}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('inputUrl request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createExternalResponseId(): string {
  return randomUUID();
}
