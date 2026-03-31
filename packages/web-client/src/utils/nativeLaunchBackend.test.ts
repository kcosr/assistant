import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssistantLaunchConfigBridge,
  configureNativeLaunchBackend,
} from './nativeLaunchBackend';

describe('AssistantLaunchConfigBridge', () => {
  let hostWindow: Window & { ASSISTANT_API_HOST?: string };

  beforeEach(() => {
    hostWindow = {} as Window & { ASSISTANT_API_HOST?: string };
  });

  it('configures ASSISTANT_API_HOST from the direct plugin bridge', async () => {
    const bridge = new AssistantLaunchConfigBridge(() => ({
      AssistantLaunchConfig: {
        resolveLaunchBackend: () => ({
          selectedBackend: {
            id: 'assistant',
            label: 'Assistant',
            url: 'https://assistant',
          },
        }),
      },
    }));

    const ready = await configureNativeLaunchBackend({
      isAndroid: () => true,
      bridge,
      getWindow: () => hostWindow,
    });

    expect(ready).toBe(true);
    expect(hostWindow.ASSISTANT_API_HOST).toBe('https://assistant');
  });

  it('uses the Capacitor.Plugins bridge fallback', async () => {
    const bridge = new AssistantLaunchConfigBridge(() => ({
      Capacitor: {
        Plugins: {
          AssistantLaunchConfig: {
            resolveLaunchBackend: () =>
              Promise.resolve({
                selectedBackend: {
                  id: 'work',
                  label: 'Work',
                  url: 'https://assistant/work',
                },
              }),
          },
        },
      },
    }));

    const ready = await configureNativeLaunchBackend({
      isAndroid: () => true,
      bridge,
      getWindow: () => hostWindow,
    });

    expect(ready).toBe(true);
    expect(hostWindow.ASSISTANT_API_HOST).toBe('https://assistant/work');
  });

  it('does nothing outside Android', async () => {
    const resolveLaunchBackend = vi.fn();
    const bridge = new AssistantLaunchConfigBridge(() => ({
      AssistantLaunchConfig: {
        resolveLaunchBackend,
      },
    }));

    const ready = await configureNativeLaunchBackend({
      isAndroid: () => false,
      bridge,
      getWindow: () => hostWindow,
    });

    expect(ready).toBe(true);
    expect(resolveLaunchBackend).not.toHaveBeenCalled();
  });

  it('returns false when the native chooser rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bridge = new AssistantLaunchConfigBridge(() => ({
      AssistantLaunchConfig: {
        resolveLaunchBackend: () => Promise.reject(new Error('cancelled')),
      },
    }));

    const ready = await configureNativeLaunchBackend({
      isAndroid: () => true,
      bridge,
      getWindow: () => hostWindow,
    });

    expect(ready).toBe(false);
    expect(hostWindow.ASSISTANT_API_HOST).toBeUndefined();

    errorSpy.mockRestore();
  });
});
