import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginConfig } from '../config';
import type { PluginRegistry } from '../plugins/registry';
import type { ToolPlugin } from '../plugins/types';
import { runGit } from './gitOperations';
import { GitVersioningService } from './gitVersioningService';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('GitVersioningService', () => {
  it('initializes repos and calls prepareGitSnapshot', async () => {
    const rootDir = await createTempDir('git-versioning-service-');
    const pluginBaseDir = path.join(rootDir, 'plugins', 'time-tracker');
    const instanceDir = path.join(pluginBaseDir, 'default');
    await fs.mkdir(instanceDir, { recursive: true });
    await fs.writeFile(path.join(instanceDir, 'time-tracker.db'), 'data', 'utf8');

    let snapshotCalls = 0;
    const plugin: ToolPlugin = {
      name: 'time-tracker',
      tools: [],
      initialize: async () => {},
      prepareGitSnapshot: () => {
        snapshotCalls += 1;
      },
    };

    const pluginConfig = {
      enabled: true,
      gitVersioning: { enabled: true, intervalMinutes: 1 },
    } as PluginConfig;

    const registry: PluginRegistry = {
      initialize: async () => {},
      getTools: () => [],
      shutdown: async () => {},
      getRegisteredPlugins: () => [
        {
          pluginId: 'time-tracker',
          dataDir: pluginBaseDir,
          pluginConfig,
          plugin,
        },
      ],
    };

    const service = new GitVersioningService(registry);
    await service.initialize();

    try {
      expect(snapshotCalls).toBe(1);

      const gitStat = await fs.stat(path.join(instanceDir, '.git'));
      expect(gitStat.isDirectory() || gitStat.isFile()).toBe(true);

      const log = await runGit(instanceDir, ['log', '--format=%s', '-n', '1']);
      expect(log.stdout.trim()).toBe('Initial commit');
    } finally {
      service.shutdown();
    }
  });
});
