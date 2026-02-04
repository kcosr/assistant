import type { CombinedPluginManifest, SessionAttributesPatch } from '@assistant/shared';

import type { AgentRegistry } from '../../../../agent-server/src/agents';
import { getDefaultModelForNewSession } from '../../../../agent-server/src/sessionModel';
import type { SessionHub } from '../../../../agent-server/src/sessionHub';
import type { SessionIndex } from '../../../../agent-server/src/sessionIndex';
import { isPlainObject } from '../../../../agent-server/src/sessionAttributes';
import { startSessionMessage } from '../../../../agent-server/src/sessionMessages';
import { ToolError, type ToolContext } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} must not be empty`);
  }
  return trimmed;
}

function requireSessionHub(ctx: ToolContext): SessionHub {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

function requireSessionIndex(ctx: ToolContext): SessionIndex {
  const sessionIndex = ctx.sessionIndex;
  if (!sessionIndex) {
    throw new ToolError('session_index_unavailable', 'Session index is not available');
  }
  return sessionIndex;
}

function requireAgentRegistry(ctx: ToolContext, sessionHub: SessionHub): AgentRegistry {
  return ctx.agentRegistry ?? sessionHub.getAgentRegistry();
}

function parseOptionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string or null`);
  }
  return value;
}

function requireSessionId(raw: unknown): string {
  const sessionId = requireNonEmptyString(raw, 'sessionId');
  return sessionId;
}

function parseSessionIdOverride(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const sessionId = requireNonEmptyString(raw, 'sessionId');
  if (sessionId.length > 128) {
    throw new ToolError('invalid_arguments', 'sessionId must be at most 128 characters');
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new ToolError('invalid_arguments', 'sessionId must match [A-Za-z0-9_-] only');
  }
  return sessionId;
}

function parseAttributesPatch(args: Record<string, unknown>): SessionAttributesPatch {
  let patch: unknown = args['patch'];
  if (patch === undefined) {
    patch = args['attributes'];
  }
  if (!isPlainObject(patch)) {
    throw new ToolError('invalid_arguments', 'Session attributes patch must be an object');
  }
  return patch as SessionAttributesPatch;
}

function parseOptionalAttributesPatch(
  args: Record<string, unknown>,
): SessionAttributesPatch | undefined {
  if (!('attributes' in args) && !('patch' in args)) {
    return undefined;
  }
  return parseAttributesPatch(args);
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      list: async (_args, ctx): Promise<{ sessions: unknown[] }> => {
        const sessionHub = requireSessionHub(ctx);
        const sessions = await sessionHub.listSessionSummaries();
        return { sessions };
      },
      create: async (args, ctx): Promise<unknown> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const registry = requireAgentRegistry(ctx, sessionHub);
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const sessionId = parseSessionIdOverride(parsed['sessionId']);
        const attributesPatch = parseOptionalAttributesPatch(parsed);

        const agent = registry.getAgent(agentId);
        if (!agent) {
          throw new ToolError('invalid_arguments', `Unknown agent: ${agentId}`);
        }

        if (agent.type === 'external' && !sessionId) {
          throw new ToolError('invalid_arguments', 'sessionId is required for external agents');
        }

        try {
          const model = getDefaultModelForNewSession(agent);
          let summary = await sessionIndex.createSession({
            agentId,
            ...(sessionId ? { sessionId } : {}),
            ...(model ? { model } : {}),
          });
          if (attributesPatch) {
            const patched = await sessionIndex.updateSessionAttributes(
              summary.sessionId,
              attributesPatch,
            );
            if (patched) {
              summary = patched;
            }
          }
          await sessionHub.ensureSessionState(summary.sessionId, summary, true);
          sessionHub.broadcastSessionCreated(summary);
          return summary;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create session';
          throw new ToolError('invalid_arguments', message);
        }
      },
      update: async (args, ctx): Promise<unknown> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);
        const name = parseOptionalNullableString(parsed['name'], 'name');
        const pinnedAt = parseOptionalNullableString(parsed['pinnedAt'], 'pinnedAt');

        if (name === undefined && pinnedAt === undefined) {
          throw new ToolError('invalid_arguments', 'Missing name or pinnedAt');
        }

        const existing = await sessionIndex.getSession(sessionId);
        if (!existing) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        let summary = existing;

        if (name !== undefined) {
          try {
            summary = await sessionIndex.renameSession(sessionId, name);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update session';
            throw new ToolError('invalid_arguments', message);
          }

          await sessionHub.ensureSessionState(summary.sessionId, summary, true);
          sessionHub.broadcastToAll({
            type: 'session_updated',
            sessionId: summary.sessionId,
            updatedAt: summary.updatedAt,
            name,
            ...(typeof summary.pinnedAt === 'string' ? { pinnedAt: summary.pinnedAt } : {}),
          });
        }

        if (pinnedAt !== undefined) {
          const pinnedSummary = await sessionHub.pinSession(sessionId, pinnedAt);
          if (!pinnedSummary) {
            throw new ToolError('session_not_found', 'Session not found');
          }
          summary = pinnedSummary;
        }

        return summary;
      },
      'update-attributes': async (args, ctx): Promise<unknown> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);

        const existing = await sessionIndex.getSession(sessionId);
        if (!existing) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        const patch = parseAttributesPatch(parsed);
        try {
          const summary = await sessionHub.updateSessionAttributes(sessionId, patch);
          if (!summary) {
            throw new ToolError('session_not_found', 'Session not found');
          }
          return summary;
        } catch (err) {
          if (err instanceof ToolError) {
            throw err;
          }
          const message = err instanceof Error ? err.message : 'Failed to update session';
          throw new ToolError('invalid_arguments', message);
        }
      },
      events: async (args, ctx): Promise<{ sessionId: string; events: unknown[] }> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const eventStore = ctx.eventStore;
        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);
        const existing = await sessionIndex.getSession(sessionId);
        if (!existing) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        const afterRaw = parsed['after'];
        const after =
          typeof afterRaw === 'string' && afterRaw.trim().length > 0 ? afterRaw.trim() : undefined;

        const force = parsed['force'] === true;
        const historyProvider = ctx.historyProvider;
        if (historyProvider) {
          const registry = requireAgentRegistry(ctx, sessionHub);
          const agentId = existing.agentId;
          const agent = agentId ? registry.getAgent(agentId) : undefined;
          const providerId = agent?.chat?.provider ?? null;
          const events = await historyProvider.getHistory({
            sessionId,
            ...(agentId ? { agentId } : {}),
            ...(agent ? { agent } : {}),
            providerId,
            ...(existing.attributes ? { attributes: existing.attributes } : {}),
            ...(after ? { after } : {}),
            ...(force ? { force } : {}),
          });
          return { sessionId, events };
        }

        if (!eventStore) {
          throw new ToolError('event_store_unavailable', 'Event store is not available');
        }

        const events = after
          ? await eventStore.getEventsSince(sessionId, after)
          : await eventStore.getEvents(sessionId);

        return { sessionId, events };
      },
      message: async (args, ctx): Promise<unknown> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const envConfig = ctx.envConfig;
        const baseToolHost = ctx.baseToolHost;
        if (!envConfig || !baseToolHost) {
          throw new ToolError(
            'session_message_not_supported',
            'sessions_message is not available in this context',
          );
        }

        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);
        const content = typeof parsed['content'] === 'string' ? parsed['content'] : '';
        if (!content.trim()) {
          throw new ToolError('invalid_arguments', 'content is required and must be a string');
        }

        let mode: 'sync' | 'async' = 'async';
        const modeRaw = parsed['mode'];
        if (modeRaw !== undefined) {
          if (modeRaw === 'sync' || modeRaw === 'async') {
            mode = modeRaw;
          } else {
            throw new ToolError('invalid_arguments', 'mode must be "sync" or "async"');
          }
        }

        let timeoutSeconds = 300;
        const timeoutRaw = parsed['timeout'];
        if (timeoutRaw !== undefined) {
          if (typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) && timeoutRaw > 0) {
            timeoutSeconds = Math.floor(timeoutRaw);
          } else {
            throw new ToolError('invalid_arguments', 'timeout must be a positive number');
          }
        }

        let webhook:
          | {
              url: string;
              headers?: Record<string, string>;
            }
          | undefined;
        const webhookRaw = parsed['webhook'];
        if (webhookRaw !== undefined) {
          if (!webhookRaw || typeof webhookRaw !== 'object') {
            throw new ToolError('invalid_arguments', 'Invalid webhook configuration');
          }
          const candidate = webhookRaw as { url?: unknown; headers?: unknown };
          const url =
            typeof candidate.url === 'string' && candidate.url.trim().length > 0
              ? candidate.url.trim()
              : '';
          if (!url) {
            throw new ToolError('invalid_arguments', 'Invalid webhook configuration');
          }
          let headers: Record<string, string> | undefined;
          if (candidate.headers !== undefined) {
            if (!candidate.headers || typeof candidate.headers !== 'object') {
              throw new ToolError('invalid_arguments', 'Invalid webhook configuration');
            }
            headers = {};
            for (const [key, value] of Object.entries(
              candidate.headers as Record<string, unknown>,
            )) {
              if (typeof value !== 'string') {
                throw new ToolError('invalid_arguments', 'Invalid webhook configuration');
              }
              headers[key] = value;
            }
          }
          webhook = { url, ...(headers ? { headers } : {}) };
        }

        const { response, asyncTask } = await startSessionMessage({
          input: {
            sessionId,
            content,
            mode,
            timeoutSeconds,
            ...(webhook ? { webhook } : {}),
          },
          sessionIndex,
          sessionHub,
          toolHost: baseToolHost,
          envConfig,
          ...(ctx.agentRegistry ? { agentRegistry: ctx.agentRegistry } : {}),
          ...(ctx.eventStore ? { eventStore: ctx.eventStore } : {}),
          ...(ctx.scheduledSessionService
            ? { scheduledSessionService: ctx.scheduledSessionService }
            : {}),
        });

        if (asyncTask) {
          void asyncTask;
        }

        return response;
      },
      clear: async (
        args,
        ctx,
      ): Promise<{ sessionId: string; cleared: true; updatedAt: string }> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);

        const existing = await sessionIndex.getSession(sessionId);
        if (!existing) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        try {
          const summary = await sessionHub.clearSession(sessionId);
          return {
            sessionId,
            cleared: true,
            updatedAt: summary.updatedAt,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to clear session';
          throw new ToolError('invalid_arguments', message);
        }
      },
      delete: async (
        args,
        ctx,
      ): Promise<{ sessionId: string; deleted: true; updatedAt?: string }> => {
        const sessionHub = requireSessionHub(ctx);
        const sessionIndex = requireSessionIndex(ctx);
        const parsed = asObject(args);
        const sessionId = requireSessionId(parsed['sessionId']);

        const existing = await sessionIndex.getSession(sessionId);
        if (!existing) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        const summary = await sessionHub.deleteSession(sessionId);
        return {
          sessionId,
          deleted: true,
          ...(summary ? { updatedAt: summary.updatedAt } : {}),
        };
      },
    },
  };
}
