#!/usr/bin/env node
/**
 * Generate Tauri app icons from icon.svg
 *
 * Usage: node scripts/generate-icons.mjs
 *
 * Requires: npm install sharp (run from packages/desktop)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const iconsDir = join(projectRoot, 'src-tauri', 'icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

async function generateIcons() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp not installed. Run: npm install --save-dev sharp');
    console.error('Then run this script again.');
    process.exit(1);
  }

  const svgPath = join(projectRoot, 'icon.svg');
  const svgBuffer = readFileSync(svgPath);

  const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 }, // Source for .icns and .ico
  ];

  // Windows Store logos
  const windowsSizes = [
    { name: 'Square30x30Logo.png', size: 30 },
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square89x89Logo.png', size: 89 },
    { name: 'Square107x107Logo.png', size: 107 },
    { name: 'Square142x142Logo.png', size: 142 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square284x284Logo.png', size: 284 },
    { name: 'Square310x310Logo.png', size: 310 },
    { name: 'StoreLogo.png', size: 50 },
  ];

  const allSizes = [...sizes, ...windowsSizes];

  for (const { name, size } of allSizes) {
    const outputPath = join(iconsDir, name);
    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);
    console.log(`Generated: ${name} (${size}x${size})`);
  }

  // Generate .ico (Windows) - contains multiple sizes
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = await Promise.all(
    icoSizes.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
  );

  // Simple ICO file generation (PNG-based ICO)
  const icoBuffer = createIco(icoImages, icoSizes);
  writeFileSync(join(iconsDir, 'icon.ico'), icoBuffer);
  console.log('Generated: icon.ico');

  // For macOS .icns, we need a different approach
  // Tauri can use the PNG files directly, but for a proper .icns:
  console.log('\nNote: For macOS icon.icns, use iconutil or an online converter');
  console.log('with the generated PNG files, or run: npm run tauri icon icon.svg');
}

/**
 * Create a simple ICO file from PNG buffers
 * ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
function createIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;

  let dataOffset = headerSize + dirSize;
  const entries = [];

  for (let i = 0; i < numImages; i++) {
    const size = sizes[i];
    const pngBuffer = pngBuffers[i];
    entries.push({
      width: size >= 256 ? 0 : size, // 0 means 256
      height: size >= 256 ? 0 : size,
      colors: 0,
      reserved: 0,
      planes: 1,
      bpp: 32,
      size: pngBuffer.length,
      offset: dataOffset,
      data: pngBuffer,
    });
    dataOffset += pngBuffer.length;
  }

  const totalSize = dataOffset;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // ICO header
  buffer.writeUInt16LE(0, offset);
  offset += 2; // Reserved
  buffer.writeUInt16LE(1, offset);
  offset += 2; // Type (1 = ICO)
  buffer.writeUInt16LE(numImages, offset);
  offset += 2; // Number of images

  // Directory entries
  for (const entry of entries) {
    buffer.writeUInt8(entry.width, offset);
    offset += 1;
    buffer.writeUInt8(entry.height, offset);
    offset += 1;
    buffer.writeUInt8(entry.colors, offset);
    offset += 1;
    buffer.writeUInt8(entry.reserved, offset);
    offset += 1;
    buffer.writeUInt16LE(entry.planes, offset);
    offset += 2;
    buffer.writeUInt16LE(entry.bpp, offset);
    offset += 2;
    buffer.writeUInt32LE(entry.size, offset);
    offset += 4;
    buffer.writeUInt32LE(entry.offset, offset);
    offset += 4;
  }

  // Image data
  for (const entry of entries) {
    entry.data.copy(buffer, entry.offset);
  }

  return buffer;
}

generateIcons().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
