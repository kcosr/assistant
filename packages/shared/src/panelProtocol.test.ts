import { describe, expect, it } from 'vitest';

import { LayoutPersistenceSchema, PanelInstanceSchema } from './panelProtocol';

describe('PanelInstanceSchema', () => {
  it('parses and serializes customTitle', () => {
    const parsed = PanelInstanceSchema.parse({
      panelId: 'lists-1',
      panelType: 'lists',
      customTitle: 'Work Tasks',
      meta: {
        title: 'Lists',
      },
    });

    expect(parsed).toEqual({
      panelId: 'lists-1',
      panelType: 'lists',
      customTitle: 'Work Tasks',
      meta: {
        title: 'Lists',
      },
    });
  });
});

describe('LayoutPersistenceSchema', () => {
  it('round-trips panel customTitle values', () => {
    const parsed = LayoutPersistenceSchema.parse({
      layout: {
        kind: 'pane',
        paneId: 'pane-1',
        activePanelId: 'lists-1',
        tabs: [{ panelId: 'lists-1' }],
      },
      panels: {
        'lists-1': {
          panelId: 'lists-1',
          panelType: 'lists',
          customTitle: 'Work Tasks',
        },
      },
      headerPanels: [],
      headerPanelSizes: {},
    });

    expect(parsed.panels['lists-1']).toEqual({
      panelId: 'lists-1',
      panelType: 'lists',
      customTitle: 'Work Tasks',
    });
  });

  it('defaults pane activePanelId to the first tab', () => {
    const parsed = LayoutPersistenceSchema.parse({
      layout: {
        kind: 'pane',
        paneId: 'pane-1',
        tabs: [{ panelId: 'chat-1' }, { panelId: 'notes-1' }],
      },
      panels: {
        'chat-1': { panelId: 'chat-1', panelType: 'chat' },
        'notes-1': { panelId: 'notes-1', panelType: 'notes' },
      },
      headerPanels: [],
      headerPanelSizes: {},
    });

    expect(parsed.layout).toEqual({
      kind: 'pane',
      paneId: 'pane-1',
      tabs: [{ panelId: 'chat-1' }, { panelId: 'notes-1' }],
      activePanelId: 'chat-1',
    });
  });
});
