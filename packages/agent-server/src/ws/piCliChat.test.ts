import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runPiCliChat, type PiCliSpawn } from './piCliChat';

class FakePiProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killedSignals: Array<NodeJS.Signals | undefined> = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killedSignals.push(signal);
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => {
      this.emit('close', null, signal ?? null);
    });
    return true;
  }
}

describe('runPiCliChat', () => {
  it('spawns pi with json mode, prompt, and extra args', async () => {
    const child = new FakePiProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: PiCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<PiCliSpawn>;
    };

    const promise = runPiCliChat({
      sessionId: 'session-1',
      resumeSession: false,
      userText: 'hello',
      config: {
        extraArgs: [
          '--provider',
          'google',
          '--model',
          'pi-model',
          '--thinking',
          'medium',
          '--tools',
          'bash,fs',
        ],
      },
      dataDir: '/tmp/assistant-tests',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toBe('pi');
    const args = call?.args ?? [];
    expect(args).toContain('--mode');
    expect(args).toContain('json');
    expect(args).toContain('--session-dir');
    const dirIndex = args.indexOf('--session-dir');
    expect(dirIndex).toBeGreaterThanOrEqual(0);
    const sessionDir = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
    expect(sessionDir).toBe(path.resolve('/tmp/assistant-tests', 'pi-sessions'));
    expect(args).toContain('--session');
    const sessionIndex = args.indexOf('--session');
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    const sessionValue = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
    expect(sessionValue).toBe('session-1');
    expect(args).toContain('-p');
    expect(args).toContain('--provider');
    expect(args).toContain('google');
    expect(args).toContain('--model');
    expect(args).toContain('pi-model');
    expect(args).toContain('--thinking');
    expect(args).toContain('medium');
    expect(args).toContain('--tools');
    expect(args).toContain('bash,fs');
    expect(args[args.length - 1]).toBe('hello');
  });

  it('streams message_update text_delta events as text deltas', async () => {
    const child = new FakePiProcess();
    const deltas: string[] = [];
    const thinkingDeltas: string[] = [];

    const spawnFn: PiCliSpawn = () => child as unknown as ReturnType<PiCliSpawn>;

    const promise = runPiCliChat({
      sessionId: 'session-2',
      resumeSession: false,
      userText: 'hello',
      dataDir: '/tmp/assistant-tests',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      onThinkingStart: () => undefined,
      onThinkingDelta: (delta) => {
        thinkingDeltas.push(delta);
      },
      onThinkingDone: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    const event1 = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: 'Hello',
        contentIndex: 0,
      },
    };

    const event2 = {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: ' world',
        contentIndex: 0,
      },
    };

    child.stdout.write(`${JSON.stringify(event1)}\n`);
    child.stdout.write(`${JSON.stringify(event2)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(deltas).toEqual(['Hello', ' world']);
    expect(thinkingDeltas).toEqual([]);
    expect(result.text).toBe('Hello world');
  });

  it('maps tool_execution_start and tool_execution_end events to tool callbacks', async () => {
    const child = new FakePiProcess();
    const toolCalls: Array<{
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];
    const toolResults: Array<{
      callId: string;
      toolName: string;
      ok: boolean;
      result: unknown;
    }> = [];

    const spawnFn: PiCliSpawn = () => child as unknown as ReturnType<PiCliSpawn>;

    const promise = runPiCliChat({
      sessionId: 'session-3',
      resumeSession: false,
      userText: 'run tool',
      dataDir: '/tmp/assistant-tests',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onThinkingStart: () => undefined,
      onThinkingDelta: () => undefined,
      onThinkingDone: () => undefined,
      onToolCallStart: (callId, toolName, args) => {
        toolCalls.push({ callId, toolName, args });
      },
      onToolResult: (callId, toolName, ok, result) => {
        toolResults.push({ callId, toolName, ok, result });
      },
      log: () => undefined,
      spawnFn,
    });

    const startEvent = {
      type: 'tool_execution_start',
      toolCallId: 'toolu_1',
      toolName: 'bash',
      args: { command: 'ls' },
    };

    const endEvent = {
      type: 'tool_execution_end',
      toolCallId: 'toolu_1',
      toolName: 'bash',
      result: {
        content: [
          { type: 'text', text: 'file1\n' },
          { type: 'text', text: 'file2\n' },
        ],
      },
      isError: false,
    };

    child.stdout.write(`${JSON.stringify(startEvent)}\n`);
    child.stdout.write(`${JSON.stringify(endEvent)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);

    const call = toolCalls[0]!;
    const result = toolResults[0]!;

    expect(call.callId).toBe('toolu_1');
    expect(call.toolName).toBe('bash');
    expect(call.args).toMatchObject({ command: 'ls' });

    expect(result.callId).toBe('toolu_1');
    expect(result.toolName).toBe('bash');
    expect(result.ok).toBe(true);
    expect(result.result).toBe('file1\nfile2\n');
  });

  it('kills the pi process when aborted', async () => {
    const child = new FakePiProcess();
    const spawnFn: PiCliSpawn = () => child as unknown as ReturnType<PiCliSpawn>;
    const abortController = new AbortController();

    const promise = runPiCliChat({
      sessionId: 'session-abort',
      resumeSession: false,
      userText: 'hello',
      dataDir: '/tmp/assistant-tests',
      abortSignal: abortController.signal,
      onTextDelta: () => undefined,
      onThinkingStart: () => undefined,
      onThinkingDelta: () => undefined,
      onThinkingDone: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    abortController.abort();

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(child.killedSignals.length).toBeGreaterThan(0);
  });

  it('throws on unexpected non-JSON output', async () => {
    const child = new FakePiProcess();
    const spawnFn: PiCliSpawn = () => child as unknown as ReturnType<PiCliSpawn>;

    const promise = runPiCliChat({
      sessionId: 'session-non-json',
      resumeSession: false,
      userText: 'hello',
      dataDir: '/tmp/assistant-tests',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onThinkingStart: () => undefined,
      onThinkingDelta: () => undefined,
      onThinkingDone: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write('not-json\n');
    child.stdout.end();
    child.emit('close', 0, null);

    await expect(promise).rejects.toThrow(/Unexpected Pi CLI output/);
  });

  it('adds --continue when resumeSession is true', async () => {
    const child = new FakePiProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: PiCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<PiCliSpawn>;
    };

    const promise = runPiCliChat({
      sessionId: 'session-continue',
      resumeSession: true,
      userText: 'next',
      dataDir: '/tmp/assistant-tests',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onThinkingStart: () => undefined,
      onThinkingDelta: () => undefined,
      onThinkingDone: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.args).toContain('--continue');
  });

  it('uses wrapper command and relative session path when configured', async () => {
    const child = new FakePiProcess();
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptionsWithoutStdio;
    }> = [];
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cli-wrapper-'));

    const spawnFn: PiCliSpawn = (command, args, options) => {
      calls.push({ command, args, options });
      return child as unknown as ReturnType<PiCliSpawn>;
    };

    const promise = runPiCliChat({
      sessionId: 'session-wrapper',
      resumeSession: false,
      userText: 'hello',
      dataDir: '/tmp/assistant-tests',
      config: {
        workdir,
        wrapper: {
          path: '/tmp/pi-wrapper',
          env: { PERSISTENT: '1' },
        },
      },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toBe('/tmp/pi-wrapper');
    const args = call?.args ?? [];
    expect(args[0]).toBe('pi');
    const sessionDirIndex = args.indexOf('--session-dir');
    expect(sessionDirIndex).toBeGreaterThanOrEqual(0);
    expect(args[sessionDirIndex + 1]).toBe('.assistant/pi-sessions');
    const sessionIndex = args.indexOf('--session');
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(args[sessionIndex + 1]).toBe('session-wrapper');
    expect(call?.options.cwd).toBe(workdir);
    expect(fs.existsSync(path.join(workdir, '.assistant', 'pi-sessions'))).toBe(true);
  });
});
