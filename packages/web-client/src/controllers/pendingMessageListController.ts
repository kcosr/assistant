import type {
  ServerMessageDequeuedMessage,
  ServerMessageQueuedMessage,
} from '@assistant/shared';

type PendingMessage = {
  messageId: string;
  sessionId: string;
  text: string;
  source?: 'user' | 'agent';
  fromAgentId?: string;
  fromSessionId?: string;
  position?: number;
  queuedOrder: number;
};

export interface PendingMessageListControllerOptions {
  container: HTMLElement;
  getSessionId: () => string | null;
  getAgentDisplayName: (agentId: string) => string;
  cancelQueuedMessage: (messageId: string) => void;
}

export class PendingMessageListController {
  private readonly messagesBySession = new Map<string, Map<string, PendingMessage>>();
  private readonly headerEl: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly listEl: HTMLDivElement;
  private sessionId: string | null = null;
  private nextOrder = 0;

  constructor(private readonly options: PendingMessageListControllerOptions) {
    const { container } = options;
    container.innerHTML = '';

    this.headerEl = document.createElement('div');
    this.headerEl.className = 'pending-message-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'pending-message-title';
    titleEl.textContent = 'Pending';

    this.countEl = document.createElement('span');
    this.countEl.className = 'pending-message-count';

    this.headerEl.appendChild(titleEl);
    this.headerEl.appendChild(this.countEl);

    this.listEl = document.createElement('div');
    this.listEl.className = 'pending-message-scroll';
    this.listEl.setAttribute('role', 'list');

    container.appendChild(this.headerEl);
    container.appendChild(this.listEl);

    this.sessionId = options.getSessionId();
    this.render();
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
    this.render();
  }

  handleMessageQueued(message: ServerMessageQueuedMessage): void {
    const sessionId = message.sessionId ?? this.sessionId;
    if (!sessionId) {
      return;
    }

    const queue = this.messagesBySession.get(sessionId) ?? new Map();
    const existing = queue.get(message.messageId);
    const source =
      message.source ?? (message.fromAgentId || message.fromSessionId ? 'agent' : 'user');
    const next: PendingMessage = {
      messageId: message.messageId,
      sessionId,
      text: message.text,
      source,
      position: message.position,
      queuedOrder: existing?.queuedOrder ?? this.nextOrder++,
      ...(message.fromAgentId ? { fromAgentId: message.fromAgentId } : {}),
      ...(message.fromSessionId ? { fromSessionId: message.fromSessionId } : {}),
    };
    queue.set(message.messageId, next);
    this.messagesBySession.set(sessionId, queue);
    if (this.sessionId === sessionId) {
      this.render();
    }
  }

  handleMessageDequeued(message: ServerMessageDequeuedMessage): void {
    const sessionId = message.sessionId ?? this.sessionId;
    if (!sessionId) {
      return;
    }
    const queue = this.messagesBySession.get(sessionId);
    if (!queue) {
      return;
    }
    queue.delete(message.messageId);
    if (queue.size === 0) {
      this.messagesBySession.delete(sessionId);
    }
    if (this.sessionId === sessionId) {
      this.render();
    }
  }

  clearSession(sessionId: string): void {
    if (!sessionId) {
      return;
    }
    this.messagesBySession.delete(sessionId);
    if (this.sessionId === sessionId) {
      this.render();
    }
  }

  private render(): void {
    const { container } = this.options;
    const sessionId = this.sessionId;
    const queue = sessionId ? this.messagesBySession.get(sessionId) : undefined;
    const items = queue ? Array.from(queue.values()) : [];

    items.sort((a, b) => {
      const posA = typeof a.position === 'number' ? a.position : a.queuedOrder;
      const posB = typeof b.position === 'number' ? b.position : b.queuedOrder;
      return posA - posB;
    });

    this.countEl.textContent = items.length > 0 ? String(items.length) : '';
    container.classList.toggle('has-items', items.length > 0);

    this.listEl.innerHTML = '';

    if (items.length === 0) {
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'pending-message-item';
      row.dataset['messageId'] = item.messageId;
      row.setAttribute('role', 'listitem');

      const content = document.createElement('div');

      const meta = document.createElement('div');
      meta.className = 'pending-message-meta';

      const sender = document.createElement('span');
      sender.className = 'pending-message-sender';
      sender.textContent = this.getSenderLabel(item);
      meta.appendChild(sender);

      const status = document.createElement('span');
      status.className = 'pending-message-status';
      status.textContent = items.length > 1 ? `Queued #${index + 1}` : 'Queued';
      meta.appendChild(status);

      const text = document.createElement('div');
      text.className = 'pending-message-text';
      text.textContent = item.text;

      content.appendChild(meta);
      content.appendChild(text);

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'pending-message-cancel';
      cancel.setAttribute('aria-label', 'Remove queued message');
      cancel.textContent = '×';
      cancel.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.options.cancelQueuedMessage(item.messageId);
      });

      row.appendChild(content);
      row.appendChild(cancel);
      this.listEl.appendChild(row);
    });
  }

  private getSenderLabel(item: PendingMessage): string {
    if (item.source === 'agent' || item.fromAgentId) {
      const agentId = item.fromAgentId ?? '';
      const label = agentId ? this.options.getAgentDisplayName(agentId) : '';
      return label || 'Agent';
    }
    return 'You';
  }
}
