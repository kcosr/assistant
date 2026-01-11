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
  }
});
