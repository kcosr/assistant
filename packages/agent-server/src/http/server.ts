import http from 'node:http';
import path from 'node:path';

import type { ToolContext, ToolHost } from '../tools';
import type { ConversationStore } from '../conversationStore';
import type { SessionIndex } from '../sessionIndex';
import type { SessionHub } from '../sessionHub';
import type { AgentRegistry } from '../agents';
import { PluginToolHost, type PluginRegistry } from '../plugins/registry';
import { PluginSettingsStore } from '../plugins/pluginSettingsStore';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';

import { PreferencesStore } from '../preferences/preferencesStore';
import { handleExternalRoutes } from './routes/external';
import { handlePluginRoutes } from './routes/plugins';
import { handlePreferencesRoutes } from './routes/preferences';
import { handlePanelRoutes } from './routes/panels';
import { handleStaticRoutes } from './routes/static';
import type { HttpContext, HttpHelpers, HttpRouteHandler } from './types';

const WEB_CLIENT_PUBLIC_DIR = path.resolve(__dirname, '../../../../../web-client/public');
const WEB_CLIENT_DIST_DIR = WEB_CLIENT_PUBLIC_DIR;

export function createHttpServer(options: {
  config: EnvConfig;
  conversationStore: ConversationStore;
  sessionIndex: SessionIndex;
  sessionHub: SessionHub;
  agentRegistry: AgentRegistry;
  toolHost: ToolHost;
  pluginRegistry?: PluginRegistry;
  eventStore: EventStore;
  scheduledSessionService?: ScheduledSessionService;
}): http.Server {
  const {
    config,
    conversationStore,
    sessionIndex,
    sessionHub,
    agentRegistry,
    toolHost,
    pluginRegistry,
    eventStore,
    scheduledSessionService,
  } = options;

  const pluginToolHost = pluginRegistry ? new PluginToolHost(pluginRegistry) : undefined;
  const httpToolContext: ToolContext = {
    sessionId: 'http',
    signal: new AbortController().signal,
    eventStore,
    sessionHub,
    sessionIndex,
    agentRegistry,
    conversationStore,
    envConfig: config,
    baseToolHost: toolHost,
    ...(scheduledSessionService ? { scheduledSessionService } : {}),
  };
  const preferencesStore = new PreferencesStore(path.join(config.dataDir, 'preferences.json'));
  const pluginSettingsStore = new PluginSettingsStore(
    path.join(config.dataDir, 'plugin-settings.json'),
  );

  const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const slugifyArtifactId = (raw: string): string => {
    const normalized = raw.normalize('NFKD').toLowerCase();
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  const safeSlugifyArtifactId = (raw: string): string | null => {
    const slug = slugifyArtifactId(raw);
    if (!slug || !ARTIFACT_ID_PATTERN.test(slug)) {
      return null;
    }
    return slug;
  };

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    if (config.debugHttpRequests) {
      const startTime = Date.now();
      const requestLine = `${req.method} ${req.url}`;
      res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        const size = res.getHeader('content-length');
        const sizeLabel = typeof size === 'number' || typeof size === 'string' ? `, ${size}b` : '';
        const remote = req.socket.remoteAddress ? `, ${req.socket.remoteAddress}` : '';
        console.log(
          `[http] ${res.statusCode} ${requestLine} (${durationMs}ms${sizeLabel}${remote})`,
        );
      });
    }

    // CORS headers for cross-origin requests (e.g., Capacitor mobile app)
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);

    const sendJson = (statusCode: number, body: unknown): void => {
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };

    const readJsonBody = async (): Promise<Record<string, unknown> | undefined> => {
      if (!req.headers['content-type']?.includes('application/json')) {
        sendJson(400, { error: 'Content-Type must be application/json' });
        return undefined;
      }

      let bodyText = '';
      try {
        bodyText = await new Promise<string>((resolve, reject) => {
          let data = '';
          req.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
      } catch {
        sendJson(400, { error: 'Failed to read request body' });
        return undefined;
      }

      let payload: unknown;
      try {
        payload = bodyText.trim() ? (JSON.parse(bodyText) as unknown) : {};
      } catch {
        sendJson(400, { error: 'Invalid JSON body' });
        return undefined;
      }

      if (!payload || typeof payload !== 'object') {
        sendJson(400, { error: 'Invalid JSON body' });
        return undefined;
      }

      return payload as Record<string, unknown>;
    };

    try {
      const context: HttpContext = {
        config,
        conversationStore,
        sessionIndex,
        sessionHub,
        agentRegistry,
        toolHost,
        httpToolContext,
        eventStore,
        ...(scheduledSessionService ? { scheduledSessionService } : {}),
        safeSlugifyArtifactId,
        webClientPublicDir: WEB_CLIENT_PUBLIC_DIR,
        webClientDistDir: WEB_CLIENT_DIST_DIR,
        preferencesStore,
        pluginSettingsStore,
        ...(pluginRegistry ? { pluginRegistry } : {}),
        ...(pluginToolHost ? { pluginToolHost } : {}),
      };

      const helpers: HttpHelpers = { sendJson, readJsonBody };

      const pluginRoutes = pluginRegistry?.getHttpRoutes?.() ?? [];
      const handlers: HttpRouteHandler[] = [
        handleStaticRoutes,
        handleExternalRoutes,
        handlePanelRoutes,
        ...pluginRoutes,
        handlePluginRoutes,
        handlePreferencesRoutes,
      ];

      for (const handler of handlers) {
        const handled = await handler(context, req, res, url, segments, helpers);
        if (handled) {
          return;
        }
      }

      res.statusCode = 404;
      res.end('Not found');
    } catch (err) {
      console.error('Error handling HTTP request', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  return server;
}
