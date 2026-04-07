import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SessionIndex } from './sessionIndex';
import {
  clearReplyAttentionNotification,
  publishFinalResponseNotification,
} from './notificationProducers';
import {
  getNotificationsStore,
  initializeNotificationsService,
  shutdownNotificationsService,
} from '../../plugins/core/notifications/server/service';

describe('notification producers', () => {
  let tempDir: string;
  let sessionIndex: SessionIndex;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `notification-producers-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    initializeNotificationsService(tempDir);
    sessionIndex = new SessionIndex(path.join(tempDir, 'sessions.json'));
    await sessionIndex.createSession({ agentId: 'agent-1', sessionId: 'sess-1', name: 'Demo session' });
  });

  afterEach(async () => {
    shutdownNotificationsService();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('publishes final responses as session attention singleton notifications', async () => {
    const sessionHub = {
      broadcastToAll: vi.fn(),
    } as any;

    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      sessionHub,
      sessionIndex,
      summary: { revision: 6 } as any,
    });

    const { notifications } = await getNotificationsStore().list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: 'session_attention',
      title: 'Latest assistant reply',
      body: 'Final answer',
      source: 'system',
      voiceMode: 'speak_then_listen',
      sourceEventId: 'response-1',
      sessionActivitySeq: 6,
      sessionTitle: 'Demo session',
    });
    expect(sessionHub.broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'upserted',
        }),
      }),
    );
  });

  it('clears session attention notifications on reply acceptance', async () => {
    const sessionHub = {
      broadcastToAll: vi.fn(),
    } as any;

    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      sessionHub,
      sessionIndex,
      summary: { revision: 2 } as any,
    });
    sessionHub.broadcastToAll.mockClear();

    await clearReplyAttentionNotification({
      sessionId: 'sess-1',
      sessionHub,
    });

    expect((await getNotificationsStore().list()).total).toBe(0);
    expect(sessionHub.broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'removed',
          id: expect.any(String),
        }),
      }),
    );
  });
});
