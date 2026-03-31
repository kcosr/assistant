// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadPanelLayout, savePanelLayout } from './panelLayoutStore';

describe('panelLayoutStore', () => {
  it('preserves panel customTitle when saving and loading a layout', () => {
    const layout = {
      layout: {
        kind: 'panel' as const,
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
    };

    savePanelLayout(layout, 'window-1', window.localStorage);
    expect(loadPanelLayout('window-1', window.localStorage)).toEqual(layout);
  });
});
