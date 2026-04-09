import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SessionIndex } from './sessionIndex';
import { publishFinalResponseNotification } from './notificationProducers';
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

  it('uses summary revision for sessionActivitySeq even without sessionIndex', async () => {
    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      summary: { revision: 8 } as any,
    });

    const { notifications } = await getNotificationsStore().list();
    expect(notifications[0]?.sessionActivitySeq).toBe(8);
  });

  it('uses post-activity revision so stale-ask validation sees the current seq', async () => {
    // Simulates the call-site pattern: recordSessionActivity bumps revision,
    // then publishFinalResponseNotification receives the post-bump summary.
    const preBumpRevision = 103;
    const postBumpRevision = 104;

    // Simulate what recordSessionActivity returns after bumping.
    const postActivitySummary = { revision: postBumpRevision } as any;

    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      summary: postActivitySummary,
    });

    const { notifications } = await getNotificationsStore().list();
    expect(notifications[0]?.sessionActivitySeq).toBe(postBumpRevision);
    expect(notifications[0]?.sessionActivitySeq).not.toBe(preBumpRevision);
  });

  it('resolves sessionTitle from sessionHub when sessionIndex is omitted', async () => {
    const sessionHub = {
      broadcastToAll: vi.fn(),
      getSessionIndex: () => sessionIndex,
    } as any;

    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      sessionHub,
      summary: { revision: 5 } as any,
    });

    const { notifications } = await getNotificationsStore().list();
    expect(notifications[0]?.sessionTitle).toBe('Demo session');
  });

  it('warns when notification publishing fails', async () => {
    shutdownNotificationsService();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await publishFinalResponseNotification({
      sessionId: 'sess-1',
      responseId: 'response-1',
      text: 'Final answer',
      summary: { revision: 5 } as any,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[notifications] failed to publish final response notification',
      expect.objectContaining({
        sessionId: 'sess-1',
        responseId: 'response-1',
        error: expect.anything(),
      }),
    );

    warnSpy.mockRestore();
  });
});
