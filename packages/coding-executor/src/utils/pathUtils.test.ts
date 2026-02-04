import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getSessionWorkspaceRoot, resolvePathWithinSession } from './pathUtils';

describe('pathUtils', () => {
  it('returns the workspace root as the session root', () => {
    const root = '/tmp/coding-path-utils';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root });

    expect(sessionRoot).toBe(root);
  });

  it('resolves relative paths inside the workspace root', () => {
    const root = '/tmp/coding-path-utils-rel';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root });
    const resolved = resolvePathWithinSession({ workspaceRoot: root }, 'src/app.ts');

    expect(resolved.startsWith(sessionRoot)).toBe(true);
    expect(resolved).toBe(path.join(sessionRoot, 'src', 'app.ts'));
  });

  it('treats absolute paths as workspace-relative', () => {
    const root = '/tmp/coding-path-utils-abs';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root });
    const resolved = resolvePathWithinSession({ workspaceRoot: root }, '/logs/output.log');

    expect(resolved.startsWith(sessionRoot)).toBe(true);
    expect(resolved).toBe(path.join(sessionRoot, 'logs', 'output.log'));
  });

  it('preserves absolute paths that already point within the workspace root', () => {
    const root = '/tmp/coding-path-utils-abs-preserve';
    const requested = path.join(root, 'logs', 'output.log');

    const resolved = resolvePathWithinSession({ workspaceRoot: root }, requested);

    expect(resolved).toBe(path.resolve(requested));
  });

  it('allows workspace roots that are filesystem roots', () => {
    const root = path.parse(process.cwd()).root;
    const requested = path.join(root, 'tmp', 'coding-path-utils-root');

    const resolved = resolvePathWithinSession({ workspaceRoot: root }, requested);

    expect(resolved).toBe(path.resolve(requested));
  });

  it('allows resolving absolute paths outside the workspace root when configured', () => {
    const root = path.join(os.tmpdir(), 'coding-path-utils-allow-outside');
    const requested = path.join(path.parse(process.cwd()).root, 'etc', 'passwd');

    const resolved = resolvePathWithinSession(
      { workspaceRoot: root, allowOutsideWorkspaceRoot: true },
      requested,
    );

    expect(resolved).toBe(path.resolve(requested));
  });

  it('rejects paths that escape the workspace root', () => {
    const root = '/tmp/coding-path-utils-escape';

    expect(() =>
      resolvePathWithinSession({ workspaceRoot: root }, '../outside.txt'),
    ).toThrow(/outside workspace/i);
  });
});
