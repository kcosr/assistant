import fs from 'node:fs/promises';
import path from 'node:path';

import { getRepoBranch, isBareRepoRoot, resolvePathWithinRoot, runGit } from './git';

const MAX_ENTRIES = 2000;
const DEFAULT_REPO_SCAN_DEPTH = 5;
const DEFAULT_REPO_SCAN_LIMIT = 50;
const MAX_REPO_SCAN_DEPTH = 10;
const MAX_REPO_SCAN_LIMIT = 200;
const BARE_REPO_INTERNAL_DIRS = new Set([
  'branches',
  'hooks',
  'info',
  'logs',
  'objects',
  'refs',
  'worktrees',
]);

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

export type WorkspaceRepoEntry = {
  path: string;
  name: string;
  branch: string;
};

export type WorkspaceRepoListResult = {
  root: string;
  rootName: string;
  maxDepth: number;
  maxRepos: number;
  repos: WorkspaceRepoEntry[];
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

async function isInsideWorkTree(dirPath: string): Promise<boolean> {
  const result = await runGit(dirPath, ['rev-parse', '--is-inside-work-tree'], {
    maxOutputBytes: 64,
  });
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout.trim() === 'true';
}

function normalizePathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '/') {
    return '';
  }
  return trimmed.replace(/\\/g, '/');
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

export async function listWorkspaceEntries(options: {
  workspaceRoot: string;
  path: string | null;
}): Promise<WorkspaceListResult | { error: string; status: number }> {
  const relative = normalizePathSegment(options.path ?? '');
  const absolute = relative
    ? resolvePathWithinRoot(options.workspaceRoot, relative)
    : options.workspaceRoot;
  let stats: { isDirectory(): boolean };
  try {
    stats = await fs.stat(absolute);
  } catch {
    return { error: 'Path does not exist', status: 404 };
  }
  if (!stats.isDirectory()) {
    return { error: 'Path is not a directory', status: 400 };
  }

  let entries: fs.Dirent[];
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
          return { path: entryPath, name: entry.name, type: 'dir', repoRoot };
        }
        return { path: entryPath, name: entry.name, type: 'file' };
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

export async function listWorkspaceRepos(options: {
  workspaceRoot: string;
  maxDepth?: number;
  maxRepos?: number;
}): Promise<WorkspaceRepoListResult | { error: string; status: number }> {
  let stats: { isDirectory(): boolean };
  try {
    stats = await fs.stat(options.workspaceRoot);
  } catch {
    return { error: 'Workspace root does not exist', status: 404 };
  }
  if (!stats.isDirectory()) {
    return { error: 'Workspace root is not a directory', status: 400 };
  }

  const maxDepth = clampPositiveInt(
    options.maxDepth,
    DEFAULT_REPO_SCAN_DEPTH,
    0,
    MAX_REPO_SCAN_DEPTH,
  );
  const maxRepos = clampPositiveInt(
    options.maxRepos,
    DEFAULT_REPO_SCAN_LIMIT,
    1,
    MAX_REPO_SCAN_LIMIT,
  );
  const rootName = path.basename(options.workspaceRoot) || options.workspaceRoot;
  const repos: WorkspaceRepoEntry[] = [];
  let truncated = false;

  const queue: Array<{ absolute: string; relative: string; depth: number }> = [
    { absolute: options.workspaceRoot, relative: '', depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const repoAtPath = await isRepoRoot(current.absolute);
    if (repoAtPath) {
      const insideWorkTree = await isInsideWorkTree(current.absolute);
      if (insideWorkTree) {
        const branchInfo = await getRepoBranch(current.absolute);
        if (!('error' in branchInfo) && !branchInfo.detached && branchInfo.branch) {
          const name = current.relative
            ? path.basename(current.absolute)
            : rootName || options.workspaceRoot;
          repos.push({ path: current.relative, name, branch: branchInfo.branch });
          if (repos.length >= maxRepos) {
            truncated = true;
            break;
          }
        }
        continue;
      }
    }
    if (current.depth >= maxDepth) {
      continue;
    }
    const bareRepoRoot = await isBareRepoRoot(current.absolute);
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name === '.git') {
        continue;
      }
      if (bareRepoRoot && BARE_REPO_INTERNAL_DIRS.has(entry.name)) {
        continue;
      }
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      queue.push({
        absolute: path.join(current.absolute, entry.name),
        relative,
        depth: current.depth + 1,
      });
    }
  }

  repos.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: options.workspaceRoot,
    rootName,
    maxDepth,
    maxRepos,
    repos,
    truncated,
  };
}
