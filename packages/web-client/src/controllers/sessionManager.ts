import { apiFetch } from '../utils/api';
import { readSessionOperationResult, sessionsOperationPath } from '../utils/sessionsApi';

export interface SessionManagerOptions {
  getSelectedSessionId: () => string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  refreshSessions: (preferredSessionId?: string | null) => Promise<void>;
  clearChatForSession: (sessionId: string) => void;
  closeChatPanelForSession: (sessionId: string) => void;
  clearSidebarFocusState: () => void;
  getAllSessionItems: () => HTMLElement[];
  focusZone: (zone: 'sidebar' | 'input') => void;
  openChatPanelForSession: (sessionId: string) => void;
  setStatus: (text: string) => void;
  dialogManager: {
    showTextInputDialog: (options: {
      title: string;
      message: string;
      confirmText: string;
      confirmClassName?: string;
      cancelText?: string;
      initialValue?: string;
      placeholder?: string;
      validate?: (value: string) => string | null;
    }) => Promise<string | null>;
  };
}

export interface CreateSessionOptions {
  agentType?: 'chat' | 'external';
  agentDisplayName?: string;
  openChatPanel?: boolean;
  selectSession?: boolean;
  workingDir?: string;
}

export class SessionManager {
  constructor(private readonly options: SessionManagerOptions) {}

  private static readonly EXTERNAL_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

  private validateExternalSessionId(sessionId: string): string | null {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return 'sessionId must not be empty';
    }
    if (trimmed.length > 128) {
      return 'sessionId must be at most 128 characters';
    }
    if (!SessionManager.EXTERNAL_SESSION_ID_PATTERN.test(trimmed)) {
      return 'sessionId must match [A-Za-z0-9_-] only';
    }
    return null;
  }

  private async promptForExternalSessionId(options?: {
    agentDisplayName?: string;
  }): Promise<string | null> {
    const suffix = options?.agentDisplayName ? ` (${options.agentDisplayName})` : '';

    return this.options.dialogManager.showTextInputDialog({
      title: 'External Session ID',
      message: '',
      confirmText: 'Attach',
      ...(suffix ? { title: `External Session ID${suffix}` } : {}),
      validate: (value) => this.validateExternalSessionId(value),
    });
  }

  async pinSession(sessionId: string, pinned: boolean): Promise<void> {
    try {
      const body: { pinnedAt: string | null } = {
        pinnedAt: pinned ? new Date().toISOString() : null,
      };
      const response = await apiFetch(sessionsOperationPath('update'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, ...body }),
      });
      if (!response.ok) {
        console.error('Failed to update pin state for session', response.status);
        return;
      }
      await this.options.refreshSessions(this.options.getSelectedSessionId());
    } catch (err) {
      console.error('Failed to update pin state for session', err);
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    try {
      const response = await apiFetch(sessionsOperationPath('clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        this.options.setStatus('Failed to clear session');
        return;
      }

      this.options.clearChatForSession(sessionId);

      await this.options.refreshSessions(this.options.getSelectedSessionId());
    } catch (err) {
      console.error('Failed to clear session', err);
      this.options.setStatus('Failed to clear session');
    }
  }

  async deleteSession(sessionId: string, fromKeyboard: boolean = false): Promise<void> {
    try {
      let nextSessionId: string | null = null;
      if (fromKeyboard) {
        const items = this.options.getAllSessionItems();
        const currentIndex = items.findIndex((el) => el.dataset['sessionId'] === sessionId);
        if (currentIndex !== -1) {
          const nextItem = items[currentIndex + 1] ?? items[currentIndex - 1];
          nextSessionId = nextItem?.dataset['sessionId'] ?? null;
        }
      }

      const response = await apiFetch(sessionsOperationPath('delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        this.options.setStatus('Failed to delete session');
        return;
      }

      const selectedSessionId = this.options.getSelectedSessionId();
      const wasSelected = sessionId === selectedSessionId;

      this.options.closeChatPanelForSession(sessionId);
      await this.options.refreshSessions(wasSelected ? (nextSessionId ?? null) : selectedSessionId);

      if (wasSelected) {
        const nextSelected = this.options.getSelectedSessionId();
        if (nextSelected) {
          this.options.openChatPanelForSession(nextSelected);
        }

        if (fromKeyboard && nextSelected) {
          setTimeout(() => {
            this.options.focusZone('sidebar');
          }, 100);
        }
      }
    } catch (err) {
      console.error('Failed to delete session', err);
      this.options.setStatus('Failed to delete session');
    }
  }

  selectSession(sessionId: string): void {
    console.log('[client] selectSession', {
      sessionId,
      selectedSessionId: this.options.getSelectedSessionId(),
    });
    if (sessionId === this.options.getSelectedSessionId()) {
      this.options.openChatPanelForSession(sessionId);
      return;
    }

    this.options.setSelectedSessionId(sessionId);
    this.options.openChatPanelForSession(sessionId);
  }

  async createSessionForAgent(
    agentId: string,
    options?: CreateSessionOptions,
  ): Promise<string | null> {
    try {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        this.options.setStatus('Agent is required to create a session');
        return null;
      }
      const shouldSelectSession = options?.selectSession !== false;
      const shouldOpenChatPanel = options?.openChatPanel !== false;
      let externalSessionId: string | undefined;
      if (options?.agentType === 'external') {
        const entered = await this.promptForExternalSessionId(
          options.agentDisplayName ? { agentDisplayName: options.agentDisplayName } : undefined,
        );
        if (!entered) {
          return null;
        }
        externalSessionId = entered;
      }

      const buildRequest = (sessionId?: string): RequestInit => {
        const workingDir =
          typeof options?.workingDir === 'string' ? options.workingDir.trim() : '';
        const attributes =
          workingDir.length > 0 ? { core: { workingDir } } : undefined;
        const request: RequestInit = { method: 'POST' };
        request.headers = { 'Content-Type': 'application/json' };
        request.body = JSON.stringify({
          agentId: normalizedAgentId,
          ...(sessionId ? { sessionId } : {}),
          ...(attributes ? { attributes } : {}),
        });
        return request;
      };

      const readError = async (response: Response): Promise<string | null> => {
        try {
          const json = (await response.json()) as unknown;
          if (json && typeof json === 'object' && 'error' in json) {
            const error = (json as { error?: unknown }).error;
            if (typeof error === 'string' && error.trim()) {
              return error.trim();
            }
          }
        } catch {
          // ignore JSON parse errors and fall back to text
        }
        try {
          const text = (await response.text()).trim();
          return text || null;
        } catch {
          return null;
        }
      };

      let response = await apiFetch(
        sessionsOperationPath('create'),
        buildRequest(externalSessionId),
      );
      if (!response.ok) {
        const error = await readError(response);
        if (
          response.status === 400 &&
          !externalSessionId &&
          typeof error === 'string' &&
          error.toLowerCase().includes('sessionid is required for external agents')
        ) {
          const entered = await this.promptForExternalSessionId(
            options?.agentDisplayName ? { agentDisplayName: options.agentDisplayName } : undefined,
          );
          if (!entered) {
            return null;
          }
          externalSessionId = entered;
          response = await apiFetch(
            sessionsOperationPath('create'),
            buildRequest(externalSessionId),
          );
        }

        if (!response.ok) {
          const finalError = (await readError(response)) ?? 'Failed to create new session';
          this.options.setStatus(finalError);
          return null;
        }
      }

      const summary = await readSessionOperationResult<{ sessionId?: unknown }>(response);
      const sessionId =
        summary && typeof summary === 'object' && 'sessionId' in summary
          ? (summary as { sessionId?: unknown }).sessionId
          : null;
      if (typeof sessionId !== 'string') {
        this.options.setStatus('Failed to create new session');
        return null;
      }

      if (shouldSelectSession) {
        this.options.setSelectedSessionId(sessionId);
      }
      if (shouldOpenChatPanel) {
        this.options.openChatPanelForSession(sessionId);
      }

      this.options.clearSidebarFocusState();

      console.log('[client] createSessionForAgent: created session', { sessionId });

      void this.options.refreshSessions(sessionId);
      console.log('[client] createSessionForAgent: connect called');
      return sessionId;
    } catch (err) {
      console.error('Failed to create new session', err);
      this.options.setStatus('Failed to create new session');
      return null;
    }
  }
}
