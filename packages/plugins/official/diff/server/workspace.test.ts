import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGit } from './git';
import { listWorkspaceEntries, listWorkspaceRepos } from './workspace';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-workspace-'));
  tempDirs.push(dir);
  return dir;
}

async function createGitFile(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, '.git'), 'gitdir: /tmp/mock.git');
}

async function initGitRepo(dir: string, options: { detached?: boolean } = {}): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const initResult = await runGit(dir, ['init']);
  if (initResult.exitCode !== 0) {
    throw new Error(initResult.stderr || initResult.stdout || 'git init failed');
  }
  const commitResult = await runGit(dir, [
    '-c',
    'user.name=Diff Tests',
    '-c',
    'user.email=diff@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'init',
  ]);
  if (commitResult.exitCode !== 0) {
    throw new Error(commitResult.stderr || commitResult.stdout || 'git commit failed');
  }
  if (options.detached) {
    const head = await runGit(dir, ['rev-parse', 'HEAD']);
    if (head.exitCode !== 0) {
      throw new Error(head.stderr || head.stdout || 'git rev-parse failed');
    }
    const checkout = await runGit(dir, ['checkout', head.stdout.trim()]);
    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr || checkout.stdout || 'git checkout failed');
    }
  }
}

async function initBareRepoWithWorktree(root: string, worktreeName: string): Promise<string> {
  const bareDir = path.join(root, 'bare');
  await fs.mkdir(bareDir, { recursive: true });
  const initResult = await runGit(root, ['init', '--bare', bareDir]);
  if (initResult.exitCode !== 0) {
    throw new Error(initResult.stderr || initResult.stdout || 'git init --bare failed');
  }
  const worktreeDir = path.join(bareDir, worktreeName);
  const addResult = await runGit(root, [
    '--git-dir',
    bareDir,
    'worktree',
    'add',
    '-b',
    'main',
    worktreeDir,
  ]);
  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || addResult.stdout || 'git worktree add failed');
  }
  await fs.writeFile(path.join(worktreeDir, 'README.md'), 'hello');
  const addFile = await runGit(worktreeDir, ['add', 'README.md']);
  if (addFile.exitCode !== 0) {
    throw new Error(addFile.stderr || addFile.stdout || 'git add failed');
  }
  const commitResult = await runGit(worktreeDir, [
    '-c',
    'user.name=Diff Tests',
    '-c',
    'user.email=diff@example.com',
    'commit',
    '-m',
    'init',
  ]);
  if (commitResult.exitCode !== 0) {
    throw new Error(commitResult.stderr || commitResult.stdout || 'git commit failed');
  }
  return worktreeDir;
}

async function initDotGitBareWithWorktree(
  root: string,
  containerName: string,
  worktreeName: string,
): Promise<string> {
  const containerDir = path.join(root, containerName);
  await fs.mkdir(containerDir, { recursive: true });
  const gitDir = path.join(containerDir, '.git');
  const initResult = await runGit(root, ['init', '--bare', gitDir]);
  if (initResult.exitCode !== 0) {
    throw new Error(initResult.stderr || initResult.stdout || 'git init --bare failed');
  }
  const worktreeDir = path.join(containerDir, worktreeName);
  const addResult = await runGit(containerDir, [
    '--git-dir',
    gitDir,
    'worktree',
    'add',
    '-b',
    'main',
    worktreeDir,
  ]);
  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || addResult.stdout || 'git worktree add failed');
  }
  await fs.writeFile(path.join(worktreeDir, 'README.md'), 'hello');
  const addFile = await runGit(worktreeDir, ['add', 'README.md']);
  if (addFile.exitCode !== 0) {
    throw new Error(addFile.stderr || addFile.stdout || 'git add failed');
  }
  const commitResult = await runGit(worktreeDir, [
    '-c',
    'user.name=Diff Tests',
    '-c',
    'user.email=diff@example.com',
    'commit',
    '-m',
    'init',
  ]);
  if (commitResult.exitCode !== 0) {
    throw new Error(commitResult.stderr || commitResult.stdout || 'git commit failed');
  }
  return worktreeDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('listWorkspaceEntries', () => {
  it('marks workspace root as a repo when .git is a file', async () => {
    const root = await createTempDir();
    await createGitFile(root);

    const result = await listWorkspaceEntries({ workspaceRoot: root, path: null });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    expect(result.rootIsRepo).toBe(true);
  });

  it('marks nested repo directories when .git is a file', async () => {
    const root = await createTempDir();
    const repoDir = path.join(root, 'repo');
    await fs.mkdir(repoDir);
    await createGitFile(repoDir);

    const result = await listWorkspaceEntries({ workspaceRoot: root, path: null });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const repoEntry = result.entries.find((entry) => entry.path === 'repo');
    expect(repoEntry?.repoRoot).toBe(true);
  });
});

describe('listWorkspaceRepos', () => {
  it('filters detached repos', async () => {
    const root = await createTempDir();
    const repoA = path.join(root, 'repo-a');
    const repoB = path.join(root, 'repo-b');
    await initGitRepo(repoA);
    await initGitRepo(repoB, { detached: true });

    const result = await listWorkspaceRepos({ workspaceRoot: root, maxDepth: 2, maxRepos: 10 });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const paths = result.repos.map((repo) => repo.path);
    expect(paths).toContain('repo-a');
    expect(paths).not.toContain('repo-b');
    result.repos.forEach((repo) => {
      expect(repo.branch.length).toBeGreaterThan(0);
    });
  });

  it('respects maxDepth', async () => {
    const root = await createTempDir();
    const shallowRepo = path.join(root, 'shallow');
    const deepRepo = path.join(root, 'group', 'nested');
    await initGitRepo(shallowRepo);
    await initGitRepo(deepRepo);

    const result = await listWorkspaceRepos({ workspaceRoot: root, maxDepth: 1, maxRepos: 10 });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const paths = result.repos.map((repo) => repo.path);
    expect(paths).toContain('shallow');
    expect(paths).not.toContain('group/nested');
    result.repos.forEach((repo) => {
      expect(repo.branch.length).toBeGreaterThan(0);
    });
  });

  it('finds worktrees nested under a bare repo directory', async () => {
    const root = await createTempDir();
    const worktreeDir = await initBareRepoWithWorktree(root, 'main');

    const result = await listWorkspaceRepos({ workspaceRoot: root, maxDepth: 3, maxRepos: 10 });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const relative = path.relative(root, worktreeDir).split(path.sep).join('/');
    const paths = result.repos.map((repo) => repo.path);
    expect(paths).toContain(relative);
  });

  it('finds worktrees nested under a bare .git directory', async () => {
    const root = await createTempDir();
    const worktreeDir = await initDotGitBareWithWorktree(root, 'repo', 'main');

    const result = await listWorkspaceRepos({ workspaceRoot: root, maxDepth: 3, maxRepos: 10 });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const relative = path.relative(root, worktreeDir).split(path.sep).join('/');
    const paths = result.repos.map((repo) => repo.path);
    expect(paths).toContain(relative);
  });
});
