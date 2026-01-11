import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { SessionIndex } from './index';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

describe('SessionIndex sticky session infrastructure', () => {
  it('creates sessions with agentId and persists it', async () => {
    const filePath = createTempFile('session-index-agent');
    const index = new SessionIndex(filePath);

    const summary = await index.createSession({ agentId: 'reading-list' });
    expect(summary.agentId).toBe('reading-list');

    const reloaded = new SessionIndex(filePath);
    const loadedSummary = await reloaded.getSession(summary.sessionId);
    expect(loadedSummary).toBeDefined();
    expect(loadedSummary?.agentId).toBe('reading-list');

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('"type":"session_created"');
    expect(content).toContain('"agentId":"reading-list"');
  });

  it('renames sessions with case-insensitive uniqueness and supports name removal', async () => {
    const filePath = createTempFile('session-index-rename');
    const index = new SessionIndex(filePath);

    const sessionA = await index.createSession({ agentId: 'general' });
    const sessionB = await index.createSession({ agentId: 'general' });

    const renamedA = await index.renameSession(sessionA.sessionId, 'My Session');
    expect(renamedA.name).toBe('My Session');

    const foundByName = await index.findSessionByName('my session');
    expect(foundByName).toBeDefined();
    expect(foundByName?.sessionId).toBe(sessionA.sessionId);

    await expect(index.renameSession(sessionB.sessionId, 'MY SESSION')).rejects.toThrow(
      /already in use/i,
    );

    const removedName = await index.renameSession(sessionA.sessionId, null);
    expect(removedName.name).toBeUndefined();

    const notFound = await index.findSessionByName('my session');
    expect(notFound).toBeUndefined();

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('"type":"session_renamed"');
    expect(content).toContain('"name":null');
  });

  it('allows reusing a name after the original session is deleted', async () => {
    const filePath = createTempFile('session-index-rename-reuse');
    const index = new SessionIndex(filePath);

    const sessionA = await index.createSession({ agentId: 'general' });
    const sessionB = await index.createSession({ agentId: 'general' });

    await index.renameSession(sessionA.sessionId, 'Reusable Name');
    await index.markSessionDeleted(sessionA.sessionId);

    const renamedB = await index.renameSession(sessionB.sessionId, 'reusable name');
    expect(renamedB.name).toBe('reusable name');
  });

  it('clears a session while preserving metadata', async () => {
    const filePath = createTempFile('session-index-clear');
    const index = new SessionIndex(filePath);

    const created = await index.createSession({ agentId: 'reading-list' });
    const renamed = await index.renameSession(created.sessionId, 'My Agent Session');
    await index.markSessionActivity(renamed.sessionId, 'Recent snippet');

    const beforeClear = await index.getSession(renamed.sessionId);
    expect(beforeClear).toBeDefined();
    expect(beforeClear?.agentId).toBe('reading-list');
    expect(beforeClear?.name).toBe('My Agent Session');
    expect(beforeClear?.lastSnippet).toBe('Recent snippet');

    const cleared = await index.clearSession(renamed.sessionId);
    expect(cleared.sessionId).toBe(renamed.sessionId);
    expect(cleared.agentId).toBe('reading-list');
    expect(cleared.name).toBe('My Agent Session');
    expect(cleared.createdAt).toBe(created.createdAt);
    expect(cleared.lastSnippet).toBeUndefined();

    const reloaded = new SessionIndex(filePath);
    const reloadedSummary = await reloaded.getSession(renamed.sessionId);
    expect(reloadedSummary).toBeDefined();
    expect(reloadedSummary?.agentId).toBe('reading-list');
    expect(reloadedSummary?.name).toBe('My Agent Session');
    expect(reloadedSummary?.lastSnippet).toBeUndefined();

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('"type":"session_cleared"');
  });

  it('throws when clearing a non-existent or deleted session', async () => {
    const filePath = createTempFile('session-index-clear-errors');
    const index = new SessionIndex(filePath);

    await expect(index.clearSession('missing-session')).rejects.toThrow(/Session not found/i);

    const session = await index.createSession({ agentId: 'general' });
    await index.markSessionDeleted(session.sessionId);

    await expect(index.clearSession(session.sessionId)).rejects.toThrow(/Session not found/i);
  });

  it('touchSession updates updatedAt without changing snippet', async () => {
    const filePath = createTempFile('session-index-touch');
    const index = new SessionIndex(filePath);

    const created = await index.createSession({ agentId: 'general' });
    await index.markSessionActivity(created.sessionId, 'Original snippet');

    const beforeTouch = await index.getSession(created.sessionId);
    expect(beforeTouch).toBeDefined();
    const beforeUpdatedAt = beforeTouch?.updatedAt;
    expect(beforeUpdatedAt).toBeDefined();

    // Ensure a measurable time difference so updatedAt is strictly newer
    await new Promise((resolve) => setTimeout(resolve, 5));

    const touched = await index.touchSession(created.sessionId);
    expect(touched).toBeDefined();
    expect(touched?.lastSnippet).toBe('Original snippet');
    if (!touched || !beforeUpdatedAt) {
      throw new Error('Expected non-null touched summary and updatedAt');
    }
    expect(new Date(touched.updatedAt).getTime()).toBeGreaterThan(
      new Date(beforeUpdatedAt).getTime(),
    );

    const reloaded = new SessionIndex(filePath);
    const reloadedSummary = await reloaded.getSession(created.sessionId);
    expect(reloadedSummary).toBeDefined();
    expect(reloadedSummary?.lastSnippet).toBe('Original snippet');
    expect(reloadedSummary?.updatedAt).toBe(touched?.updatedAt);
  });

  it('touchSession returns undefined for missing or deleted sessions', async () => {
    const filePath = createTempFile('session-index-touch-missing');
    const index = new SessionIndex(filePath);

    const missing = await index.touchSession('missing-session');
    expect(missing).toBeUndefined();

    const created = await index.createSession({ agentId: 'general' });
    await index.markSessionDeleted(created.sessionId);

    const deleted = await index.touchSession(created.sessionId);
    expect(deleted).toBeUndefined();
  });

  it('pinSession sets and clears pinnedAt while preserving other fields', async () => {
    const filePath = createTempFile('session-index-pin');
    const index = new SessionIndex(filePath);

    const created = await index.createSession({ agentId: 'reading-list' });
    const renamed = await index.renameSession(created.sessionId, 'My Pinned Session');

    const pinTimestamp = new Date().toISOString();
    const pinned = await index.pinSession(renamed.sessionId, pinTimestamp);
    expect(pinned).toBeDefined();
    expect(pinned?.pinnedAt).toBe(pinTimestamp);
    expect(pinned?.agentId).toBe('reading-list');
    expect(pinned?.name).toBe('My Pinned Session');

    const reloaded = new SessionIndex(filePath);
    const reloadedPinned = await reloaded.getSession(renamed.sessionId);
    expect(reloadedPinned).toBeDefined();
    expect(reloadedPinned?.pinnedAt).toBe(pinTimestamp);

    const unpinned = await index.pinSession(renamed.sessionId, null);
    expect(unpinned).toBeDefined();
    expect(unpinned?.pinnedAt).toBeUndefined();

    const reloadedAfterUnpin = new SessionIndex(filePath);
    const reloadedUnpinned = await reloadedAfterUnpin.getSession(renamed.sessionId);
    expect(reloadedUnpinned).toBeDefined();
    expect(reloadedUnpinned?.pinnedAt).toBeUndefined();

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('"type":"session_pinned"');
  });

  it('updates session attributes with deep merge and persists patches', async () => {
    const filePath = createTempFile('session-index-attributes');
    const index = new SessionIndex(filePath);

    const created = await index.createSession({ agentId: 'general' });
    const updated = await index.updateSessionAttributes(created.sessionId, {
      core: { workingDir: '/tmp/session-a' },
      ui: { activePanelId: 'lists-1' },
    });

    expect(updated?.attributes).toEqual({
      core: { workingDir: '/tmp/session-a' },
      ui: { activePanelId: 'lists-1' },
    });

    const patched = await index.updateSessionAttributes(created.sessionId, {
      core: { activeBranch: 'main' },
      ui: { activePanelId: 'notes-1' },
    });

    expect(patched?.attributes).toEqual({
      core: { workingDir: '/tmp/session-a', activeBranch: 'main' },
      ui: { activePanelId: 'notes-1' },
    });

    const cleared = await index.updateSessionAttributes(created.sessionId, {
      ui: null,
    });

    expect(cleared?.attributes).toEqual({
      core: { workingDir: '/tmp/session-a', activeBranch: 'main' },
    });

    const reloaded = new SessionIndex(filePath);
    const loadedSummary = await reloaded.getSession(created.sessionId);
    expect(loadedSummary?.attributes).toEqual({
      core: { workingDir: '/tmp/session-a', activeBranch: 'main' },
    });

    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('"type":"session_attributes_patch"');
  });

  it('rejects invalid core attribute patches', async () => {
    const filePath = createTempFile('session-index-attributes-invalid');
    const index = new SessionIndex(filePath);

    const created = await index.createSession({ agentId: 'general' });

    await expect(
      index.updateSessionAttributes(created.sessionId, {
        core: { workingDir: 'relative/path' },
      }),
    ).rejects.toThrow(/absolute path/i);

    await expect(
      index.updateSessionAttributes(created.sessionId, {
        core: { activeBranch: 123 },
      }),
    ).rejects.toThrow(/core\.activeBranch/i);

    await expect(
      index.updateSessionAttributes(created.sessionId, {
        core: 'invalid',
      }),
    ).rejects.toThrow(/core attributes/i);
  });
});

describe('SessionIndex findSessionForAgent', () => {
  it('returns undefined when no sessions exist for agent', async () => {
    const filePath = createTempFile('session-index-find-agent-empty');
    const index = new SessionIndex(filePath);

    const result = await index.findSessionForAgent('reading-list');
    expect(result).toBeUndefined();
  });

  it('returns the most recently updated non-deleted session for an agent', async () => {
    const filePath = createTempFile('session-index-find-agent-latest');
    const index = new SessionIndex(filePath);

    const first = await index.createSession({ agentId: 'reading-list' });
    const second = await index.createSession({ agentId: 'reading-list' });

    // Make the first session the most recently updated
    await index.markSessionActivity(first.sessionId, 'Most recent activity');

    const result = await index.findSessionForAgent('reading-list');
    expect(result).toBeDefined();
    expect(result?.sessionId).toBe(first.sessionId);
    expect(result?.sessionId).not.toBe(second.sessionId);
  });

  it('ignores deleted sessions when selecting most recent', async () => {
    const filePath = createTempFile('session-index-find-agent-deleted');
    const index = new SessionIndex(filePath);

    const first = await index.createSession({ agentId: 'reading-list' });
    const second = await index.createSession({ agentId: 'reading-list' });

    await index.markSessionDeleted(second.sessionId);

    const result = await index.findSessionForAgent('reading-list');
    expect(result).toBeDefined();
    expect(result?.sessionId).toBe(first.sessionId);
  });
});
