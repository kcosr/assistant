/**
 * Global test setup for web-client tests.
 *
 * Ensures API calls use relative URLs (same-origin) in tests
 * by clearing the configured API host.
 */
import { beforeEach } from 'vitest';

beforeEach(() => {
  // Clear configured API host so tests use relative URLs
  if (typeof window !== 'undefined') {
    delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
    delete (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
    delete (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  }
});
