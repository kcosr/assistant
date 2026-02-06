// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupAndroidAppLifecycleHandlers, setupBackButtonHandler } from './capacitor';

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
