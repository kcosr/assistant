import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_AUTHOR_NAME = 'AI Assistant';
const DEFAULT_AUTHOR_EMAIL = 'assistant@local';

export const DEFAULT_GIT_IGNORE_PATTERNS = ['*.db-wal', '*.db-shm', '*.db-journal'];

export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function runGit(
  cwd: string,
  args: string[],
  options: { maxOutputBytes?: number } = {},
): Promise<GitCommandResult> {
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

export async function ensureGitIgnore(dir: string, patterns: string[]): Promise<boolean> {
  if (patterns.length === 0) {
    return false;
  }
  const gitignorePath = path.join(dir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(gitignorePath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      throw err;
    }
  }

  const lines = existing.split(/\r?\n/);
  const known = new Set(lines.map((line) => line.trim()).filter((line) => line.length > 0));
  const toAdd = patterns.filter((pattern) => !known.has(pattern));
  if (toAdd.length === 0) {
    return false;
  }

  const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = existing + suffix + toAdd.join('\n') + '\n';
  await fs.writeFile(gitignorePath, next, 'utf8');
  return true;
}

async function ensureLocalGitConfig(dir: string): Promise<void> {
  await runGit(dir, ['config', 'user.name', DEFAULT_AUTHOR_NAME]);
  await runGit(dir, ['config', 'user.email', DEFAULT_AUTHOR_EMAIL]);
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);
}

export async function ensureRepoInitialized(
  dir: string,
  options: { ignorePatterns?: string[] } = {},
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const gitPath = path.join(dir, '.git');
  const hasGit = await pathExists(gitPath);
  if (!hasGit) {
    const initResult = await runGit(dir, ['init']);
    if (initResult.exitCode !== 0) {
      throw new Error(initResult.stderr || initResult.stdout || 'Failed to init git repo');
    }
  }

  await ensureLocalGitConfig(dir);

  const ignorePatterns = options.ignorePatterns ?? [];
  await ensureGitIgnore(dir, ignorePatterns);

  if (!hasGit) {
    const addResult = await runGit(dir, ['add', '-A']);
    if (addResult.exitCode !== 0) {
      throw new Error(addResult.stderr || addResult.stdout || 'Failed to stage initial commit');
    }
    const commitResult = await runGit(dir, ['commit', '-m', 'Initial commit', '--allow-empty']);
    if (commitResult.exitCode !== 0) {
      throw new Error(
        commitResult.stderr || commitResult.stdout || 'Failed to commit initial repo',
      );
    }
  }
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await runGit(process.cwd(), ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function hasChanges(dir: string): Promise<boolean> {
  const files = await listChangedFiles(dir);
  return files.length > 0;
}

export async function commitAll(dir: string, message: string): Promise<void> {
  const addResult = await runGit(dir, ['add', '-A']);
  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr || addResult.stdout || 'Failed to stage git commit');
  }
  const commitResult = await runGit(dir, ['commit', '-m', message]);
  if (commitResult.exitCode !== 0) {
    throw new Error(commitResult.stderr || commitResult.stdout || 'Failed to commit git changes');
  }
}

export async function isDetachedHead(dir: string): Promise<boolean> {
  const result = await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to determine git HEAD');
  }
  return result.stdout.trim() === 'HEAD';
}

export async function listChangedFiles(dir: string): Promise<string[]> {
  const result = await runGit(dir, ['status', '--porcelain', '-z']);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to read git status');
  }

  const entries = result.stdout.split('\0').filter((entry) => entry.length > 0);
  const files: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    const pathValue = entry.slice(3);
    if (!pathValue) {
      continue;
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const next = entries[index + 1];
      if (next) {
        files.push(next);
        index += 1;
        continue;
      }
    }
    files.push(pathValue);
  }

  return Array.from(new Set(files)).sort();
}
