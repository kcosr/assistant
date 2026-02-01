import { describe, expect, it } from 'vitest';
import { EMPTY_PANEL_MANIFEST } from '../panels/empty/manifest';
import { INPUT_PANEL_MANIFEST } from '../panels/input/manifest';
import { collectPanelIds } from './layoutTree';
import { createDefaultPanelLayout } from './panelDefaultLayout';

describe('panelDefaultLayout', () => {
  it('uses the empty panel when available', () => {
    const layout = createDefaultPanelLayout([INPUT_PANEL_MANIFEST, EMPTY_PANEL_MANIFEST]);

    const panelIds = collectPanelIds(layout.layout);
    expect(panelIds).toEqual(['empty-1']);
    expect(layout.panels['empty-1']?.panelType).toBe('empty');
    expect(layout.headerPanels).toEqual([]);
    expect(layout.headerPanelSizes).toEqual({});
  });
});
