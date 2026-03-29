import { describe, expect, it } from 'vitest';

import {
  ensureRetainedShareDelivery,
  ensureShareIntentFilter,
} from './patch-android-share.mjs';

describe('ensureShareIntentFilter', () => {
  it('adds a text share intent filter after the launcher filter', () => {
    const input = `<activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>`;

    const result = ensureShareIntentFilter(input);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('android.intent.action.SEND');
    expect(result.contents).toContain('android:mimeType="text/plain"');
  });

  it('does not duplicate an existing share intent filter', () => {
    const input = `<activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
        </activity>`;

    const result = ensureShareIntentFilter(input);

    expect(result.changed).toBe(false);
    expect(result.contents).toBe(input);
  });
});

describe('ensureRetainedShareDelivery', () => {
  it('retains the share event until JS listeners are ready', () => {
    const input = 'notifyListeners("shareReceived", shareData);';

    const result = ensureRetainedShareDelivery(input);

    expect(result.changed).toBe(true);
    expect(result.contents).toContain('notifyListeners("shareReceived", shareData, true);');
  });

  it('does not change an already retained share event', () => {
    const input = 'notifyListeners("shareReceived", shareData, true);';

    const result = ensureRetainedShareDelivery(input);

    expect(result.changed).toBe(false);
    expect(result.contents).toBe(input);
  });
});
