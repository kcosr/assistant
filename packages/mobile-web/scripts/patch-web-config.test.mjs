import { describe, expect, it } from 'vitest';

import { applyConfigOverrides } from './patch-web-config.mjs';

const baseConfig = `/**
 * Assistant Frontend Configuration
 */

// API host for backend connections (WebSocket and HTTP)
// window.ASSISTANT_API_HOST = 'assistant';

// Set to true to use http:// and ws:// instead of https:// and wss://
// window.ASSISTANT_INSECURE = true;

// Enable push notifications on mobile (requires google-services.json)
window.__ASSISTANT_ENABLE_PUSH__ = false;
`;

describe('applyConfigOverrides', () => {
  it('writes a default API host when none is set', () => {
    const result = applyConfigOverrides(baseConfig);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('window.ASSISTANT_API_HOST = "assistant";');
  });

  it('preserves an existing API host when no override is provided', () => {
    const withHost = baseConfig.replace(
      "// window.ASSISTANT_API_HOST = 'assistant';",
      "window.ASSISTANT_API_HOST = 'https://example.test';",
    );

    const result = applyConfigOverrides(withHost);

    expect(result.changed).toBe(false);
    expect(result.contents).toBe(withHost);
  });

  it('overrides the API host when provided', () => {
    const withHost = baseConfig.replace(
      "// window.ASSISTANT_API_HOST = 'assistant';",
      "window.ASSISTANT_API_HOST = 'https://example.test';",
    );

    const result = applyConfigOverrides(withHost, { apiHost: '10.0.2.2:3000' });

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('window.ASSISTANT_API_HOST = "10.0.2.2:3000";');
  });

  it('sets insecure and websocket port when requested', () => {
    const result = applyConfigOverrides(baseConfig, { insecure: true, wsPort: 7777 });

    expect(result.contents).toContain('window.ASSISTANT_INSECURE = true;');
    expect(result.contents).toContain('window.ASSISTANT_WS_PORT = 7777;');
  });
});
