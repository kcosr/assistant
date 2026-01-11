import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getSessionWorkspaceRoot, LocalExecutor } from '@assistant/coding-executor';

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

describe('LocalExecutor', () => {
  it('writes and reads files within a session workspace', async () => {
    const workspaceRoot = createTempDir('coding-executor-io');
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
    const workspaceRoot = createTempDir('coding-executor-traversal');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'session-b';

    await expect(executor.writeFile(sessionId, '../outside.txt', 'escape')).rejects.toThrow(
      /outside workspace/i,
    );
  });

  it('isolates files between sessions', async () => {
    const workspaceRoot = createTempDir('coding-executor-isolation');
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

  it('shares workspace between sessions when configured', async () => {
    const workspaceRoot = createTempDir('coding-executor-shared');
    const executor = new LocalExecutor({ workspaceRoot, sharedWorkspace: true });

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
  });

  it('runs bash commands in the session workspace', async () => {
    const workspaceRoot = createTempDir('coding-executor-bash');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'bash-session';
    const sessionRoot = getSessionWorkspaceRoot({ workspaceRoot, sessionId });

    const result = await executor.runBash(sessionId, 'pwd');

    expect(result.exitCode).toBe(0);
    expect(result.output.trim().split('\n')[0]).toBe(sessionRoot);
  });

  it('terminates bash processes when abortSignal aborts', async () => {
    const workspaceRoot = createTempDir('coding-executor-bash-abort');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'bash-abort-session';
    const abortController = new AbortController();

    const promise = executor.runBash(sessionId, 'node -e "setTimeout(() => {}, 100000)"', {
      abortSignal: abortController.signal,
    });

    abortController.abort();

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('lists directory contents with ls()', async () => {
    const workspaceRoot = createTempDir('coding-executor-ls');
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
    const workspaceRoot = createTempDir('coding-executor-edit');
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
    const workspaceRoot = createTempDir('coding-executor-find');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'find-session';

    await executor.writeFile(sessionId, 'src/index.ts', 'console.log("index");');
    await executor.writeFile(sessionId, 'src/utils/helper.ts', 'console.log("helper");');
    await executor.writeFile(sessionId, 'other/ignore.md', '# ignore');

    const result = await executor.find(sessionId, { pattern: '**/*.ts', path: 'src' });

    expect(result.files.length).toBeGreaterThanOrEqual(2);
    expect(result.files).toContain('index.ts');
    expect(result.files).toContain('utils/helper.ts');
    expect(result.truncated).toBe(false);
    expect(result.limit).toBeGreaterThan(0);
  });

  it('returns empty results when no files match', async () => {
    const workspaceRoot = createTempDir('coding-executor-find-empty');
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
    const workspaceRoot = createTempDir('coding-executor-find-truncate');
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
    const workspaceRoot = createTempDir('coding-executor-find-hidden');
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
    const workspaceRoot = createTempDir('coding-executor-grep-fallback');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'grep-session';
    const fileContent = ['first line', 'match here', 'another match here'].join('\n');

    await executor.writeFile(sessionId, 'src/example.txt', fileContent);

    const originalPath = process.env['PATH'];
    const tempPath = createTempDir('coding-executor-grep-path');
    process.env['PATH'] = tempPath;

    try {
      const result = await executor.grep(sessionId, {
        pattern: 'match',
        path: '.',
        glob: 'src/*.txt',
        literal: true,
      });

      expect(result.content).toContain('src/example.txt:2: match here');
      expect(result.content).toContain('src/example.txt:3: another match here');
      expect(result.content).not.toContain('No matches found');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('returns a friendly message when grep finds no matches', async () => {
    const workspaceRoot = createTempDir('coding-executor-grep-empty');
    const executor = new LocalExecutor({ workspaceRoot });

    const sessionId = 'grep-session-empty';
    await executor.writeFile(sessionId, 'file.txt', 'line one\nline two');

    const originalPath = process.env['PATH'];
    const tempPath = createTempDir('coding-executor-grep-path-empty');
    process.env['PATH'] = tempPath;

    try {
      const result = await executor.grep(sessionId, {
        pattern: 'absent-pattern',
        path: '.',
        literal: true,
      });

      expect(result.content.trim()).toBe('No matches found');
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
