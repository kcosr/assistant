import type { SessionAttributesPatch } from '@assistant/shared';
import type { SessionSummary } from './sessionIndex';
import { isPlainObject, mergeSessionAttributes } from './sessionAttributes';

export type SessionIndexRecord =
  | {
      type: 'session_created';
      sessionId: string;
      timestamp: string;
      agentId: string;
      model?: string;
    }
  | {
      type: 'session_updated';
      sessionId: string;
      timestamp: string;
      lastSnippet?: string;
    }
  | {
      type: 'session_deleted';
      sessionId: string;
      timestamp: string;
    }
  | {
      type: 'session_renamed';
      sessionId: string;
      timestamp: string;
      name: string | null;
    }
  | {
      type: 'session_agent_set';
      sessionId: string;
      timestamp: string;
      agentId: string;
    }
  | {
      type: 'session_cleared';
      sessionId: string;
      timestamp: string;
    }
  | {
      type: 'session_pinned';
      sessionId: string;
      timestamp: string;
      pinnedAt: string | null;
    }
  | {
      type: 'session_model_set';
      sessionId: string;
      timestamp: string;
      model: string | null;
    }
  | {
      type: 'session_attributes_patch';
      sessionId: string;
      timestamp: string;
      patch: SessionAttributesPatch;
    };

export function loadSessionIndexFromFileContent(
  content: string,
  sessions: Map<string, SessionSummary>,
): void {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        sessionId?: string;
        timestamp?: string;
        [key: string]: unknown;
      };
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.timestamp !== 'string'
      ) {
        continue;
      }

      const { sessionId, timestamp } = parsed;
      let summary = sessions.get(sessionId);
      if (!summary) {
        summary = {
          sessionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }

      if (parsed.type === 'session_created') {
        const created = parsed as { agentId?: unknown; model?: unknown } & typeof parsed;
        summary.createdAt = timestamp;
        summary.updatedAt = timestamp;
        if (typeof created.agentId === 'string' && created.agentId.length > 0) {
          summary.agentId = created.agentId;
        }
        if (typeof created.model === 'string' && created.model.length > 0) {
          summary.model = created.model;
        }
      } else if (parsed.type === 'session_updated') {
        const updated = parsed as { lastSnippet?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (typeof updated.lastSnippet === 'string') {
          summary.lastSnippet = updated.lastSnippet;
        }
      } else if (parsed.type === 'session_deleted') {
        sessions.delete(sessionId);
        continue;
      } else if (parsed.type === 'session_renamed') {
        const renamed = parsed as { name?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (renamed.name === null) {
          delete summary.name;
        } else if (typeof renamed.name === 'string') {
          summary.name = renamed.name;
        }
      } else if (parsed.type === 'session_agent_set') {
        const agentSet = parsed as { agentId?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (typeof agentSet.agentId === 'string' && agentSet.agentId.length > 0) {
          summary.agentId = agentSet.agentId;
        }
      } else if (parsed.type === 'session_cleared') {
        summary.updatedAt = timestamp;
        delete summary.lastSnippet;
      } else if (parsed.type === 'session_pinned') {
        const pinned = parsed as { pinnedAt?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (pinned.pinnedAt === null) {
          delete summary.pinnedAt;
        } else if (typeof pinned.pinnedAt === 'string') {
          summary.pinnedAt = pinned.pinnedAt;
        }
      } else if (parsed.type === 'session_model_set') {
        const modelSet = parsed as { model?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (modelSet.model === null) {
          delete summary.model;
        } else if (typeof modelSet.model === 'string' && modelSet.model.length > 0) {
          summary.model = modelSet.model;
        }
      } else if (parsed.type === 'session_attributes_patch') {
        const patchRecord = parsed as { patch?: unknown } & typeof parsed;
        summary.updatedAt = timestamp;
        if (isPlainObject(patchRecord.patch)) {
          const nextAttributes = mergeSessionAttributes(
            summary.attributes,
            patchRecord.patch as SessionAttributesPatch,
          );
          if (Object.keys(nextAttributes).length > 0) {
            summary.attributes = nextAttributes;
          } else {
            delete summary.attributes;
          }
        }
      }

      sessions.set(sessionId, summary);
    } catch {
      console.error('Failed to parse session index line', line);
    }
  }
}
