#!/usr/bin/env node
/**
 * Apply a build flavor to capacitor.config.json.
 *
 * Reads flavor definitions from flavors.json and writes the selected
 * flavor's appId and appName into capacitor.config.json. The matching
 * ASSISTANT_API_HOST is exported as an environment variable for
 * downstream scripts (patch-web-config.mjs).
 *
 * Usage:
 *   node scripts/apply-flavor.mjs <flavor>
 *   node scripts/apply-flavor.mjs work
 *   node scripts/apply-flavor.mjs default
 *
 * After applying a flavor, run android:add (first time) or android:sync
 * to generate/update the native project with the new identity.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(scriptDir, '..');
const flavorsPath = path.join(mobileDir, 'flavors.json');
const capConfigPath = path.join(mobileDir, 'capacitor.config.json');

const flavorName = process.argv[2];
if (!flavorName) {
  console.error('Usage: node scripts/apply-flavor.mjs <flavor>');
  console.error('');
  try {
    const flavors = JSON.parse(fs.readFileSync(flavorsPath, 'utf8'));
    console.error('Available flavors:', Object.keys(flavors).join(', '));
  } catch {
    // ignore
  }
  process.exit(1);
}

let flavors;
try {
  flavors = JSON.parse(fs.readFileSync(flavorsPath, 'utf8'));
} catch (err) {
  console.error(`[apply-flavor] Failed to read ${flavorsPath}:`, err.message);
  process.exit(1);
}

const flavor = flavors[flavorName];
if (!flavor) {
  console.error(`[apply-flavor] Unknown flavor: "${flavorName}"`);
  console.error('Available flavors:', Object.keys(flavors).join(', '));
  process.exit(1);
}

let capConfig;
try {
  capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
} catch (err) {
  console.error(`[apply-flavor] Failed to read ${capConfigPath}:`, err.message);
  process.exit(1);
}

const prevAppId = capConfig.appId;
capConfig.appId = flavor.appId;
capConfig.appName = flavor.appName;

fs.writeFileSync(capConfigPath, JSON.stringify(capConfig, null, 2) + '\n', 'utf8');

console.log(`[apply-flavor] Applied flavor "${flavorName}":`);
console.log(`  appId:   ${flavor.appId}`);
console.log(`  appName: ${flavor.appName}`);
console.log(`  apiHost: ${flavor.apiHost}`);

if (prevAppId !== flavor.appId) {
  console.log('');
  console.log(
    `  ⚠  appId changed from "${prevAppId}" to "${flavor.appId}".`,
  );
  console.log(
    '  You must regenerate the android project: remove android/ and run android:add.',
  );
}

console.log('');
console.log('Next steps:');
console.log(`  ASSISTANT_API_HOST='${flavor.apiHost}' npm run android:sync`);
console.log('  or, for a fresh project:');
console.log(`  rm -rf android/`);
console.log(`  ASSISTANT_API_HOST='${flavor.apiHost}' npm run android:add`);
