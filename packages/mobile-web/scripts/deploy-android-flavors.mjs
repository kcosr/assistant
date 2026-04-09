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
const ADB_PROBE_TIMEOUT_MS = 15_000;
const ADB_INSTALL_TIMEOUT_MS = 180_000;

function run(command, args, options = {}) {
  const cwd = options.cwd ?? mobileDir;
  const env = { ...process.env, ...(options.env ?? {}) };
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    encoding: 'utf8',
    timeout: options.timeout,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        `[deploy-android-flavors] Command timed out after ${options.timeout}ms: ${command} ${args.join(' ')}`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `[deploy-android-flavors] Command failed with exit code ${result.status ?? 1}: ${command} ${args.join(' ')}`,
    );
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
    timeout: options.timeout,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        `[deploy-android-flavors] Command timed out after ${options.timeout}ms: ${command} ${args.join(' ')}`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr ||
        `[deploy-android-flavors] Command failed with exit code ${result.status ?? 1}: ${command} ${args.join(' ')}`,
    );
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

function isDeviceResponsive(device) {
  try {
    const state = runCapture('adb', ['-s', device, 'get-state'], {
      cwd: repoRoot,
      timeout: ADB_PROBE_TIMEOUT_MS,
    }).trim();
    if (state !== 'device') {
      return false;
    }
    runCapture('adb', ['-s', device, 'shell', 'true'], {
      cwd: repoRoot,
      timeout: ADB_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[deploy-android-flavors] Skipping unresponsive device ${device}: ${message}`);
    return false;
  }
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
const failedInstalls = [];

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
    if (!isDeviceResponsive(device)) {
      failedInstalls.push({
        flavorName,
        device,
        reason: 'device did not respond to adb probe',
      });
      continue;
    }
    try {
      run('adb', ['-s', device, 'install', '-r', stage.debugApkPath], {
        cwd: repoRoot,
        timeout: ADB_INSTALL_TIMEOUT_MS,
      });
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
        {
          cwd: repoRoot,
          timeout: ADB_PROBE_TIMEOUT_MS,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[deploy-android-flavors] Failed to deploy ${flavorName} to ${device}: ${message}`,
      );
      failedInstalls.push({
        flavorName,
        device,
        reason: message,
      });
    }
  }
}

if (failedInstalls.length > 0) {
  console.error('\n[deploy-android-flavors] Deployment finished with device failures:');
  for (const failure of failedInstalls) {
    console.error(
      `- flavor=${failure.flavorName} device=${failure.device} reason=${failure.reason}`,
    );
  }
  process.exit(1);
}

console.log('\n[deploy-android-flavors] Completed.');
