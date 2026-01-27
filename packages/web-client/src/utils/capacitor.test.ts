// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupBackButtonHandler } from './capacitor';

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
