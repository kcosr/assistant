#!/usr/bin/env node
/**
 * Patches the Android manifest to receive shared text content from other apps.
 *
 * - Adds intent-filter for ACTION_SEND with text/plain MIME type
 */
import fs from 'fs';
import path from 'path';

const mobileDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const androidMain = path.resolve(mobileDir, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

if (!exists(manifestPath)) {
  console.log('[patch-android-share] Android project not found. Run: npm run android:add');
  process.exit(0);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');

// Check if share intent-filter already exists
if (/android\.intent\.action\.SEND/.test(manifest)) {
  console.log('[patch-android-share] Share intent-filter already present');
  process.exit(0);
}

// Add intent-filter for receiving shared text after the MAIN intent-filter
const shareIntentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;

// Insert after the closing </intent-filter> of the MAIN launcher intent
manifest = manifest.replace(
  /(<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN"\s*\/>.*?<\/intent-filter>)/s,
  `$1${shareIntentFilter}`,
);

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('[patch-android-share] Added share intent-filter for text/plain');
