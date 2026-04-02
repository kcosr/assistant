#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAndroidBuildStage } from './android-build-stage.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(mobileDir, '..', '..');
const flavorsPath = path.join(mobileDir, 'flavors.json');

function run(command, args, options = {}) {
  const cwd = options.cwd ?? mobileDir;
  const env = { ...process.env, ...(options.env ?? {}) };
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args, options = {}) {
  const cwd = options.cwd ?? mobileDir;
  const env = { ...process.env, ...(options.env ?? {}) };
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    if (stderr) {
      console.error(stderr);
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

function loadFlavors() {
  try {
    return JSON.parse(readFileSync(flavorsPath, 'utf8'));
  } catch (err) {
    console.error(`[deploy-android-flavors] Failed to read ${flavorsPath}:`, err.message);
    process.exit(1);
  }
}

function getConnectedDevices() {
  const output = runCapture('adb', ['devices']);
  const devices = output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);

  if (devices.length === 0) {
    console.error('[deploy-android-flavors] No connected ADB devices in state "device".');
    process.exit(1);
  }

  return devices;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const skipWebBuild = args.includes('--skip-web-build');
  const flavorNames = args.filter((arg) => arg !== '--skip-web-build');
  return {
    skipWebBuild,
    flavorNames: flavorNames.length > 0 ? flavorNames : ['default', 'work'],
  };
}

const { skipWebBuild, flavorNames } = parseArgs();
const flavors = loadFlavors();

for (const flavorName of flavorNames) {
  if (!flavors[flavorName]) {
    console.error(`[deploy-android-flavors] Unknown flavor: "${flavorName}"`);
    console.error(`Available flavors: ${Object.keys(flavors).join(', ')}`);
    process.exit(1);
  }
}

if (!skipWebBuild) {
  run('npm', ['run', 'build', '-w', '@assistant/web-client'], { cwd: repoRoot });
}

const devices = getConnectedDevices();
console.log(`[deploy-android-flavors] Target devices: ${devices.join(', ')}`);

for (const flavorName of flavorNames) {
  const flavor = flavors[flavorName];
  console.log(`\n[deploy-android-flavors] Deploying flavor: ${flavorName}`);
  console.log(
    `[deploy-android-flavors] appId=${flavor.appId}, apiHost=${flavor.apiHost}`,
  );

  const stage = createAndroidBuildStage({
    repoRoot,
    mobileDir,
    flavorName,
  });
  console.log(`[deploy-android-flavors] stagingDir=${stage.stageRoot}`);

  run('node', ['scripts/apply-flavor.mjs', flavorName], { cwd: stage.stagedMobileDir });

  const flavorEnv = {
    ASSISTANT_API_HOST: flavor.apiHost,
    ASSISTANT_APP_ID: flavor.appId,
    ASSISTANT_APP_NAME: flavor.appName,
  };

  run('npm', ['run', 'android:build'], {
    cwd: stage.stagedMobileDir,
    env: flavorEnv,
  });

  if (!existsSync(stage.debugApkPath)) {
    console.error(`[deploy-android-flavors] APK not found: ${stage.debugApkPath}`);
    process.exit(1);
  }

  for (const device of devices) {
    run('adb', ['-s', device, 'install', '-r', stage.debugApkPath], { cwd: repoRoot });
    run(
      'adb',
      [
        '-s',
        device,
        'shell',
        'monkey',
        '-p',
        flavor.appId,
        '-c',
        'android.intent.category.LAUNCHER',
        '1',
      ],
      { cwd: repoRoot },
    );
  }
}

console.log('\n[deploy-android-flavors] Completed.');
