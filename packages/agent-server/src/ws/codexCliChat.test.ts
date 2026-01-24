import { type SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { runCodexCliChat, type CodexCliSpawn } from './codexCliChat';

class FakeCodexProcess extends EventEmitter {
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

describe('runCodexCliChat', () => {
  it('spawns codex exec for first message with extra args and prompt', async () => {
    const child = new FakeCodexProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: CodexCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: undefined,
      userText: 'hello',
      config: { extraArgs: ['-m', 'o3', '--config', 'model_reasoning_effort=xhigh'] },
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
    expect(call?.command).toBe('codex');
    const args = call?.args ?? [];
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('-m');
    expect(args).toContain('o3');
    expect(args).toContain('--config');
    expect(args).toContain('model_reasoning_effort=xhigh');
    expect(args[args.length - 1]).toBe('hello');
  });

  it('injects ASSISTANT_SESSION_ID into the codex environment', async () => {
    const child = new FakeCodexProcess();
    let capturedEnv: SpawnOptionsWithoutStdio['env'] | undefined;

    const spawnFn: CodexCliSpawn = (_command, _args, options) => {
      capturedEnv = options.env;
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: undefined,
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

  it('adds model to codex args when provided', async () => {
    const child = new FakeCodexProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: CodexCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: undefined,
      userText: 'hello',
      model: 'o3',
      config: { extraArgs: ['--config', 'model_reasoning_effort=xhigh'] },
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
    expect(args).toContain('o3');
    expect(args).toContain('--config');
    expect(args).toContain('model_reasoning_effort=xhigh');
  });

  it('adds reasoning config when thinking is provided', async () => {
    const child = new FakeCodexProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: CodexCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: undefined,
      userText: 'hello',
      thinking: 'high',
      config: { extraArgs: ['--config', 'foo=bar'] },
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.end();
    child.emit('close', 0, null);

    await promise;

    const args = calls[0]!.args;
    expect(args).toContain('--config');
    expect(args).toContain('model_reasoning_effort=high');
    expect(args).toContain('foo=bar');
  });

  it('uses wrapper command and merges wrapper env when configured', async () => {
    const child = new FakeCodexProcess();
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptionsWithoutStdio;
    }> = [];

    const spawnFn: CodexCliSpawn = (command, args, options) => {
      calls.push({ command, args, options });
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: undefined,
      userText: 'hello',
      config: {
        wrapper: {
          path: '/tmp/codex-wrapper',
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
    expect(call?.command).toBe('/tmp/codex-wrapper');
    expect(call?.args[0]).toBe('codex');
    expect(call?.options.env?.['CONTAINER_NAME']).toBe('assistant');
  });

  it('spawns codex exec resume when an existing session is provided', async () => {
    const child = new FakeCodexProcess();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const spawnFn: CodexCliSpawn = (command, args) => {
      calls.push({ command, args });
      return child as unknown as ReturnType<CodexCliSpawn>;
    };

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      existingCodexSessionId: 'codex-session-1',
      userText: 'next turn',
      config: { extraArgs: ['-m', 'o3-mini'] },
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
    expect(call?.command).toBe('codex');
    const args = call?.args ?? [];
    // --json must come before 'resume' subcommand
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('--json');
    expect(args).toContain('resume');
    expect(args).toContain('-m');
    expect(args).toContain('o3-mini');
    expect(args).toContain('codex-session-1');
    expect(args[args.length - 1]).toBe('next turn');
  });

  it('streams agent_message_delta events as text deltas', async () => {
    const child = new FakeCodexProcess();
    const deltas: string[] = [];

    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'hello',
      existingCodexSessionId: undefined,
      abortSignal: new AbortController().signal,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
      log: () => undefined,
      spawnFn,
    });

    // Use new direct event format with item.completed for agent_message
    const event1 = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Hello world',
      },
    };

    child.stdout.write(`${JSON.stringify(event1)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    // agent_message adds newlines
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toContain('Hello world');
    expect(result.text).toContain('Hello world');
  });

  it('captures codex session_id from session_configured', async () => {
    const child = new FakeCodexProcess();
    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;
    const onSessionId = vi.fn();

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'hello',
      existingCodexSessionId: undefined,
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onSessionId,
      log: () => undefined,
      spawnFn,
    });

    // Use new direct event format - thread.started provides session ID
    const threadEvent = {
      type: 'thread.started',
      thread_id: 'codex-session-xyz',
    };

    const messageEvent = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Hi',
      },
    };

    child.stdout.write(`${JSON.stringify(threadEvent)}\n`);
    child.stdout.write(`${JSON.stringify(messageEvent)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(result.codexSessionId).toBe('codex-session-xyz');
    expect(onSessionId).toHaveBeenCalledWith('codex-session-xyz');
  });

  it('captures codex session_id from session_meta output', async () => {
    const child = new FakeCodexProcess();
    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;
    const onSessionId = vi.fn();

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'hello',
      existingCodexSessionId: undefined,
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      onSessionId,
      log: () => undefined,
      spawnFn,
    });

    const sessionMetaEvent = {
      type: 'session_meta',
      payload: {
        id: 'codex-session-meta',
      },
    };

    const messageEvent = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Hi',
      },
    };

    child.stdout.write(`${JSON.stringify(sessionMetaEvent)}\n`);
    child.stdout.write(`${JSON.stringify(messageEvent)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;
    expect(result.codexSessionId).toBe('codex-session-meta');
    expect(onSessionId).toHaveBeenCalledWith('codex-session-meta');
  });

  it('decodes exec_command_output_delta stdout as base64 and appends to text', async () => {
    const child = new FakeCodexProcess();
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

    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'run command',
      existingCodexSessionId: undefined,
      abortSignal: new AbortController().signal,
      onTextDelta: (delta, full) => {
        deltas.push(full);
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

    // Use new direct event format - item.started + item.completed for command
    const startEvent = {
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: 'echo hello',
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    };

    const completeEvent = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: 'echo hello',
        aggregated_output: 'hello\n',
        exit_code: 0,
        status: 'completed',
      },
    };

    child.stdout.write(`${JSON.stringify(startEvent)}\n`);
    child.stdout.write(`${JSON.stringify(completeEvent)}\n`);
    child.stdout.end();
    child.emit('close', 0, null);

    const result = await promise;

    // Command execution output should be reported via tool callbacks, not main text stream
    expect(deltas).toHaveLength(0);
    expect(result.text).toBe('');

    expect(toolCalls).toHaveLength(1);
    expect(toolResults).toHaveLength(1);

    const call = toolCalls[0]!;
    const toolResult = toolResults[0]!;

    expect(call.toolName).toBe('shell');
    expect(call.args).toMatchObject({ command: 'echo hello' });
    expect(toolResult.toolName).toBe('shell');
    expect(toolResult.callId).toBe(call.callId);
    expect(toolResult.ok).toBe(true);
    expect(toolResult.result).toMatchObject({ output: 'hello\n', exitCode: 0 });
  });

  it('kills the codex process when aborted', async () => {
    const child = new FakeCodexProcess();
    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;
    const abortController = new AbortController();

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'hello',
      existingCodexSessionId: undefined,
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
    const child = new FakeCodexProcess();
    const spawnFn: CodexCliSpawn = () => child as unknown as ReturnType<CodexCliSpawn>;

    const promise = runCodexCliChat({
      ourSessionId: 'session-123',
      userText: 'hello',
      existingCodexSessionId: undefined,
      abortSignal: new AbortController().signal,
      onTextDelta: () => undefined,
      log: () => undefined,
      spawnFn,
    });

    child.stdout.write('not-json\n');
    child.stdout.end();
    child.emit('close', 0, null);

    await expect(promise).rejects.toThrow(/Unexpected codex CLI output/);
  });
});
