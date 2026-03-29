import { apiFetch } from '../utils/api';
import { readSessionOperationResult, sessionsOperationPath } from '../utils/sessionsApi';
import type { SessionContextUsage } from '@assistant/shared';

interface SessionSummary {
  agentId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When set, indicates that the session is pinned in the UI.
   * The value is the timestamp when the session was pinned and
   * is used for ordering pinned sessions (most recently pinned first).
   */
  pinnedAt?: string;
  /**
   * Optional user-defined session name.
   */
  name?: string;
  /**
   * Optional session-scoped attributes for plugins/panels.
   */
  attributes?: Record<string, unknown>;
  lastSnippet?: string;
  /**
   * Currently selected chat model for this session (when applicable).
   */
  model?: string;
  /**
   * Currently selected thinking level for this session (when applicable).
   */
  thinking?: string;
  contextUsage?: SessionContextUsage;
}

interface ListSessionsResponse {
  sessions: SessionSummary[];
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
  sessionWorkingDir?:
    | { mode: 'none' }
    | { mode: 'fixed'; path: string }
    | { mode: 'prompt'; roots: string[] };
  sessionConfigCapabilities?: {
    availableModels?: string[];
    availableThinking?: string[];
    availableSkills?: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  };
}

interface OperationResponse<T> {
  ok?: boolean;
  result?: T;
}

export interface SessionDataControllerOptions {
  getSelectedSessionId: () => string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  setSessionSummaries: (summaries: SessionSummary[]) => void;
  setAgentSummaries: (agents: AgentSummary[]) => void;
  renderAgentSidebar: () => void;
}

export class SessionDataController {
  constructor(private readonly options: SessionDataControllerOptions) {}

  private isPinned(session: SessionSummary): boolean {
    return typeof session.pinnedAt === 'string' && session.pinnedAt.length > 0;
  }

  private compareSessions(a: SessionSummary, b: SessionSummary): number {
    const aPinned = this.isPinned(a);
    const bPinned = this.isPinned(b);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    if (aPinned && bPinned) {
      const aPinnedTime = new Date(a.pinnedAt as string).getTime();
      const bPinnedTime = new Date(b.pinnedAt as string).getTime();
      if (aPinnedTime !== bPinnedTime) {
        return bPinnedTime - aPinnedTime;
      }
    }

    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    return bCreated - aCreated;
  }

  async fetchAgents(): Promise<void> {
    try {
      const response = await apiFetch('/api/plugins/agents/operations/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeAll: true }),
      });
      if (!response.ok) {
        console.error('Failed to fetch agents', response.status);
        return;
      }
      const data = (await response.json()) as unknown;
      let rawAgents: AgentSummary[] = [];
      if (data && typeof data === 'object') {
        const direct = (data as { agents?: unknown }).agents;
        if (Array.isArray(direct)) {
          rawAgents = direct as AgentSummary[];
        } else {
          const wrapped = (data as OperationResponse<{ agents?: unknown }>).result?.agents;
          if (Array.isArray(wrapped)) {
            rawAgents = wrapped as AgentSummary[];
          }
        }
      }
      const parsedAgents: AgentSummary[] = [];
      for (const agent of rawAgents) {
        if (!agent || typeof agent !== 'object') {
          continue;
        }
        const anyAgent = agent as {
          agentId?: unknown;
          displayName?: unknown;
          description?: unknown;
          type?: unknown;
          sessionWorkingDir?: unknown;
          sessionConfigCapabilities?: unknown;
        };

        const agentId = typeof anyAgent.agentId === 'string' ? anyAgent.agentId.trim() : '';
        if (!agentId) {
          continue;
        }

        const displayNameRaw =
          typeof anyAgent.displayName === 'string' ? anyAgent.displayName.trim() : '';
        const displayName = displayNameRaw || agentId;

        const description =
          typeof anyAgent.description === 'string' && anyAgent.description.trim()
            ? anyAgent.description.trim()
            : undefined;

        const typeRaw = typeof anyAgent.type === 'string' ? anyAgent.type.trim() : '';
        const type = typeRaw === 'external' || typeRaw === 'chat' ? typeRaw : undefined;

        let sessionWorkingDir:
          | { mode: 'none' }
          | { mode: 'fixed'; path: string }
          | { mode: 'prompt'; roots: string[] }
          | undefined;
        if (
          anyAgent.sessionWorkingDir &&
          typeof anyAgent.sessionWorkingDir === 'object' &&
          !Array.isArray(anyAgent.sessionWorkingDir)
        ) {
          const raw = anyAgent.sessionWorkingDir as {
            mode?: unknown;
            path?: unknown;
            roots?: unknown;
          };
          const mode = typeof raw.mode === 'string' ? raw.mode.trim() : '';
          if (mode === 'none') {
            sessionWorkingDir = { mode: 'none' };
          } else if (mode === 'fixed') {
            const pathValue = typeof raw.path === 'string' ? raw.path.trim() : '';
            if (pathValue) {
              sessionWorkingDir = { mode: 'fixed', path: pathValue };
            }
          } else if (mode === 'prompt') {
            const roots = Array.isArray(raw.roots)
              ? raw.roots
                  .filter((root) => typeof root === 'string')
                  .map((root) => root.trim())
                  .filter((root) => root.length > 0)
              : [];
            if (roots.length > 0) {
              sessionWorkingDir = { mode: 'prompt', roots };
            }
          }
        }

        let sessionConfigCapabilities:
          | {
              availableModels?: string[];
              availableThinking?: string[];
              availableSkills?: Array<{ id: string; name: string; description: string }>;
            }
          | undefined;
        if (
          anyAgent.sessionConfigCapabilities &&
          typeof anyAgent.sessionConfigCapabilities === 'object' &&
          !Array.isArray(anyAgent.sessionConfigCapabilities)
        ) {
          const raw = anyAgent.sessionConfigCapabilities as {
            availableModels?: unknown;
            availableThinking?: unknown;
            availableSkills?: unknown;
          };
          const availableModels = Array.isArray(raw.availableModels)
            ? raw.availableModels
                .filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
            : [];
          const availableThinking = Array.isArray(raw.availableThinking)
            ? raw.availableThinking
                .filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
            : [];
          const availableSkills = Array.isArray(raw.availableSkills)
            ? raw.availableSkills
                .filter(
                  (value): value is { id: string; name: string; description: string } =>
                    !!value &&
                    typeof value === 'object' &&
                    typeof (value as { id?: unknown }).id === 'string' &&
                    typeof (value as { name?: unknown }).name === 'string' &&
                    typeof (value as { description?: unknown }).description === 'string',
                )
                .map((value) => ({
                  id: value.id.trim(),
                  name: value.name.trim(),
                  description: value.description.trim(),
                }))
                .filter((value) => value.id && value.name)
            : [];
          if (availableModels.length > 0 || availableThinking.length > 0 || availableSkills.length > 0) {
            sessionConfigCapabilities = {
              ...(availableModels.length > 0 ? { availableModels } : {}),
              ...(availableThinking.length > 0 ? { availableThinking } : {}),
              ...(availableSkills.length > 0 ? { availableSkills } : {}),
            };
          }
        }

        parsedAgents.push({
          agentId,
          displayName,
          ...(description ? { description } : {}),
          ...(type ? { type } : {}),
          ...(sessionWorkingDir ? { sessionWorkingDir } : {}),
          ...(sessionConfigCapabilities ? { sessionConfigCapabilities } : {}),
        });
      }

      this.options.setAgentSummaries(parsedAgents);
    } catch (err) {
      console.error('Failed to fetch agents', err);
      this.options.setAgentSummaries([]);
    }
    this.options.renderAgentSidebar();
  }

  async refreshSessions(preferredSessionId?: string | null): Promise<void> {
    try {
      const response = await apiFetch(sessionsOperationPath('list'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        console.error('Failed to fetch sessions', response.status);
        return;
      }
      const data = await readSessionOperationResult<ListSessionsResponse>(response);
      const summaries = Array.isArray(data?.sessions) ? data.sessions : [];
      this.options.setSessionSummaries(summaries);

      const preferred =
        typeof preferredSessionId === 'string'
          ? preferredSessionId
          : this.options.getSelectedSessionId();
      let nextActive: string | null = preferred ?? null;

      if (nextActive && !summaries.some((session) => session.sessionId === nextActive)) {
        nextActive =
          summaries.length > 0
            ? (summaries.slice().sort((a, b) => this.compareSessions(a, b))[0]?.sessionId ?? null)
            : null;
      }

      this.options.setSelectedSessionId(nextActive ?? null);
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    }
    this.options.renderAgentSidebar();
  }
}
