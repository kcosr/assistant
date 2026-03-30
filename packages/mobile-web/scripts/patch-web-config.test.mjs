import { describe, expect, it } from 'vitest';

import { applyConfigOverrides, applyHtmlOverrides } from './patch-web-config.mjs';

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
    expect(result.contents).toContain('window.ASSISTANT_API_HOST = "https://assistant";');
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

  it('updates the legacy bare assistant host to the full default host', () => {
    const withLegacyHost = baseConfig.replace(
      "// window.ASSISTANT_API_HOST = 'assistant';",
      'window.ASSISTANT_API_HOST = "assistant";',
    );

    const result = applyConfigOverrides(withLegacyHost);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('window.ASSISTANT_API_HOST = "https://assistant";');
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

describe('applyHtmlOverrides', () => {
  const baseHtml = `<!doctype html>
<html lang="en">
  <head>
    <script src="config.js"></script>
    <script type="module" src="client.js"></script>
  </head>
</html>
`;

  it('injects an inline api host script before client.js', () => {
    const result = applyHtmlOverrides(baseHtml);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain(
      '<script data-assistant-api-host-inline>window.ASSISTANT_API_HOST = "https://assistant";</script>',
    );
    expect(
      result.contents.indexOf('data-assistant-api-host-inline') <
        result.contents.indexOf('type="module" src="client.js"'),
    ).toBe(true);
  });

  it('updates an existing inline api host script', () => {
    const withInline = baseHtml.replace(
      '<script src="config.js"></script>',
      '<script src="config.js"></script>\n    <script data-assistant-api-host-inline>window.ASSISTANT_API_HOST = "https://old.example";</script>',
    );

    const result = applyHtmlOverrides(withInline, { apiHost: 'https://assistant/assistant-work' });

    expect(result.changed).toBe(true);
    expect(result.contents).toContain(
      'window.ASSISTANT_API_HOST = "https://assistant/assistant-work";',
    );
    expect(result.contents).not.toContain('https://old.example');
  });
});
