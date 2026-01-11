export function parseWebhookHeaders(headers: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers || headers.length === 0) return result;

  for (const header of headers) {
    const trimmed = header.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (!key) continue;

    result[key] = value;
  }

  return result;
}
