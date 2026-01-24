import { type SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runClaudeCliChat, type ClaudeCliSpawn } from './claudeCliChat';

class FakeClaudeProcess extends EventEmitter {
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

describe('runClaudeCliChat', () => {
  it('spawns claude with session-id for first message', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: ClaudeCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('claude');
    expect(calls[0]?.args).toContain('--session-id');
    expect(calls[0]?.args).toContain('session-123');
    expect(calls[0]?.args).toContain('hello');
  });

  it('injects ASSISTANT_SESSION_ID into the claude environment', async () => {
    const child = new FakeClaudeProcess();
    let capturedEnv: SpawnOptionsWithoutStdio['env'] | undefined;

    const spawnFn: ClaudeCliSpawn = (_command, _args, options) => {
      capturedEnv = options.env;
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(capturedEnv?.['ASSISTANT_SESSION_ID']).toBe('session-123');
  });

  it('adds model to claude args when provided', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: ClaudeCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      model: 'sonnet',
      config: { extraArgs: ['--agent', 'test-agent'] },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    const args = calls[0]!.args;
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--agent');
    expect(args).toContain('test-agent');
  });

  it('spawns claude with resume for subsequent messages and passes extra args', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: ClaudeCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: true,
      userText: 'hello',
      config: { extraArgs: ['--model', 'test-model', '--agent', 'test-agent'] },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    const args = calls[0]!.args;
    expect(args).toContain('--resume');
    expect(args).toContain('session-123');
    expect(args).toContain('--model');
    expect(args).toContain('test-model');
    expect(args).toContain('--agent');
    expect(args).toContain('test-agent');
  });

  it('passes extra args through to claude', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: ClaudeCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      config: { extraArgs: ['--dangerously-skip-permissions'] },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain('--dangerously-skip-permissions');
  });

  it('sets cwd when workdir is provided', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ options: SpawnOptionsWithoutStdio }> = [];

    const spawnFn: ClaudeCliSpawn = (_command, _args, options) => {
      calls.push({ options });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      config: { workdir: '/tmp/claude-workdir' },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.cwd).toBe('/tmp/claude-workdir');
  });

  it('defaults cwd to the home directory when workdir is not provided', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{ options: SpawnOptionsWithoutStdio }> = [];

    const spawnFn: ClaudeCliSpawn = (_command, _args, options) => {
      calls.push({ options });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.cwd).toBe(os.homedir());
  });

  it('uses wrapper command and merges wrapper env when configured', async () => {
    const child = new FakeClaudeProcess();
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptionsWithoutStdio;
    }> = [];

    const spawnFn: ClaudeCliSpawn = (command, args, options) => {
      calls.push({ command, args, options });
      return child as unknown as ReturnType<ClaudeCliSpawn>;
    };

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      config: {
        wrapper: {
          path: '/tmp/claude-wrapper',
          env: { CONTAINER_NAME: 'assistant' },
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
    expect(call?.command).toBe('/tmp/claude-wrapper');
    expect(call?.args[0]).toBe('claude');
    expect(call?.options.env?.['CONTAINER_NAME']).toBe('assistant');
  });

  it('streams explicit delta events as text deltas', async () => {
    const child = new FakeClaudeProcess();
    const deltas: string[] = [];

    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(`${JSON.stringify({ delta: { text: 'Hello' } })}\n`);
    child.stdout.write(`${JSON.stringify({ delta: { text: ' world' } })}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.text).toBe('Hello world');
  });

  it('streams nested stream_event content_block_delta events', async () => {
    const child = new FakeClaudeProcess();
    const deltas: string[] = [];
    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(
      `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
      })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.text).toBe('Hello world');
  });

  it('derives deltas from partial full-text message events', async () => {
    const child = new FakeClaudeProcess();
    const deltas: string[] = [];
    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(
      `${JSON.stringify({ message: { content: [{ type: 'text', text: 'Hello' }] } })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({ message: { content: [{ type: 'text', text: 'Hello there' }] } })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(deltas).toEqual(['Hello', ' there']);
    expect(result.text).toBe('Hello there');
  });

  it('kills the claude process when aborted', async () => {
    const child = new FakeClaudeProcess();
    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;
    const abortController = new AbortController();

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: abortController.signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    abortController.abort();

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(child.killedSignals.length).toBeGreaterThan(0);
  });

  it('throws on unexpected non-JSON output', async () => {
    const child = new FakeClaudeProcess();
    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-123',
      resumeSession: false,
      userText: 'hello',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write('not-json\n');
    child.stdout.end();
    child.emit('close', 0, null);

    await expect(promise).rejects.toThrow(/Unexpected claude output/);
  });

  it('surfaces tool_use content blocks as formatted tool call text', async () => {
    const child = new FakeClaudeProcess();
    const deltas: string[] = [];
    const toolCalls: Array<{
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];

    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-tool',
      resumeSession: false,
      userText: 'use a tool',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      onToolCallStart: (callId, toolName, args) => {
        toolCalls.push({ callId, toolName, args });
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'read_file',
          input: { path: '/some/file.txt' },
        },
      })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    // Tool calls should be emitted via callback, not text stream
    expect(deltas).toHaveLength(0);
    expect(toolCalls).toHaveLength(1);
    const call = toolCalls[0]!;
    expect(call.toolName).toBe('read_file');
    expect(typeof call.callId).toBe('string');
    expect(call.callId.length).toBeGreaterThan(0);
    expect(call.args).toMatchObject({ path: '/some/file.txt' });
  });

  it('accumulates input_json_delta for streaming tool input', async () => {
    const child = new FakeClaudeProcess();
    const toolCalls: Array<{
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];

    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-tool-streaming',
      resumeSession: false,
      userText: 'use a tool',
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onToolCallStart: (callId, toolName, args) => {
        toolCalls.push({ callId, toolName, args });
      },
      log: () => undefined,
      spawnFn,
    });

    // Simulate streaming tool input like real Claude CLI output
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'Bash',
          input: {},
        },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"c' },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'ommand": "echo ' },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'hello"}' },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_stop',
        index: 0,
      })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(toolCalls).toHaveLength(1);
    const call = toolCalls[0]!;
    expect(call.toolName).toBe('Bash');
    expect(call.args).toMatchObject({ command: 'echo hello' });
  });

  it('surfaces thinking_delta content blocks as thinking text', async () => {
    const child = new FakeClaudeProcess();
    const textDeltas: string[] = [];
    const thinkingDeltas: string[] = [];
    let thinkingDoneText = '';

    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-thinking',
      resumeSession: false,
      userText: 'think',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta);
      },
      onThinkingStart: () => undefined,
      onThinkingDelta: (delta) => {
        thinkingDeltas.push(delta);
      },
      onThinkingDone: (text) => {
        thinkingDoneText = text;
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_delta',
        delta: {
          type: 'thinking_delta',
          thinking: 'Let me analyze this...',
        },
      })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;

    expect(textDeltas).toHaveLength(0);
    expect(thinkingDeltas).toEqual(['Let me analyze this...']);
    expect(thinkingDoneText).toBe('Let me analyze this...');
    expect(result.text).toBe('');
  });

  it('surfaces tool result content blocks and links them to prior tool_use', async () => {
    const child = new FakeClaudeProcess();
    const deltas: string[] = [];
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

    const spawnFn: ClaudeCliSpawn = () => child as unknown as ReturnType<ClaudeCliSpawn>;

    const promise = runClaudeCliChat({
      sessionId: 'session-tool-result',
      resumeSession: false,
      userText: 'tool result',
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      onToolCallStart: (callId, toolName, args) => {
        toolCalls.push({ callId, toolName, args });
      },
      onToolResult: (callId, toolName, ok, result) => {
        toolResults.push({ callId, toolName, ok, result });
      },
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'get_weather',
          input: { location: 'NYC' },
        },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          result: { ok: true, tempC: 20 },
        },
      })}\n`,
    );
    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    expect(deltas).toHaveLength(0);
    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);

    const call = toolCalls[0]!;
    const result = toolResults[0]!;

    expect(call.toolName).toBe('get_weather');
    expect(result.toolName).toBe('get_weather');
    expect(call.callId).toBe(result.callId);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ ok: true, tempC: 20 });
  });
});
