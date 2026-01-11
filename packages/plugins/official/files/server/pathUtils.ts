import path from 'node:path';

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
  const normalizedRoot = baseRoot.endsWith(path.sep) ? baseRoot : `${baseRoot}${path.sep}`;
  const normalizedResolved = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;

  if (!normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error('Invalid path: access outside workspace is not allowed');
  }

  return resolved;
}
