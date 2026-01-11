import type { PanelTypeManifest } from '@assistant/shared';

export const CHAT_PANEL_MANIFEST: PanelTypeManifest = {
  type: 'chat',
  title: 'Chat',
  icon: 'message-square',
  description: 'Chat transcript.',
  multiInstance: true,
  defaultSessionBinding: 'fixed',
  sessionScope: 'optional',
  defaultPlacement: { region: 'center' },
  capabilities: ['chat.read', 'chat.write'],
};
