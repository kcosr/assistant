import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export type DiffEntry = {
  path: string;
  status: string;
  renameFrom?: string;
};

export type RepoBranchInfo =
  | { branch: string; detached: false }
  | { branch: null; detached: true }
  | { error: string; status: number };

export async function runGit(
  cwd: string,
  args: string[],
  options: { maxOutputBytes?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = maxOutputBytes - stdoutBytes;
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
      if (chunk.length > remaining) {
        truncated = true;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: typeof code === 'number' ? code : -1,
        truncated,
      });
    });
  });
}

export async function runGitWithInput(
  cwd: string,
  args: string[],
  input: string,
  options: { maxOutputBytes?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = maxOutputBytes - stdoutBytes;
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
      if (chunk.length > remaining) {
        truncated = true;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: typeof code === 'number' ? code : -1,
        truncated,
      });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function isBareRepoRoot(dirPath: string): Promise<boolean> {
  try {
    const [headStat, objectsStat, refsStat] = await Promise.all([
      fs.stat(path.join(dirPath, 'HEAD')),
      fs.stat(path.join(dirPath, 'objects')),
      fs.stat(path.join(dirPath, 'refs')),
    ]);
    return headStat.isFile() && objectsStat.isDirectory() && refsStat.isDirectory();
  } catch {
    return false;
  }
}

export async function getRepoBranch(repoRoot: string): Promise<RepoBranchInfo> {
  const result = await runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD'], {
    maxOutputBytes: 1024,
  });
  const branch = result.stdout.trim();
  if (result.exitCode === 0 && branch) {
    return { branch, detached: false };
  }
  const stderr = result.stderr.trim();
  if (stderr.includes('not a symbolic ref')) {
    return { branch: null, detached: true };
  }
  return {
    error: stderr || branch || 'Failed to resolve repository branch',
    status: 500,
  };
}

export function resolvePathWithinRoot(root: string, requestedPath: string): string {
  const baseRoot = path.resolve(root);
  let relativePath = requestedPath.trim();
  if (!relativePath || relativePath === '.' || relativePath === '/') {
    return baseRoot;
  }

  relativePath = relativePath.replace(/\\/g, '/');
  if (path.isAbsolute(relativePath)) {
    relativePath = relativePath.slice(1);
  }

  const resolved = path.resolve(baseRoot, relativePath);
  const normalizedRoot = baseRoot.endsWith(path.sep) ? baseRoot : baseRoot + path.sep;
  const normalizedResolved = resolved.endsWith(path.sep) ? resolved : resolved + path.sep;

  if (!normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error('Invalid path: access outside workspace is not allowed');
  }

  return resolved;
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root) + path.sep;
  const normalizedCandidate = path.resolve(candidate) + path.sep;
  return normalizedCandidate.startsWith(normalizedRoot);
}

export async function resolveRepoRoot(
  workspaceRoot: string,
  repoPath: string | null,
): Promise<{ root: string; relative: string } | { error: string; status: number }> {
  let candidate = repoPath ? resolvePathWithinRoot(workspaceRoot, repoPath) : workspaceRoot;
  try {
    const stats = await fs.stat(candidate);
    if (!stats.isDirectory()) {
      candidate = path.dirname(candidate);
    }
  } catch {
    return { error: 'Repository path does not exist', status: 404 };
  }

  const rootResult = await runGit(candidate, ['rev-parse', '--show-toplevel']);
  if (rootResult.exitCode !== 0) {
    const stdout = rootResult.stdout.trim();
    const stderr = rootResult.stderr.trim();
    const needsWorkTree = stderr.includes('must be run in a work tree');
    const bare = await isBareRepoRoot(candidate);
    console.warn('[diff] resolveRepoRoot: git rev-parse failed', {
      repoPath,
      workspaceRoot,
      candidate,
      stdout,
      stderr,
      bare,
    });
    if (needsWorkTree || bare) {
      return {
        error: 'Selected path is a bare repository (no working tree). Choose a worktree instead.',
        status: 400,
      };
    }
    return { error: stderr || stdout || 'No git repository found at repoPath', status: 404 };
  }

  const root = rootResult.stdout.trim();
  if (!root) {
    const stderr = rootResult.stderr.trim();
    const bare = await isBareRepoRoot(candidate);
    console.warn('[diff] resolveRepoRoot: empty git root', {
      repoPath,
      workspaceRoot,
      candidate,
      stderr,
      bare,
    });
    if (bare) {
      return {
        error: 'Selected path is a bare repository (no working tree). Choose a worktree instead.',
        status: 400,
      };
    }
    return { error: stderr || 'No git repository found at repoPath', status: 404 };
  }

  const absoluteRoot = path.isAbsolute(root) ? root : path.resolve(candidate, root);
  if (!isPathWithinRoot(workspaceRoot, absoluteRoot)) {
    return { error: 'Repository root is outside the workspace root', status: 400 };
  }

  const relative = path.relative(workspaceRoot, absoluteRoot).split(path.sep).join('/');
  return { root: absoluteRoot, relative };
}

export function parseNameStatus(output: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const lines = output.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) {
      continue;
    }
    const status = parts[0] ?? '';
    let pathValue = parts[1] ?? '';
    let renameFrom: string | undefined;

    if (status.startsWith('R') || status.startsWith('C')) {
      renameFrom = parts[1];
      pathValue = parts[2] ?? parts[1] ?? '';
    }

    if (!pathValue) {
      continue;
    }

    const entry: DiffEntry = {
      path: pathValue,
      status,
      ...(renameFrom ? { renameFrom } : {}),
    };
    entries.push(entry);
  }

  return entries;
}

export async function listUntrackedPaths(repoRoot: string, prefix?: string): Promise<string[]> {
  const args = ['ls-files', '--others', '--exclude-standard'];
  if (prefix) {
    args.push('--', prefix);
  }
  const result = await runGit(repoRoot, args, { maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES });
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
