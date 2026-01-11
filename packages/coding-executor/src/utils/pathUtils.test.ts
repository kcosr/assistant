import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getSessionWorkspaceRoot, resolvePathWithinSession } from './pathUtils';

describe('pathUtils', () => {
  it('computes session workspace root with sanitized session id', () => {
    const root = '/tmp/coding-path-utils';
    const sessionId = ' session/with unsafe chars ';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root, sessionId });
    const dirName = path.basename(sessionRoot);

    expect(sessionRoot.startsWith(root)).toBe(true);
    expect(dirName).not.toContain(' ');
    expect(dirName).not.toContain('/');
  });

  it('uses shared workspace root when configured', () => {
    const root = '/tmp/coding-path-utils-shared';
    const sessionId = 's1';

    const sessionRoot = getSessionWorkspaceRoot({
      workspaceRoot: root,
      sessionId,
      sharedWorkspace: true,
    });

    expect(sessionRoot).toBe(root);
  });

  it('resolves relative paths inside the session workspace', () => {
    const root = '/tmp/coding-path-utils-rel';
    const sessionId = 's1';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root, sessionId });
    const resolved = resolvePathWithinSession({ workspaceRoot: root, sessionId }, 'src/app.ts');

    expect(resolved.startsWith(sessionRoot)).toBe(true);
    expect(resolved).toBe(path.join(sessionRoot, 'src', 'app.ts'));
  });

  it('treats absolute paths as session-relative', () => {
    const root = '/tmp/coding-path-utils-abs';
    const sessionId = 's2';

    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot: root, sessionId });
    const resolved = resolvePathWithinSession(
      { workspaceRoot: root, sessionId },
      '/logs/output.log',
    );

    expect(resolved.startsWith(sessionRoot)).toBe(true);
    expect(resolved).toBe(path.join(sessionRoot, 'logs', 'output.log'));
  });

  it('rejects paths that escape the session workspace', () => {
    const root = '/tmp/coding-path-utils-escape';
    const sessionId = 's3';

    expect(() =>
      resolvePathWithinSession({ workspaceRoot: root, sessionId }, '../outside.txt'),
    ).toThrow(/outside workspace/i);
  });
});
