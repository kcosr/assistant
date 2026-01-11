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

export async function httpRequest<T>(
  config: AssistantCliConfig,
  init: HttpRequestOptions,
): Promise<T> {
  const url = new URL(init.path, config.baseUrl);
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

  const response = await fetch(url.toString(), requestInit);

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const parsedBody = text && isJson ? JSON.parse(text) : text;

  if (!response.ok) {
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
