export class ChatScrollManager {
  private userScrolledAway = false;
  private scrollTimeoutId: number | null = null;
  private readonly bottomThresholdPx: number;
  private autoScrollEnabled = true;

  constructor(
    private readonly container: HTMLElement,
    private readonly scrollToBottomButton: HTMLButtonElement,
    options?: { bottomThresholdPx?: number },
  ) {
    this.bottomThresholdPx = options?.bottomThresholdPx ?? 50;
  }

  setAutoScrollEnabled(enabled: boolean): void {
    this.autoScrollEnabled = enabled;
  }

  private isAtBottom(): boolean {
    const { scrollHeight, scrollTop, clientHeight } = this.container;
    return scrollHeight - scrollTop - clientHeight < this.bottomThresholdPx;
  }

  updateScrollButtonVisibility(): void {
    if (this.isAtBottom()) {
      this.scrollToBottomButton.classList.remove('visible');
      this.userScrolledAway = false;
    } else {
      this.scrollToBottomButton.classList.add('visible');
    }
  }

  scrollToBottom(): void {
    this.userScrolledAway = false;
    this.container.scrollTop = this.container.scrollHeight;
    this.scrollToBottomButton.classList.remove('visible');
  }

  scrollToTop(): void {
    this.container.scrollTop = 0;
    this.userScrolledAway = true;
    this.updateScrollButtonVisibility();
  }

  autoScrollIfEnabled(): void {
    if (this.autoScrollEnabled && !this.userScrolledAway) {
      this.container.scrollTop = this.container.scrollHeight;
    }
    this.updateScrollButtonVisibility();
  }

  handleScroll(): void {
    if (this.scrollTimeoutId !== null) {
      window.clearTimeout(this.scrollTimeoutId);
    }
    this.scrollTimeoutId = window.setTimeout(() => {
      this.scrollTimeoutId = null;
    }, 150);

    if (!this.isAtBottom()) {
      this.userScrolledAway = true;
    }
    this.updateScrollButtonVisibility();
  }

  handleUserScrollStart(): void {
    this.userScrolledAway = true;
  }

  resetScrollState(): void {
    this.userScrolledAway = false;
    this.scrollToBottomButton.classList.remove('visible');
  }
}
