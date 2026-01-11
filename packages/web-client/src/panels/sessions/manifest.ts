import type { PanelTypeManifest } from '@assistant/shared';

export const SESSIONS_PANEL_MANIFEST: PanelTypeManifest = {
  type: 'sessions',
  title: 'Sessions',
  icon: 'users',
  description: 'Session list and agent picker.',
  defaultSessionBinding: 'global',
  sessionScope: 'global',
  defaultPinned: true,
  capabilities: ['sessions.read', 'sessions.write'],
};
