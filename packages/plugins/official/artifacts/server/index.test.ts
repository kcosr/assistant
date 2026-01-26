import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempDataDir(): string {
  return path.join(
    os.tmpdir(),
    `artifacts-plugin-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('artifacts plugin instances', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDataDir();
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('defaults to the default instance when none are configured', async () => {
    const plugin = createTestPlugin();

    await plugin.initialize(tempDir, { enabled: true } as any);

    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const instances = await ops.instance_list();
    expect(instances).toEqual([{ id: 'default', label: 'Default' }]);
  });

  it('returns configured instances in addition to default', async () => {
    const plugin = createTestPlugin();

    await plugin.initialize(tempDir, {
      enabled: true,
      instances: ['work', { id: 'personal', label: 'Personal' }],
    } as any);

    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const instances = await ops.instance_list();
    expect(instances).toEqual(
      expect.arrayContaining([
        { id: 'default', label: 'Default' },
        { id: 'work', label: 'Work' },
        { id: 'personal', label: 'Personal' },
      ]),
    );
    expect(instances).toHaveLength(3);
  });
});
