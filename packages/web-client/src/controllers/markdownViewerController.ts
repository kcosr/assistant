import { applyMarkdownToElement, enhanceCodeBlocksWithCopyButtons } from '../utils/markdown';
import { applyTextSearchHighlights } from '../utils/textSearchHighlight';

/**
 * Icons for collapse/expand toggles
 */
const COLLAPSE_ICON = '▼';
const EXPAND_ICON = '▶';
const MIXED_ICON = '◆';

/**
 * Get the heading level from a heading element (1-6).
 */
function getHeadingLevel(el: Element): number {
  const match = el.tagName.match(/^H(\d)$/i);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

/**
 * Options for creating a copy dropdown.
 */
interface CopyDropdownOptions {
  /** CSS class prefix for styling (e.g., 'collection-note-copy' or 'collapsible-section-copy') */
  classPrefix: string;
  /** Get plain text to copy */
  getPlainText: () => string;
  /** Get markdown to copy (if not provided or returns same as plain text, option is disabled) */
  getMarkdown?: () => string;
  /** Optional: make it compact (smaller for inline use) */
  compact?: boolean;
}

/**
 * Create a copy dropdown with Copy (plain text) and Copy Markdown options.
 * Returns the wrapper element.
 */
function createCopyDropdown(options: CopyDropdownOptions): HTMLElement {
  const { classPrefix, getPlainText, getMarkdown, compact } = options;

  const wrapper = document.createElement('div');
  wrapper.className = `${classPrefix}-wrapper`;

  const mainButton = document.createElement('button');
  mainButton.type = 'button';
  mainButton.className = `${classPrefix}-button ${classPrefix}-main-button`;
  mainButton.textContent = 'Copy';
  mainButton.setAttribute('aria-label', 'Copy as plain text');

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = `${classPrefix}-button ${classPrefix}-toggle-button`;
  toggleButton.setAttribute('aria-label', 'Copy options');

  const menu = document.createElement('div');
  menu.className = `${classPrefix}-menu`;

  const markdownItem = document.createElement('button');
  markdownItem.type = 'button';
  markdownItem.className = `${classPrefix}-menu-item`;
  markdownItem.textContent = 'Copy Markdown';

  // Disable markdown option if not available
  const markdownAvailable = Boolean(getMarkdown);
  if (!markdownAvailable) {
    markdownItem.disabled = true;
    markdownItem.title = 'Markdown source not available for this section';
  }

  menu.appendChild(markdownItem);
  wrapper.appendChild(mainButton);
  wrapper.appendChild(toggleButton);
  wrapper.appendChild(menu);

  if (compact) {
    wrapper.classList.add(`${classPrefix}-compact`);
  }

  // State
  let menuOpen = false;

  const setMenuOpen = (open: boolean): void => {
    if (menuOpen === open) {
      return;
    }
    menuOpen = open;
    menu.classList.toggle('open', menuOpen);

    const handleDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && (wrapper.contains(target) || target === toggleButton)) {
        return;
      }
      setMenuOpen(false);
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleMenuKeyDown);
    };

    const handleMenuKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        document.removeEventListener('click', handleDocumentClick);
        document.removeEventListener('keydown', handleMenuKeyDown);
      }
    };

    if (menuOpen) {
      document.addEventListener('click', handleDocumentClick);
      document.addEventListener('keydown', handleMenuKeyDown);
    }
  };

  const showCopySuccess = (): void => {
    const original = mainButton.textContent ?? 'Copy';
    mainButton.textContent = 'Copied';
    mainButton.disabled = true;
    setTimeout(() => {
      mainButton.textContent = original;
      mainButton.disabled = false;
    }, 1500);
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  toggleButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(!menuOpen);
  });

  mainButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    void copyToClipboard(getPlainText()).then((ok) => {
      if (ok) {
        showCopySuccess();
      }
    });
  });

  markdownItem.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!markdownAvailable) {
      return;
    }
    setMenuOpen(false);
    void copyToClipboard(getMarkdown!()).then((ok) => {
      if (ok) {
        showCopySuccess();
      }
    });
  });

  return wrapper;
}

/**
 * Transform rendered markdown content to have collapsible sections.
 * Each heading gets a toggle button, and content under it can be collapsed.
 * Sections are nested based on heading hierarchy.
 * Returns the maximum heading level found.
 */
function makeCollapsibleSections(container: HTMLElement, onManualToggle?: () => void): number {
  const children = Array.from(container.children);
  if (children.length === 0) {
    return 0;
  }

  // Clear container and rebuild with sections
  container.innerHTML = '';

  // Track max level
  let maxLevel = 0;

  // Stack to track nested sections: [{ section, contentEl, level }]
  const sectionStack: Array<{
    section: HTMLElement;
    contentEl: HTMLElement;
    level: number;
  }> = [];

  // Helper to get current content target
  const getCurrentContentTarget = (): HTMLElement => {
    const top = sectionStack[sectionStack.length - 1];
    return top ? top.contentEl : container;
  };

  // Helper to close sections until we reach a level lower than the target
  const closeToLevel = (targetLevel: number): void => {
    while (sectionStack.length > 0) {
      const top = sectionStack[sectionStack.length - 1];
      if (!top) {
        break;
      }
      if (top.level >= targetLevel) {
        // Close this section: append it to parent
        sectionStack.pop();
        const parent = getCurrentContentTarget();
        parent.appendChild(top.section);
      } else {
        break;
      }
    }
  };

  for (const child of children) {
    const level = getHeadingLevel(child);

    if (level > 0) {
      maxLevel = Math.max(maxLevel, level);

      // It's a heading - close any sections at same or deeper level
      closeToLevel(level);

      // Create new section
      const section = document.createElement('div');
      section.className = 'collapsible-section';
      section.dataset['level'] = String(level);

      // Create header with toggle
      const headerWrapper = document.createElement('div');
      headerWrapper.className = 'collapsible-section-header';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'collapsible-section-toggle';
      toggle.textContent = COLLAPSE_ICON;
      toggle.setAttribute('aria-label', 'Collapse section');
      toggle.setAttribute('aria-expanded', 'true');

      // Clone the heading and add toggle
      const headingClone = child.cloneNode(true) as HTMLElement;
      headerWrapper.appendChild(toggle);
      headerWrapper.appendChild(headingClone);

      // Add copy dropdown (appears on hover)
      // Note: getMarkdown is not provided since we don't have the original markdown per-section
      const copyDropdown = createCopyDropdown({
        classPrefix: 'collapsible-section-copy',
        getPlainText: () => section.textContent ?? '',
        // getMarkdown not provided - Copy Markdown will be disabled
        compact: true,
      });
      headerWrapper.appendChild(copyDropdown);

      section.appendChild(headerWrapper);

      // Create content container
      const contentEl = document.createElement('div');
      contentEl.className = 'collapsible-section-content';
      section.appendChild(contentEl);

      // Add toggle behavior
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = section.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? EXPAND_ICON : COLLAPSE_ICON;
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
        toggle.setAttribute('aria-label', isCollapsed ? 'Expand section' : 'Collapse section');
        // Notify that user manually toggled
        onManualToggle?.();
      });

      // Push to stack
      sectionStack.push({ section, contentEl, level });
    } else {
      // Non-heading content - append to current section's content or container
      const target = getCurrentContentTarget();
      target.appendChild(child.cloneNode(true));
    }
  }

  // Close all remaining sections
  closeToLevel(0);

  return maxLevel;
}

/**
 * Set sections to a specific expansion level.
 * Sections with level <= expandLevel are expanded, others are collapsed.
 * expandLevel of 0 means all collapsed, Infinity means all expanded.
 */
function setSectionsToLevel(container: HTMLElement, expandLevel: number): void {
  const sections = container.querySelectorAll<HTMLElement>('.collapsible-section');
  for (const section of Array.from(sections)) {
    const level = parseInt(section.dataset['level'] ?? '0', 10);
    const shouldCollapse = level > expandLevel;
    const toggle = section.querySelector<HTMLButtonElement>('.collapsible-section-toggle');

    if (shouldCollapse) {
      section.classList.add('collapsed');
      if (toggle) {
        toggle.textContent = EXPAND_ICON;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Expand section');
      }
    } else {
      section.classList.remove('collapsed');
      if (toggle) {
        toggle.textContent = COLLAPSE_ICON;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Collapse section');
      }
    }
  }
}

/**
 * Check if any collapsible sections exist in the container.
 */
function hasCollapsibleSections(container: HTMLElement): boolean {
  return container.querySelector('.collapsible-section') !== null;
}

/**
 * Options for initializing the MarkdownViewerController.
 */
export interface MarkdownViewerOptions {
  /** Container element where content will be rendered */
  container: HTMLElement;
  /** CSS class to add to the content wrapper (optional) */
  contentClass?: string;
  /** Selectors to ignore when applying search highlights */
  searchIgnoreSelectors?: string[];
  /** CSS class for search hit highlights */
  searchHitClass?: string;
  /** CSS class for active search hit */
  searchActiveClass?: string;
}

/**
 * State representing expand/collapse level.
 */
export interface ExpandCollapseState {
  /** Maximum heading level found in content (0 if no headings) */
  maxLevel: number;
  /** Current expansion level (0 = all collapsed, Infinity = all expanded) */
  currentLevel: number;
  /** Whether user has manually toggled sections (mixed state) */
  isMixed: boolean;
  /** Whether collapsible sections exist */
  hasSections: boolean;
}

/**
 * Search state with matches and active index.
 */
export interface SearchState {
  /** All matched elements */
  matches: HTMLElement[];
  /** Currently active match index (-1 if none) */
  activeIndex: number;
}

const DEFAULT_SEARCH_IGNORE_SELECTORS = [
  '.markdown-code-copy-wrapper',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'svg',
];

/**
 * Controller for rendering and managing markdown content with collapsible sections,
 * search highlighting, and copy functionality.
 *
 * This controller provides methods but does not render its own UI controls.
 * The consumer is responsible for rendering buttons/controls and calling the appropriate methods.
 */
export class MarkdownViewerController {
  private readonly container: HTMLElement;
  private readonly contentClass: string;
  private readonly searchIgnoreSelectors: string[];
  private readonly searchHitClass: string;
  private readonly searchActiveClass: string;

  private contentEl: HTMLElement | null = null;
  private rawMarkdown: string = '';

  // Expand/collapse state
  private maxLevel: number = 0;
  private currentLevel: number = Infinity;
  private isMixed: boolean = false;

  // Search state
  private searchMatches: HTMLElement[] = [];
  private searchActiveIndex: number = -1;

  constructor(options: MarkdownViewerOptions) {
    this.container = options.container;
    this.contentClass = options.contentClass ?? 'markdown-viewer-content';
    this.searchIgnoreSelectors = options.searchIgnoreSelectors ?? DEFAULT_SEARCH_IGNORE_SELECTORS;
    this.searchHitClass = options.searchHitClass ?? 'markdown-search-hit';
    this.searchActiveClass = options.searchActiveClass ?? 'markdown-search-hit-active';
  }

  /**
   * Render markdown content into the container.
   * @param markdown The raw markdown string to render
   * @param onManualToggle Optional callback when user manually toggles a section
   */
  render(markdown: string, onManualToggle?: () => void): void {
    this.rawMarkdown = markdown;
    this.searchMatches = [];
    this.searchActiveIndex = -1;

    // Create content element
    this.contentEl = document.createElement('div');
    this.contentEl.className = `${this.contentClass} markdown-content`;

    // Render markdown
    applyMarkdownToElement(this.contentEl, markdown);

    // Transform to collapsible sections
    const handleToggle = (): void => {
      this.isMixed = true;
      onManualToggle?.();
    };
    this.maxLevel = makeCollapsibleSections(this.contentEl, handleToggle);

    // Re-enhance code blocks after DOM rebuild (cloneNode doesn't copy event listeners)
    enhanceCodeBlocksWithCopyButtons(this.contentEl);

    // Start all expanded
    this.currentLevel = this.maxLevel > 0 ? Infinity : 0;
    this.isMixed = false;

    // Clear container and append
    this.container.innerHTML = '';
    this.container.appendChild(this.contentEl);
  }

  /**
   * Get the current expand/collapse state.
   */
  getExpandCollapseState(): ExpandCollapseState {
    return {
      maxLevel: this.maxLevel,
      currentLevel: this.currentLevel,
      isMixed: this.isMixed,
      hasSections: this.contentEl ? hasCollapsibleSections(this.contentEl) : false,
    };
  }

  /**
   * Set sections to a specific expansion level.
   * @param level 0 = all collapsed, Infinity = all expanded, 1-6 = expand to that heading level
   */
  setExpandLevel(level: number): void {
    if (!this.contentEl) {
      return;
    }
    this.currentLevel = level;
    this.isMixed = false;
    setSectionsToLevel(this.contentEl, level);
  }

  /**
   * Expand all sections.
   */
  expandAll(): void {
    this.setExpandLevel(Infinity);
  }

  /**
   * Collapse all sections.
   */
  collapseAll(): void {
    this.setExpandLevel(0);
  }

  /**
   * Cycle through expansion levels: 0 → 1 → 2 → ... → maxLevel → Infinity → 0
   * If in mixed state, resets to level 0.
   */
  cycleExpandLevel(): void {
    if (!this.contentEl || this.maxLevel === 0) {
      return;
    }

    if (this.isMixed) {
      // Reset to all collapsed
      this.setExpandLevel(0);
      return;
    }

    if (this.currentLevel > this.maxLevel) {
      // Was all expanded, go to level 0
      this.setExpandLevel(0);
    } else {
      // Go to next level
      this.setExpandLevel(this.currentLevel + 1);
    }
  }

  /**
   * Get the label text for an expand/collapse toggle button.
   */
  getExpandCollapseLabel(): string {
    if (this.isMixed) {
      return MIXED_ICON;
    }
    if (this.currentLevel === 0) {
      return `${EXPAND_ICON} 0`;
    }
    if (this.currentLevel > this.maxLevel) {
      return COLLAPSE_ICON;
    }
    return `${EXPAND_ICON} ${this.currentLevel}`;
  }

  /**
   * Get aria-label for an expand/collapse toggle button.
   */
  getExpandCollapseAriaLabel(): string {
    if (this.isMixed) {
      return 'Section state is mixed, click to reset';
    }
    const levelDesc =
      this.currentLevel === 0
        ? 'all collapsed'
        : this.currentLevel > this.maxLevel
          ? 'all expanded'
          : `level ${this.currentLevel} expanded`;
    return `Section expansion: ${levelDesc}, click to cycle`;
  }

  /**
   * Apply search highlighting to the content.
   * @param query Search query string (empty to clear highlights)
   * @returns Search state with matches
   */
  applySearch(query: string): SearchState {
    if (!this.contentEl || !this.contentEl.isConnected) {
      this.searchMatches = [];
      this.searchActiveIndex = -1;
      return { matches: [], activeIndex: -1 };
    }

    this.searchMatches = applyTextSearchHighlights(this.contentEl, query, {
      highlightClass: this.searchHitClass,
      ignoreSelectors: this.searchIgnoreSelectors,
    });

    if (this.searchMatches.length === 0) {
      this.searchActiveIndex = -1;
      return { matches: [], activeIndex: -1 };
    }

    // Activate first match
    this.setActiveSearchMatch(0, { scroll: true });
    return {
      matches: this.searchMatches,
      activeIndex: this.searchActiveIndex,
    };
  }

  /**
   * Set the active search match by index.
   * @param index Index of match to activate
   * @param options Options for scrolling behavior
   */
  setActiveSearchMatch(index: number, options?: { scroll?: boolean }): void {
    // Deactivate previous
    if (this.searchActiveIndex >= 0) {
      const previous = this.searchMatches[this.searchActiveIndex];
      previous?.classList.remove(this.searchActiveClass);
    }

    this.searchActiveIndex = index;
    const active = this.searchMatches[this.searchActiveIndex];
    if (!active) {
      this.searchActiveIndex = -1;
      return;
    }

    active.classList.add(this.searchActiveClass);
    if (options?.scroll !== false) {
      active.scrollIntoView({ block: 'center' });
    }
  }

  /**
   * Move to the next search match (wraps around).
   */
  nextSearchMatch(): void {
    if (this.searchMatches.length === 0) {
      return;
    }
    const nextIndex =
      this.searchActiveIndex >= 0 ? (this.searchActiveIndex + 1) % this.searchMatches.length : 0;
    this.setActiveSearchMatch(nextIndex, { scroll: true });
  }

  /**
   * Move to the previous search match (wraps around).
   */
  previousSearchMatch(): void {
    if (this.searchMatches.length === 0) {
      return;
    }
    const prevIndex =
      this.searchActiveIndex > 0 ? this.searchActiveIndex - 1 : this.searchMatches.length - 1;
    this.setActiveSearchMatch(prevIndex, { scroll: true });
  }

  /**
   * Get current search state.
   */
  getSearchState(): SearchState {
    return {
      matches: this.searchMatches,
      activeIndex: this.searchActiveIndex,
    };
  }

  /**
   * Get the plain text content of the rendered markdown.
   */
  getPlainText(): string {
    return this.contentEl?.textContent ?? '';
  }

  /**
   * Get the raw markdown source.
   */
  getMarkdown(): string {
    return this.rawMarkdown;
  }

  /**
   * Get the content element (for attaching additional event handlers).
   */
  getContentElement(): HTMLElement | null {
    return this.contentEl;
  }

  /**
   * Check if content has collapsible sections.
   */
  hasSections(): boolean {
    return this.contentEl ? hasCollapsibleSections(this.contentEl) : false;
  }

  /**
   * Clear the rendered content.
   */
  clear(): void {
    this.container.innerHTML = '';
    this.contentEl = null;
    this.rawMarkdown = '';
    this.maxLevel = 0;
    this.currentLevel = Infinity;
    this.isMixed = false;
    this.searchMatches = [];
    this.searchActiveIndex = -1;
  }

  /**
   * Destroy the controller and clean up.
   */
  destroy(): void {
    this.clear();
  }
}

// Re-export for convenience
export { createCopyDropdown, type CopyDropdownOptions };
