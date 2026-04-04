// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { PanelEventEnvelope, PanelTypeManifest, SessionContext } from '@assistant/shared';

import { PanelRegistry } from './panelRegistry';
import { PanelHostController } from './panelHostController';

describe('PanelHostController', () => {
  it('merges metadata updates for a panel', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = { type: 'meta-panel', title: 'Meta Panel' };
    registry.register(manifest, () => ({
      mount() {
        return { unmount() {} };
      },
    }));

    let metadata: Record<string, unknown> | null = null;
    const hostController = new PanelHostController({
      registry,
      onPanelMetadataChange: (_panelId, meta) => {
        metadata = meta;
      },
    });

    hostController.mountPanel({
      panelId: 'meta-1',
      panelType: manifest.type,
      container: document.createElement('div'),
    });

    hostController.setPanelMetadata('meta-1', { status: 'busy', badge: '1' });
    expect(metadata).toEqual({ status: 'busy', badge: '1' });

    hostController.setPanelMetadata('meta-1', { status: 'idle' });
    expect(metadata).toEqual({ status: 'idle', badge: '1' });
  });

  it('dispatches panel events to the mounted panel handle', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = { type: 'event-panel', title: 'Event Panel' };
    let received: PanelEventEnvelope | null = null;
    registry.register(manifest, () => ({
      mount() {
        return {
          onEvent: (event) => {
            received = event;
          },
          unmount() {},
        };
      },
    }));

    const hostController = new PanelHostController({
      registry,
    });

    hostController.mountPanel({
      panelId: 'event-1',
      panelType: manifest.type,
      container: document.createElement('div'),
    });

    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: 'event-1',
      panelType: 'event-panel',
      payload: { ok: true },
    };
    hostController.dispatchPanelEvent(event);

    expect(received).toEqual(event);
  });

  it('dispatches wildcard panel events to all matching panel types', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = { type: 'event-panel', title: 'Event Panel' };
    const otherManifest: PanelTypeManifest = { type: 'other-panel', title: 'Other Panel' };
    const received: PanelEventEnvelope[] = [];
    const otherReceived: PanelEventEnvelope[] = [];

    registry.register(manifest, () => ({
      mount() {
        return {
          onEvent: (event) => {
            received.push(event);
          },
          unmount() {},
        };
      },
    }));
    registry.register(otherManifest, () => ({
      mount() {
        return {
          onEvent: (event) => {
            otherReceived.push(event);
          },
          unmount() {},
        };
      },
    }));

    const hostController = new PanelHostController({
      registry,
    });

    hostController.mountPanel({
      panelId: 'event-1',
      panelType: manifest.type,
      container: document.createElement('div'),
    });
    hostController.mountPanel({
      panelId: 'other-1',
      panelType: otherManifest.type,
      container: document.createElement('div'),
    });

    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: '*',
      panelType: 'event-panel',
      payload: { ok: true },
    };
    hostController.dispatchPanelEvent(event);

    expect(received).toEqual([event]);
    expect(otherReceived).toEqual([]);
  });

  it('filters wildcard panel events by session binding', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = {
      type: 'chat',
      title: 'Chat Panel',
      defaultSessionBinding: 'fixed',
    };
    const receivedByPanel = new Map<string, PanelEventEnvelope[]>();

    registry.register(manifest, () => ({
      mount(_container, host) {
        const panelId = host.panelId();
        receivedByPanel.set(panelId, []);
        return {
          onEvent: (event) => {
            receivedByPanel.get(panelId)?.push(event);
          },
          unmount() {},
        };
      },
    }));

    const hostController = new PanelHostController({
      registry,
    });

    hostController.mountPanel({
      panelId: 'event-a',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-a' },
    });
    hostController.mountPanel({
      panelId: 'event-b',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-b' },
    });
    hostController.mountPanel({
      panelId: 'event-unbound',
      panelType: manifest.type,
      container: document.createElement('div'),
    });

    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: '*',
      panelType: manifest.type,
      sessionId: 'session-a',
      payload: { ok: true },
    };
    hostController.dispatchPanelEvent(event);

    expect(receivedByPanel.get('event-a')).toEqual([event]);
    expect(receivedByPanel.get('event-b')).toEqual([]);
    expect(receivedByPanel.get('event-unbound')).toEqual([]);
  });

  it('broadcasts wildcard events to all panels when sessionId is "*"', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = { type: 'event-panel', title: 'Event Panel' };
    const receivedByPanel = new Map<string, PanelEventEnvelope[]>();

    registry.register(manifest, () => ({
      mount(_container, host) {
        const panelId = host.panelId();
        receivedByPanel.set(panelId, []);
        return {
          onEvent: (event) => {
            receivedByPanel.get(panelId)?.push(event);
          },
          unmount() {},
        };
      },
    }));

    const hostController = new PanelHostController({
      registry,
    });

    hostController.mountPanel({
      panelId: 'event-a',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-a' },
    });
    hostController.mountPanel({
      panelId: 'event-b',
      panelType: manifest.type,
      container: document.createElement('div'),
    });

    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: '*',
      panelType: manifest.type,
      sessionId: '*',
      payload: { ok: true },
    };
    hostController.dispatchPanelEvent(event);

    expect(receivedByPanel.get('event-a')).toEqual([event]);
    expect(receivedByPanel.get('event-b')).toEqual([event]);
  });

  it('delivers existing context values to new subscribers', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = { type: 'context-panel', title: 'Context Panel' };
    const values: unknown[] = [];

    registry.register(manifest, () => ({
      mount(_container, host) {
        host.setContext('panel.selection', { id: 'alpha' });
        host.subscribeContext('panel.selection', (value) => values.push(value));
        return { unmount() {} };
      },
    }));

    const hostController = new PanelHostController({
      registry,
    });

    hostController.mountPanel({
      panelId: 'context-1',
      panelType: manifest.type,
      container: document.createElement('div'),
    });

    expect(values).toEqual([{ id: 'alpha' }]);
  });

  it('sends panel events with the resolved session binding', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = {
      type: 'chat',
      title: 'Chat Panel',
      defaultSessionBinding: 'fixed',
    };

    registry.register(manifest, () => ({
      mount(_container, host) {
        host.sendEvent({ ok: true });
        return { unmount() {} };
      },
    }));

    const dispatched: PanelEventEnvelope[] = [];
    const hostController = new PanelHostController({
      registry,
      sendPanelEvent: (event) => dispatched.push(event),
    });

    hostController.mountPanel({
      panelId: 'send-1',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-a' },
    });

    expect(dispatched).toEqual([
      {
        type: 'panel_event',
        panelId: 'send-1',
        panelType: 'chat',
        payload: { ok: true },
        sessionId: 'session-a',
      },
      {
        type: 'panel_event',
        panelId: 'send-1',
        panelType: 'chat',
        payload: {
          type: 'panel_lifecycle',
          state: 'opened',
          binding: { mode: 'fixed', sessionId: 'session-a' },
        },
        sessionId: 'session-a',
      },
      {
        type: 'panel_event',
        panelId: 'send-1',
        panelType: 'chat',
        payload: {
          type: 'panel_session_changed',
          previousSessionId: null,
          sessionId: 'session-a',
        },
        sessionId: 'session-a',
      },
    ]);
  });

  it('allows explicit null session id for panel events', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = {
      type: 'chat',
      title: 'Chat Panel',
      defaultSessionBinding: 'fixed',
    };

    registry.register(manifest, () => ({
      mount(_container, host) {
        host.sendEvent({ ok: true }, { sessionId: null });
        return { unmount() {} };
      },
    }));

    const dispatched: PanelEventEnvelope[] = [];
    const hostController = new PanelHostController({
      registry,
      sendPanelEvent: (event) => dispatched.push(event),
    });

    hostController.mountPanel({
      panelId: 'send-2',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-a' },
    });

    const okEvent = dispatched.find((event) => {
      const payload = event.payload as { ok?: unknown } | null;
      return payload?.ok === true;
    });
    expect(okEvent).toBeTruthy();
    expect(okEvent?.sessionId).toBeUndefined();
  });

  it('provides session context and forwards attribute updates', async () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = {
      type: 'chat',
      title: 'Chat Panel',
      defaultSessionBinding: 'fixed',
    };
    let updatePromise: Promise<void> | null = null;
    const contexts: Array<SessionContext | null> = [];

    registry.register(manifest, () => ({
      mount(_container, host) {
        host.subscribeSessionContext((ctx) => {
          contexts.push(ctx);
          if (ctx?.sessionId === 'session-b') {
            updatePromise = host.updateSessionAttributes({ core: { activeBranch: 'main' } });
          }
        });
        return { unmount() {} };
      },
    }));

    const updates: Array<{ sessionId: string; patch: Record<string, unknown> }> = [];
    const hostController = new PanelHostController({
      registry,
      updateSessionAttributes: async (sessionId, patch) => {
        updates.push({ sessionId, patch });
      },
    });

    hostController.setContext('session.summaries', [
      { sessionId: 'session-a', attributes: { core: { workingDir: '/tmp/a' } } },
      { sessionId: 'session-b', attributes: { core: { workingDir: '/tmp/b' } } },
    ]);

    hostController.mountPanel({
      panelId: 'context-1',
      panelType: manifest.type,
      container: document.createElement('div'),
      binding: { mode: 'fixed', sessionId: 'session-a' },
    });

    hostController.setPanelBinding('context-1', { mode: 'fixed', sessionId: 'session-b' });

    const pendingUpdate = updatePromise;
    if (!pendingUpdate) {
      throw new Error('Expected updateSessionAttributes to be available');
    }
    await pendingUpdate;

    expect(contexts).toEqual([
      {
        sessionId: 'session-a',
        attributes: { core: { workingDir: '/tmp/a' } },
      },
      {
        sessionId: 'session-b',
        attributes: { core: { workingDir: '/tmp/b' } },
      },
    ]);
    expect(updates).toEqual([
      { sessionId: 'session-b', patch: { core: { activeBranch: 'main' } } },
    ]);
  });

  it('renders a placeholder when panel capabilities are missing', () => {
    const registry = new PanelRegistry();
    const manifest: PanelTypeManifest = {
      type: 'cap-panel',
      title: 'Cap Panel',
      capabilities: ['cap.read'],
    };
    let mounted = false;
    registry.register(manifest, () => ({
      mount() {
        mounted = true;
        return { unmount() {} };
      },
    }));

    const container = document.createElement('div');
    const hostController = new PanelHostController({
      registry,
      getAvailablePanelTypes: () => new Set([manifest.type]),
      getAvailableCapabilities: () => new Set(),
    });

    hostController.mountPanel({
      panelId: 'cap-1',
      panelType: manifest.type,
      container,
    });

    expect(mounted).toBe(false);
    expect(container.querySelector('.panel-placeholder-title')?.textContent ?? '').toBe(
      'Panel "Cap Panel" is unavailable.',
    );
    expect(container.querySelector('.panel-placeholder-details')?.textContent ?? '').toContain(
      'Missing capabilities',
    );
  });

  it('renders a placeholder when the panel type is unknown', () => {
    const registry = new PanelRegistry();
    const container = document.createElement('div');
    const hostController = new PanelHostController({
      registry,
      getAvailablePanelTypes: () => new Set(['unknown-panel']),
      getAvailableCapabilities: () => new Set(),
    });

    hostController.mountPanel({
      panelId: 'unknown-1',
      panelType: 'unknown-panel',
      container,
    });

    expect(container.querySelector('.panel-placeholder-title')?.textContent ?? '').toBe(
      'Panel "unknown-panel" is unavailable.',
    );
    expect(container.querySelector('.panel-placeholder-details')?.textContent ?? '').toContain(
      'Panel manifest is not registered',
    );
  });
});
