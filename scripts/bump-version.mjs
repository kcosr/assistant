#!/usr/bin/env node
/**
 * bump-version.mjs
 *
 * Updates the VERSION file with a new semantic version.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch     # 1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor     # 1.0.1 -> 1.1.0
 *   node scripts/bump-version.mjs major     # 1.1.0 -> 2.0.0
 *   node scripts/bump-version.mjs 2.0.0     # Set to specific version
 *   node scripts/bump-version.mjs           # Show current version
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const versionFilePath = join(root, 'VERSION');
const ignoredDirs = new Set(['.git', 'data', 'dist', 'node_modules']);

function readVersion() {
  try {
    return readFileSync(versionFilePath, 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    suffix: match[4] || '',
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}${parts.suffix}`;
}

function collectPackageJsonPaths(dir, results) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      collectPackageJsonPaths(entryPath, results);
      continue;
    }
    if (entry.isFile() && entry.name === 'package.json') {
      results.push(entryPath);
    }
  }
}

function updatePackageJsonVersions(packageJsonPaths, version) {
  let updatedCount = 0;
  for (const packageJsonPath of packageJsonPaths) {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (data.version === version) {
      continue;
    }
    data.version = version;
    writeFileSync(packageJsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    updatedCount += 1;
  }
  return updatedCount;
}

function updatePackageLock(packageJsonPaths, version) {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return false;
  }
  const raw = readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(raw);
  let updated = false;

  if (lock.version !== version) {
    lock.version = version;
    updated = true;
  }

  if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
    lock.packages[''].version = version;
    updated = true;
  }

  if (lock.packages) {
    for (const packageJsonPath of packageJsonPaths) {
      const relDir = relative(root, dirname(packageJsonPath)).split('\\').join('/');
      const lockKey = relDir === '' || relDir === '.' ? '' : relDir;
      const entry = lock.packages[lockKey];
      if (!entry || entry.version === version) {
        continue;
      }
      entry.version = version;
      updated = true;
    }
  }

  if (updated) {
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  }
  return updated;
}

function updateTauriConfig(version) {
  const tauriConfigPath = join(root, 'packages', 'desktop', 'src-tauri', 'tauri.conf.json');
  if (!existsSync(tauriConfigPath)) {
    return false;
  }
  const raw = readFileSync(tauriConfigPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to parse ${tauriConfigPath}:`, err);
    return false;
  }
  if (data.version === version) {
    return false;
  }
  data.version = version;
  writeFileSync(tauriConfigPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return true;
}

function updateCargoToml(version) {
  const cargoPath = join(root, 'packages', 'desktop', 'src-tauri', 'Cargo.toml');
  if (!existsSync(cargoPath)) {
    return false;
  }
  const raw = readFileSync(cargoPath, 'utf8');
  const lines = raw.split('\n');
  let inPackageSection = false;
  let updated = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inPackageSection = trimmed === '[package]';
      continue;
    }
    if (inPackageSection && trimmed.startsWith('version')) {
      const nextLine = line.replace(
        /version\s*=\s*"[^"]*"/,
        `version = "${version}"`,
      );
      if (nextLine !== line) {
        lines[i] = nextLine;
        updated = true;
      }
      break;
    }
  }

  if (!updated) {
    return false;
  }

  let output = lines.join('\n');
  if (!output.endsWith('\n')) {
    output += '\n';
  }
  writeFileSync(cargoPath, output, 'utf8');
  return true;
}

const currentVersion = readVersion();
const arg = process.argv[2];

if (!arg) {
  console.log(`Current version: ${currentVersion}`);
  process.exit(0);
}

const parts = parseVersion(currentVersion);
if (!parts) {
  console.error(`Current VERSION "${currentVersion}" is not valid semver (X.Y.Z)`);
  process.exit(1);
}

let newVersion;

switch (arg.toLowerCase()) {
  case 'patch':
    parts.patch += 1;
    parts.suffix = '';
    newVersion = formatVersion(parts);
    break;
  case 'minor':
    parts.minor += 1;
    parts.patch = 0;
    parts.suffix = '';
    newVersion = formatVersion(parts);
    break;
  case 'major':
    parts.major += 1;
    parts.minor = 0;
    parts.patch = 0;
    parts.suffix = '';
    newVersion = formatVersion(parts);
    break;
  default:
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
      console.error(
        `Invalid version: "${arg}". Use patch, minor, major, or a semver like 1.2.3`
      );
      process.exit(1);
    }
    newVersion = arg;
}

writeFileSync(versionFilePath, `${newVersion}\n`, 'utf8');
console.log(`Version updated: ${currentVersion} -> ${newVersion}`);

const packageJsonPaths = [];
collectPackageJsonPaths(root, packageJsonPaths);
const updatedCount = updatePackageJsonVersions(packageJsonPaths, newVersion);
if (updatedCount > 0) {
  console.log(`Updated ${updatedCount} package.json file(s).`);
}

const lockUpdated = updatePackageLock(packageJsonPaths, newVersion);
if (lockUpdated) {
  console.log('Updated package-lock.json.');
}

const tauriConfigUpdated = updateTauriConfig(newVersion);
if (tauriConfigUpdated) {
  console.log('Updated tauri.conf.json.');
}

const cargoUpdated = updateCargoToml(newVersion);
if (cargoUpdated) {
  console.log('Updated Cargo.toml.');
}
