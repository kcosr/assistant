#!/usr/bin/env node
/**
 * Patch Android MainActivity to set WebView text zoom.
 *
 * Configure via environment variable:
 *   WEBVIEW_TEXT_ZOOM=120  (default: 120, meaning 120%)
 *
 * - Reads appId from capacitor.config.json to locate MainActivity.java
 * - Ensures imports for Bundle/WebView are present
 * - Ensures onCreate(Bundle) exists and sets getBridge().getWebView().getSettings().setTextZoom()
 */
import fs from 'fs';
import path from 'path';

// Read zoom level from environment, default to 100 (normal)
const textZoom = parseInt(process.env.WEBVIEW_TEXT_ZOOM || '100', 10);
if (isNaN(textZoom) || textZoom < 50 || textZoom > 300) {
  console.error('[patch-android-fontscale] Invalid WEBVIEW_TEXT_ZOOM value. Must be 50-300.');
  process.exit(1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const mobileDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const capConfigPath = path.join(mobileDir, 'capacitor.config.json');
if (!fs.existsSync(capConfigPath)) {
  console.error('[patch-android-fontscale] capacitor.config.json not found');
  process.exit(0);
}

const cap = readJSON(capConfigPath);
const appId = String(cap.appId || '').trim();
if (!appId) {
  console.error('[patch-android-fontscale] appId missing in capacitor.config.json');
  process.exit(0);
}

const javaPkgPath = appId.replace(/\./g, '/');
const mainActivityPath = path.join(
  mobileDir,
  'android',
  'app',
  'src',
  'main',
  'java',
  javaPkgPath,
  'MainActivity.java',
);

if (!fs.existsSync(mainActivityPath)) {
  console.log(
    '[patch-android-fontscale] MainActivity.java not found. Generate Android project first (npm run android:add).',
  );
  process.exit(0);
}

let src = fs.readFileSync(mainActivityPath, 'utf8');

// Ensure required imports
if (!/import\s+android\.os\.Bundle;/.test(src)) {
  src = src.replace(/(package\s+[^;]+;\s*)/m, `$1\nimport android.os.Bundle;\n`);
}
if (!/import\s+android\.webkit\.WebView;/.test(src)) {
  src = src.replace(
    /(package\s+[^;]+;\s*(?:\n.*?)*?)(import\s+android\.os\.Bundle;[^]*?;)/m,
    `$1$2\nimport android.webkit.WebView;\n`,
  );
}

// Check if already patched with correct zoom level
const zoomRegex = new RegExp(`setTextZoom\\(${textZoom}\\)`);
if (zoomRegex.test(src)) {
  console.log(`[patch-android-fontscale] Text zoom already set to ${textZoom}%`);
  process.exit(0);
}

// Remove any existing setTextZoom blocks
src = src.replace(
  /\s*try\s*\{[\s\S]*?setTextZoom\(\d+\);[\s\S]*?\}\s*catch\s*\(Throwable t\)\s*\{\s*\/\*[^*]*\*\/\s*\}/g,
  '',
);

// Ensure onCreate override that sets text zoom
if (!/void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)/.test(src)) {
  // Insert onCreate after class declaration
  src = src.replace(
    /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/,
    `$1\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        try {\n            WebView wv = getBridge().getWebView();\n            if (wv != null && wv.getSettings() != null) {\n                wv.getSettings().setTextZoom(${textZoom});\n            }\n        } catch (Throwable t) { /* ignore */ }\n    }\n\n`,
  );
} else {
  // Add text zoom to existing onCreate after super.onCreate()
  src = src.replace(
    /(super\.onCreate\([^)]*\);)/,
    `$1\n        try {\n            WebView wv = getBridge().getWebView();\n            if (wv != null && wv.getSettings() != null) {\n                wv.getSettings().setTextZoom(${textZoom});\n            }\n        } catch (Throwable t) { /* ignore */ }`,
  );
}

fs.writeFileSync(mainActivityPath, src, 'utf8');
console.log(`[patch-android-fontscale] Set WebView text zoom to ${textZoom}% in MainActivity.java`);
