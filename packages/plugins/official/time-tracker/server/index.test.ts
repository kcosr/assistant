import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';
import type { CombinedPluginManifest } from '@assistant/shared';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempDataDir(): string {
  return path.join(
    os.tmpdir(),
    `time-tracker-plugin-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('time-tracker export_xlsx', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDataDir();
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses fixed column widths for item and description', async () => {
    const plugin = createTestPlugin();
    await plugin.initialize(tempDir, { enabled: true } as any);

    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const result = (await ops.export_xlsx({
      rows: [
        {
          item: 'Task A',
          total_minutes: 90,
          description: 'One note',
        },
      ],
      start_date: '2026-01-01',
      end_date: '2026-01-01',
    })) as { content: string };

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(result.content, 'base64'));
    const sheet = workbook.getWorksheet('Time Report');
    if (!sheet) {
      throw new Error('Expected worksheet to be defined');
    }

    expect(sheet.getColumn(1).width).toBe(80);
    expect(sheet.getColumn(5).width).toBe(160);
  });
});
