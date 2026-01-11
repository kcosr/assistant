import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface SessionPathOptions {
  workspaceRoot: string;
  sessionId: string;
  sharedWorkspace?: boolean;
}

function sanitizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || 'session';
}

export function getSessionWorkspaceRoot(options: SessionPathOptions): string {
  if (options.sharedWorkspace) {
    return options.workspaceRoot;
  }
  const safeSessionId = sanitizeSessionId(options.sessionId);
  return path.join(options.workspaceRoot, safeSessionId);
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
