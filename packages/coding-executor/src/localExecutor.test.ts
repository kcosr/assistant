import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getSessionWorkspaceRoot } from './utils/pathUtils';
import { LocalExecutor } from './localExecutor';

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

describe('LocalExecutor (coding-sidecar)', () => {
  it('writes and reads files within a session workspace', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-io');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'session-a';
    const content = 'hello\nworld';

    await executor.writeFile(sessionId, 'test.txt', content);
    const result = await executor.readFile(sessionId, 'test.txt');

    expect(result.type).toBe('text');
    expect(result.content).toContain('hello');
    expect(result.totalLines).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('prevents path traversal outside the session workspace', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-traversal');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'session-b';

    await expect(executor.writeFile(sessionId, '../outside.txt', 'escape')).rejects.toThrow(
      /outside workspace/i,
    );
  });

  it('isolates files between sessions', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-isolation');
    const executor = new LocalExecutor({ workspaceRoot });

    const session1 = 's1';
    const session2 = 's2';

    await executor.writeFile(session1, 'shared.txt', 'session one');

    const session1Root = getSessionWorkspaceRoot({ workspaceRoot, sessionId: session1 });
    const session2Root = getSessionWorkspaceRoot({ workspaceRoot, sessionId: session2 });

    expect(session1Root).not.toBe(session2Root);

    const readSession1 = await executor.readFile(session1, 'shared.txt');
    expect(readSession1.type).toBe('text');

    await expect(executor.readFile(session2, 'shared.txt')).rejects.toThrow();
  });

  it('shares workspace between sessions when SHARED_WORKSPACE is true', async () => {
    const previous = process.env['SHARED_WORKSPACE'];
    process.env['SHARED_WORKSPACE'] = 'true';

    const workspaceRoot = createTempDir('coding-sidecar-shared');
    const executor = new LocalExecutor({ workspaceRoot });

    const session1 = 's1';
    const session2 = 's2';

    await executor.writeFile(session1, 'shared.txt', 'from session one');

    const session1Root = getSessionWorkspaceRoot({
      workspaceRoot,
      sessionId: session1,
      sharedWorkspace: true,
    });
    const session2Root = getSessionWorkspaceRoot({
      workspaceRoot,
      sessionId: session2,
      sharedWorkspace: true,
    });

    expect(session1Root).toBe(session2Root);

    const readSession2 = await executor.readFile(session2, 'shared.txt');
    expect(readSession2.type).toBe('text');
    expect(readSession2.content).toContain('from session one');

    if (previous === undefined) {
      delete process.env['SHARED_WORKSPACE'];
    } else {
      process.env['SHARED_WORKSPACE'] = previous;
    }
  });

  it('runs bash commands in the session workspace', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-bash');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'bash-session';
    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot, sessionId });

    const result = await executor.runBash(sessionId, 'pwd');

    expect(result.exitCode).toBe(0);
    expect(result.output.trim().split('\n')[0]).toBe(sessionRoot);
  });

  it('accepts abortSignal option for bash commands', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-bash-signal');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'bash-signal-session';
    const controller = new AbortController();

    const result = await executor.runBash(sessionId, 'echo hello', {
      abortSignal: controller.signal,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello');
  });

  it('lists directory contents with ls()', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-ls');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'ls-session';

    await executor.writeFile(sessionId, 'dir/subfile.txt', 'sub');
    await executor.writeFile(sessionId, 'file.txt', 'file');
    await executor.writeFile(sessionId, '.hidden', 'hidden');

    const rootListing = await executor.ls(sessionId);
    const rootLines = rootListing.output.split('\n').filter((line) => line.trim().length > 0);

    expect(rootLines).toContain('dir/');
    expect(rootLines).toContain('file.txt');
    expect(rootLines).toContain('.hidden');

    const limitedListing = await executor.ls(sessionId, undefined, { limit: 1 });
    const limitedLines = limitedListing.output.split('\n').filter((line) => line.trim().length > 0);
    expect(limitedLines.length).toBe(1);

    const dirListing = await executor.ls(sessionId, 'dir');
    expect(dirListing.output.trim()).toBe('subfile.txt');
  });

  it('edits files with unique oldText and returns a diff', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-edit');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'edit-session';
    const initial = ['line1', 'target line', 'line3'].join('\n');

    await executor.writeFile(sessionId, 'edit.txt', initial);

    const result = await executor.editFile(sessionId, 'edit.txt', 'target line', 'updated line');

    expect(result.ok).toBe(true);
    expect(result.diff).toContain('-2 target line');
    expect(result.diff).toContain('+2 updated line');

    const readBack = await executor.readFile(sessionId, 'edit.txt');
    expect(readBack.content).toContain('updated line');
  });

  it('finds files by glob pattern relative to the search path', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-find');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'find-session';

    await executor.writeFile(sessionId, 'src/index.ts', 'console.log("index");');
    await executor.writeFile(sessionId, 'src/utils/helper.ts', 'console.log("helper");');
    await executor.writeFile(sessionId, 'notes/ignore.md', '# ignore');

    const result = await executor.find(sessionId, { pattern: '**/*.ts', path: 'src' });

    expect(result.files.length).toBeGreaterThanOrEqual(2);
    expect(result.files).toContain('index.ts');
    expect(result.files).toContain('utils/helper.ts');
    expect(result.truncated).toBe(false);
    expect(result.limit).toBeGreaterThan(0);
  });

  it('returns empty results when no files match', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-find-empty');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'find-empty';

    const result = await executor.find(sessionId, {
      pattern: 'does-not-exist-*.ts',
      path: '.',
    });

    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('marks results as truncated when limit is exceeded', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-find-truncate');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'find-truncate';

    for (let i = 0; i < 10; i += 1) {
      await executor.writeFile(sessionId, `src/file-${i}.ts`, `// file ${i}`);
    }

    const limit = 3;
    const result = await executor.find(sessionId, {
      pattern: 'src/*.ts',
      path: '.',
      limit,
    });

    expect(result.files.length).toBeLessThanOrEqual(limit);
    expect(result.truncated).toBe(true);
  });

  it('includes hidden files when matching patterns', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-find-hidden');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'find-hidden';

    await executor.writeFile(sessionId, 'src/.hidden.ts', '// hidden');
    await executor.writeFile(sessionId, 'src/visible.ts', '// visible');

    const result = await executor.find(sessionId, {
      pattern: '**/*.ts',
      path: 'src',
    });

    expect(result.files).toContain('.hidden.ts');
    expect(result.files).toContain('visible.ts');
  });

  it('performs grep via Node fallback when ripgrep is unavailable', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-grep-fallback');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'grep-session';
    const fileContent = ['alpha', 'beta match', 'gamma match'].join('\n');

    await executor.writeFile(sessionId, 'src/example.txt', fileContent);

    const originalPath = process.env['PATH'];
    const tempPath = createTempDir('coding-sidecar-grep-path');
    process.env['PATH'] = tempPath;

    try {
      const result = await executor.grep(sessionId, {
        pattern: 'match',
        path: '.',
        glob: 'src/*.txt',
        literal: true,
      });

      expect(result.content).toContain('src/example.txt:2: beta match');
      expect(result.content).toContain('src/example.txt:3: gamma match');
      expect(result.content).not.toContain('No matches found');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('returns a friendly message when grep finds no matches', async () => {
    const workspaceRoot = createTempDir('coding-sidecar-grep-empty');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'grep-session-empty';
    await executor.writeFile(sessionId, 'file.txt', 'one\ntwo\nthree');

    const originalPath = process.env['PATH'];
    const tempPath = createTempDir('coding-sidecar-grep-path-empty');
    process.env['PATH'] = tempPath;

    try {
      const result = await executor.grep(sessionId, {
        pattern: 'not-present',
        path: '.',
        literal: true,
      });

      expect(result.content.trim()).toBe('No matches found');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
