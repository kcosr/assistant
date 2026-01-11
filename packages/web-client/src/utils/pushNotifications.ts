/**
 * Push Notifications via Firebase Cloud Messaging (FCM)
 *
 * Registers for push notifications and shows the device token.
 * Only active in Capacitor Android context.
 */

interface PushNotificationToken {
  value: string;
}

interface PushNotificationSchema {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

interface ActionPerformed {
  notification: PushNotificationSchema;
}

interface PushNotificationsPlugin {
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(
    event: 'registration',
    callback: (token: PushNotificationToken) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    event: 'registrationError',
    callback: (error: { error: string }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    event: 'pushNotificationReceived',
    callback: (notification: PushNotificationSchema) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    event: 'pushNotificationActionPerformed',
    callback: (action: ActionPerformed) => void,
  ): Promise<{ remove: () => void }>;
}

import { isCapacitorAndroid } from './capacitor';

/**
 * Check if FCM token modal should be shown.
 * Set window.__ASSISTANT_SHOW_FCM_TOKEN__ = true to enable.
 */
function shouldShowTokenModal(): boolean {
  const globalAny = globalThis as { __ASSISTANT_SHOW_FCM_TOKEN__?: boolean };
  return globalAny.__ASSISTANT_SHOW_FCM_TOKEN__ === true;
}

/**
 * Show a modal with copy button for the FCM token.
 */
function showTokenModal(token: string): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.8); z-index: 99999;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1a1a1a; border-radius: 12px; padding: 20px;
    max-width: 100%; width: 400px; color: white;
  `;

  modal.innerHTML = `
    <h3 style="margin: 0 0 12px 0; font-size: 16px;">FCM Token</h3>
    <textarea id="fcm-token-text" readonly style="
      width: 100%; height: 120px; background: #333; color: #fff;
      border: 1px solid #555; border-radius: 8px; padding: 10px;
      font-family: monospace; font-size: 12px; resize: none;
    ">${token}</textarea>
    <div style="display: flex; gap: 10px; margin-top: 12px;">
      <button id="fcm-copy-btn" style="
        flex: 1; padding: 12px; background: #4a9eff; color: white;
        border: none; border-radius: 8px; font-size: 14px; cursor: pointer;
      ">Copy Token</button>
      <button id="fcm-close-btn" style="
        flex: 1; padding: 12px; background: #555; color: white;
        border: none; border-radius: 8px; font-size: 14px; cursor: pointer;
      ">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('fcm-copy-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(token);
      const btn = document.getElementById('fcm-copy-btn');
      if (btn) btn.textContent = 'Copied!';
    } catch {
      // Fallback: select the text
      const textarea = document.getElementById('fcm-token-text') as HTMLTextAreaElement;
      textarea?.select();
      document.execCommand('copy');
      const btn = document.getElementById('fcm-copy-btn');
      if (btn) btn.textContent = 'Copied!';
    }
  });

  document.getElementById('fcm-close-btn')?.addEventListener('click', () => {
    overlay.remove();
  });
}

/**
 * Check if push notifications are enabled.
 * Set window.__ASSISTANT_ENABLE_PUSH__ = true to enable.
 */
function isPushEnabled(): boolean {
  const globalAny = globalThis as { __ASSISTANT_ENABLE_PUSH__?: boolean };
  return globalAny.__ASSISTANT_ENABLE_PUSH__ === true;
}

/**
 * Initialize push notifications.
 * Requests permission, registers with FCM, and shows the token modal.
 * Disabled by default - set __ASSISTANT_ENABLE_PUSH__ = true in config.js to enable.
 */
export async function initPushNotifications(): Promise<void> {
  if (!isCapacitorAndroid()) {
    return;
  }

  if (!isPushEnabled()) {
    console.log('[push] Push notifications disabled. Set __ASSISTANT_ENABLE_PUSH__ = true to enable.');
    return;
  }

  try {
    const { PushNotifications } = (await import('@capacitor/push-notifications')) as {
      PushNotifications: PushNotificationsPlugin;
    };

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      return;
    }

    // Listen for registration success
    await PushNotifications.addListener('registration', (token) => {
      console.log('[push] FCM token:', token.value);
      if (shouldShowTokenModal()) {
        showTokenModal(token.value);
      }
    });

    // Listen for registration errors
    await PushNotifications.addListener('registrationError', (error) => {
      console.error('[push] Registration error:', error.error);
    });

    // Listen for notifications received while app is in foreground
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[push] Notification received:', notification);
    });

    // Listen for notification tap (app opened from notification)
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[push] Notification action:', action);
    });

    // Register with FCM
    await PushNotifications.register();
  } catch (err) {
    // Firebase not configured (google-services.json missing) or other error
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('FirebaseApp') || message.includes('Firebase')) {
      console.warn('[push] Firebase not configured. Push notifications disabled.');
      console.warn('[push] To enable, add google-services.json to packages/mobile-web/');
    } else {
      console.error('[push] Error:', err);
    }
  }
}
