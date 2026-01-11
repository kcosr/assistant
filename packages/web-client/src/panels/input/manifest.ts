import type { PanelTypeManifest } from '@assistant/shared';

export const INPUT_PANEL_MANIFEST: PanelTypeManifest = {
  type: 'input',
  title: 'Input',
  icon: 'edit-3',
  description: 'Message composer and session picker.',
  multiInstance: false,
  defaultSessionBinding: 'global',
  sessionScope: 'global',
  defaultPlacement: { region: 'bottom', size: { height: 180 } },
  capabilities: ['chat.write'],
};
