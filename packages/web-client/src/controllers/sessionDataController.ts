import { apiFetch } from '../utils/api';
import { readSessionOperationResult, sessionsOperationPath } from '../utils/sessionsApi';

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
}

interface ListSessionsResponse {
  sessions: SessionSummary[];
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
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

        parsedAgents.push({
          agentId,
          displayName,
          ...(description ? { description } : {}),
          ...(type ? { type } : {}),
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
