#!/usr/bin/env node
/**
 * Copy google-services.json to Android app folder for Firebase/FCM.
 */
import fs from 'fs';
import path from 'path';

const mobileDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcPath = path.join(mobileDir, 'google-services.json');
const destPath = path.join(mobileDir, 'android', 'app', 'google-services.json');

if (!fs.existsSync(srcPath)) {
  console.log('[patch-android-firebase] google-services.json not found in mobile-web folder');
  process.exit(0);
}

if (!fs.existsSync(path.dirname(destPath))) {
  console.log('[patch-android-firebase] Android project not found. Run: npm run android:add');
  process.exit(0);
}

fs.copyFileSync(srcPath, destPath);
console.log('[patch-android-firebase] Copied google-services.json to android/app/');
