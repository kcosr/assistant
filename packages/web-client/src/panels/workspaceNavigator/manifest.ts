import type { PanelTypeManifest } from '@assistant/shared';

export const WORKSPACE_NAVIGATOR_PANEL_MANIFEST: PanelTypeManifest = {
  type: 'navigator',
  title: 'Navigator',
  icon: 'compass',
  description: 'Browse splits and panels.',
  defaultSessionBinding: 'global',
  sessionScope: 'global',
  defaultPinned: true,
};
