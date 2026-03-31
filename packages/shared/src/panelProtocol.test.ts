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
        kind: 'panel',
        panelId: 'lists-1',
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
});
