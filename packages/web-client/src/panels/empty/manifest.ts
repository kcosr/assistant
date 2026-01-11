import type { PanelTypeManifest } from '@assistant/shared';

export const EMPTY_PANEL_MANIFEST: PanelTypeManifest = {
  type: 'empty',
  title: 'Empty',
  icon: 'plus',
  description: 'Placeholder panel for adding a new panel.',
  multiInstance: true,
  defaultSessionBinding: 'global',
  sessionScope: 'global',
};
