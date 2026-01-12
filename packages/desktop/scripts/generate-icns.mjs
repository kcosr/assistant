#!/usr/bin/env node
/**
 * Generate macOS .icns file from PNG icons
 *
 * ICNS format: https://en.wikipedia.org/wiki/Apple_Icon_Image_format
 *
 * This creates a valid .icns file with PNG-compressed images.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');

// ICNS icon types with their PNG sizes
// https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html
const icnsTypes = [
  { type: 'ic07', size: 128 }, // 128x128
  { type: 'ic08', size: 256 }, // 256x256
  { type: 'ic09', size: 512 }, // 512x512
  { type: 'ic10', size: 1024 }, // 1024x1024 (we'll use 512 upscaled)
  { type: 'ic11', size: 32 }, // 16x16@2x
  { type: 'ic12', size: 64 }, // 32x32@2x
  { type: 'ic13', size: 256 }, // 128x128@2x
  { type: 'ic14', size: 512 }, // 256x256@2x
];

async function generateIcns() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp not installed. Run: npm install --save-dev sharp');
    process.exit(1);
  }

  const svgPath = join(__dirname, '..', 'icon.svg');
  const svgBuffer = readFileSync(svgPath);

  // Generate PNG buffers for each size needed
  const sizeToBuffer = new Map();
  const uniqueSizes = [...new Set(icnsTypes.map((t) => t.size))];

  for (const size of uniqueSizes) {
    const pngBuffer = await sharp(svgBuffer).resize(size, size).png().toBuffer();
    sizeToBuffer.set(size, pngBuffer);
  }

  // Build ICNS file
  const entries = [];
  for (const { type, size } of icnsTypes) {
    const pngBuffer = sizeToBuffer.get(size);
    if (pngBuffer) {
      entries.push({ type, data: pngBuffer });
    }
  }

  // Calculate total size
  const headerSize = 8; // 'icns' + 4-byte length
  let totalSize = headerSize;
  for (const entry of entries) {
    totalSize += 8 + entry.data.length; // type (4) + length (4) + data
  }

  // Create buffer
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // ICNS header
  buffer.write('icns', offset);
  offset += 4;
  buffer.writeUInt32BE(totalSize, offset);
  offset += 4;

  // Write each icon entry
  for (const entry of entries) {
    buffer.write(entry.type, offset);
    offset += 4;
    buffer.writeUInt32BE(8 + entry.data.length, offset);
    offset += 4;
    entry.data.copy(buffer, offset);
    offset += entry.data.length;
  }

  const outputPath = join(iconsDir, 'icon.icns');
  writeFileSync(outputPath, buffer);
  console.log(`Generated: icon.icns (${totalSize} bytes)`);
}

generateIcns().catch((err) => {
  console.error('Failed to generate .icns:', err);
  process.exit(1);
});
