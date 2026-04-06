import { describe, expect, it } from 'vitest';
import {
  detectBangCommand,
  executeShellCommand,
  ASSISTANT_INTERNAL_TOOL_PREFIX,
  BANG_SHELL_TOOL_NAME,
} from './bangCommand';

// ---------------------------------------------------------------------------
// detectBangCommand
// ---------------------------------------------------------------------------

describe('detectBangCommand', () => {
  it('returns none for regular text', () => {
    const result = detectBangCommand('hello world');
    expect(result).toEqual({ isBang: false, isEscape: false });
  });

  it('returns none for empty string', () => {
    const result = detectBangCommand('');
    expect(result).toEqual({ isBang: false, isEscape: false });
  });

  it('detects a simple bang command', () => {
    const result = detectBangCommand('!pwd');
    expect(result).toEqual({ isBang: true, command: 'pwd' });
  });

  it('strips leading whitespace after !', () => {
    const result = detectBangCommand('!  ls -la');
    expect(result).toEqual({ isBang: true, command: 'ls -la' });
  });

  it('returns empty command for bare !', () => {
    const result = detectBangCommand('!');
    expect(result).toEqual({ isBang: true, command: '' });
  });

  it('returns empty command for ! followed by only spaces', () => {
    const result = detectBangCommand('!   ');
    expect(result).toEqual({ isBang: true, command: '' });
  });

  it('treats !! as escape — returns text with single !', () => {
    const result = detectBangCommand('!!hello');
    expect(result).toEqual({ isBang: false, isEscape: true, text: '!hello' });
  });

  it('treats !! alone as escape', () => {
    const result = detectBangCommand('!!');
    expect(result).toEqual({ isBang: false, isEscape: true, text: '!' });
  });

  it('handles multiline bang command', () => {
    const result = detectBangCommand('!echo hello\necho world');
    expect(result).toEqual({ isBang: true, command: 'echo hello\necho world' });
  });

  it('handles bang with complex shell command', () => {
    const result = detectBangCommand('!git log --oneline -5 | head -3');
    expect(result).toEqual({ isBang: true, command: 'git log --oneline -5 | head -3' });
  });

  it('detects bang after a <context .../> line', () => {
    const result = detectBangCommand('<context panel-id="notes" />\n!pwd');
    expect(result).toEqual({ isBang: true, command: 'pwd' });
  });

  it('detects !! escape after a <context .../> line', () => {
    const result = detectBangCommand('<context type="list" id="123" />\n!!hello');
    expect(result).toEqual({ isBang: false, isEscape: true, text: '!hello' });
  });

  it('returns none when context line is followed by normal text', () => {
    const result = detectBangCommand('<context panel-id="notes" />\nhello world');
    expect(result).toEqual({ isBang: false, isEscape: false });
  });

  it('handles context line with attributes and bang', () => {
    const result = detectBangCommand(
      '<context type="list" id="abc" name="My List" selection="1,2" />\n!ls -la',
    );
    expect(result).toEqual({ isBang: true, command: 'ls -la' });
  });
});

// ---------------------------------------------------------------------------
// executeShellCommand
// ---------------------------------------------------------------------------

describe('executeShellCommand', () => {
  it('executes a simple command and captures output', async () => {
    const result = await executeShellCommand({
      command: 'echo hello',
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe('hello');
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it('captures non-zero exit code', async () => {
    const result = await executeShellCommand({
      command: 'exit 42',
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr in output', async () => {
    const result = await executeShellCommand({
      command: 'echo err >&2',
      cwd: process.cwd(),
    });
    expect(result.output.trim()).toBe('err');
  });

  it('calls onChunk with streaming output', async () => {
    const chunks: string[] = [];
    await executeShellCommand({
      command: 'echo hello',
      cwd: process.cwd(),
      onChunk: (chunk) => chunks.push(chunk),
    });
    expect(chunks.join('').trim()).toBe('hello');
  });

  it('enforces timeout', async () => {
    const result = await executeShellCommand({
      command: 'sleep 10',
      cwd: process.cwd(),
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
  });

  it('enforces output size limit and truncates during streaming', async () => {
    const chunks: string[] = [];
    const result = await executeShellCommand({
      command: 'yes | head -10000',
      cwd: process.cwd(),
      maxOutputBytes: 100,
      onChunk: (chunk) => chunks.push(chunk),
    });
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(100);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await executeShellCommand({
      command: 'sleep 10',
      cwd: process.cwd(),
      signal: controller.signal,
    });
    // Should complete (killed by abort) rather than hang
    expect(result.exitCode).not.toBe(0);
  });

  it('uses specified cwd', async () => {
    const result = await executeShellCommand({
      command: 'pwd',
      cwd: '/tmp',
    });
    expect(result.output.trim()).toBe('/tmp');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('BANG_SHELL_TOOL_NAME starts with ASSISTANT_INTERNAL_TOOL_PREFIX', () => {
    expect(BANG_SHELL_TOOL_NAME.startsWith(ASSISTANT_INTERNAL_TOOL_PREFIX)).toBe(true);
  });
});
