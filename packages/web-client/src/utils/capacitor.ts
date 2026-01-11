/**
 * Capacitor utilities for mobile builds.
 * These functions safely no-op when not running in a Capacitor context.
 */

// Helper to dynamically import Capacitor plugins without TypeScript resolution
const importModule = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

/**
 * Check if running in Capacitor Android context.
 */
/**
 * Check if running in Capacitor Android context.
 */
export function isCapacitorAndroid(): boolean {
  return window.location.origin === 'https://localhost';
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

/**
 * Configure mobile-specific styles and status bar.
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

  try {
    const { StatusBar, Style } = await importModule<{
      StatusBar: {
        setStyle: (opts: { style: unknown }) => Promise<void>;
      };
      Style: { Dark: unknown; Light: unknown };
    }>('@capacitor/status-bar');

    // Dark style (light text) to match our dark theme
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Not in Capacitor context or plugin not available
  }
}

export async function enableAppReloadOnResume(): Promise<void> {
  if (!isCapacitorAndroid()) {
    return;
  }

  try {
    const { App } = await importModule<{
      App: {
        addListener: (
          eventName: 'appStateChange',
          listenerFunc: (state: { isActive: boolean }) => void,
        ) => { remove: () => Promise<void> };
      };
    }>('@capacitor/app');

    let hasBackgrounded = false;
    App.addListener('appStateChange', (state) => {
      if (!state || typeof state.isActive !== 'boolean') {
        return;
      }
      if (state.isActive) {
        if (hasBackgrounded) {
          window.location.reload();
        }
      } else {
        hasBackgrounded = true;
      }
    });
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
