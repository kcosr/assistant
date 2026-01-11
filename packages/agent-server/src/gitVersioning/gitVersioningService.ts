import fs from 'node:fs/promises';

import { resolvePluginInstanceDataDir, resolvePluginInstances } from '../plugins/instances';
import type { PluginRegistry } from '../plugins/registry';
import type { ToolPlugin } from '../plugins/types';
import {
  DEFAULT_GIT_IGNORE_PATTERNS,
  commitAll,
  ensureRepoInitialized,
  isDetachedHead,
  isGitAvailable,
  listChangedFiles,
} from './gitOperations';
import type { GitVersioningTarget } from './types';

type GitVersioningTargetState = GitVersioningTarget & {
  key: string;
  intervalMs: number;
  plugin: ToolPlugin;
};

function formatCommitMessage(files: string[], maxFiles = 10): string {
  const visible = files.slice(0, maxFiles);
  const remaining = files.length - visible.length;
  if (remaining > 0) {
    return `${visible.join(', ')} +${remaining} more`;
  }
  return visible.join(', ');
}

function buildTargetKey(pluginId: string, instanceId: string): string {
  return `${pluginId}:${instanceId}`;
}

export class GitVersioningService {
  private readonly targets = new Map<string, GitVersioningTargetState>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();
  private initialized = false;

  constructor(private readonly pluginRegistry: PluginRegistry) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const gitAvailable = await isGitAvailable();
    if (!gitAvailable) {
      console.error('[git-versioning] git is not available; snapshots are disabled');
      return;
    }

    const entries = this.pluginRegistry.getRegisteredPlugins?.() ?? [];
    for (const entry of entries) {
      const gitConfig = entry.pluginConfig?.gitVersioning;
      if (!gitConfig?.enabled) {
        continue;
      }

      const intervalMinutes =
        typeof gitConfig.intervalMinutes === 'number' && Number.isFinite(gitConfig.intervalMinutes)
          ? Math.max(1, Math.floor(gitConfig.intervalMinutes))
          : 1;
      const intervalMs = intervalMinutes * 60_000;
      const instances = resolvePluginInstances(entry.pluginId, entry.pluginConfig);

      for (const instance of instances) {
        try {
          const instanceDir = resolvePluginInstanceDataDir(entry.dataDir, instance.id);
          await fs.mkdir(instanceDir, { recursive: true });
          await ensureRepoInitialized(instanceDir, {
            ignorePatterns: DEFAULT_GIT_IGNORE_PATTERNS,
          });

          const key = buildTargetKey(entry.pluginId, instance.id);
          const target: GitVersioningTargetState = {
            key,
            pluginId: entry.pluginId,
            instanceId: instance.id,
            dataDir: instanceDir,
            intervalMs,
            plugin: entry.plugin,
          };
          this.targets.set(key, target);
          this.scheduleTarget(target);
          await this.commitIfNeeded(target);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[git-versioning] Failed to initialize ${entry.pluginId}/${instance.id}: ${message}`,
          );
        }
      }
    }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.targets.clear();
    this.inFlight.clear();
    this.initialized = false;
  }

  private scheduleTarget(target: GitVersioningTargetState): void {
    if (this.timers.has(target.key)) {
      return;
    }
    const timer = setInterval(() => {
      void this.commitIfNeeded(target);
    }, target.intervalMs);
    this.timers.set(target.key, timer);
  }

  private async commitIfNeeded(target: GitVersioningTargetState): Promise<void> {
    if (this.inFlight.has(target.key)) {
      return;
    }
    this.inFlight.add(target.key);
    try {
      if (await isDetachedHead(target.dataDir)) {
        console.error(
          `[git-versioning] Detached HEAD for ${target.pluginId}/${target.instanceId}; skipping snapshot`,
        );
        return;
      }
      if (target.plugin.prepareGitSnapshot) {
        await target.plugin.prepareGitSnapshot({ instanceId: target.instanceId });
      }
      const changedFiles = await listChangedFiles(target.dataDir);
      if (changedFiles.length === 0) {
        return;
      }
      const message = formatCommitMessage(changedFiles);
      console.log(
        `[git-versioning] Committing ${target.pluginId}/${target.instanceId}: ${message}`,
      );
      await commitAll(target.dataDir, message);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[git-versioning] Failed to snapshot ${target.pluginId}/${target.instanceId}: ${message}`,
      );
    } finally {
      this.inFlight.delete(target.key);
    }
  }
}
