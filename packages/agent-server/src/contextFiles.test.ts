import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from './agents';
import { buildContextFilesPrompt } from './contextFiles';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createAgent(contextFiles: AgentDefinition['contextFiles']): AgentDefinition {
  return {
    agentId: `agent-${Math.random().toString(16).slice(2)}`,
    displayName: 'Agent',
    description: 'Agent',
    ...(contextFiles ? { contextFiles } : {}),
  };
}

describe('contextFiles', () => {
  it('builds a prompt in source order, include order, and lexical match order', () => {
    const root = createTempDir('context-files-order');
    writeTextFile(path.join(root, 'README.md'), 'root readme');
    writeTextFile(path.join(root, 'product', 'overview.md'), 'overview');
    writeTextFile(path.join(root, 'product', 'policies', 'b.md'), 'policy b');
    writeTextFile(path.join(root, 'product', 'policies', 'a.md'), 'policy a');
    writeTextFile(path.join(root, 'shared', 'nested', 'guide.md'), 'guide');

    const docsRoot = createTempDir('context-files-order-docs');
    writeTextFile(path.join(docsRoot, 'system-prompt', 'extra.md'), 'extra');

    const agent = createAgent([
      {
        root,
        include: ['README.md', 'product/overview.md', 'product/policies/*.md', 'shared/**/*.md'],
      },
      {
        root: docsRoot,
        include: ['system-prompt/*.md', 'system-prompt/*.md'],
      },
    ]);

    const prompt = buildContextFilesPrompt(agent);

    expect(prompt).toContain('## Context Files');
    expect(prompt).toContain('--- Context file: README.md ---');
    expect(prompt).toContain('--- Context file: product/overview.md ---');
    expect(prompt).toContain('--- Context file: product/policies/a.md ---');
    expect(prompt).toContain('--- Context file: product/policies/b.md ---');
    expect(prompt).toContain('--- Context file: shared/nested/guide.md ---');
    expect(prompt).toContain('--- Context file: system-prompt/extra.md ---');

    expect(prompt.indexOf('README.md')).toBeLessThan(prompt.indexOf('product/overview.md'));
    expect(prompt.indexOf('product/overview.md')).toBeLessThan(
      prompt.indexOf('product/policies/a.md'),
    );
    expect(prompt.indexOf('product/policies/a.md')).toBeLessThan(
      prompt.indexOf('product/policies/b.md'),
    );
    expect(prompt.indexOf('product/policies/b.md')).toBeLessThan(
      prompt.indexOf('shared/nested/guide.md'),
    );
    expect(prompt.indexOf('shared/nested/guide.md')).toBeLessThan(
      prompt.indexOf('system-prompt/extra.md'),
    );
    expect(prompt.match(/system-prompt\/extra\.md/g)).toHaveLength(2);
  });

  it('fails when an include pattern matches no files', () => {
    const root = createTempDir('context-files-empty-match');
    writeTextFile(path.join(root, 'README.md'), 'root readme');

    const agent = createAgent([{ root, include: ['missing.md'] }]);

    expect(() => buildContextFilesPrompt(agent)).toThrow(/matched no files/);
  });

  it('fails on binary files', () => {
    const root = createTempDir('context-files-binary');
    const filePath = path.join(root, 'blob.bin');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]));

    const agent = createAgent([{ root, include: ['blob.bin'] }]);

    expect(() => buildContextFilesPrompt(agent)).toThrow(/appears to be binary/);
  });

  it('fails on invalid UTF-8 content', () => {
    const root = createTempDir('context-files-invalid-utf8');
    const filePath = path.join(root, 'bad.txt');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from([0xc3, 0x28]));

    const agent = createAgent([{ root, include: ['bad.txt'] }]);

    expect(() => buildContextFilesPrompt(agent)).toThrow(/not valid UTF-8/);
  });

  it('follows symlinks that stay within the declared root', () => {
    const root = createTempDir('context-files-symlink-inside');
    const targetPath = path.join(root, 'docs', 'guide.md');
    writeTextFile(targetPath, 'inside');
    fs.symlinkSync(targetPath, path.join(root, 'guide-link.md'));

    const agent = createAgent([{ root, include: ['guide-link.md'] }]);
    const prompt = buildContextFilesPrompt(agent);

    expect(prompt).toContain('--- Context file: guide-link.md ---');
    expect(prompt).toContain('inside');
  });

  it('rejects symlinks that escape the declared root', () => {
    const root = createTempDir('context-files-symlink-outside');
    const outsideDir = createTempDir('context-files-outside-target');
    const outsidePath = path.join(outsideDir, 'secret.md');
    writeTextFile(outsidePath, 'outside');
    fs.symlinkSync(outsidePath, path.join(root, 'secret.md'));

    const agent = createAgent([{ root, include: ['secret.md'] }]);

    expect(() => buildContextFilesPrompt(agent)).toThrow(/resolves outside root/);
  });

});
