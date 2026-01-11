/**
 * Controller for displaying a preview of panel context (e.g., selected text)
 * above the chat input area.
 */

export interface ContextPreviewData {
  /** The type of context (e.g., 'note', 'list') */
  type: string;
  /** Display name for the context source */
  name: string;
  /** The selected/highlighted text content */
  selectedText?: string;
  /** Number of selected items (for lists) */
  selectedItemCount?: number;
  /** Titles of selected items (for lists) */
  selectedItemTitles?: string[];
}

export interface ContextPreviewControllerOptions {
  container: HTMLElement;
  /** Called when the user clears the context preview */
  onClearSelection?: () => void;
  /** Whether context is enabled */
  getIncludePanelContext: () => boolean;
}

export class ContextPreviewController {
  private readonly containerEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly sourceEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  private currentData: ContextPreviewData | null = null;

  constructor(private readonly options: ContextPreviewControllerOptions) {
    const { container } = options;
    container.innerHTML = '';
    container.className = 'context-preview';

    this.containerEl = container;

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'context-preview-content';

    this.sourceEl = document.createElement('div');
    this.sourceEl.className = 'context-preview-source';

    this.textEl = document.createElement('div');
    this.textEl.className = 'context-preview-text';

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'context-preview-clear';
    this.clearButton.setAttribute('aria-label', 'Clear selection');
    this.clearButton.textContent = '×';
    this.clearButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onClearSelection?.();
    });

    this.contentEl.appendChild(this.sourceEl);
    this.contentEl.appendChild(this.textEl);
    container.appendChild(this.contentEl);
    container.appendChild(this.clearButton);

    this.render();
  }

  /**
   * Update the preview with new context data.
   */
  update(data: ContextPreviewData | null): void {
    this.currentData = data;
    this.render();
  }

  /**
   * Clear the preview.
   */
  clear(): void {
    this.currentData = null;
    this.render();
  }

  private render(): void {
    const data = this.currentData;
    const includeContext = this.options.getIncludePanelContext();

    // Determine if we have something meaningful to show
    const hasSelectedText = Boolean(data?.selectedText && data.selectedText.trim().length > 0);
    const hasSelectedItems = Boolean(data?.selectedItemCount && data.selectedItemCount > 0);
    const hasContent = hasSelectedText || hasSelectedItems;

    // Only show if context is enabled and we have content
    const shouldShow = includeContext && hasContent;
    this.containerEl.classList.toggle('visible', shouldShow);

    if (!shouldShow || !data) {
      return;
    }

    // Build source label (e.g., "📝 Note: My Note" or "📋 List: Shopping")
    const icon = data.type === 'note' ? '📝' : data.type === 'list' ? '📋' : '📄';
    const typeLabel = data.type.charAt(0).toUpperCase() + data.type.slice(1);
    this.sourceEl.textContent = `${icon} ${typeLabel}: ${data.name}`;

    // Build content preview
    if (hasSelectedText) {
      const text = data.selectedText!.trim();
      const maxLength = 150;
      const truncated = text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
      // Replace newlines with spaces for compact display
      this.textEl.textContent = `"${truncated.replace(/\n+/g, ' ')}"`;
    } else if (hasSelectedItems) {
      const count = data.selectedItemCount!;
      if (data.selectedItemTitles && data.selectedItemTitles.length > 0) {
        const titles = data.selectedItemTitles.slice(0, 3);
        const more = count > 3 ? ` +${count - 3} more` : '';
        this.textEl.textContent = titles.join(', ') + more;
      } else {
        this.textEl.textContent = `${count} item${count === 1 ? '' : 's'} selected`;
      }
    }
  }
}
