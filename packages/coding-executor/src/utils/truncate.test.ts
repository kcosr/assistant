import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from './truncate';

describe('truncateHead', () => {
  it('returns full content when within limits', () => {
    const text = 'line1\nline2';
    const result = truncateHead(text);

    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
    expect(result.totalLines).toBe(2);
    expect(result.totalBytes).toBe(Buffer.byteLength(text, 'utf-8'));
  });

  it('truncates by lines when exceeding maxLines', () => {
    const lines = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line${i + 1}`).join(
      '\n',
    );
    const result = truncateHead(lines, { maxLines: 10, maxBytes: DEFAULT_MAX_BYTES });

    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe('lines');
    expect(result.outputLines).toBe(10);
    expect(result.content.split('\n')).toHaveLength(10);
  });

  it('sets firstLineExceedsLimit when first line is too large', () => {
    const longLine = 'x'.repeat(DEFAULT_MAX_BYTES + 10);
    const result = truncateHead(longLine, { maxBytes: 1024 });

    expect(result.truncated).toBe(true);
    expect(result.firstLineExceedsLimit).toBe(true);
    expect(result.content).toBe('');
  });
});

describe('truncateTail', () => {
  it('returns full content when within limits', () => {
    const text = 'a\nb\nc';
    const result = truncateTail(text);

    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
    expect(result.totalLines).toBe(3);
  });

  it('keeps last lines when truncating by lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const result = truncateTail(lines, { maxLines: 5, maxBytes: DEFAULT_MAX_BYTES });

    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe('lines');
    expect(result.outputLines).toBe(5);
    expect(result.content.split('\n')[0]).toBe('line16');
  });
});
