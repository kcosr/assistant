// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  __resetCapacitorTestState,
  setupAndroidAppLifecycleHandlers,
  setupBackButtonHandler,
  syncStatusBarThemeForScheme,
} from './capacitor';

type BackButtonListener = (event: { canGoBack?: boolean }) => void;

const createAppMock = () => {
  let listener: BackButtonListener | null = null;
  const addListener = vi.fn(
    (eventName: string, callback: BackButtonListener) => {
      if (eventName === 'backButton') {
        listener = callback;
      }
      return { remove: vi.fn(async () => {}) };
    },
  );
  const exitApp = vi.fn();
  return {
    App: { addListener, exitApp },
    getListener: () => listener,
  };
};

describe('setupBackButtonHandler', () => {
  afterEach(() => {
    __resetCapacitorTestState();
    vi.restoreAllMocks();
  });

  it('does not fall back when handler consumes the event', async () => {
    const appMock = createAppMock();
    const handler = vi.fn(() => true);
    const historySpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    Object.defineProperty(window.history, 'length', { value: 2, configurable: true });

    const importModule = (async () => ({ App: appMock.App })) as unknown as <T>(
      specifier: string,
    ) => Promise<T>;

    await setupBackButtonHandler(handler, {
      importModule,
      isAndroid: () => true,
    });

    const listener = appMock.getListener();
    expect(listener).toBeTruthy();
    listener?.({ canGoBack: true });

    expect(handler).toHaveBeenCalledWith({ canGoBack: true });
    expect(historySpy).not.toHaveBeenCalled();
    expect(appMock.App.exitApp).not.toHaveBeenCalled();
  });

  it('falls back to history.back when available', async () => {
    const appMock = createAppMock();
    const handler = vi.fn(() => false);
    const historySpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    Object.defineProperty(window.history, 'length', { value: 2, configurable: true });

    const importModule = (async () => ({ App: appMock.App })) as unknown as <T>(
      specifier: string,
    ) => Promise<T>;

    await setupBackButtonHandler(handler, {
      importModule,
      isAndroid: () => true,
    });

    const listener = appMock.getListener();
    listener?.({ canGoBack: true });

    expect(handler).toHaveBeenCalledWith({ canGoBack: true });
    expect(historySpy).toHaveBeenCalledTimes(1);
    expect(appMock.App.exitApp).not.toHaveBeenCalled();
  });

  it('calls App.exitApp when no history is available', async () => {
    const appMock = createAppMock();
    const handler = vi.fn(() => false);
    const historySpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });

    const importModule = (async () => ({ App: appMock.App })) as unknown as <T>(
      specifier: string,
    ) => Promise<T>;

    await setupBackButtonHandler(handler, {
      importModule,
      isAndroid: () => true,
    });

    const listener = appMock.getListener();
    listener?.({ canGoBack: false });

    expect(handler).toHaveBeenCalledWith({ canGoBack: false });
    expect(historySpy).not.toHaveBeenCalled();
    expect(appMock.App.exitApp).toHaveBeenCalledTimes(1);
  });
});

type AppStateListener = (state: { isActive: boolean }) => void;

const createAppStateMock = () => {
  let listener: AppStateListener | null = null;
  const addListener = vi.fn((eventName: string, callback: AppStateListener) => {
    if (eventName === 'appStateChange') {
      listener = callback;
    }
    return { remove: vi.fn(async () => {}) };
  });
  return {
    App: { addListener },
    getListener: () => listener,
  };
};

describe('setupAndroidAppLifecycleHandlers', () => {
  afterEach(() => {
    __resetCapacitorTestState();
    vi.restoreAllMocks();
  });

  it('invokes background/resume handlers only on transitions', async () => {
    const appMock = createAppStateMock();
    const onBackground = vi.fn();
    const onResume = vi.fn();

    const importModule = (async () => ({ App: appMock.App })) as unknown as <T>(
      specifier: string,
    ) => Promise<T>;

    await setupAndroidAppLifecycleHandlers(
      { onBackground, onResume },
      {
        importModule,
        isAndroid: () => true,
        document,
      },
    );

    const listener = appMock.getListener();
    expect(listener).toBeTruthy();

    listener?.({ isActive: true });
    expect(onResume).not.toHaveBeenCalled();

    listener?.({ isActive: false });
    expect(onBackground).toHaveBeenCalledTimes(1);

    listener?.({ isActive: false });
    expect(onBackground).toHaveBeenCalledTimes(1);

    listener?.({ isActive: true });
    expect(onResume).toHaveBeenCalledTimes(1);

    listener?.({ isActive: true });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('falls back to document visibilitychange when available', async () => {
    const appMock = createAppStateMock();
    const onBackground = vi.fn();
    const onResume = vi.fn();

    const importModule = (async () => ({ App: appMock.App })) as unknown as <T>(
      specifier: string,
    ) => Promise<T>;

    await setupAndroidAppLifecycleHandlers(
      { onBackground, onResume },
      {
        importModule,
        isAndroid: () => true,
        document,
      },
    );

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onBackground).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe('syncStatusBarThemeForScheme', () => {
  afterEach(() => {
    __resetCapacitorTestState();
    delete (window as typeof window & { Capacitor?: unknown }).Capacitor;
    vi.restoreAllMocks();
  });

  it('maps dark scheme to Style.Dark', async () => {
    const setStyle = vi.fn(async () => {});
    const importModule = (async () => ({
      StatusBar: { setStyle },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });

    expect(setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });

  it('maps light scheme to Style.Light', async () => {
    const setStyle = vi.fn(async () => {});
    const importModule = (async () => ({
      StatusBar: { setStyle },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('light', {
      importModule,
      isAndroid: () => true,
    });

    expect(setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('is a no-op outside Android', async () => {
    const importModule = vi.fn(async () => ({
      StatusBar: { setStyle: vi.fn(async () => {}) },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => false,
    });

    expect(importModule).not.toHaveBeenCalled();
  });

  it('dedupes repeated syncs for the same scheme', async () => {
    const setStyle = vi.fn(async () => {});
    const importModule = (async () => ({
      StatusBar: { setStyle },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });
    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });

    expect(setStyle).toHaveBeenCalledTimes(1);
  });

  it('reapplies the same scheme when forced', async () => {
    const setStyle = vi.fn(async () => {});
    const importModule = (async () => ({
      StatusBar: { setStyle },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });
    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
      force: true,
    });

    expect(setStyle).toHaveBeenCalledTimes(2);
  });

  it('applies the latest requested scheme after an in-flight update completes', async () => {
    let resolveFirstCall: (() => void) | null = null;
    const firstCallDone = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });
    const setStyle = vi.fn(async ({ style }: { style: string }) => {
      if (style === 'DARK') {
        await firstCallDone;
      }
    });
    const importModule = (async () => ({
      StatusBar: { setStyle },
      Style: { Dark: 'DARK', Light: 'LIGHT' },
    })) as unknown as <T>(specifier: string) => Promise<T>;

    const firstSync = syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });
    await Promise.resolve();
    const secondSync = syncStatusBarThemeForScheme('light', {
      importModule,
      isAndroid: () => true,
    });

    if (typeof resolveFirstCall !== 'function') {
      throw new Error('Expected first call resolver to be assigned');
    }
    (resolveFirstCall as () => void)();
    await Promise.all([firstSync, secondSync]);

    expect(setStyle.mock.calls).toEqual([[{ style: 'DARK' }], [{ style: 'LIGHT' }]]);
  });

  it('swallows importer failures', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as <T>(specifier: string) => Promise<T>;

    await expect(
      syncStatusBarThemeForScheme('dark', {
        importModule,
        isAndroid: () => true,
      }),
    ).resolves.toBeUndefined();
  });

  it('falls back to the global Capacitor StatusBar plugin when import fails', async () => {
    const setStyle = vi.fn(async () => {});
    (
      window as typeof window & {
        Capacitor?: {
          Plugins?: {
            StatusBar?: {
              setStyle: typeof setStyle;
            };
          };
        };
      }
    ).Capacitor = {
      Plugins: {
        StatusBar: {
          setStyle,
        },
      },
    };

    const importModule = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('light', {
      importModule,
      isAndroid: () => true,
    });

    expect(setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('registers the global Capacitor StatusBar plugin when import fails', async () => {
    const setStyle = vi.fn(async () => {});
    const registerPlugin = vi.fn(() => ({
      setStyle,
    }));
    (
      window as typeof window & {
        Capacitor?: {
          registerPlugin?: typeof registerPlugin;
        };
      }
    ).Capacitor = {
      registerPlugin,
    };

    const importModule = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as <T>(specifier: string) => Promise<T>;

    await syncStatusBarThemeForScheme('dark', {
      importModule,
      isAndroid: () => true,
    });

    expect(registerPlugin).toHaveBeenCalledWith('StatusBar');
    expect(setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });
});
