import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import bundledFonts from '../bundled-fonts.json' with { type: 'json' };
import {
  assertSupportedFontLicense,
  bundledFontLicense,
  bundledFontSubsets,
  bundleFonts,
} from './bundle-fonts.mjs';

test('rejects font packages whose license does not match the bundled license layout', () => {
  expect(() =>
    assertSupportedFontLicense(
      { package: '@fontsource-variable/example' },
      { license: 'Apache-2.0' },
    ),
  ).toThrow(/Unsupported license "Apache-2.0".*expected OFL-1.1/);
});

test('bundles every declared font face and its license', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-fonts-'));
  const result = await bundleFonts({ outputDir });
  const css = await fs.readFile(path.join(outputDir, 'fonts.css'), 'utf8');
  const notice = await fs.readFile(path.join(outputDir, 'NOTICE.md'), 'utf8');

  expect(result.fontCount).toBe(bundledFonts.length);
  expect(result.faceCount).toBe(
    bundledFonts.reduce((total, font) => total + font.styles.length * bundledFontSubsets.length, 0),
  );

  for (const font of bundledFonts) {
    expect(css).toMatch(new RegExp(`font-family: '${font.family}'`));
    expect(notice).toMatch(new RegExp(`- ${font.label}:.*\\(${bundledFontLicense}\\)`));
    await fs.access(path.join(outputDir, 'licenses', `${font.id}-${bundledFontLicense}.txt`));

    for (const style of font.styles) {
      for (const subset of bundledFontSubsets) {
        const outputName = `${font.id}-${subset}-${style}.woff2`;
        const stat = await fs.stat(path.join(outputDir, outputName));
        expect(stat.size, `${outputName} should not be empty`).toBeGreaterThan(0);
        expect(css).toContain(`url('./${outputName}')`);
      }
    }
  }
});
