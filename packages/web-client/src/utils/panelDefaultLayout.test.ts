import { describe, expect, it } from 'vitest';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { SESSIONS_PANEL_MANIFEST } from '../panels/sessions/manifest';
import { collectPanelIds } from './layoutTree';
import { createDefaultPanelLayout, DEFAULT_PANEL_IDS } from './panelDefaultLayout';

describe('panelDefaultLayout', () => {
  it('creates a layout using default placements when provided', () => {
    const layout = createDefaultPanelLayout([SESSIONS_PANEL_MANIFEST, CHAT_PANEL_MANIFEST]);

    expect(layout.panels[DEFAULT_PANEL_IDS.chat]?.panelType).toBe('chat');
    expect(layout.panels[DEFAULT_PANEL_IDS.sessions]).toBeUndefined();

    const panelIds = collectPanelIds(layout.layout);
    expect(panelIds).toEqual([DEFAULT_PANEL_IDS.chat]);
    expect(layout.headerPanels).toEqual([]);
    expect(layout.headerPanelSizes).toEqual({});
  });
});
