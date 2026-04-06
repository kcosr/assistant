import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPlugin } from './index';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    sessionId: 'test-session',
    sessionHub: {
      broadcastToAll: vi.fn(),
    },
    sessionIndex: {
      getSession: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as any;
}

describe('notifications server plugin', () => {
  let tempDir: string;
  let plugin: PluginModule;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `notifications-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    plugin = createPlugin({ manifest: {} as any });
    await plugin.initialize!(tempDir);
  });

  afterEach(async () => {
    await plugin.shutdown?.();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create operation', () => {
    it('creates a notification and broadcasts', async () => {
      const ctx = createMockCtx();
      const result = (await plugin.operations!.create(
        { title: 'Hello', body: 'World' },
        ctx,
      )) as any;

      expect(result.id).toBeDefined();
      expect(result.title).toBe('Hello');
      expect(result.body).toBe('World');
      expect(result.source).toBe('tool');
      expect(result.readAt).toBeNull();
      expect(result.tts).toBe(false);
      expect(result.sessionId).toBeNull();

      expect(ctx.sessionHub.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'created',
            notification: expect.objectContaining({ title: 'Hello' }),
          }),
        }),
      );
    });

    it('resolves session title when sessionId is provided', async () => {
      const ctx = createMockCtx({
        sessionIndex: {
          getSession: vi.fn().mockResolvedValue({
            name: 'My Session',
            lastSnippet: 'snippet',
          }),
        },
      });

      const result = (await plugin.operations!.create(
        { title: 'T', body: 'B', sessionId: 'sess-1' },
        ctx,
      )) as any;

      expect(result.sessionId).toBe('sess-1');
      expect(result.sessionTitle).toBe('My Session');
    });

    it('falls back to sessionId when session not found', async () => {
      const ctx = createMockCtx();

      const result = (await plugin.operations!.create(
        { title: 'T', body: 'B', sessionId: 'unknown-session' },
        ctx,
      )) as any;

      expect(result.sessionTitle).toBe('unknown-session');
    });

    it('respects tts flag', async () => {
      const ctx = createMockCtx();
      const result = (await plugin.operations!.create(
        { title: 'T', body: 'B', tts: true },
        ctx,
      )) as any;

      expect(result.tts).toBe(true);
    });

    it('accepts source parameter', async () => {
      const ctx = createMockCtx();
      const result = (await plugin.operations!.create(
        { title: 'T', body: 'B', source: 'http' },
        ctx,
      )) as any;

      expect(result.source).toBe('http');
    });

    it('rejects invalid source', async () => {
      const ctx = createMockCtx();
      const result = (await plugin.operations!.create(
        { title: 'T', body: 'B', source: 'invalid' },
        ctx,
      )) as any;

      expect(result.source).toBe('tool');
    });
  });

  describe('list operation', () => {
    it('lists notifications newest-first', async () => {
      const ctx = createMockCtx();
      await plugin.operations!.create({ title: 'First', body: 'B' }, ctx);
      await plugin.operations!.create({ title: 'Second', body: 'B' }, ctx);

      const result = (await plugin.operations!.list({}, ctx)) as any;

      expect(result.total).toBe(2);
      expect(result.notifications[0].title).toBe('Second');
      expect(result.notifications[1].title).toBe('First');
    });

    it('supports unreadOnly filter', async () => {
      const ctx = createMockCtx();
      const n1 = (await plugin.operations!.create({ title: 'A', body: 'B' }, ctx)) as any;
      await plugin.operations!.create({ title: 'B', body: 'B' }, ctx);
      await plugin.operations!.toggle_read({ id: n1.id }, ctx);

      const result = (await plugin.operations!.list({ unreadOnly: true }, ctx)) as any;

      expect(result.total).toBe(1);
      expect(result.notifications[0].title).toBe('B');
    });
  });

  describe('get operation', () => {
    it('gets a notification by id', async () => {
      const ctx = createMockCtx();
      const created = (await plugin.operations!.create(
        { title: 'Find Me', body: 'B' },
        ctx,
      )) as any;

      const result = (await plugin.operations!.get({ id: created.id }, ctx)) as any;

      expect(result.title).toBe('Find Me');
    });

    it('throws for unknown id', async () => {
      const ctx = createMockCtx();

      await expect(
        plugin.operations!.get({ id: 'nonexistent' }, ctx),
      ).rejects.toThrow('Notification not found');
    });
  });

  describe('toggle_read operation', () => {
    it('toggles read state and broadcasts', async () => {
      const ctx = createMockCtx();
      const created = (await plugin.operations!.create(
        { title: 'Toggle', body: 'B' },
        ctx,
      )) as any;
      ctx.sessionHub.broadcastToAll.mockClear();

      const toggled = (await plugin.operations!.toggle_read(
        { id: created.id },
        ctx,
      )) as any;

      expect(toggled.readAt).not.toBeNull();

      expect(ctx.sessionHub.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'updated',
          }),
        }),
      );
    });
  });

  describe('mark_all_read operation', () => {
    it('marks all read and broadcasts snapshot', async () => {
      const ctx = createMockCtx();
      await plugin.operations!.create({ title: 'A', body: 'B' }, ctx);
      await plugin.operations!.create({ title: 'B', body: 'B' }, ctx);
      ctx.sessionHub.broadcastToAll.mockClear();

      const result = (await plugin.operations!.mark_all_read({}, ctx)) as any;

      expect(result.marked).toBe(2);

      expect(ctx.sessionHub.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'snapshot',
          }),
        }),
      );
    });
  });

  describe('clear operation', () => {
    it('removes a notification and broadcasts', async () => {
      const ctx = createMockCtx();
      const created = (await plugin.operations!.create(
        { title: 'Clear Me', body: 'B' },
        ctx,
      )) as any;
      ctx.sessionHub.broadcastToAll.mockClear();

      const result = (await plugin.operations!.clear({ id: created.id }, ctx)) as any;

      expect(result.ok).toBe(true);

      expect(ctx.sessionHub.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'removed',
            id: created.id,
          }),
        }),
      );
    });

    it('throws for unknown id', async () => {
      const ctx = createMockCtx();

      await expect(
        plugin.operations!.clear({ id: 'nonexistent' }, ctx),
      ).rejects.toThrow('Notification not found');
    });
  });

  describe('clear_all operation', () => {
    it('removes all notifications and broadcasts empty snapshot', async () => {
      const ctx = createMockCtx();
      await plugin.operations!.create({ title: 'A', body: 'B' }, ctx);
      await plugin.operations!.create({ title: 'B', body: 'B' }, ctx);
      ctx.sessionHub.broadcastToAll.mockClear();

      const result = (await plugin.operations!.clear_all({}, ctx)) as any;

      expect(result.cleared).toBe(2);

      expect(ctx.sessionHub.broadcastToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'snapshot',
            notifications: [],
          }),
        }),
      );
    });
  });

  describe('panelEventHandler', () => {
    it('responds to request_snapshot', async () => {
      const ctx = createMockCtx();
      await plugin.operations!.create({ title: 'Test', body: 'B' }, ctx);

      const sendToClient = vi.fn();
      const handler = plugin.panelEventHandlers!.notifications;

      await handler(
        { panelId: 'p1', panelType: 'notifications', payload: { type: 'request_snapshot' } } as any,
        {
          sessionId: null,
          panelId: 'p1',
          panelType: 'notifications',
          connectionId: 'c1',
          connection: {} as any,
          sessionHub: ctx.sessionHub,
          sessionIndex: ctx.sessionIndex,
          sendToClient,
          sendToSession: vi.fn(),
          sendToAll: vi.fn(),
        } as any,
      );

      expect(sendToClient).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'snapshot',
            notifications: expect.arrayContaining([
              expect.objectContaining({ title: 'Test' }),
            ]),
          }),
        }),
      );
    });

    it('handles toggle_read via panel event', async () => {
      const ctx = createMockCtx();
      const created = (await plugin.operations!.create(
        { title: 'Toggle', body: 'B' },
        ctx,
      )) as any;

      const handler = plugin.panelEventHandlers!.notifications;
      const sendToAll = vi.fn();

      await handler(
        {
          panelId: 'p1',
          panelType: 'notifications',
          payload: { type: 'toggle_read', id: created.id },
        } as any,
        {
          sessionId: null,
          panelId: 'p1',
          panelType: 'notifications',
          connectionId: 'c1',
          connection: {} as any,
          sessionHub: ctx.sessionHub,
          sessionIndex: ctx.sessionIndex,
          sendToClient: vi.fn(),
          sendToSession: vi.fn(),
          sendToAll,
        } as any,
      );

      expect(sendToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panel_event',
          panelType: 'notifications',
          payload: expect.objectContaining({
            type: 'notification_update',
            event: 'updated',
            notification: expect.objectContaining({
              id: created.id,
              readAt: expect.any(String),
            }),
          }),
        }),
      );
    });
  });
});
