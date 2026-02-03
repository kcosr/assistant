import path from 'node:path';

import dotenv from 'dotenv';
import { getSessionWorkspaceRoot } from '@assistant/coding-executor';
import { WebSocketServer } from 'ws';
import { AgentRegistry } from './agents';
import { loadConfig as loadAppConfig, type AppConfig } from './config';
import { FileEventStore, SessionScopedEventStore } from './events';
import { DefaultPluginRegistry, PluginToolHost, type PluginRegistry } from './plugins/registry';
import { SessionIndex } from './sessionIndex';
import { SessionHub } from './sessionHub';
import { CompositeToolHost, createToolHost, type McpServerConfig, type ToolHost } from './tools';
import { loadEnvConfig, type EnvConfig } from './envConfig';
import { createHttpServer } from './http/server';
import { MultiplexedConnection } from './ws/multiplexedConnection';
import { killAllCliProcesses } from './ws/cliProcessRegistry';
import { GitVersioningService } from './gitVersioning';
import { ScheduledSessionService } from './scheduledSessions';
import { SearchService } from './search/searchService';
import {
  ClaudeSessionHistoryProvider,
  CodexSessionHistoryProvider,
  EventStoreHistoryProvider,
  HistoryProviderRegistry,
  PiSessionHistoryProvider,
} from './history/historyProvider';
import { PiSessionWriter } from './history/piSessionWriter';

export {
  buildSystemPrompt,
  filterVisibleAgents,
  type BuildSystemPromptOptions,
} from './systemPrompt';
export { SessionIndex, type SessionConfig, type SessionSummary } from './sessionIndex';
export { SessionHub } from './sessionHub';
export { createHttpServer } from './http/server';
export { Session } from './ws/session';

dotenv.config();

export let agentRegistry: AgentRegistry | undefined;

function resolveCodingWorkspaceRoot(
  appConfig: AppConfig | undefined,
  dataDir: string,
): { workspaceRoot: string } | null {
  const codingConfig = appConfig?.plugins?.['coding'];
  if (!codingConfig?.enabled) {
    return null;
  }

  const mode = codingConfig.mode === 'sidecar' ? 'sidecar' : 'local';
  let workspaceRoot: string | null = null;

  if (mode === 'local') {
    if (codingConfig.local?.workspaceRoot && codingConfig.local.workspaceRoot.trim().length > 0) {
      workspaceRoot = codingConfig.local.workspaceRoot.trim();
    } else {
      workspaceRoot = path.join(dataDir, 'plugins', 'coding', 'coding-workspaces');
    }
  } else {
    return null;
  }

  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return null;
  }

  return { workspaceRoot };
}

function createSessionWorkingDirResolver(
  appConfig: AppConfig | undefined,
  dataDir: string,
  pluginRegistry?: PluginRegistry,
): ((sessionId: string) => string | null) | undefined {
  if (!pluginRegistry) {
    return undefined;
  }
  const resolved = resolveCodingWorkspaceRoot(appConfig, dataDir);
  if (!resolved) {
    return undefined;
  }
  const { workspaceRoot } = resolved;
  return () => getSessionWorkspaceRoot({ workspaceRoot });
}

export async function startServer(
  config: EnvConfig,
  pluginRegistry?: PluginRegistry,
  appConfig?: AppConfig,
  gitVersioningService?: GitVersioningService,
): Promise<void> {
  const sessionIndex = new SessionIndex(path.join(config.dataDir, 'sessions.jsonl'));
  const eventStore = new FileEventStore(config.dataDir);
  const registry = agentRegistry ?? new AgentRegistry([]);
  const historyProvider = new HistoryProviderRegistry([
    new ClaudeSessionHistoryProvider({ eventStore }),
    new CodexSessionHistoryProvider({ eventStore, dataDir: config.dataDir }),
    new PiSessionHistoryProvider({ eventStore }),
    new EventStoreHistoryProvider(eventStore),
  ]);
  const mirrorPiSessionHistory = appConfig?.sessions?.mirrorPiSessionHistory ?? true;
  const piSessionWriter = mirrorPiSessionHistory ? new PiSessionWriter() : undefined;

  const maxCachedSessions =
    appConfig?.sessions && typeof appConfig.sessions.maxCached === 'number'
      ? appConfig.sessions.maxCached
      : 100;

  const resolveSessionWorkingDir = createSessionWorkingDirResolver(
    appConfig,
    config.dataDir,
    pluginRegistry,
  );

  const sessionHub = new SessionHub({
    sessionIndex,
    agentRegistry: registry,
    ...(pluginRegistry ? { pluginRegistry } : {}),
    maxCachedSessions,
    ...(resolveSessionWorkingDir ? { resolveSessionWorkingDir } : {}),
    historyProvider,
    eventStore,
    ...(piSessionWriter ? { piSessionWriter } : {}),
  });
  const chatEventStore = new SessionScopedEventStore(eventStore, sessionHub);

  const baseToolHost = createToolHost(
    {
      toolsEnabled: config.toolsEnabled,
      ...(config.mcpServers?.length ? { mcpServers: config.mcpServers } : {}),
    },
    {
      sessionHub,
      sessionIndex,
    },
  );

  const toolHosts: ToolHost[] = [baseToolHost];

  if (pluginRegistry) {
    const pluginToolHost = new PluginToolHost(pluginRegistry);
    toolHosts.push(pluginToolHost);
  }

  const toolHost = toolHosts.length === 1 ? baseToolHost : new CompositeToolHost(toolHosts);

  const searchService = new SearchService(pluginRegistry);
  searchService.syncFromRegistry();

  const scheduledSessionService = new ScheduledSessionService({
    agentRegistry: registry,
    logger: console,
    dataDir: config.dataDir,
    sessionHub,
    sessionIndex,
    envConfig: config,
    toolHost,
    eventStore: chatEventStore,
    searchService,
    broadcast: (event) => {
      sessionHub.broadcastToAll({
        type: 'panel_event',
        panelId: '*',
        panelType: 'scheduled-sessions',
        sessionId: '*',
        payload: event,
      });
    },
  });
  await scheduledSessionService.initialize();

  const httpServer = createHttpServer({
    config,
    sessionIndex,
    sessionHub,
    agentRegistry: registry,
    toolHost,
    searchService,
    eventStore: chatEventStore,
    scheduledSessionService,
    historyProvider,
    ...(pluginRegistry ? { pluginRegistry } : {}),
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  wss.on('connection', (ws) => {
    const connectionId = Math.random().toString(36).slice(2, 10);
    console.log(`[ws] client connected`, { connectionId });

    ws.on('close', (code, reason) => {
      console.log(`[ws] client disconnected`, {
        connectionId,
        code,
        reason: reason?.toString() ?? '',
      });
    });

    new MultiplexedConnection({
      clientSocket: ws,
      config,
      toolHost,
      sessionHub,
      eventStore: chatEventStore,
      scheduledSessionService,
      searchService,
      connectionId,
    });
  });

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`Agent server listening on http://0.0.0.0:${config.port} (WS path: /ws)`);

    // Warmup: pre-initialize MCP servers so first connection is fast
    void (async () => {
      try {
        const tools = await toolHost.listTools();
        console.log(`[warmup] Pre-initialized tools: ${tools.length} tools available`);
      } catch (err) {
        console.error('[warmup] Failed to pre-initialize tools:', err);
      }
    })();
  });

  process.once('beforeExit', () => {
    void (async () => {
      if (gitVersioningService) {
        gitVersioningService.shutdown();
      }
      scheduledSessionService.shutdown();
      if (pluginRegistry) {
        await pluginRegistry.shutdown();
      }
    })();
  });

  // Kill all CLI child processes on shutdown signals
  const shutdownHandler = (): void => {
    console.log('[shutdown] Cleaning up CLI processes...');
    killAllCliProcesses();
    if (gitVersioningService) {
      gitVersioningService.shutdown();
    }
    scheduledSessionService.shutdown();
  };

  process.once('SIGINT', shutdownHandler);
  process.once('SIGTERM', shutdownHandler);
}

export async function runServer(): Promise<void> {
  const envConfig = loadEnvConfig();

  const appConfigPathEnv = process.env['APP_CONFIG_PATH'];
  const appConfigPath =
    typeof appConfigPathEnv === 'string' && appConfigPathEnv.trim().length > 0
      ? path.resolve(appConfigPathEnv.trim())
      : path.join(envConfig.dataDir, 'config.json');

  const appConfig: AppConfig = loadAppConfig(appConfigPath);

  const agentDefinitions = appConfig.agents;

  agentRegistry = new AgentRegistry(agentDefinitions);

  const pluginRegistry = new DefaultPluginRegistry();
  await pluginRegistry.initialize(appConfig, envConfig.dataDir, {
    configDir: path.dirname(appConfigPath),
  });

  const gitVersioningService = new GitVersioningService(pluginRegistry);
  await gitVersioningService.initialize();

  const hasMcpServers = appConfig.mcpServers.length > 0;

  const pluginsConfig = appConfig.plugins ?? {};
  let anyPluginEnabled = false;
  for (const value of Object.values(pluginsConfig)) {
    if (value && typeof value === 'object' && (value as { enabled?: boolean }).enabled) {
      anyPluginEnabled = true;
      break;
    }
  }

  const toolsEnabledEnv = process.env['MCP_TOOLS_ENABLED'];
  const toolsEnabled =
    toolsEnabledEnv !== undefined ? envConfig.toolsEnabled : hasMcpServers || anyPluginEnabled;

  const mcpServers: McpServerConfig[] | undefined = hasMcpServers
    ? appConfig.mcpServers.map((server) => ({
        command: server.command,
        ...(server.name ? { name: server.name } : {}),
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
      }))
    : undefined;

  const mergedConfig: EnvConfig = {
    ...envConfig,
    toolsEnabled,
    ...(mcpServers ? { mcpServers } : {}),
  };

  await startServer(mergedConfig, pluginRegistry, appConfig, gitVersioningService);
}

// Only start the HTTP/WebSocket server when this module is executed
// directly via Node (for example, `node dist/agent-server/src/index.js`),
// not when it is imported by tests or other modules.
if (require.main === module) {
  runServer();
}
