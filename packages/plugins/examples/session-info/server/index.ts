import type { CombinedPluginManifest } from '@assistant/shared';

import type { SessionSummary } from '../../../../agent-server/src/sessionIndex';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type LabelSetArgs = {
  text: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseLabelSetArgs(raw: unknown): LabelSetArgs {
  const obj = asObject(raw);
  const textRaw = obj['text'];
  if (typeof textRaw !== 'string') {
    throw new ToolError('invalid_arguments', 'text is required and must be a string');
  }
  return { text: textRaw };
}

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

function getSessionInfoLabel(summary: SessionSummary | undefined): string | null {
  const attributes = summary?.attributes as Record<string, unknown> | undefined;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return null;
  }
  const sessionInfo = attributes['sessionInfo'];
  if (!sessionInfo || typeof sessionInfo !== 'object' || Array.isArray(sessionInfo)) {
    return null;
  }
  const label = (sessionInfo as Record<string, unknown>)['label'];
  return typeof label === 'string' && label.trim().length > 0 ? label : null;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      label_set: async (args, ctx) => {
        const sessionHub = requireSessionHub(ctx);
        const parsed = parseLabelSetArgs(args);

        const sessionId = ctx.sessionId?.trim();
        if (!sessionId) {
          throw new ToolError('invalid_session', 'Session id is required');
        }

        const trimmed = parsed.text.trim();
        const label = trimmed.length > 0 ? trimmed : null;

        const summary = await sessionHub.updateSessionAttributes(sessionId, {
          sessionInfo: {
            label: label ?? null,
          },
        });
        if (!summary) {
          throw new ToolError('session_not_found', 'Session not found');
        }

        return {
          ok: true,
          label: getSessionInfoLabel(summary),
        };
      },
      label_get: async (_args, ctx) => {
        const sessionHub = requireSessionHub(ctx);
        const sessionId = ctx.sessionId?.trim();
        if (!sessionId) {
          throw new ToolError('invalid_session', 'Session id is required');
        }

        const summary = await sessionHub.getSessionIndex().getSession(sessionId);
        return {
          label: getSessionInfoLabel(summary),
        };
      },
    },
    async initialize(): Promise<void> {
      // No initialization required.
    },
  };
}
