import fs from 'node:fs/promises';
import path from 'node:path';

import { truncateHead } from '@assistant/coding-executor';

import { resolvePathWithinRoot } from './pathUtils';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILE_LINES = 4000;

export type WorkspaceReadResult = {
  root: string;
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

function normalizeWorkspacePath(workspaceRoot: string, absolutePath: string): string | null {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

function looksBinary(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

async function readFileHead(filePath: string): Promise<{ buffer: Buffer; truncated: boolean }> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const truncated = bytesRead > MAX_FILE_BYTES;
    const slice = buffer.slice(0, Math.min(bytesRead, MAX_FILE_BYTES));
    return { buffer: slice, truncated };
  } finally {
    await handle.close();
  }
}

export async function readWorkspaceFile(options: {
  workspaceRoot: string;
  path: string;
}): Promise<WorkspaceReadResult | { error: string; status: number }> {
  let absolute: string;
  try {
    absolute = resolvePathWithinRoot(options.workspaceRoot, options.path);
  } catch (err) {
    return { error: (err as Error).message, status: 400 };
  }
  let stats: { isFile(): boolean };
  try {
    stats = await fs.stat(absolute);
  } catch (err) {
    return { error: (err as Error).message, status: 404 };
  }
  if (!stats.isFile()) {
    return { error: 'Path is not a file', status: 400 };
  }

  const relativePath = normalizeWorkspacePath(options.workspaceRoot, absolute);
  if (!relativePath) {
    return { error: 'Path is outside the workspace root', status: 400 };
  }

  let buffer: Buffer;
  let truncated = false;
  try {
    const readResult = await readFileHead(absolute);
    buffer = readResult.buffer;
    truncated = readResult.truncated;
  } catch (err) {
    return { error: (err as Error).message, status: 500 };
  }

  if (looksBinary(buffer)) {
    return {
      root: options.workspaceRoot,
      path: relativePath,
      content: '',
      truncated,
      binary: true,
    };
  }

  const rawText = buffer.toString('utf-8');
  const truncation = truncateHead(rawText, {
    maxBytes: MAX_FILE_BYTES,
    maxLines: MAX_FILE_LINES,
  });

  return {
    root: options.workspaceRoot,
    path: relativePath,
    content: truncation.content || '',
    truncated: truncation.truncated || truncation.firstLineExceedsLimit || truncated,
    binary: false,
  };
}
