import path from 'node:path';

import {
  DEFAULT_MAX_OUTPUT_BYTES,
  getRepoBranch,
  resolvePathWithinRoot,
  resolveRepoRoot,
  runGit,
} from './git';
import type { DiffTarget } from './status';

export type DiffPatchResult = {
  repoRoot: { root: string; relative: string };
  path: string;
  patch: string;
  truncated: boolean;
};

function normalizeRepoPath(repoRoot: string, absolutePath: string): string | null {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

export async function getDiffPatch(options: {
  workspaceRoot: string;
  repoPath: string | null;
  target: DiffTarget;
  path: string;
  maxOutputBytes?: number;
}): Promise<DiffPatchResult | { error: string; status: number }> {
  const repoRoot = await resolveRepoRoot(options.workspaceRoot, options.repoPath);
  if ('error' in repoRoot) {
    return repoRoot;
  }
  const branchInfo = await getRepoBranch(repoRoot.root);
  if ('error' in branchInfo) {
    return branchInfo;
  }
  if (branchInfo.detached) {
    return { error: 'Repository is in detached HEAD state', status: 409 };
  }

  const absolute = resolvePathWithinRoot(options.workspaceRoot, options.path);
  const relativePath = normalizeRepoPath(repoRoot.root, absolute);
  if (!relativePath) {
    return { error: 'Path is outside the repository root', status: 400 };
  }

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  if (options.target === 'staged') {
    const result = await runGit(repoRoot.root, ['diff', '--cached', '--', relativePath], {
      maxOutputBytes,
    });
    if (result.exitCode !== 0) {
      return {
        error: result.stderr || result.stdout || 'Failed to compute diff patch',
        status: 500,
      };
    }
    return {
      repoRoot,
      path: relativePath,
      patch: result.stdout,
      truncated: result.truncated,
    };
  }

  const untracked = await runGit(repoRoot.root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    relativePath,
  ]);
  const isUntracked = untracked.exitCode === 0 && untracked.stdout.trim().length > 0;
  if (isUntracked) {
    const result = await runGit(
      repoRoot.root,
      ['diff', '--no-index', '--', '/dev/null', relativePath],
      { maxOutputBytes },
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        error: result.stderr || result.stdout || 'Failed to compute untracked file diff',
        status: 500,
      };
    }
    return {
      repoRoot,
      path: relativePath,
      patch: result.stdout,
      truncated: result.truncated,
    };
  }

  const result = await runGit(repoRoot.root, ['diff', '--', relativePath], {
    maxOutputBytes,
  });
  if (result.exitCode !== 0) {
    return {
      error: result.stderr || result.stdout || 'Failed to compute diff patch',
      status: 500,
    };
  }
  return {
    repoRoot,
    path: relativePath,
    patch: result.stdout,
    truncated: result.truncated,
  };
}
