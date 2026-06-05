import { describe, expect, it } from 'vitest';

import { resolveDesktopAppConfig } from './appConfig';

describe('resolveDesktopAppConfig', () => {
  it('resolves the default variant identity', () => {
    expect(resolveDesktopAppConfig({})).toEqual({
      variant: 'default',
      productName: 'Assistant',
      appId: 'com.assistant.desktop',
      defaultBackendUrl: 'https://assistant',
    });
  });

  it('resolves the work variant identity and backend', () => {
    expect(resolveDesktopAppConfig({ ASSISTANT_DESKTOP_VARIANT: 'work' })).toEqual({
      variant: 'work',
      productName: 'Assistant Work',
      appId: 'com.assistant.desktop.work',
      defaultBackendUrl: 'https://assistant/assistant-work',
    });
  });

  it('honors an explicit backend URL override', () => {
    expect(
      resolveDesktopAppConfig({
        ASSISTANT_DESKTOP_VARIANT: 'work',
        ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL: ' https://example.test/work ',
      }).defaultBackendUrl,
    ).toBe('https://example.test/work');
  });
});
