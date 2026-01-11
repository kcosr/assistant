import type { DiffEntry } from './git';
import { getRepoBranch, listUntrackedPaths, parseNameStatus, resolveRepoRoot, runGit } from './git';

export type DiffTarget = 'working' | 'staged';

export type DiffStatusResult = {
  repoRoot: { root: string; relative: string };
  branch: string;
  entries: DiffEntry[];
  truncated: boolean;
  target: DiffTarget;
};

export async function getDiffStatus(options: {
  workspaceRoot: string;
  repoPath: string | null;
  target: DiffTarget;
}): Promise<DiffStatusResult | { error: string; status: number }> {
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
  const branch = branchInfo.branch;

  const listAddedPaths = async (): Promise<Set<string>> => {
    const result = await runGit(repoRoot.root, [
      'diff',
      '--name-status',
      '--cached',
      '--diff-filter=A',
    ]);
    if (result.exitCode !== 0) {
      return new Set<string>();
    }
    const added = parseNameStatus(result.stdout);
    return new Set(added.map((entry) => entry.path));
  };

  if (options.target === 'staged') {
    try {
      const result = await runGit(repoRoot.root, ['diff', '--name-status', '--cached']);
      if (result.exitCode !== 0) {
        return {
          error: result.stderr || result.stdout || 'Failed to compute staged diff status',
          status: 500,
        };
      }
      const entries = parseNameStatus(result.stdout);
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return {
        repoRoot,
        branch,
        entries,
        truncated: result.truncated,
        target: 'staged',
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Failed to compute staged diff status',
        status: 500,
      };
    }
  }

  try {
    const result = await runGit(repoRoot.root, ['diff', '--name-status']);
    if (result.exitCode !== 0) {
      return {
        error: result.stderr || result.stdout || 'Failed to compute diff status',
        status: 500,
      };
    }
    const entries = parseNameStatus(result.stdout);
    const addedPaths = await listAddedPaths();
    entries.forEach((entry) => {
      if (entry.status === 'M' && addedPaths.has(entry.path)) {
        entry.status = 'A';
      }
    });
    const untracked = await listUntrackedPaths(repoRoot.root);
    for (const entryPath of untracked) {
      entries.push({ path: entryPath, status: '??' });
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return {
      repoRoot,
      branch,
      entries,
      truncated: result.truncated,
      target: 'working',
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to compute diff status',
      status: 500,
    };
  }
}
