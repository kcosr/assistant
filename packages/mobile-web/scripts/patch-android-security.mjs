#!/usr/bin/env node
/**
 * Patches the generated Android project to trust user-installed CAs and
 * allow self-signed certificates via Android Network Security Config.
 *
 * - Adds android:networkSecurityConfig to AndroidManifest.xml
 * - Writes res/xml/network_security_config.xml trusting system + user CAs
 */
import fs from 'fs';
import path from 'path';

const mobileDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const androidMain = path.resolve(mobileDir, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');
const xmlDir = path.join(androidMain, 'res', 'xml');
const xmlPath = path.join(xmlDir, 'network_security_config.xml');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

if (!exists(manifestPath)) {
  console.log('[patch-android-security] Android project not found. Run: npm run android:add');
  process.exit(0);
}

// Ensure res/xml directory exists
fs.mkdirSync(xmlDir, { recursive: true });

// Write the network_security_config.xml
const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Trust system and user-installed CAs -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
fs.writeFileSync(xmlPath, xml, 'utf8');
console.log(`[patch-android-security] Wrote ${path.relative(process.cwd(), xmlPath)}`);

// Patch AndroidManifest.xml to reference the security config
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/android:networkSecurityConfig=/.test(manifest)) {
  manifest = manifest.replace(
    /(<application\b)([^>]*)(>)/,
    (m, a, b, c) => `${a}${b} android:networkSecurityConfig="@xml/network_security_config"${c}`,
  );
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  console.log('[patch-android-security] Updated AndroidManifest.xml with networkSecurityConfig');
} else {
  console.log(
    '[patch-android-security] AndroidManifest.xml already references networkSecurityConfig',
  );
}

// Add RECORD_AUDIO permission for microphone input
manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/android.permission.RECORD_AUDIO/.test(manifest)) {
  manifest = manifest.replace(
    /(<manifest\b[^>]*>)/,
    `$1\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />`,
  );
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  console.log('[patch-android-security] Added RECORD_AUDIO permission');
} else {
  console.log('[patch-android-security] RECORD_AUDIO permission already present');
}

// Add MODIFY_AUDIO_SETTINGS permission (needed for some audio features)
manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/android.permission.MODIFY_AUDIO_SETTINGS/.test(manifest)) {
  manifest = manifest.replace(
    /(<manifest\b[^>]*>)/,
    `$1\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />`,
  );
  fs.writeFileSync(manifestPath, manifest, 'utf8');
  console.log('[patch-android-security] Added MODIFY_AUDIO_SETTINGS permission');
} else {
  console.log('[patch-android-security] MODIFY_AUDIO_SETTINGS permission already present');
}
