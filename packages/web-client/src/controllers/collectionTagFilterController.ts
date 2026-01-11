import { applyTagColorToElement } from '../utils/tagColors';

export interface CollectionTagFilterControllerOptions {
  tagsContainer: HTMLElement | null;
  activeTagsContainer: HTMLElement | null;
  searchInput: HTMLInputElement | null;
  getAllTags: () => string[];
  onFiltersUpdated: (query: string) => void;
  allowNegation?: boolean;
}

type ActiveTagFilter = { mode: 'include' | 'exclude'; tag: string };

export class CollectionTagFilterController {
  private activeTagFilters: string[] = [];
  private activeExcludedTagFilters: string[] = [];
  private activeFilterOrder: ActiveTagFilter[] = [];
  private tagSuggestionsFocusIndex = -1;
  private isInTagSuggestionsMode = false;
  private suggestionsMode: 'include' | 'exclude' = 'include';

  constructor(private readonly options: CollectionTagFilterControllerOptions) {}

  reset(): void {
    this.activeTagFilters = [];
    this.activeExcludedTagFilters = [];
    this.activeFilterOrder = [];
    this.tagSuggestionsFocusIndex = -1;
    this.isInTagSuggestionsMode = false;
    this.suggestionsMode = 'include';
    this.updateActiveTagsDisplay();
    this.updateTagSuggestions(null, false);
  }

  getActiveTagFilters(): string[] {
    return [...this.activeTagFilters];
  }

  getActiveExcludedTagFilters(): string[] {
    return [...this.activeExcludedTagFilters];
  }

  getActiveFiltersInOrder(): ActiveTagFilter[] {
    return [...this.activeFilterOrder];
  }

  clearActiveTagFilters(): void {
    this.activeTagFilters = [];
    this.activeFilterOrder = this.activeFilterOrder.filter((f) => f.mode !== 'include');
    this.updateActiveTagsDisplay();
  }

  clearActiveExcludedTagFilters(): void {
    this.activeExcludedTagFilters = [];
    this.activeFilterOrder = this.activeFilterOrder.filter((f) => f.mode !== 'exclude');
    this.updateActiveTagsDisplay();
  }

  clearAllTagFilters(): void {
    this.activeTagFilters = [];
    this.activeExcludedTagFilters = [];
    this.activeFilterOrder = [];
    this.updateActiveTagsDisplay();
  }

  setActiveTagFilters(tags: string[]): void {
    const unique: string[] = [];
    for (const raw of tags) {
      if (typeof raw !== 'string') continue;
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      if (!unique.includes(tag)) {
        unique.push(tag);
      }
    }
    this.activeTagFilters = unique;
    this.activeFilterOrder = this.rebuildFilterOrder({
      include: this.activeTagFilters,
      exclude: this.activeExcludedTagFilters,
    });
    this.updateActiveTagsDisplay();
  }

  setActiveExcludedTagFilters(tags: string[]): void {
    if (!this.isNegationAllowed()) {
      return;
    }
    const unique: string[] = [];
    for (const raw of tags) {
      if (typeof raw !== 'string') continue;
      const tag = raw.trim().toLowerCase();
      if (!tag) continue;
      if (!unique.includes(tag)) {
        unique.push(tag);
      }
    }
    this.activeExcludedTagFilters = unique;
    this.activeFilterOrder = this.rebuildFilterOrder({
      include: this.activeTagFilters,
      exclude: this.activeExcludedTagFilters,
    });
    this.updateActiveTagsDisplay();
  }

  get isSuggestionsMode(): boolean {
    return this.isInTagSuggestionsMode;
  }

  setSuggestionsMode(enabled: boolean): void {
    this.isInTagSuggestionsMode = enabled;
  }

  get focusIndex(): number {
    return this.tagSuggestionsFocusIndex;
  }

  parseSearchQuery(query: string): {
    includeTags: string[];
    excludeTags: string[];
    text: string;
    partialTag: string | null;
    partialTagIsExcluded: boolean;
  } {
    const parts = splitOnWhitespace(query);
    const includeTags: string[] = [];
    const excludeTags: string[] = [];
    let text = '';
    let partialTag: string | null = null;
    let partialTagIsExcluded = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (this.isNegationAllowed() && part === '!') {
        // Treat a lone "!" token as the start of a negated tag filter ("!@...") while typing,
        // so it doesn't act like a text query that temporarily filters out everything.
        continue;
      }
      const negated = this.isNegationAllowed() && part.startsWith('!@');
      if (negated || part.startsWith('@')) {
        const tagValue = part.slice(negated ? 2 : 1).toLowerCase();
        const isLast = i === parts.length - 1;
        const queryEndsWithSpace = query.endsWith(' ');
        if (isLast && !queryEndsWithSpace) {
          partialTag = tagValue;
          partialTagIsExcluded = negated;
        } else if (tagValue.length > 0) {
          if (negated) {
            excludeTags.push(tagValue);
          } else {
            includeTags.push(tagValue);
          }
        }
      } else if (part.length > 0) {
        text += (text.length > 0 ? ' ' : '') + part;
      }
    }

    return { includeTags, excludeTags, text, partialTag, partialTagIsExcluded };
  }

  updateActiveTagsDisplay(): void {
    const { activeTagsContainer } = this.options;
    if (!activeTagsContainer) return;

    activeTagsContainer.innerHTML = '';

    if (this.activeTagFilters.length === 0 && this.activeExcludedTagFilters.length === 0) {
      activeTagsContainer.classList.remove('visible');
      return;
    }

    activeTagsContainer.classList.add('visible');

    const renderTag = (mode: 'include' | 'exclude', tag: string) => {
      const tagEl = document.createElement('span');
      tagEl.className = 'collection-search-dropdown-active-tag';
      tagEl.classList.toggle('collection-search-dropdown-active-tag--exclude', mode === 'exclude');
      tagEl.dataset['tag'] = tag;
      tagEl.dataset['tagMode'] = mode;

      const prefix = document.createElement('span');
      prefix.className = 'collection-search-dropdown-active-tag-prefix';
      prefix.textContent = mode === 'exclude' ? '!@' : '@';
      tagEl.appendChild(prefix);

      const label = document.createElement('span');
      label.className = 'collection-search-dropdown-active-tag-label';
      label.textContent = tag;
      tagEl.appendChild(label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'collection-search-dropdown-active-tag-remove';
      remove.textContent = '×';
      tagEl.appendChild(remove);

      applyTagColorToElement(tagEl, tag);
      tagEl.title = mode === 'exclude' ? `Remove !@${tag} filter` : `Remove @${tag} filter`;
      tagEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeTagFilter(tag, mode);
      });
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeTagFilter(tag, mode);
      });
      activeTagsContainer.appendChild(tagEl);
    };

    for (const entry of this.activeFilterOrder) {
      renderTag(entry.mode, entry.tag);
    }

    // In case order got out of sync, ensure all filters are shown.
    const known = new Set(this.activeFilterOrder.map((e) => `${e.mode}:${e.tag}`));
    for (const tag of this.activeTagFilters) {
      if (known.has(`include:${tag}`)) continue;
      renderTag('include', tag);
    }
    for (const tag of this.activeExcludedTagFilters) {
      if (known.has(`exclude:${tag}`)) continue;
      renderTag('exclude', tag);
    }
  }

  addTagFilter(tag: string, mode: 'include' | 'exclude' = 'include'): void {
    if (mode === 'exclude' && !this.isNegationAllowed()) {
      return;
    }
    const lowerTag = tag.toLowerCase();

    // Ensure a tag cannot be both included and excluded.
    this.activeTagFilters = this.activeTagFilters.filter((t) => t !== lowerTag);
    this.activeExcludedTagFilters = this.activeExcludedTagFilters.filter((t) => t !== lowerTag);
    this.activeFilterOrder = this.activeFilterOrder.filter((f) => f.tag !== lowerTag);

    if (mode === 'include') {
      if (!this.activeTagFilters.includes(lowerTag)) {
        this.activeTagFilters.push(lowerTag);
      }
    } else {
      if (!this.activeExcludedTagFilters.includes(lowerTag)) {
        this.activeExcludedTagFilters.push(lowerTag);
      }
    }

    this.activeFilterOrder.push({ mode, tag: lowerTag });
    this.updateActiveTagsDisplay();
    const { searchInput } = this.options;
    if (searchInput) {
      const { text } = this.parseSearchQuery(searchInput.value);
      searchInput.value = text;
    }
    this.tagSuggestionsFocusIndex = -1;
    this.isInTagSuggestionsMode = false;
    this.options.onFiltersUpdated(this.options.searchInput?.value ?? '');
    this.options.searchInput?.focus();
  }

  addTagFilterFromSuggestion(tag: string): void {
    this.addTagFilter(tag, this.suggestionsMode);
  }

  removeTagFilter(tag: string, mode: 'include' | 'exclude' = 'include'): void {
    const lowerTag = tag.toLowerCase();
    if (mode === 'exclude') {
      this.activeExcludedTagFilters = this.activeExcludedTagFilters.filter((t) => t !== lowerTag);
    } else {
      this.activeTagFilters = this.activeTagFilters.filter((t) => t !== lowerTag);
    }
    this.activeFilterOrder = this.activeFilterOrder.filter(
      (f) => !(f.mode === mode && f.tag === lowerTag),
    );
    this.updateActiveTagsDisplay();
    this.options.onFiltersUpdated(this.options.searchInput?.value ?? '');
    this.options.searchInput?.focus();
  }

  removeLastTagFilter(): void {
    const last = this.activeFilterOrder[this.activeFilterOrder.length - 1];
    if (!last) return;
    this.removeTagFilter(last.tag, last.mode);
  }

  updateTagSuggestions(partialTag: string | null, partialTagIsExcluded: boolean): void {
    const { tagsContainer } = this.options;
    if (!tagsContainer) return;

    tagsContainer.innerHTML = '';
    this.tagSuggestionsFocusIndex = -1;

    if (partialTag === null) {
      tagsContainer.classList.remove('visible');
      this.isInTagSuggestionsMode = false;
      return;
    }

    if (partialTagIsExcluded && !this.isNegationAllowed()) {
      tagsContainer.classList.remove('visible');
      this.isInTagSuggestionsMode = false;
      return;
    }

    this.suggestionsMode = partialTagIsExcluded ? 'exclude' : 'include';

    const allTags = this.options.getAllTags();
    const matchingTags = allTags.filter(
      (tag) =>
        tag.startsWith(partialTag) &&
        !this.activeTagFilters.includes(tag) &&
        !this.activeExcludedTagFilters.includes(tag),
    );

    if (matchingTags.length === 0) {
      tagsContainer.classList.remove('visible');
      this.isInTagSuggestionsMode = false;
      return;
    }

    tagsContainer.classList.add('visible');
    this.isInTagSuggestionsMode = true;

    for (let i = 0; i < matchingTags.length; i++) {
      const tag = matchingTags[i];
      if (!tag) continue;
      const tagEl = document.createElement('span');
      tagEl.className = 'collection-search-dropdown-tag';
      if (matchingTags.length === 1) {
        tagEl.classList.add('focused');
        this.tagSuggestionsFocusIndex = 0;
      }
      tagEl.dataset['tag'] = tag;
      const prefix = partialTagIsExcluded ? '!@' : '@';
      tagEl.innerHTML = `<span class="collection-search-dropdown-tag-prefix">${prefix}</span>${tag}`;
      applyTagColorToElement(tagEl, tag);
      tagEl.addEventListener('click', () => {
        this.addTagFilter(tag, partialTagIsExcluded ? 'exclude' : 'include');
      });
      tagsContainer.appendChild(tagEl);
    }
  }

  getVisibleTagSuggestions(): HTMLElement[] {
    const { tagsContainer } = this.options;
    if (!tagsContainer) return [];
    return Array.from(
      tagsContainer.querySelectorAll('.collection-search-dropdown-tag'),
    ) as HTMLElement[];
  }

  setFocusedTagSuggestion(index: number): void {
    const suggestions = this.getVisibleTagSuggestions();
    suggestions.forEach((el, i) => {
      el.classList.toggle('focused', i === index);
    });
    this.tagSuggestionsFocusIndex = index;
    if (index >= 0 && suggestions[index]) {
      suggestions[index].scrollIntoView({ block: 'nearest' });
    }
  }

  private isNegationAllowed(): boolean {
    return this.options.allowNegation !== false;
  }

  private rebuildFilterOrder(args: { include: string[]; exclude: string[] }): ActiveTagFilter[] {
    const next: ActiveTagFilter[] = [];
    for (const tag of args.include) {
      next.push({ mode: 'include', tag });
    }
    for (const tag of args.exclude) {
      next.push({ mode: 'exclude', tag });
    }
    return next;
  }
}

function splitOnWhitespace(query: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < query.length; i++) {
    const char = query[i] ?? '';
    if (char && /\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}
