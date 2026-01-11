import type { PanelHost } from '../controllers/panelRegistry';
import type { ChatPanelDom } from '../panels/chat/chatPanel';
import type { ChatRuntime, ChatRuntimeOptions } from '../panels/chat/runtime';

export const CHAT_PANEL_SERVICES_CONTEXT_KEY = 'core.chat';

export interface ChatPanelServices {
  getRuntimeOptions: () => Omit<ChatRuntimeOptions, 'elements'>;
  registerChatPanel: (options: {
    runtime: ChatRuntime;
    dom: ChatPanelDom;
    host: PanelHost;
  }) => void | (() => void);
}
