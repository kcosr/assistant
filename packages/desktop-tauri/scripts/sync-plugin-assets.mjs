import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const distPluginsRoot = path.join(repoRoot, 'dist', 'plugins');
const webClientPluginsRoot = path.join(repoRoot, 'packages', 'web-client', 'public', 'plugins');
const assetNames = ['bundle.js', 'bundle.js.map', 'styles.css'];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyAsset(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath))) {
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function removeAssetIfStale(sourcePath, targetPath) {
  if (await pathExists(sourcePath)) {
    return;
  }
  if (!(await pathExists(targetPath))) {
    return;
  }
  await fs.rm(targetPath, { force: true, recursive: true });
}

async function pruneStalePlugins(validPluginIds) {
  if (!(await pathExists(webClientPluginsRoot))) {
    return;
  }
  const entries = await fs.readdir(webClientPluginsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginId = entry.name;
    if (validPluginIds.has(pluginId)) {
      continue;
    }
    const pluginDir = path.join(webClientPluginsRoot, pluginId);
    const files = await fs.readdir(pluginDir);
    const unknown = files.filter((file) => !assetNames.includes(file));
    if (unknown.length > 0) {
      continue;
    }
    await fs.rm(pluginDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!(await pathExists(distPluginsRoot))) {
    console.warn('[tauri] No dist/plugins output found; run npm run build:plugins first.');
    return;
  }

  const entries = await fs.readdir(distPluginsRoot, { withFileTypes: true });
  const pluginIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const pluginIdSet = new Set(pluginIds);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginId = entry.name;
    const sourcePublicDir = path.join(distPluginsRoot, pluginId, 'public');
    if (!(await pathExists(sourcePublicDir))) {
      continue;
    }
    for (const assetName of assetNames) {
      const sourcePath = path.join(sourcePublicDir, assetName);
      const targetPath = path.join(webClientPluginsRoot, pluginId, assetName);
      await copyAsset(sourcePath, targetPath);
      await removeAssetIfStale(sourcePath, targetPath);
    }
  }

  await pruneStalePlugins(pluginIdSet);
}

main().catch((err) => {
  console.error('[tauri] Failed to sync plugin assets:', err);
  process.exitCode = 1;
});
