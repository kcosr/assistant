import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import bundledFonts from '../bundled-fonts.json' with { type: 'json' };
import {
  assertSupportedFontLicense,
  bundledFontLicense,
  bundledFontSubsets,
  bundleFonts,
} from './bundle-fonts.mjs';

test('rejects font packages whose license does not match the bundled license layout', () => {
  assert.throws(
    () =>
      assertSupportedFontLicense(
        { package: '@fontsource-variable/example' },
        { license: 'Apache-2.0' },
      ),
    /Unsupported license "Apache-2.0".*expected OFL-1.1/,
  );
});

test('bundles every declared font face and its license', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-fonts-'));
  const result = await bundleFonts({ outputDir });
  const css = await fs.readFile(path.join(outputDir, 'fonts.css'), 'utf8');
  const notice = await fs.readFile(path.join(outputDir, 'NOTICE.md'), 'utf8');

  assert.equal(result.fontCount, bundledFonts.length);
  assert.equal(
    result.faceCount,
    bundledFonts.reduce((total, font) => total + font.styles.length * bundledFontSubsets.length, 0),
  );

  for (const font of bundledFonts) {
    assert.match(css, new RegExp(`font-family: '${font.family}'`));
    assert.match(notice, new RegExp(`- ${font.label}:.*\\(${bundledFontLicense}\\)`));
    await fs.access(path.join(outputDir, 'licenses', `${font.id}-${bundledFontLicense}.txt`));

    for (const style of font.styles) {
      for (const subset of bundledFontSubsets) {
        const outputName = `${font.id}-${subset}-${style}.woff2`;
        const stat = await fs.stat(path.join(outputDir, outputName));
        assert.ok(stat.size > 0, `${outputName} should not be empty`);
        assert.ok(css.includes(`url('./${outputName}')`));
      }
    }
  }
});
