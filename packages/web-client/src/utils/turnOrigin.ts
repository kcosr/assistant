export function createWebTurnOriginId(): string {
  if (
    typeof window !== 'undefined' &&
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}
