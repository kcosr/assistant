export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface WebhookDeliveryOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

export async function deliverWebhook(
  config: WebhookConfig,
  payload: unknown,
  options?: WebhookDeliveryOptions,
): Promise<void> {
  const { url, headers } = config;
  const maxRetries = options?.maxRetries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 30_000;

  let attempt = 0;

  while (attempt < maxRetries) {
    attempt += 1;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          ...(headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        // Do not retry 4xx responses
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Timeout – will retry if attempts remain
      } else {
        // Network or other error – will retry if attempts remain
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
