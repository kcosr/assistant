export class ChatScrollManager {
  private userScrolledAway = false;
  private scrollTimeoutId: number | null = null;
  private bottomSettleFrameId: number | null = null;
  private bottomSettleToken = 0;
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

  scrollToBottomAfterLayout(frames: number = 2): void {
    this.scrollToBottom();
    if (typeof requestAnimationFrame !== 'function' || frames <= 0) {
      return;
    }
    this.bottomSettleToken += 1;
    const settleToken = this.bottomSettleToken;
    if (this.bottomSettleFrameId !== null) {
      cancelAnimationFrame(this.bottomSettleFrameId);
      this.bottomSettleFrameId = null;
    }
    let remainingFrames = frames;
    const settle = () => {
      if (settleToken !== this.bottomSettleToken) {
        return;
      }
      this.scrollToBottom();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        this.bottomSettleFrameId = requestAnimationFrame(settle);
      } else {
        this.bottomSettleFrameId = null;
      }
    };
    this.bottomSettleFrameId = requestAnimationFrame(settle);
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
