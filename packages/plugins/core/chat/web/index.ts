import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { createChatPanel } from '../../../../web-client/src/panels/chat';
import { ThinkingPreferencesClient } from '../../../../web-client/src/utils/thinkingPreferences';
import { ToolOutputPreferencesClient } from '../../../../web-client/src/utils/toolOutputPreferences';
import {
  CHAT_PANEL_SERVICES_CONTEXT_KEY,
  type ChatPanelServices,
} from '../../../../web-client/src/utils/chatPanelServices';

type AgentSummary = {
  agentId: string;
  displayName: string;
};

const fallbackToolOutputPreferencesClient = new ToolOutputPreferencesClient();
void fallbackToolOutputPreferencesClient.load();
const fallbackThinkingPreferencesClient = new ThinkingPreferencesClient();
void fallbackThinkingPreferencesClient.load();

function resolveChatServices(host: PanelHost): ChatPanelServices | null {
  const raw = host.getContext(CHAT_PANEL_SERVICES_CONTEXT_KEY);
  if (raw && typeof raw === 'object') {
    return raw as ChatPanelServices;
  }
  return null;
}

function getAgentDisplayName(host: PanelHost, agentId: string): string {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return '';
  }
  const summaries = host.getContext('agent.summaries');
  if (Array.isArray(summaries)) {
    const match = (summaries as AgentSummary[]).find((summary) => summary.agentId === trimmed);
    const label = match?.displayName ?? trimmed;
    return label.trim() || trimmed;
  }
  return trimmed;
}

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for chat plugin.');
} else {
  registry.registerPanel(
    'chat',
    createChatPanel({
      getRuntimeOptions: (host) => {
        const services = resolveChatServices(host);
        if (services?.getRuntimeOptions) {
          return services.getRuntimeOptions();
        }
        return {
          toolOutputPreferencesClient: fallbackToolOutputPreferencesClient,
          thinkingPreferencesClient: fallbackThinkingPreferencesClient,
          autoScrollEnabled: true,
          getAgentDisplayName: (agentId) => getAgentDisplayName(host, agentId),
        };
      },
      onRuntimeReady: ({ runtime, dom, host }) => {
        const services = resolveChatServices(host);
        const cleanup = services?.registerChatPanel?.({ runtime, dom, host }) ?? null;
        return () => {
          if (cleanup) {
            cleanup();
          }
        };
      },
    }),
  );
}
