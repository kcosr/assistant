/**
 * Capacitor utilities for mobile builds.
 * These functions safely no-op when not running in a Capacitor context.
 */

export type NativeThemeScheme = 'light' | 'dark';

type StatusBarPlugin = {
  setStyle: (opts: { style: unknown }) => Promise<void> | void;
};

type StatusBarStyleValues = {
  Dark: unknown;
  Light: unknown;
};

// Helper to dynamically import Capacitor plugins without TypeScript resolution
const importModule = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

let lastAppliedStatusBarStyle: 'dark' | 'light' | null = null;
let requestedStatusBarStyle: 'dark' | 'light' | null = null;
let pendingStatusBarSync: Promise<void> | null = null;
let lastStatusBarSyncFailed = false;

function getCapacitorGlobal(): {
  Plugins?: {
    App?: unknown;
    StatusBar?: unknown;
  };
  App?: unknown;
  StatusBar?: unknown;
  registerPlugin?: (name: string) => unknown;
} | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return ((window as unknown as { Capacitor?: unknown }).Capacitor ?? null) as {
    Plugins?: {
      App?: unknown;
      StatusBar?: unknown;
    };
    App?: unknown;
    StatusBar?: unknown;
    registerPlugin?: (name: string) => unknown;
  } | null;
}

/**
 * Check if running in Capacitor Android context.
 */
export function isCapacitor(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = cap?.getPlatform?.();
  if (platform) {
    return platform !== 'web';
  }
  const origin = window.location?.origin;
  return origin === 'capacitor://localhost';
}

export function isCapacitorAndroid(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = cap?.getPlatform?.();
  if (platform) {
    return platform === 'android';
  }
  const origin = window.location?.origin;
  return origin === 'https://localhost' || origin === 'capacitor://localhost';
}

export type CapacitorBackButtonEvent = {
  canGoBack?: boolean;
};

export async function setupBackButtonHandler(
  handler: (event: { canGoBack: boolean }) => boolean,
  options?: {
    importModule?: typeof importModule;
    isAndroid?: () => boolean;
  },
): Promise<void> {
  const isAndroid = options?.isAndroid ?? isCapacitorAndroid;
  if (!isAndroid()) {
    return;
  }

  const importer = options?.importModule ?? importModule;

  try {
    type AppPlugin = {
      addListener: (
        eventName: 'backButton',
        listenerFunc: (event: CapacitorBackButtonEvent) => void,
      ) => { remove: () => Promise<void> };
      exitApp?: () => Promise<void> | void;
    };

    const loadAppPlugin = async (): Promise<AppPlugin | null> => {
      try {
        const { App } = await importer<{
          App: AppPlugin;
        }>('@capacitor/app');
        if (App && typeof App.addListener === 'function') {
          return App;
        }
        return null;
      } catch {
        const cap = getCapacitorGlobal();
        const appPlugin = (
          (cap?.Plugins?.App as {
            addListener?: (
              eventName: 'backButton',
              listenerFunc: (event: CapacitorBackButtonEvent) => void,
            ) => { remove: () => Promise<void> };
            exitApp?: () => Promise<void> | void;
          }) ??
          (cap?.App as {
            addListener?: (
              eventName: 'backButton',
              listenerFunc: (event: CapacitorBackButtonEvent) => void,
            ) => { remove: () => Promise<void> };
            exitApp?: () => Promise<void> | void;
          })
        ) ?? null;
        if (appPlugin && typeof appPlugin.addListener === 'function') {
          return appPlugin as AppPlugin;
        }
        return null;
      }
    };

    const appPlugin = await loadAppPlugin();
    if (!appPlugin) {
      return;
    }

    appPlugin.addListener('backButton', (event) => {
      const canGoBack = typeof event?.canGoBack === 'boolean' ? event.canGoBack : false;
      const handled = handler({ canGoBack });
      if (handled) {
        return;
      }
      const historyLength =
        typeof window !== 'undefined' && typeof window.history?.length === 'number'
          ? window.history.length
          : 0;
      if (
        canGoBack &&
        historyLength > 1 &&
        typeof window !== 'undefined' &&
        typeof window.history?.back === 'function'
      ) {
        window.history.back();
        return;
      }
      void appPlugin.exitApp?.();
    });
  } catch {
    // Not in Capacitor context or plugin not available.
  }
}

/**
 * Detect keyboard visibility using visualViewport API.
 * When keyboard is shown, add a class to hide bottom nav bar padding.
 */
function setupKeyboardDetection(): void {
  if (!window.visualViewport) {
    return;
  }

  const viewportHeight = window.innerHeight;
  const threshold = 150; // Keyboard is likely visible if viewport shrinks by this much

  const handleResize = () => {
    const currentHeight = window.visualViewport?.height ?? viewportHeight;
    const keyboardVisible = viewportHeight - currentHeight > threshold;

    if (keyboardVisible) {
      document.documentElement.classList.add('keyboard-visible');
    } else {
      document.documentElement.classList.remove('keyboard-visible');
    }
  };

  window.visualViewport.addEventListener('resize', handleResize);
}

async function loadStatusBarPlugin(
  importer: typeof importModule,
): Promise<{ StatusBar: StatusBarPlugin; Style: StatusBarStyleValues } | null> {
  try {
    const { StatusBar, Style } = await importer<{
      StatusBar: StatusBarPlugin;
      Style: StatusBarStyleValues;
    }>('@capacitor/status-bar');
    if (StatusBar && typeof StatusBar.setStyle === 'function') {
      return { StatusBar, Style };
    }
  } catch {
    // Fall through to the global Capacitor bridge.
  }

  const cap = getCapacitorGlobal();
  const statusBarPlugin = (
    (cap?.Plugins?.StatusBar as StatusBarPlugin | undefined) ??
    (cap?.StatusBar as StatusBarPlugin | undefined) ??
    (typeof cap?.registerPlugin === 'function'
      ? (cap.registerPlugin('StatusBar') as StatusBarPlugin)
      : null)
  ) as StatusBarPlugin | null;
  if (!statusBarPlugin || typeof statusBarPlugin.setStyle !== 'function') {
    return null;
  }

  // The native bridge accepts string enum values even without the ESM wrapper.
  return {
    StatusBar: statusBarPlugin,
    Style: {
      Dark: 'DARK',
      Light: 'LIGHT',
    },
  };
}

export async function syncStatusBarThemeForScheme(
  scheme: NativeThemeScheme,
  options?: {
    importModule?: typeof importModule;
    isAndroid?: () => boolean;
    force?: boolean;
  },
): Promise<void> {
  const isAndroid = options?.isAndroid ?? isCapacitorAndroid;
  if (!isAndroid()) {
    return;
  }

  const styleKey = scheme === 'dark' ? 'dark' : 'light';
  if (options?.force && lastAppliedStatusBarStyle === styleKey && !pendingStatusBarSync) {
    lastAppliedStatusBarStyle = null;
  }
  requestedStatusBarStyle = styleKey;
  if (lastAppliedStatusBarStyle === styleKey && !pendingStatusBarSync) {
    return;
  }
  if (pendingStatusBarSync) {
    await pendingStatusBarSync;
    return;
  }

  const importer = options?.importModule ?? importModule;

  pendingStatusBarSync = (async () => {
    try {
      lastStatusBarSyncFailed = false;
      const statusBarModule = await loadStatusBarPlugin(importer);
      if (!statusBarModule) {
        return;
      }
      const { StatusBar, Style } = statusBarModule;

      while (requestedStatusBarStyle && requestedStatusBarStyle !== lastAppliedStatusBarStyle) {
        const nextStyle = requestedStatusBarStyle;
        await StatusBar.setStyle({
          style: nextStyle === 'dark' ? Style.Dark : Style.Light,
        });
        lastAppliedStatusBarStyle = nextStyle;
      }
    } catch {
      // Not in Capacitor context or plugin not available.
      lastStatusBarSyncFailed = true;
    } finally {
      pendingStatusBarSync = null;
    }
  })();

  await pendingStatusBarSync;
  if (
    requestedStatusBarStyle &&
    requestedStatusBarStyle !== lastAppliedStatusBarStyle &&
    !pendingStatusBarSync &&
    !lastStatusBarSyncFailed
  ) {
    await syncStatusBarThemeForScheme(
      requestedStatusBarStyle === 'dark' ? 'dark' : 'light',
      options,
    );
  }
}

/**
 * Configure mobile-specific layout shims for Capacitor Android.
 *
 * Adds fixed padding for Android status bar and navigation bar since
 * CSS safe-area-inset doesn't work reliably in Android WebView.
 */
export async function configureStatusBar(): Promise<void> {
  // Add padding for Android system bars
  if (isCapacitorAndroid()) {
    document.documentElement.style.setProperty('--capacitor-status-bar-height', '56px');
    document.documentElement.style.setProperty('--capacitor-status-bar-height-landscape', '24px');
    document.documentElement.style.setProperty('--capacitor-nav-bar-height', '16px');
    document.documentElement.classList.add('capacitor-android');

    // Detect keyboard visibility and hide bottom padding when keyboard is up
    setupKeyboardDetection();
  }
}

export async function setupAndroidAppLifecycleHandlers(
  handlers: {
    onBackground?: () => void;
    onResume?: () => void;
  },
  options?: {
    importModule?: typeof importModule;
    isAndroid?: () => boolean;
    document?: Document;
  },
): Promise<void> {
  const isAndroid = options?.isAndroid ?? (() => isCapacitor() && isCapacitorAndroid());
  if (!isAndroid()) {
    return;
  }

  const doc = options?.document ?? (typeof document !== 'undefined' ? document : null);
  const importer = options?.importModule ?? importModule;

  const onBackground = typeof handlers.onBackground === 'function' ? handlers.onBackground : null;
  const onResume = typeof handlers.onResume === 'function' ? handlers.onResume : null;
  if (!onBackground && !onResume) {
    return;
  }

  try {
    type AppPlugin = {
      addListener: (
        eventName: 'appStateChange',
        listenerFunc: (state: { isActive: boolean }) => void,
      ) => { remove: () => Promise<void> };
    };

    const loadAppPlugin = async (): Promise<AppPlugin | null> => {
      try {
        const { App } = await importer<{ App: AppPlugin }>('@capacitor/app');
        if (App && typeof App.addListener === 'function') {
          return App;
        }
        return null;
      } catch {
        const cap = (window as unknown as {
          Capacitor?: { Plugins?: { App?: unknown }; App?: unknown };
        }).Capacitor;
        const appPlugin = (
          (cap?.Plugins?.App as {
            addListener?: (
              eventName: 'appStateChange',
              listenerFunc: (state: { isActive: boolean }) => void,
            ) => { remove: () => Promise<void> };
          }) ??
          (cap?.App as {
            addListener?: (
              eventName: 'appStateChange',
              listenerFunc: (state: { isActive: boolean }) => void,
            ) => { remove: () => Promise<void> };
          })
        ) ?? null;
        if (appPlugin && typeof appPlugin.addListener === 'function') {
          return appPlugin as AppPlugin;
        }
        return null;
      }
    };

    const appPlugin = await loadAppPlugin();
    if (!appPlugin) {
      return;
    }

    let isBackgrounded = false;
    const emitBackground = (): void => {
      if (isBackgrounded) {
        return;
      }
      isBackgrounded = true;
      onBackground?.();
    };
    const emitResume = (): void => {
      if (!isBackgrounded) {
        return;
      }
      isBackgrounded = false;
      onResume?.();
    };

    appPlugin.addListener('appStateChange', (state) => {
      if (!state || typeof state.isActive !== 'boolean') {
        return;
      }
      if (state.isActive) {
        emitResume();
      } else {
        emitBackground();
      }
    });

    if (doc) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible') {
          emitResume();
        } else if (doc.visibilityState === 'hidden') {
          emitBackground();
        }
      });
    }
  } catch {
    // Not in Capacitor context or plugin not available.
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url || !url.trim()) {
    return;
  }

  if (isCapacitorAndroid()) {
    try {
      const { Browser } = await importModule<{
        Browser: {
          open: (options: { url: string }) => Promise<void>;
        };
      }>('@capacitor/browser');

      await Browser.open({ url });
      return;
    } catch {
      // Not in Capacitor context or plugin not available; fall through to browser open.
    }
  }

  try {
    if (typeof window !== 'undefined') {
      if (typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      window.location.href = url;
    }
  } catch {
    // Ignore failures opening the URL on web.
  }
}

export function __resetCapacitorTestState(): void {
  lastAppliedStatusBarStyle = null;
  requestedStatusBarStyle = null;
  pendingStatusBarSync = null;
  lastStatusBarSyncFailed = false;
}
