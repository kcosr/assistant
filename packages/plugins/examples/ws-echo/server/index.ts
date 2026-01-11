import type { CombinedPluginManifest } from '@assistant/shared';

import type { PanelEventHandler, PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type WsEchoInputPayload = {
  type: 'ws_echo_input';
  text?: unknown;
};

const handleWsEchoEvent: PanelEventHandler = async (event, ctx) => {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const typed = payload as WsEchoInputPayload;
  if (typed.type !== 'ws_echo_input') {
    return;
  }
  const text = typeof typed.text === 'string' ? typed.text : '';

  ctx.sendToClient({
    type: 'panel_event',
    panelId: event.panelId,
    panelType: event.panelType,
    payload: { type: 'ws_echo_update', text },
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  });
};

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    panelEventHandlers: {
      'ws-echo': handleWsEchoEvent,
    },
  };
}
