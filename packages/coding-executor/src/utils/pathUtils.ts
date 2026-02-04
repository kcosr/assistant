import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface SessionPathOptions {
  workspaceRoot: string;
  /**
   * When true, disables the workspace boundary check and treats absolute paths
   * as literal filesystem paths (instead of workspace-root-relative shorthands).
   *
   * This is unsafe for untrusted execution and should only be enabled when the
   * sidecar/executor environment is already sufficiently sandboxed.
   */
  allowOutsideWorkspaceRoot?: boolean;
}

export function getSessionWorkspaceRoot(options: SessionPathOptions): string {
  return path.resolve(options.workspaceRoot);
}

export async function ensureSessionWorkspace(options: SessionPathOptions): Promise<string> {
  const root = getSessionWorkspaceRoot(options);
  await mkdir(root, { recursive: true });
  return root;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (!relative) {
    return true;
  }

  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return false;
  }

  // Different drive letters on Windows produce an absolute relative path.
  if (path.isAbsolute(relative)) {
    return false;
  }

  return true;
}

function assertPathWithinRoot(root: string, candidate: string): void {
  if (!isPathWithinRoot(root, candidate)) {
    throw new Error('Invalid path: access outside workspace is not allowed');
  }
}

export function resolvePathWithinSession(
  options: SessionPathOptions,
  requestedPath: string,
): string {
  const sessionRoot = getSessionWorkspaceRoot(options);
  const allowOutsideWorkspaceRoot = options.allowOutsideWorkspaceRoot === true;

  let normalizedPath = requestedPath.replace(/\\/g, '/');

  if (!normalizedPath || normalizedPath === '.') {
    return sessionRoot;
  }

  if (normalizedPath === '/') {
    return allowOutsideWorkspaceRoot ? path.sep : sessionRoot;
  }

  if (path.isAbsolute(normalizedPath)) {
    const resolvedAbs = path.resolve(normalizedPath);

    if (allowOutsideWorkspaceRoot) {
      return resolvedAbs;
    }

    // If the caller already provided a workspace-qualified absolute path, honor it.
    if (isPathWithinRoot(sessionRoot, resolvedAbs)) {
      return resolvedAbs;
    }

    // Backward-compatible behavior: treat "/foo/bar" as workspace-root-relative shorthand.
    normalizedPath = normalizedPath.replace(/^\/+/, '');
  }

  const resolved = path.resolve(sessionRoot, normalizedPath);

  if (!allowOutsideWorkspaceRoot) {
    assertPathWithinRoot(sessionRoot, resolved);
  }

  return resolved;
}
