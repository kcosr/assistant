import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..', '..', '..');
const canonicalSvgPath = join(repoRoot, 'packages', 'mobile-web', 'resources', 'icon.svg');
const electronIconsDir = join(repoRoot, 'packages', 'desktop', 'icons');
const tauriIconsDir = join(repoRoot, 'packages', 'desktop-tauri', 'src-tauri', 'icons');

test('Electron and Tauri desktop icons match the canonical app artwork', async () => {
  const canonicalSvg = await readFile(canonicalSvgPath);
  const expectedPng = await sharp(canonicalSvg).resize(512, 512).png().toBuffer();
  const electronPng = await readFile(join(electronIconsDir, 'icon.png'));
  const tauriPng = await readFile(join(tauriIconsDir, 'icon.png'));

  assert.deepEqual(electronPng, expectedPng);
  assert.deepEqual(tauriPng, expectedPng);
  assert.deepEqual(
    await readFile(join(electronIconsDir, 'icon.ico')),
    await readFile(join(tauriIconsDir, 'icon.ico')),
  );
  assert.deepEqual(
    await readFile(join(electronIconsDir, 'icon.icns')),
    await readFile(join(tauriIconsDir, 'icon.icns')),
  );
});

test('desktop development and packaging hooks regenerate icons', async () => {
  const electronPackage = JSON.parse(
    await readFile(join(repoRoot, 'packages', 'desktop', 'package.json'), 'utf8'),
  );
  const tauriPackage = JSON.parse(
    await readFile(join(repoRoot, 'packages', 'desktop-tauri', 'package.json'), 'utf8'),
  );

  assert.match(electronPackage.scripts['preelectron:dev'], /npm run icons:generate/);
  assert.match(electronPackage.scripts['preelectron:build'], /npm run icons:generate/);
  assert.match(tauriPackage.scripts['pretauri:dev'], /npm run icons:generate/);
  assert.match(tauriPackage.scripts['pretauri:build'], /npm run icons:generate/);
});
