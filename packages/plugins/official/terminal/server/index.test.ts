import os from 'node:os';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node-pty';

import { SessionIndex } from '../../../../agent-server/src/sessionIndex';
import { createPlugin } from './index';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

type FakePtyHandlers = {
  onData?: (data: string) => void;
  onExit?: (event: { exitCode: number; signal?: number }) => void;
};

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createFakePty() {
  const handlers: FakePtyHandlers = {};
  const pty = {
    pid: 123,
    cols: 80,
    rows: 24,
    process: 'bash',
    handleFlowControl: false,
    onData: (handler: (data: string) => void) => {
      handlers.onData = handler;
      return { dispose: vi.fn() };
    },
    onExit: (handler: (event: { exitCode: number; signal?: number }) => void) => {
      handlers.onExit = handler;
      return { dispose: vi.fn() };
    },
    resize: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
  };

  return { pty, handlers };
}

const MANIFEST = { id: 'terminal', version: '0.1.0' } as CombinedPluginManifest;

describe('terminal plugin', () => {
  it('spawns a PTY on panel open and streams input/resize', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    if (!handler) {
      throw new Error('Expected terminal panel event handler');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-session'));
    const sendToSession = vi.fn();

    const ctx = {
      sessionId: 'session-1',
      panelId: 'terminal-1',
      panelType: 'terminal',
      connectionId: 'conn-1',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession,
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-1',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
        sessionId: 'session-1',
      },
      ctx,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sendToSession).toHaveBeenCalled();

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-1',
        panelType: 'terminal',
        payload: { type: 'terminal_input', text: 'ls\n' },
        sessionId: 'session-1',
      },
      ctx,
    );

    expect(pty.write).toHaveBeenCalledWith('ls\n');

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-1',
        panelType: 'terminal',
        payload: { type: 'terminal_resize', cols: 100, rows: 40 },
        sessionId: 'session-1',
      },
      ctx,
    );

    expect(pty.resize).toHaveBeenCalledWith(100, 40);

    await plugin.shutdown?.();
  });

  it('closes PTYs when a session is deleted', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    if (!handler) {
      throw new Error('Expected terminal panel event handler');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-session-delete'));
    const ctx = {
      sessionId: 'session-2',
      panelId: 'terminal-2',
      panelType: 'terminal',
      connectionId: 'conn-2',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession: vi.fn(),
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-2',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
        sessionId: 'session-2',
      },
      ctx,
    );

    plugin.onSessionDeleted?.('session-2');

    expect(pty.kill).toHaveBeenCalled();

    await plugin.shutdown?.();
  });

  it('writes to the PTY via the write operation', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    const write = plugin.operations?.write;
    if (!handler || !write) {
      throw new Error('Expected terminal plugin handlers');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-write'));
    const ctx = {
      sessionId: 'session-3',
      panelId: 'terminal-3',
      panelType: 'terminal',
      connectionId: 'conn-3',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession: vi.fn(),
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-3',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
        sessionId: 'session-3',
      },
      ctx,
    );

    const toolResult = await write(
      { text: 'echo test\n' },
      {
        signal: new AbortController().signal,
        sessionId: 'session-3',
      },
    );

    expect(pty.write).toHaveBeenCalledWith('echo test\n');
    expect(toolResult).toMatchObject({ ok: true, sessionId: 'session-3', panelId: 'terminal-3' });

    await plugin.shutdown?.();
  });

  it('spawns a PTY for unbound panels and routes output to the client', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockClear();
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    if (!handler) {
      throw new Error('Expected terminal panel event handler');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-unbound'));
    const sendToClient = vi.fn();
    const sendToSession = vi.fn();

    const ctx = {
      sessionId: null,
      panelId: 'terminal-4',
      panelType: 'terminal',
      connectionId: 'conn-4',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient,
      sendToSession,
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-4',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
      },
      ctx,
    );

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-4',
        panelType: 'terminal',
        payload: { type: 'terminal_input', text: 'ls\n' },
      },
      ctx,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sendToClient).toHaveBeenCalled();
    expect(sendToSession).not.toHaveBeenCalled();
    expect(pty.write).toHaveBeenCalledWith('ls\n');

    await plugin.shutdown?.();
  });

  it('writes to unbound panels when panelId is provided', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    const write = plugin.operations?.write;
    if (!handler || !write) {
      throw new Error('Expected terminal plugin handlers');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-write-unbound'));
    const ctx = {
      sessionId: null,
      panelId: 'terminal-5',
      panelType: 'terminal',
      connectionId: 'conn-5',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession: vi.fn(),
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-5',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
      },
      ctx,
    );

    const toolResult = await write(
      { text: 'echo test\n', panelId: 'terminal-5' },
      {
        signal: new AbortController().signal,
        sessionId: 'session-5',
      },
    );

    expect(pty.write).toHaveBeenCalledWith('echo test\n');
    expect(toolResult).toMatchObject({ ok: true, sessionId: 'session-5', panelId: 'terminal-5' });

    await plugin.shutdown?.();
  });

  it('returns a snapshot for unbound panels when panelId is provided', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    const readScreen = plugin.operations?.['read-screen'];
    if (!handler || !readScreen) {
      throw new Error('Expected terminal plugin handlers');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-read-unbound'));
    const sendToConnection = vi.fn(() => true);
    const broadcastToSession = vi.fn();
    const ctx = {
      sessionId: null,
      panelId: 'terminal-6',
      panelType: 'terminal',
      connectionId: 'conn-6',
      connection: {} as never,
      sessionHub: {} as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession: vi.fn(),
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-6',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
      },
      ctx,
    );

    const readPromise = readScreen(
      { panelId: 'terminal-6' },
      {
        signal: new AbortController().signal,
        sessionId: 'session-6',
        sessionHub: { sendToConnection, broadcastToSession } as never,
      },
    );

    expect(sendToConnection).toHaveBeenCalledTimes(1);
    const [connectionId, requestMessage] = sendToConnection.mock.calls[0] ?? [];
    expect(connectionId).toBe('conn-6');
    const requestId = requestMessage?.payload?.requestId as string | undefined;
    expect(requestMessage?.payload?.type).toBe('terminal_snapshot_request');
    expect(typeof requestId).toBe('string');
    expect(broadcastToSession).not.toHaveBeenCalled();

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-6',
        panelType: 'terminal',
        payload: {
          type: 'terminal_snapshot_response',
          requestId,
          snapshot: {
            cols: 80,
            rows: 24,
            cursor: { x: 0, y: 0 },
            bufferType: 'normal',
            lines: ['echo test'],
            wrapped: [false],
            timestamp: new Date().toISOString(),
          },
        },
      },
      ctx,
    );

    const result = await readPromise;
    expect(result).toMatchObject({
      sessionId: 'session-6',
      panelId: 'terminal-6',
      snapshot: {
        cols: 80,
        rows: 24,
      },
    });

    await plugin.shutdown?.();
  });

  it('returns a snapshot via the read-screen operation', async () => {
    const { pty } = createFakePty();
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(pty as never);

    const plugin = createPlugin({ manifest: MANIFEST });
    const handler = plugin.panelEventHandlers?.['terminal'];
    const readScreen = plugin.operations?.['read-screen'];
    if (!handler || !readScreen) {
      throw new Error('Expected terminal plugin handlers');
    }

    const sessionIndex = new SessionIndex(createTempFile('terminal-plugin-read'));
    const broadcastToSession = vi.fn();
    const ctx = {
      sessionId: 'session-4',
      panelId: 'terminal-4',
      panelType: 'terminal',
      connectionId: 'conn-4',
      connection: {} as never,
      sessionHub: {
        broadcastToSession,
      } as never,
      sessionIndex,
      sendToClient: vi.fn(),
      sendToSession: vi.fn(),
      sendToAll: vi.fn(),
    };

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-4',
        panelType: 'terminal',
        payload: { type: 'panel_lifecycle', state: 'opened' },
        sessionId: 'session-4',
      },
      ctx,
    );

    const readPromise = readScreen(
      {},
      {
        signal: new AbortController().signal,
        sessionId: 'session-4',
        sessionHub: { broadcastToSession } as never,
      },
    );

    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    const [, requestMessage] = broadcastToSession.mock.calls[0] ?? [];
    const requestId = requestMessage?.payload?.requestId as string | undefined;
    expect(requestMessage?.payload?.type).toBe('terminal_snapshot_request');
    expect(typeof requestId).toBe('string');

    await handler(
      {
        type: 'panel_event',
        panelId: 'terminal-4',
        panelType: 'terminal',
        payload: {
          type: 'terminal_snapshot_response',
          requestId,
          snapshot: {
            cols: 80,
            rows: 24,
            cursor: { x: 0, y: 0 },
            bufferType: 'normal',
            lines: ['echo test'],
            wrapped: [false],
            timestamp: new Date().toISOString(),
          },
        },
        sessionId: 'session-4',
      },
      ctx,
    );

    const result = await readPromise;
    expect(result).toMatchObject({
      sessionId: 'session-4',
      panelId: 'terminal-4',
      snapshot: {
        cols: 80,
        rows: 24,
      },
    });

    await plugin.shutdown?.();
  });
});
