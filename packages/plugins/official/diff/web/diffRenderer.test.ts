import { describe, expect, it } from 'vitest';

import { computeWordDiff, pairChanges, type DiffHunkLine } from './diffRenderer';

describe('computeWordDiff', () => {
  it('returns unchanged segments when texts are identical', () => {
    const result = computeWordDiff('hello world', 'hello world');
    expect(result.oldSegments).toEqual([{ text: 'hello world', type: 'unchanged' }]);
    expect(result.newSegments).toEqual([{ text: 'hello world', type: 'unchanged' }]);
  });

  it('detects added words', () => {
    const result = computeWordDiff('hello', 'hello world');
    expect(result.oldSegments).toEqual([{ text: 'hello', type: 'unchanged' }]);
    expect(result.newSegments).toEqual([
      { text: 'hello', type: 'unchanged' },
      { text: ' world', type: 'added' },
    ]);
  });

  it('detects removed words', () => {
    const result = computeWordDiff('hello world', 'hello');
    expect(result.oldSegments).toEqual([
      { text: 'hello', type: 'unchanged' },
      { text: ' world', type: 'removed' },
    ]);
    expect(result.newSegments).toEqual([{ text: 'hello', type: 'unchanged' }]);
  });

  it('detects changed words', () => {
    const result = computeWordDiff('const foo = 1;', 'const bar = 1;');
    // The diff library handles word boundaries, expect foo->bar change
    expect(result.oldSegments.some((s) => s.type === 'removed' && s.text.includes('foo'))).toBe(
      true,
    );
    expect(result.newSegments.some((s) => s.type === 'added' && s.text.includes('bar'))).toBe(true);
  });

  it('handles empty strings', () => {
    const result = computeWordDiff('', 'new text');
    expect(result.oldSegments).toEqual([]);
    expect(result.newSegments).toEqual([{ text: 'new text', type: 'added' }]);
  });

  it('handles complete replacement', () => {
    const result = computeWordDiff('old', 'new');
    expect(result.oldSegments).toEqual([{ text: 'old', type: 'removed' }]);
    expect(result.newSegments).toEqual([{ text: 'new', type: 'added' }]);
  });
});

describe('pairChanges', () => {
  it('passes context lines through unchanged', () => {
    const lines: DiffHunkLine[] = [
      { type: 'context', text: 'line 1', oldNumber: 1, newNumber: 1 },
      { type: 'context', text: 'line 2', oldNumber: 2, newNumber: 2 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[0] },
      { old: lines[1], new: lines[1] },
    ]);
  });

  it('passes meta lines through unchanged', () => {
    const lines: DiffHunkLine[] = [{ type: 'meta', text: 'No newline at end of file' }];
    const result = pairChanges(lines);
    expect(result).toEqual([{ old: lines[0], new: lines[0] }]);
  });

  it('pairs consecutive del/add lines', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old line', oldNumber: 1 },
      { type: 'add', text: 'new line', newNumber: 1 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([{ old: lines[0], new: lines[1] }]);
  });

  it('pairs multiple consecutive del/add sequences', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old 1', oldNumber: 1 },
      { type: 'del', text: 'old 2', oldNumber: 2 },
      { type: 'add', text: 'new 1', newNumber: 1 },
      { type: 'add', text: 'new 2', newNumber: 2 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[2] },
      { old: lines[1], new: lines[3] },
    ]);
  });

  it('handles more deletions than additions', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old 1', oldNumber: 1 },
      { type: 'del', text: 'old 2', oldNumber: 2 },
      { type: 'del', text: 'old 3', oldNumber: 3 },
      { type: 'add', text: 'new 1', newNumber: 1 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[3] },
      { old: lines[1], new: null },
      { old: lines[2], new: null },
    ]);
  });

  it('handles more additions than deletions', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old 1', oldNumber: 1 },
      { type: 'add', text: 'new 1', newNumber: 1 },
      { type: 'add', text: 'new 2', newNumber: 2 },
      { type: 'add', text: 'new 3', newNumber: 3 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[1] },
      { old: null, new: lines[2] },
      { old: null, new: lines[3] },
    ]);
  });

  it('handles pure additions (no deletions)', () => {
    const lines: DiffHunkLine[] = [
      { type: 'add', text: 'new 1', newNumber: 1 },
      { type: 'add', text: 'new 2', newNumber: 2 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: null, new: lines[0] },
      { old: null, new: lines[1] },
    ]);
  });

  it('handles pure deletions (no additions)', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old 1', oldNumber: 1 },
      { type: 'del', text: 'old 2', oldNumber: 2 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: null },
      { old: lines[1], new: null },
    ]);
  });

  it('handles mixed context and changes', () => {
    const lines: DiffHunkLine[] = [
      { type: 'context', text: 'unchanged', oldNumber: 1, newNumber: 1 },
      { type: 'del', text: 'old', oldNumber: 2 },
      { type: 'add', text: 'new', newNumber: 2 },
      { type: 'context', text: 'also unchanged', oldNumber: 3, newNumber: 3 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[0] },
      { old: lines[1], new: lines[2] },
      { old: lines[3], new: lines[3] },
    ]);
  });

  it('handles interleaved changes correctly', () => {
    const lines: DiffHunkLine[] = [
      { type: 'del', text: 'old 1', oldNumber: 1 },
      { type: 'add', text: 'new 1', newNumber: 1 },
      { type: 'context', text: 'middle', oldNumber: 2, newNumber: 2 },
      { type: 'del', text: 'old 2', oldNumber: 3 },
      { type: 'add', text: 'new 2', newNumber: 3 },
    ];
    const result = pairChanges(lines);
    expect(result).toEqual([
      { old: lines[0], new: lines[1] },
      { old: lines[2], new: lines[2] },
      { old: lines[3], new: lines[4] },
    ]);
  });

  it('handles empty input', () => {
    const result = pairChanges([]);
    expect(result).toEqual([]);
  });
});
