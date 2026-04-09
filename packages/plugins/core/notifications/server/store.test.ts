import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NotificationsStore } from './store';

describe('NotificationsStore', () => {
  let tempDir: string;
  let store: NotificationsStore;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `notifications-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    store = new NotificationsStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('inserts and lists notifications newest-first', async () => {
    const n1 = await store.insert({ title: 'First', body: 'Body 1' }, 'tool');
    const n2 = await store.insert({ title: 'Second', body: 'Body 2' }, 'http');

    const { notifications, total } = await store.list();
    expect(total).toBe(2);
    expect(notifications).toHaveLength(2);
    // Newest first
    expect(notifications[0].id).toBe(n2.id);
    expect(notifications[1].id).toBe(n1.id);
  });

  it('inserts with optional fields', async () => {
    const n = await store.insert(
      {
        kind: 'notification',
        title: 'With Session',
        body: 'Body',
        sessionId: 'sess-1',
        sessionTitle: 'My Session',
        tts: true,
        voiceMode: 'speak',
        ttsText: 'Speak me',
        sourceEventId: 'event-1',
        sessionActivitySeq: 7,
      },
      'cli',
    );

    expect(n.kind).toBe('notification');
    expect(n.sessionId).toBe('sess-1');
    expect(n.sessionTitle).toBe('My Session');
    expect(n.tts).toBe(true);
    expect(n.voiceMode).toBe('speak');
    expect(n.ttsText).toBe('Speak me');
    expect(n.sourceEventId).toBe('event-1');
    expect(n.sessionActivitySeq).toBe(7);
    expect(n.source).toBe('cli');
    expect(n.readAt).toBeNull();
  });

  it('defaults optional fields to null/false', async () => {
    const n = await store.insert({ title: 'Basic', body: 'Body' }, 'tool');

    expect(n.kind).toBe('notification');
    expect(n.sessionId).toBeNull();
    expect(n.sessionTitle).toBeNull();
    expect(n.tts).toBe(false);
    expect(n.voiceMode).toBe('none');
    expect(n.ttsText).toBeNull();
    expect(n.sourceEventId).toBeNull();
    expect(n.sessionActivitySeq).toBeNull();
  });

  it('upserts singleton session attention by session', async () => {
    const first = await store.upsertSessionAttention(
      {
        title: 'Reply 1',
        body: 'First answer',
        sessionId: 'sess-1',
        sessionTitle: 'Session 1',
        tts: true,
        voiceMode: 'speak_then_listen',
        ttsText: 'First answer',
        sourceEventId: 'response-1',
        sessionActivitySeq: 4,
      },
      'system',
    );
    const second = await store.upsertSessionAttention(
      {
        title: 'Reply 2',
        body: 'Second answer',
        sessionId: 'sess-1',
        sessionTitle: 'Session 1',
        tts: true,
        voiceMode: 'speak_then_listen',
        ttsText: 'Second answer',
        sourceEventId: 'response-2',
        sessionActivitySeq: 5,
      },
      'system',
    );

    const { notifications, total } = await store.list();
    expect(total).toBe(1);
    expect(notifications[0]?.id).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(notifications[0]).toMatchObject({
      kind: 'session_attention',
      title: 'Reply 2',
      source: 'system',
      sourceEventId: 'response-2',
      sessionActivitySeq: 5,
    });
  });

  it('serializes concurrent session attention upserts for the same session', async () => {
    const [first, second] = await Promise.all([
      store.upsertSessionAttentionWithRevision(
        {
          title: 'Reply 1',
          body: 'First answer',
          sessionId: 'sess-1',
        },
        'system',
      ),
      store.upsertSessionAttentionWithRevision(
        {
          title: 'Reply 2',
          body: 'Second answer',
          sessionId: 'sess-1',
        },
        'system',
      ),
    ]);

    const { notifications, total } = await store.list();
    expect(total).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(first.value.id).toBe(second.value.id);
    expect([first.revision, second.revision].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(['Reply 1', 'Reply 2']).toContain(notifications[0]?.title);
  });

  it('preserves an existing sessionTitle when a later upsert omits it', async () => {
    const first = await store.upsertSessionAttentionWithRevision(
      {
        title: 'Reply 1',
        body: 'First answer',
        sessionId: 'sess-1',
        sessionTitle: 'Assistant',
      },
      'system',
    );

    const second = await store.upsertSessionAttentionWithRevision(
      {
        title: 'Reply 2',
        body: 'Second answer',
        sessionId: 'sess-1',
      },
      'system',
    );

    expect(second.value.id).toBe(first.value.id);
    expect(second.value.sessionTitle).toBe('Assistant');
  });

  it('removes session attention by session id', async () => {
    await store.upsertSessionAttention(
      {
        title: 'Reply',
        body: 'Answer',
        sessionId: 'sess-1',
      },
      'system',
    );

    const removed = await store.removeSessionAttention('sess-1');

    expect(removed?.kind).toBe('session_attention');
    expect((await store.list()).total).toBe(0);
  });

  it('gets a notification by id', async () => {
    const n = await store.insert({ title: 'Find Me', body: 'Body' }, 'tool');

    const found = await store.get(n.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Find Me');
  });

  it('returns null for unknown id', async () => {
    const found = await store.get('nonexistent');
    expect(found).toBeNull();
  });

  it('toggles read/unread state', async () => {
    const n = await store.insert({ title: 'Toggle Me', body: 'Body' }, 'tool');
    expect(n.readAt).toBeNull();

    const toggled = await store.toggleRead(n.id);
    expect(toggled).not.toBeNull();
    expect(toggled!.readAt).not.toBeNull();

    const toggledBack = await store.toggleRead(n.id);
    expect(toggledBack).not.toBeNull();
    expect(toggledBack!.readAt).toBeNull();
  });

  it('toggleRead returns null for unknown id', async () => {
    const result = await store.toggleRead('nonexistent');
    expect(result).toBeNull();
  });

  it('marks all notifications read', async () => {
    await store.insert({ title: 'A', body: 'Body' }, 'tool');
    await store.insert({ title: 'B', body: 'Body' }, 'tool');

    const count = await store.markAllRead();
    expect(count).toBe(2);

    const { notifications } = await store.list();
    for (const n of notifications) {
      expect(n.readAt).not.toBeNull();
    }

    // Calling again should return 0
    const count2 = await store.markAllRead();
    expect(count2).toBe(0);
  });

  it('removes a notification', async () => {
    const n = await store.insert({ title: 'Remove Me', body: 'Body' }, 'tool');

    const removed = await store.remove(n.id);
    expect(removed).toBe(true);

    const { total } = await store.list();
    expect(total).toBe(0);
  });

  it('remove returns false for unknown id', async () => {
    const result = await store.remove('nonexistent');
    expect(result).toBe(false);
  });

  it('removes all notifications', async () => {
    await store.insert({ title: 'A', body: 'Body' }, 'tool');
    await store.insert({ title: 'B', body: 'Body' }, 'tool');

    const count = await store.removeAll();
    expect(count).toBe(2);

    const { total } = await store.list();
    expect(total).toBe(0);

    // Calling again should return 0
    const count2 = await store.removeAll();
    expect(count2).toBe(0);
  });

  it('returns atomic revisions from mutation helpers', async () => {
    const inserted = await store.insertWithRevision({ title: 'A', body: 'Body' }, 'tool');
    expect(inserted.revision).toBe(1);

    const toggled = await store.toggleReadWithRevision(inserted.value.id);
    expect(toggled?.revision).toBe(2);

    const marked = await store.markAllReadSnapshot();
    expect(marked.revision).toBe(2);

    const removed = await store.removeWithRevision(inserted.value.id);
    expect(removed?.revision).toBe(3);

    const cleared = await store.removeAllSnapshot();
    expect(cleared.revision).toBe(3);
  });

  it('filters by unreadOnly', async () => {
    const n1 = await store.insert({ title: 'Read', body: 'Body' }, 'tool');
    await store.insert({ title: 'Unread', body: 'Body' }, 'tool');
    await store.toggleRead(n1.id);

    const { notifications, total } = await store.list({ unreadOnly: true });
    expect(total).toBe(1);
    expect(notifications[0].title).toBe('Unread');
  });

  it('supports limit and offset', async () => {
    await store.insert({ title: 'A', body: 'Body' }, 'tool');
    await store.insert({ title: 'B', body: 'Body' }, 'tool');
    await store.insert({ title: 'C', body: 'Body' }, 'tool');

    const { notifications, total } = await store.list({ limit: 1, offset: 1 });
    expect(total).toBe(3);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('B');
  });

  it('computes unread count', async () => {
    await store.insert({ title: 'A', body: 'Body' }, 'tool');
    const n2 = await store.insert({ title: 'B', body: 'Body' }, 'tool');

    expect(await store.unreadCount()).toBe(2);

    await store.toggleRead(n2.id);
    expect(await store.unreadCount()).toBe(1);
  });

  it('persists data across instances', async () => {
    await store.insert({ title: 'Persisted', body: 'Body' }, 'tool');

    // Create a new store instance pointing to same dir
    const store2 = new NotificationsStore(tempDir);
    const { notifications } = await store2.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Persisted');
  });

  it('prunes oldest read notifications when cap is exceeded', async () => {
    const smallStore = new NotificationsStore(tempDir, 3);

    // Insert 3 notifications and read the first two
    const n1 = await smallStore.insert({ title: 'N1', body: 'Body' }, 'tool');
    const n2 = await smallStore.insert({ title: 'N2', body: 'Body' }, 'tool');
    await smallStore.insert({ title: 'N3', body: 'Body' }, 'tool');

    await smallStore.toggleRead(n1.id);
    await smallStore.toggleRead(n2.id);

    // Insert a 4th — should prune the oldest read (N1)
    await smallStore.insert({ title: 'N4', body: 'Body' }, 'tool');

    const { notifications, total } = await smallStore.list();
    expect(total).toBe(3);
    const titles = notifications.map((n) => n.title);
    expect(titles).toContain('N4');
    expect(titles).toContain('N3');
    expect(titles).toContain('N2');
    expect(titles).not.toContain('N1');
  });

  it('prune keeps unread notifications even when over cap', async () => {
    const smallStore = new NotificationsStore(tempDir, 2);

    // Insert 3 unread notifications — all should survive since none are read
    await smallStore.insert({ title: 'U1', body: 'Body' }, 'tool');
    await smallStore.insert({ title: 'U2', body: 'Body' }, 'tool');
    await smallStore.insert({ title: 'U3', body: 'Body' }, 'tool');

    const { notifications } = await smallStore.list();
    expect(notifications).toHaveLength(3);
  });

  it('writes valid JSON to disk', async () => {
    await store.insert({ title: 'Check', body: 'Body' }, 'tool');

    const raw = await readFile(path.join(tempDir, 'notifications.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.notifications).toHaveLength(1);
    expect(parsed.notifications[0].title).toBe('Check');
    expect(parsed.notifications[0].kind).toBe('notification');
  });

  it('increments revision on each mutation', async () => {
    expect(store.revision).toBe(0);

    await store.insert({ title: 'A', body: 'B' }, 'tool');
    expect(store.revision).toBe(1);

    await store.insert({ title: 'B', body: 'B' }, 'tool');
    expect(store.revision).toBe(2);

    // markAllRead with unread items bumps revision
    await store.markAllRead();
    expect(store.revision).toBe(3);

    const { notifications } = await store.list();
    await store.remove(notifications[0].id);
    expect(store.revision).toBe(4);

    await store.insert({ title: 'C', body: 'D' }, 'tool');
    await store.removeAll();
    expect(store.revision).toBe(6);
  });

  it('does not increment revision for no-op markAllRead', async () => {
    // No notifications to mark
    await store.markAllRead();
    expect(store.revision).toBe(0);
  });

  it('serializes concurrent writes without data loss', async () => {
    // Fire multiple inserts concurrently
    const results = await Promise.all([
      store.insert({ title: 'A', body: 'B' }, 'tool'),
      store.insert({ title: 'B', body: 'B' }, 'tool'),
      store.insert({ title: 'C', body: 'B' }, 'tool'),
    ]);

    expect(results).toHaveLength(3);
    const { notifications } = await store.list();
    expect(notifications).toHaveLength(3);

    // Verify persisted data matches by reloading from disk
    const store2 = new NotificationsStore(tempDir);
    const { notifications: reloaded } = await store2.list();
    expect(reloaded).toHaveLength(3);
  });
});
