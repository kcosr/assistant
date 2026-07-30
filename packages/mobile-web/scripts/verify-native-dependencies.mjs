#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileRequire = createRequire(path.join(mobileDir, 'package.json'));

export function getPinnedNativeDependencies(packageJson) {
  return Object.entries({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }).filter(([name]) => name.startsWith('@capacitor/') || name.startsWith('@capgo/capacitor-'));
}

export function findNativeDependencyMismatches(packageJson, resolveInstalledVersion) {
  const mismatches = [];
  for (const [name, expectedVersion] of getPinnedNativeDependencies(packageJson)) {
    if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
      mismatches.push(`${name}: dependency must be pinned exactly, found ${expectedVersion}`);
      continue;
    }

    let installedVersion;
    try {
      installedVersion = resolveInstalledVersion(name);
    } catch {
      mismatches.push(`${name}: expected ${expectedVersion}, package is not installed`);
      continue;
    }
    if (installedVersion !== expectedVersion) {
      mismatches.push(`${name}: expected ${expectedVersion}, installed ${installedVersion}`);
    }
  }
  return mismatches;
}

export function verifyNativeDependencies() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(mobileDir, 'package.json'), 'utf8'));
  const mismatches = findNativeDependencyMismatches(packageJson, (name) => {
    const installedPackageJson = mobileRequire(`${name}/package.json`);
    return installedPackageJson.version;
  });
  if (mismatches.length > 0) {
    throw new Error(
      `Native dependency verification failed:\n${mismatches
        .map((mismatch) => `  - ${mismatch}`)
        .join('\n')}\nRun npm ci from the repository root before building mobile packages.`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyNativeDependencies();
    console.log('Native dependency versions match the exact mobile package pins.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
