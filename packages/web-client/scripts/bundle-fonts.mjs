#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import bundledFonts from '../bundled-fonts.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const packageDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const defaultOutputDir = path.join(packageDir, 'public', 'fonts');
export const bundledFontSubsets = ['latin-ext', 'latin'];
export const bundledFontLicense = 'OFL-1.1';

const unicodeRanges = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};

function resolvePackageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function sourceName(font, subset, style) {
  return `${font.id}-${subset}-wght-${style}.woff2`;
}

function outputName(font, subset, style) {
  return `${font.id}-${subset}-${style}.woff2`;
}

export function assertSupportedFontLicense(font, packageMetadata) {
  if (packageMetadata.license !== bundledFontLicense) {
    throw new Error(
      `Unsupported license "${packageMetadata.license}" for ${font.package}; expected ${bundledFontLicense}`,
    );
  }
}

function renderFontFace(font, subset, style) {
  const unicodeRange = unicodeRanges[subset];
  if (!unicodeRange) {
    throw new Error(`Unsupported font subset "${subset}" for ${font.id}`);
  }

  return `/* ${font.label}: ${subset} ${style} */
@font-face {
  font-family: '${font.family}';
  font-style: ${style};
  font-display: swap;
  font-weight: ${font.weight};
  src: url('./${outputName(font, subset, style)}') format('woff2-variations');
  unicode-range: ${unicodeRange};
}`;
}

function renderNotice(packageDetails) {
  const lines = [
    '# Bundled font notices',
    '',
    'These web fonts are generated from the following Fontsource packages:',
    '',
  ];

  for (const { font, packageMetadata } of packageDetails) {
    lines.push(
      `- ${font.label}: ${font.package}@${packageMetadata.version} (${packageMetadata.license})`,
    );
  }

  lines.push(
    '',
    'The corresponding license text for each font is included in the `licenses` directory.',
    '',
  );
  return lines.join('\n');
}

export async function bundleFonts({ outputDir = defaultOutputDir } = {}) {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, 'licenses'), { recursive: true });

  const cssBlocks = [];
  const packageDetails = [];

  for (const font of bundledFonts) {
    const packageRoot = resolvePackageRoot(font.package);
    const packageMetadata = JSON.parse(
      await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    assertSupportedFontLicense(font, packageMetadata);
    packageDetails.push({ font, packageMetadata });

    for (const style of font.styles) {
      for (const subset of bundledFontSubsets) {
        await fs.copyFile(
          path.join(packageRoot, 'files', sourceName(font, subset, style)),
          path.join(outputDir, outputName(font, subset, style)),
        );
        cssBlocks.push(renderFontFace(font, subset, style));
      }
    }

    await fs.copyFile(
      path.join(packageRoot, 'LICENSE'),
      path.join(outputDir, 'licenses', `${font.id}-${bundledFontLicense}.txt`),
    );
  }

  await fs.writeFile(path.join(outputDir, 'fonts.css'), `${cssBlocks.join('\n\n')}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'NOTICE.md'), renderNotice(packageDetails), 'utf8');

  return {
    fontCount: bundledFonts.length,
    faceCount: cssBlocks.length,
    outputDir,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await bundleFonts();
  console.log(
    `Bundled ${result.fontCount} fonts (${result.faceCount} faces) into ${result.outputDir}`,
  );
}
