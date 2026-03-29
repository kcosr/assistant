#!/usr/bin/env node
/**
 * Patches Android share-target handling for Capacitor builds.
 *
 * - Adds an ACTION_SEND intent-filter for text/plain shares.
 * - Retains share events until the WebView listener consumes them on cold start.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const mobileDir = path.resolve(scriptDir, '..');
const androidMain = path.resolve(mobileDir, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');
const sharePluginPath = path.resolve(
  mobileDir,
  '..',
  '..',
  'node_modules',
  '@capgo',
  'capacitor-share-target',
  'android',
  'src',
  'main',
  'java',
  'app',
  'capgo',
  'sharetarget',
  'CapacitorShareTargetPlugin.java',
);

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function ensureShareIntentFilter(manifest) {
  if (/android\.intent\.action\.SEND/.test(manifest)) {
    return { contents: manifest, changed: false };
  }

  const shareIntentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;

  const updated = manifest.replace(
    /(<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN"\s*\/>.*?<\/intent-filter>)/s,
    `$1${shareIntentFilter}`,
  );
  return { contents: updated, changed: updated !== manifest };
}

export function ensureRetainedShareDelivery(pluginSource) {
  const alreadyPatched =
    /notifyListeners\(\s*"shareReceived"\s*,\s*shareData\s*,\s*true\s*\);/.test(pluginSource);
  if (alreadyPatched) {
    return { contents: pluginSource, changed: false };
  }

  const updated = pluginSource.replace(
    /notifyListeners\(\s*"shareReceived"\s*,\s*shareData\s*\);/,
    'notifyListeners("shareReceived", shareData, true);',
  );
  return { contents: updated, changed: updated !== pluginSource };
}

function patchFile(filePath, label, transform) {
  if (!exists(filePath)) {
    console.log(`[patch-android-share] ${label} not found: ${path.relative(process.cwd(), filePath)}`);
    return false;
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const result = transform(original);
  if (!result.changed) {
    console.log(`[patch-android-share] ${label} already up to date`);
    return false;
  }

  fs.writeFileSync(filePath, result.contents, 'utf8');
  console.log(`[patch-android-share] Updated ${label}: ${path.relative(process.cwd(), filePath)}`);
  return true;
}

function run() {
  if (!exists(manifestPath)) {
    console.log('[patch-android-share] Android project not found. Run: npm run android:add');
    process.exit(0);
  }

  patchFile(manifestPath, 'Android share intent-filter', ensureShareIntentFilter);
  patchFile(sharePluginPath, 'Capacitor share-target delivery', ensureRetainedShareDelivery);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run();
}
