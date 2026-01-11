import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolvePathWithinRoot } from './pathUtils';

const MAX_ENTRIES = 2000;

export type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  repoRoot?: boolean;
};

export type WorkspaceListResult = {
  root: string;
  rootName: string;
  rootIsRepo: boolean;
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
};

async function isRepoRoot(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dirPath, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function normalizePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '/') {
    return '';
  }
  return trimmed.replace(/\\/g, '/');
}

export async function listWorkspaceEntries(options: {
  workspaceRoot: string;
  path: string | null;
}): Promise<WorkspaceListResult | { error: string; status: number }> {
  const relative = normalizePathSegment(options.path ?? '');
  let absolute: string;
  try {
    absolute = relative
      ? resolvePathWithinRoot(options.workspaceRoot, relative)
      : options.workspaceRoot;
  } catch (err) {
    return { error: (err as Error).message, status: 400 };
  }

  let stats: { isDirectory(): boolean };
  try {
    stats = await fs.stat(absolute);
  } catch {
    return { error: 'Path does not exist', status: 404 };
  }
  if (!stats.isDirectory()) {
    return { error: 'Path is not a directory', status: 400 };
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch (err) {
    return { error: (err as Error).message, status: 500 };
  }

  const rootName = path.basename(options.workspaceRoot) || options.workspaceRoot;
  const rootIsRepo = await isRepoRoot(options.workspaceRoot);

  const mapped = await Promise.all(
    entries
      .filter((entry) => entry.name !== '.git')
      .map(async (entry) => {
        const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const repoRoot = await isRepoRoot(path.join(absolute, entry.name));
          return { path: entryPath, name: entry.name, type: 'dir' as const, repoRoot };
        }
        return { path: entryPath, name: entry.name, type: 'file' as const };
      }),
  );

  mapped.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  let truncated = false;
  let limited = mapped;
  if (mapped.length > MAX_ENTRIES) {
    truncated = true;
    limited = mapped.slice(0, MAX_ENTRIES);
  }

  return {
    root: options.workspaceRoot,
    rootName,
    rootIsRepo,
    path: relative,
    entries: limited,
    truncated,
  };
}
