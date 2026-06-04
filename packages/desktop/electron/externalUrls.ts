import { URL } from 'node:url';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function isSameFileUrl(value: string, expectedFileUrl: string): boolean {
  try {
    const url = new URL(value);
    const expected = new URL(expectedFileUrl);
    return (
      url.protocol === 'file:' &&
      expected.protocol === 'file:' &&
      url.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

export async function openAllowedExternalUrl(
  value: string,
  openExternal: (url: string) => Promise<unknown>,
): Promise<void> {
  if (!isAllowedExternalUrl(value)) {
    throw new Error(`Blocked external URL: ${value}`);
  }
  await openExternal(value);
}
