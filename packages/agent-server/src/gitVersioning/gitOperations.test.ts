import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GIT_IGNORE_PATTERNS,
  commitAll,
  ensureRepoInitialized,
  hasChanges,
  isDetachedHead,
  runGit,
} from './gitOperations';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('git operations', () => {
  it('initializes a repo with a gitignore', async () => {
    const dir = await createTempDir('git-versioning-');
    await ensureRepoInitialized(dir, { ignorePatterns: DEFAULT_GIT_IGNORE_PATTERNS });

    const gitStat = await fs.stat(path.join(dir, '.git'));
    expect(gitStat.isDirectory() || gitStat.isFile()).toBe(true);

    const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    for (const pattern of DEFAULT_GIT_IGNORE_PATTERNS) {
      expect(gitignore).toContain(pattern);
    }

    const log = await runGit(dir, ['log', '--format=%s', '-n', '1']);
    expect(log.stdout.trim()).toBe('Initial commit');
  });

  it('detects changes and commits them', async () => {
    const dir = await createTempDir('git-versioning-');
    await ensureRepoInitialized(dir, { ignorePatterns: DEFAULT_GIT_IGNORE_PATTERNS });

    await fs.writeFile(path.join(dir, 'sample.txt'), 'hello', 'utf8');
    expect(await hasChanges(dir)).toBe(true);

    await commitAll(dir, 'Test commit');
    expect(await hasChanges(dir)).toBe(false);

    const log = await runGit(dir, ['log', '--format=%s', '-n', '1']);
    expect(log.stdout.trim()).toBe('Test commit');
  });

  it('detects detached HEAD state', async () => {
    const dir = await createTempDir('git-versioning-');
    await ensureRepoInitialized(dir, { ignorePatterns: DEFAULT_GIT_IGNORE_PATTERNS });

    expect(await isDetachedHead(dir)).toBe(false);

    const checkout = await runGit(dir, ['checkout', '--detach']);
    expect(checkout.exitCode).toBe(0);
    expect(await isDetachedHead(dir)).toBe(true);
  });
});
