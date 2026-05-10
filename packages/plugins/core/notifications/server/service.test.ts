import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('notifications service', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('shares initialized store across isolated module instances', async () => {
    const tempDir = path.join(
      os.tmpdir(),
      `notifications-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });

    try {
      const sourceA =
        (await import('./service?instance=source-a')) as typeof import('./service');
      const sourceB =
        (await import('./service?instance=source-b')) as typeof import('./service');

      sourceA.initializeNotificationsService(tempDir);
      await sourceB.createNotificationRecord({
        input: {
          kind: 'session_attention',
          title: 'Latest assistant reply',
          body: 'Final answer',
          sessionId: 'sess-1',
          tts: true,
          voiceMode: 'speak_then_listen',
          ttsText: 'Final answer',
          sourceEventId: 'response-1',
        },
        source: 'system',
      });

      const { notifications, total } = await sourceA.getNotificationsStore().list();
      expect(total).toBe(1);
      expect(notifications[0]).toMatchObject({
        kind: 'session_attention',
        sessionId: 'sess-1',
        sourceEventId: 'response-1',
      });

      sourceB.shutdownNotificationsService();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
