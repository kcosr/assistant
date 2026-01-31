const WINDOW_ID_STORAGE_KEY = 'aiAssistantWindowId';

function generateWindowId(): string {
  if (typeof window !== 'undefined') {
    const crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  }
  return `window-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function getClientWindowId(): string {
  if (typeof window === 'undefined') {
    return 'server';
  }

  try {
    const existing = window.sessionStorage?.getItem(WINDOW_ID_STORAGE_KEY);
    if (existing) {
      (globalThis as { __ASSISTANT_WINDOW_ID__?: string }).__ASSISTANT_WINDOW_ID__ = existing;
      return existing;
    }
  } catch {
    // Ignore sessionStorage errors.
  }

  const generated = generateWindowId();
  try {
    window.sessionStorage?.setItem(WINDOW_ID_STORAGE_KEY, generated);
  } catch {
    // Ignore sessionStorage errors.
  }
  (globalThis as { __ASSISTANT_WINDOW_ID__?: string }).__ASSISTANT_WINDOW_ID__ = generated;
  return generated;
}
