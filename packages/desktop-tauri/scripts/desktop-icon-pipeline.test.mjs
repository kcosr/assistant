import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { expect, test } from 'vitest';

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

  expect(electronPng).toEqual(expectedPng);
  expect(tauriPng).toEqual(expectedPng);
  expect(await readFile(join(electronIconsDir, 'icon.ico'))).toEqual(
    await readFile(join(tauriIconsDir, 'icon.ico')),
  );
  expect(await readFile(join(electronIconsDir, 'icon.icns'))).toEqual(
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

  expect(electronPackage.scripts['preelectron:dev']).toMatch(/npm run icons:generate/);
  expect(electronPackage.scripts['preelectron:build']).toMatch(/npm run icons:generate/);
  expect(tauriPackage.scripts['pretauri:dev']).toMatch(/npm run icons:generate/);
  expect(tauriPackage.scripts['pretauri:build']).toMatch(/npm run icons:generate/);
  expect(tauriPackage.scripts['tauri:icon']).toBe('npm run icons:generate');
});
