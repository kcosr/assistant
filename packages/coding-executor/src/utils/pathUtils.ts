import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface SessionPathOptions {
  workspaceRoot: string;
}

export function getSessionWorkspaceRoot(options: SessionPathOptions): string {
  return path.resolve(options.workspaceRoot);
}

export async function ensureSessionWorkspace(options: SessionPathOptions): Promise<string> {
  const root = getSessionWorkspaceRoot(options);
  await mkdir(root, { recursive: true });
  return root;
}

export function resolvePathWithinSession(
  options: SessionPathOptions,
  requestedPath: string,
): string {
  const sessionRoot = getSessionWorkspaceRoot(options);

  let relativePath = requestedPath.replace(/\\/g, '/');

  if (!relativePath || relativePath === '.' || relativePath === '/') {
    return sessionRoot;
  }

  if (path.isAbsolute(relativePath)) {
    relativePath = relativePath.slice(1);
  }

  const resolved = path.resolve(sessionRoot, relativePath);

  const normalizedRoot = path.resolve(sessionRoot) + path.sep;
  const normalizedResolved = path.resolve(resolved) + path.sep;

  if (!normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error('Invalid path: access outside workspace is not allowed');
  }

  return resolved;
}
