import type http from 'node:http';

import type { ToolContext, ToolHost } from '../tools';
import type { ConversationStore } from '../conversationStore';
import type { SessionIndex } from '../sessionIndex';
import type { SessionHub } from '../sessionHub';
import type { AgentRegistry } from '../agents';
import type { EventStore } from '../events';
import type { PluginRegistry, PluginToolHost } from '../plugins/registry';
import type { EnvConfig } from '../envConfig';
import type { PreferencesStore } from '../preferences/preferencesStore';
import type { PluginSettingsStore } from '../plugins/pluginSettingsStore';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';
import type { SearchService } from '../search/searchService';

export interface HttpContext {
  config: EnvConfig;
  conversationStore: ConversationStore;
  sessionIndex: SessionIndex;
  sessionHub: SessionHub;
  agentRegistry: AgentRegistry;
  toolHost: ToolHost;
  pluginRegistry?: PluginRegistry;
  pluginToolHost?: PluginToolHost;
  searchService?: SearchService;
  httpToolContext: ToolContext;
  eventStore: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  safeSlugifyArtifactId: (raw: string) => string | null;
  webClientPublicDir: string;
  webClientDistDir: string;
  preferencesStore: PreferencesStore;
  pluginSettingsStore: PluginSettingsStore;
}

export interface HttpHelpers {
  sendJson: (statusCode: number, body: unknown) => void;
  readJsonBody: () => Promise<Record<string, unknown> | undefined>;
}

export type HttpRouteHandler = (
  context: HttpContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  segments: string[],
  helpers: HttpHelpers,
) => Promise<boolean> | boolean;
