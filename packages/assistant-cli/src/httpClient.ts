import type { AssistantCliConfig } from './config';

export interface HttpError extends Error {
  status: number;
  body?: unknown;
}

export interface HttpRequestOptions {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

function stripTrailingSlashes(value: string): string {
  if (value === '/') {
    return '';
  }
  return value.replace(/\/+$/, '');
}

function resolveRequestUrl(baseUrl: string, requestPath: string): URL {
  const url = new URL(baseUrl);
  const basePathPrefix = stripTrailingSlashes(url.pathname);
  const normalizedRequestPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  url.pathname = `${basePathPrefix}${normalizedRequestPath}`.replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  if (redacted['Authorization']) {
    redacted['Authorization'] = '[redacted]';
  }
  return redacted;
}

function formatBodyForLog(body: unknown): unknown {
  if (typeof body === 'string') {
    return body.length > 500 ? `${body.slice(0, 500)}…` : body;
  }
  return body;
}

export async function httpRequest<T>(
  config: AssistantCliConfig,
  init: HttpRequestOptions,
): Promise<T> {
  const url = resolveRequestUrl(config.baseUrl, init.path);
  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(init.headers ?? {}),
  };

  const requestInit: RequestInit = {
    method: init.method ?? 'GET',
    headers,
  };
  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), requestInit);
  } catch (err) {
    console.error('[assistant-cli] fetch failed', {
      url: url.toString(),
      method: requestInit.method ?? 'GET',
      headers: redactHeaders(headers),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const parsedBody = text && isJson ? JSON.parse(text) : text;

  if (!response.ok) {
    console.error('[assistant-cli] http error', {
      url: url.toString(),
      method: requestInit.method ?? 'GET',
      status: response.status,
      statusText: response.statusText,
      body: formatBodyForLog(parsedBody),
    });
    const error: HttpError = Object.assign(
      new Error(`HTTP ${response.status} ${response.statusText || 'Error'}`.trim()),
      {
        status: response.status,
        body: parsedBody,
      },
    );
    throw error;
  }

  return parsedBody as T;
}
