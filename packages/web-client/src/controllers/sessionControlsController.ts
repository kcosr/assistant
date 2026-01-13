import type { CollectionItemSummary } from './collectionTypes';
import { stripContextLine } from '../utils/chatMessageRenderer';
import { resolveAutoTitle } from '../utils/sessionLabel';

interface SessionSummary {
  sessionId: string;
  /**
   * Optional user-defined session name.
   */
  name?: string;
  /**
   * Optional session-scoped attributes for plugins/panels.
   */
  attributes?: Record<string, unknown>;
  lastSnippet?: string;
}

export interface SessionControlsControllerOptions {
  sessionNameDisplay: HTMLElement;
  getActiveSessionId: () => string | null;
  getSessionSummaries: () => SessionSummary[];
  getAvailableItems: () => CollectionItemSummary[];
}

export class SessionControlsController {
  constructor(private readonly options: SessionControlsControllerOptions) {}

  update(): void {
    const activeSessionId = this.options.getActiveSessionId();
    if (!activeSessionId) {
      this.options.sessionNameDisplay.textContent = '-';
      return;
    }

    const session = this.options
      .getSessionSummaries()
      .find((summary) => summary.sessionId === activeSessionId);

    if (session) {
      let title: string | null = null;

      const name = typeof session.name === 'string' ? session.name.trim() : '';
      if (name) {
        title = name;
      }

      if (!title) {
        const autoTitle = resolveAutoTitle(session.attributes);
        if (autoTitle) {
          title = autoTitle;
        }
      }

      if (!title) {
        const snippet =
          typeof session.lastSnippet === 'string'
            ? stripContextLine(session.lastSnippet).trim()
            : '';
        title = snippet.length > 0 ? snippet : 'New session';
      }

      const truncated = title.length > 40 ? `${title.slice(0, 37)}…` : title;
      this.options.sessionNameDisplay.textContent = truncated;
    } else {
      this.options.sessionNameDisplay.textContent = activeSessionId.slice(0, 8) + '…';
    }
  }
}
