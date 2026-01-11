export interface SessionTypingIndicatorControllerOptions {
  isSessionVisible: (sessionId: string) => boolean;
  sessionsWithPendingMessages: Set<string>;
}

export class SessionTypingIndicatorController {
  private readonly activityHideTimeouts = new Map<string, number>();

  constructor(private readonly options: SessionTypingIndicatorControllerOptions) {}

  show(sessionId: string): void {
    const indicator = this.getIndicator(sessionId);
    if (indicator) {
      indicator.classList.add('visible');
      indicator.classList.remove('has-pending');
    }
  }

  hide(sessionId: string): void {
    const indicator = this.getIndicator(sessionId);
    if (!indicator) {
      return;
    }

    indicator.classList.remove('visible');

    if (!this.options.isSessionVisible(sessionId)) {
      indicator.classList.add('has-pending');
      this.options.sessionsWithPendingMessages.add(sessionId);
    } else {
      indicator.classList.remove('has-pending');
      this.options.sessionsWithPendingMessages.delete(sessionId);
    }
  }

  clearPending(sessionId: string): void {
    const indicator = this.getIndicator(sessionId);
    if (indicator) {
      indicator.classList.remove('has-pending');
    }
    this.options.sessionsWithPendingMessages.delete(sessionId);
  }

  private getIndicator(sessionId: string): HTMLElement | null {
    return document.querySelector(`.session-typing-indicator[data-session-id="${sessionId}"]`);
  }

  showActivity(sessionId: string): void {
    this.clearActivityHideTimeout(sessionId);
    const indicator = this.getActivityIndicator(sessionId);
    if (!indicator) {
      return;
    }
    indicator.classList.remove('hidden');
  }

  scheduleHideActivity(sessionId: string, delayMs: number): void {
    this.clearActivityHideTimeout(sessionId);
    if (delayMs <= 0) {
      this.hideActivity(sessionId);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      this.activityHideTimeouts.delete(sessionId);
      this.hideActivity(sessionId);
    }, delayMs);
    this.activityHideTimeouts.set(sessionId, timeoutId);
  }

  hideActivity(sessionId: string): void {
    this.clearActivityHideTimeout(sessionId);
    const indicator = this.getActivityIndicator(sessionId);
    if (!indicator) {
      return;
    }
    indicator.classList.add('hidden');
  }

  private clearActivityHideTimeout(sessionId: string): void {
    const existingTimeoutId = this.activityHideTimeouts.get(sessionId);
    if (typeof existingTimeoutId === 'number') {
      window.clearTimeout(existingTimeoutId);
      this.activityHideTimeouts.delete(sessionId);
    }
  }

  private getActivityIndicator(sessionId: string): HTMLElement | null {
    return document.querySelector(`.session-activity-indicator[data-session-id="${sessionId}"]`);
  }
}
