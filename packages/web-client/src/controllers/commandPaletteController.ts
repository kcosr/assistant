export interface SearchableScope {
  pluginId: string;
  label: string;
  instances: Array<{ id: string; label: string }>;
}

export interface GlobalSearchOptions {
  query: string;
  profiles?: string[];
  plugin?: string;
  scope?: string;
  instance?: string;
  limit?: number;
}

export interface SearchApiResult {
  pluginId: string;
  instanceId: string;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  score?: number;
  launch: {
    panelType: string;
    payload: Record<string, unknown>;
  };
}

export interface SearchApiResponse {
  results: SearchApiResult[];
  timing?: {
    totalMs: number;
    byPlugin?: Record<string, number>;
  };
}

export type LaunchAction =
  | { type: 'modal' }
  | { type: 'workspace' }
  | { type: 'pin' }
  | { type: 'replace' };

export interface CommandPaletteControllerOptions {
  overlay: HTMLElement | null;
  palette?: HTMLElement | null;
  input: HTMLInputElement | null;
  ghost: HTMLElement | null;
  results: HTMLElement | null;
  sortButton?: HTMLButtonElement | null;
  closeButton: HTMLButtonElement | null;
  triggerButton: HTMLButtonElement | null;
  fetchScopes: () => Promise<SearchableScope[]>;
  fetchResults: (options: GlobalSearchOptions) => Promise<SearchApiResponse>;
  getSelectedPanelId: () => string | null;
  onLaunch: (result: SearchApiResult, action: LaunchAction) => boolean | void;
  resolveIcon?: (result: SearchApiResult) => string | null;
  setStatus?: (message: string) => void;
  isMobileViewport?: () => boolean;
}

type PaletteMode = 'idle' | 'global' | 'command' | 'profile' | 'scope' | 'query';

type ParsedState = {
  mode: PaletteMode;
  commandQuery?: string;
  profileId?: string | null;
  profileQuery?: string;
  scopeId?: string | null;
  scopeQuery?: string;
  query?: string;
};

type OptionItem = {
  id: string;
  label: string;
  description?: string;
  type: 'command' | 'profile' | 'scope';
  profileId?: string | null;
};

type SortMode = 'relevance' | 'items' | 'plugin';
type GroupMode = 'none' | 'plugin' | 'type';
type ResultCategory = 'listItem' | 'list' | 'note' | 'other';
type MenuKind = 'action' | 'sort';

type MenuEntry = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
  section?: string;
};

type DisplayEntry =
  | { type: 'header'; label: string }
  | { type: 'result'; result: SearchApiResult };

type MenuState = {
  index: number;
  anchor: HTMLElement;
  kind: MenuKind;
};

const COMMAND_OPTIONS: OptionItem[] = [
  {
    id: 'search',
    label: 'Search',
    description: 'Search notes, lists, and more',
    type: 'command',
  },
  {
    id: 'pinned',
    label: 'Pinned',
    description: 'Show pinned notes and lists',
    type: 'command',
  },
];

const PINNED_QUERY = 'tag:pinned';

const MAIN_MENU_ITEMS: Array<{
  id: string;
  label: string;
  action: LaunchAction;
  requiresSelection?: boolean;
}> = [
  { id: 'modal', label: 'Open modal', action: { type: 'modal' } },
  { id: 'workspace', label: 'Open workspace', action: { type: 'workspace' } },
  { id: 'pin', label: 'Pin to header', action: { type: 'pin' } },
  { id: 'replace', label: 'Replace', action: { type: 'replace' }, requiresSelection: true },
];

const SORT_MODE_STORAGE_KEY = 'aiAssistantCommandPaletteSortMode';
const GROUP_MODE_STORAGE_KEY = 'aiAssistantCommandPaletteGroupMode';
const DEFAULT_SORT_MODE: SortMode = 'relevance';
const DEFAULT_GROUP_MODE: GroupMode = 'none';
const RESULT_CATEGORY_ORDER: ResultCategory[] = ['listItem', 'list', 'note', 'other'];
const RESULT_CATEGORY_LABELS: Record<ResultCategory, string> = {
  listItem: 'List items',
  list: 'Lists',
  note: 'Notes',
  other: 'Other',
};

const SEARCH_DEBOUNCE_MS = 150;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const splitFirstToken = (input: string): { token: string; rest: string; hasTrailingSpace: boolean } => {
  const trimmedStart = input.replace(/^\s+/, '');
  if (!trimmedStart) {
    return { token: '', rest: '', hasTrailingSpace: input.endsWith(' ') };
  }
  const spaceIndex = trimmedStart.indexOf(' ');
  if (spaceIndex === -1) {
    return { token: trimmedStart, rest: '', hasTrailingSpace: input.endsWith(' ') };
  }
  return {
    token: trimmedStart.slice(0, spaceIndex),
    rest: trimmedStart.slice(spaceIndex + 1),
    hasTrailingSpace: input.endsWith(' '),
  };
};

const splitTokens = (input: string): { tokens: string[]; hasTrailingSpace: boolean } => {
  const trimmedEnd = input.replace(/\s+$/, '');
  const hasTrailingSpace = trimmedEnd.length !== input.length;
  if (!trimmedEnd) {
    return { tokens: [], hasTrailingSpace };
  }
  return { tokens: trimmedEnd.split(/\s+/), hasTrailingSpace };
};

const stripLeadingToken = (input: string): string => {
  const trimmedStart = input.replace(/^\s+/, '');
  const spaceIndex = trimmedStart.indexOf(' ');
  if (spaceIndex === -1) {
    return '';
  }
  return trimmedStart.slice(spaceIndex + 1);
};

export class CommandPaletteController {
  private isOpen = false;
  private scopes: SearchableScope[] = [];
  private results: SearchApiResult[] = [];
  private loading = false;
  private profileSkipped = false;
  private pluginSkipped = false;
  private activeMode: PaletteMode = 'idle';
  private activeOptions: OptionItem[] = [];
  private optionIndex = 0;
  private resultIndex = 0;
  private menuState: MenuState | null = null;
  private menuEl: HTMLElement | null = null;
  private menuItems: HTMLButtonElement[] = [];
  private menuEntries: MenuEntry[] = [];
  private searchTimer: number | null = null;
  private searchToken = 0;
  private lastQueryKey = '';
  private cachedState: ParsedState = { mode: 'idle' };
  private sortMode: SortMode = DEFAULT_SORT_MODE;
  private groupMode: GroupMode = DEFAULT_GROUP_MODE;
  private orderedResults: SearchApiResult[] = [];

  constructor(private readonly options: CommandPaletteControllerOptions) {
    this.loadPreferences();
  }

  attach(): void {
    const { triggerButton, closeButton, input, overlay, sortButton } = this.options;
    triggerButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    closeButton?.addEventListener('click', () => {
      this.close();
    });
    sortButton?.addEventListener('click', () => {
      this.toggleSortMenu();
    });
    input?.addEventListener('input', () => {
      this.handleInput();
    });
    input?.addEventListener('scroll', () => {
      this.syncGhostScroll();
    });
    input?.addEventListener('focus', () => {
      this.moveCaretToEnd();
    });
    input?.addEventListener('click', () => {
      this.moveCaretToEnd();
    });
    overlay?.addEventListener('mousedown', (event) => {
      if (!this.isOpen) {
        return;
      }
      if (event.target === overlay) {
        this.close();
      }
    });
    document.addEventListener('keydown', this.handleKeyDown);
  }

  open(): void {
    const { overlay, input } = this.options;
    if (!overlay || !input) {
      return;
    }
    this.loadPreferences();
    this.closeMenus();
    this.isOpen = true;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    input.value = '';
    this.profileSkipped = false;
    this.pluginSkipped = false;
    this.activeMode = 'idle';
    this.optionIndex = 0;
    this.resultIndex = 0;
    this.results = [];
    this.orderedResults = [];
    this.loading = false;
    this.cachedState = { mode: 'idle' };
    this.loadScopes();
    this.handleInput();
    input.focus();
  }

  close(): void {
    const { overlay, input } = this.options;
    if (!overlay) {
      return;
    }
    this.closeMenus();
    this.isOpen = false;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (input && overlay.contains(document.activeElement)) {
      input.blur();
    }
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.open();
  }

  isPaletteOpen(): boolean {
    return this.isOpen;
  }

  private async loadScopes(): Promise<void> {
    try {
      this.scopes = await this.options.fetchScopes();
      if (this.isOpen) {
        this.render();
      }
    } catch (err) {
      this.options.setStatus?.('Failed to load search scopes');
      console.error('Failed to load search scopes', err);
    }
  }

  private loadPreferences(): void {
    try {
      this.sortMode = this.normalizeSortMode(localStorage.getItem(SORT_MODE_STORAGE_KEY));
      this.groupMode = this.normalizeGroupMode(localStorage.getItem(GROUP_MODE_STORAGE_KEY));
    } catch {
      this.sortMode = DEFAULT_SORT_MODE;
      this.groupMode = DEFAULT_GROUP_MODE;
    }
  }

  private persistPreferences(): void {
    try {
      localStorage.setItem(SORT_MODE_STORAGE_KEY, this.sortMode);
      localStorage.setItem(GROUP_MODE_STORAGE_KEY, this.groupMode);
    } catch {
      // Ignore localStorage errors
    }
  }

  private normalizeSortMode(value: string | null): SortMode {
    if (value === 'relevance' || value === 'items' || value === 'plugin') {
      return value;
    }
    return DEFAULT_SORT_MODE;
  }

  private normalizeGroupMode(value: string | null): GroupMode {
    if (value === 'none' || value === 'plugin' || value === 'type') {
      return value;
    }
    return DEFAULT_GROUP_MODE;
  }

  private isSearchMode(): boolean {
    return this.activeMode === 'global' || this.activeMode === 'query';
  }

  private handleInput(): void {
    if (!this.isOpen) {
      return;
    }
    this.closeMenus();
    const input = this.options.input;
    if (!input) {
      return;
    }
    const value = input.value;
    if (!value.startsWith('/search')) {
      this.profileSkipped = false;
      this.pluginSkipped = false;
    }
    const state = this.parseInput(value);
    this.cachedState = state;
    const previousMode = this.activeMode;
    this.activeMode = state.mode;
    if (previousMode !== this.activeMode) {
      if (
        this.activeMode === 'command' ||
        this.activeMode === 'profile' ||
        this.activeMode === 'scope'
      ) {
        this.optionIndex = 0;
      }
      if (this.activeMode === 'global' || this.activeMode === 'query') {
        this.resultIndex = 0;
      }
    }
    if (this.activeMode === 'profile' && !(state.profileQuery ?? '').trim()) {
      this.optionIndex = 0;
    }
    if (this.activeMode === 'scope' && !(state.scopeQuery ?? '').trim()) {
      this.optionIndex = 0;
    }
    this.moveCaretToEnd();
    this.render();
    this.scheduleSearch(state);
  }

  private scheduleSearch(state: ParsedState): void {
    if (state.mode !== 'global' && state.mode !== 'query') {
      this.loading = false;
      this.results = [];
      this.orderedResults = [];
      this.lastQueryKey = '';
      return;
    }
    const query = state.query?.trim() ?? '';
    const profileId = state.mode === 'query' ? state.profileId ?? undefined : undefined;
    const scopeId = state.mode === 'query' ? state.scopeId ?? undefined : undefined;
    const allowEmptyQuery = state.mode === 'query' && Boolean(scopeId || profileId);
    if (!query && !allowEmptyQuery) {
      this.loading = false;
      this.results = [];
      this.orderedResults = [];
      this.lastQueryKey = '';
      return;
    }
    const key = `${query}::${profileId ?? ''}::${scopeId ?? ''}`;
    if (key === this.lastQueryKey) {
      return;
    }
    this.lastQueryKey = key;
    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
    }
    const token = ++this.searchToken;
    this.loading = true;
    if (!query) {
      this.results = [];
      this.orderedResults = [];
      this.render();
    }
    this.searchTimer = window.setTimeout(async () => {
      try {
        const response = await this.options.fetchResults({
          query,
          ...(profileId ? { profiles: [profileId] } : {}),
          ...(scopeId ? { plugin: scopeId } : {}),
        });
        if (token !== this.searchToken) {
          return;
        }
        this.results = Array.isArray(response.results) ? response.results : [];
        this.orderedResults = [];
        this.resultIndex = 0;
      } catch (err) {
        if (token !== this.searchToken) {
          return;
        }
        this.results = [];
        this.orderedResults = [];
        this.options.setStatus?.('Search failed');
        console.error('Search failed', err);
      } finally {
        if (token === this.searchToken) {
          this.loading = false;
          this.render();
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  private parseInput(value: string): ParsedState {
    if (!value) {
      return { mode: 'command', commandQuery: '' };
    }
    if (!value.startsWith('/')) {
      return { mode: 'global', query: value };
    }
    const afterSlash = value.slice(1);
    const { token, rest, hasTrailingSpace } = splitFirstToken(afterSlash);
    const commandToken = token.trim();
    if (!commandToken) {
      return { mode: 'command', commandQuery: '' };
    }
    const normalizedCommand = commandToken.toLowerCase();
    const isSearchCommand = 'search'.startsWith(normalizedCommand);
    const isPinnedCommand = 'pinned'.startsWith(normalizedCommand);
    if (!isSearchCommand && !isPinnedCommand) {
      return { mode: 'command', commandQuery: commandToken };
    }
    if (isPinnedCommand) {
      if (normalizedCommand !== 'pinned') {
        return { mode: 'command', commandQuery: commandToken };
      }
      return { mode: 'global', query: PINNED_QUERY };
    }
    const commandConfirmed =
      normalizedCommand === 'search' && (hasTrailingSpace || rest.trim().length > 0);
    if (!commandConfirmed) {
      return { mode: 'command', commandQuery: commandToken };
    }

    if (this.profileSkipped) {
      return { mode: 'query', profileId: null, scopeId: null, query: rest.trimStart() };
    }

    const { tokens, hasTrailingSpace: restTrailing } = splitTokens(rest);
    if (tokens.length === 0) {
      return { mode: 'profile', profileQuery: '' };
    }
    const profileToken = tokens[0] ?? '';
    const profile = this.findProfile(profileToken);
    const profileConfirmed = profile && (tokens.length > 1 || restTrailing);
    if (!profileConfirmed) {
      return { mode: 'profile', profileQuery: profileToken };
    }

    if (this.pluginSkipped) {
      return {
        mode: 'query',
        profileId: profile.id,
        scopeId: null,
        query: stripLeadingToken(rest).trimStart(),
      };
    }

    const restAfterProfile = stripLeadingToken(rest);
    const scopeInfo = splitTokens(restAfterProfile);
    if (scopeInfo.tokens.length === 0) {
      return { mode: 'scope', profileId: profile.id, scopeQuery: '' };
    }
    const scopeToken = scopeInfo.tokens[0] ?? '';
    const scope = this.findScopeForProfile(profile.id, scopeToken);
    const scopeConfirmed =
      scope && (scopeInfo.tokens.length > 1 || scopeInfo.hasTrailingSpace);
    if (!scopeConfirmed) {
      return {
        mode: 'scope',
        profileId: profile.id,
        scopeQuery: scopeToken,
      };
    }
    return {
      mode: 'query',
      profileId: profile.id,
      scopeId: scope.pluginId,
      query: scopeInfo.tokens.slice(1).join(' '),
    };
  }

  private getProfiles(): Array<{ id: string; label: string }> {
    const entries = new Map<string, string>();
    for (const scope of this.scopes) {
      for (const instance of scope.instances ?? []) {
        if (!instance.id) {
          continue;
        }
        const normalized = instance.id.trim();
        if (!normalized) {
          continue;
        }
        if (!entries.has(normalized)) {
          entries.set(normalized, instance.label || normalized);
        }
      }
    }
    const profiles = Array.from(entries.entries()).map(([id, label]) => ({ id, label }));
    profiles.sort((a, b) => {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      return a.id.localeCompare(b.id);
    });
    return profiles;
  }

  private findProfile(token: string): { id: string; label: string } | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return this.getProfiles().find((profile) => profile.id.toLowerCase() === normalized) ?? null;
  }

  private findScopeForProfile(profileId: string, token: string): SearchableScope | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return (
      this.scopes.find((scope) => {
        if (scope.pluginId.toLowerCase() !== normalized) {
          return false;
        }
        return scope.instances.some(
          (instance) => instance.id.toLowerCase() === profileId.toLowerCase(),
        );
      }) ?? null
    );
  }

  private render(): void {
    if (!this.isOpen) {
      return;
    }
    this.renderGhost();
    const { results } = this.options;
    if (!results) {
      return;
    }
    results.innerHTML = '';
    this.updateSortControl();

    if (this.activeMode === 'command') {
      this.activeOptions = this.filterCommandOptions(this.cachedState.commandQuery ?? '');
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }
    if (this.activeMode === 'profile') {
      const profileQuery = this.cachedState.profileQuery ?? '';
      this.activeOptions = this.buildProfileOptions(profileQuery);
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }
    if (this.activeMode === 'scope') {
      const profileId = this.cachedState.profileId ?? null;
      const scopeQuery = this.cachedState.scopeQuery ?? '';
      this.activeOptions = this.buildScopeOptions(profileId, scopeQuery);
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }

    this.activeOptions = [];
    this.orderedResults = this.buildOrderedResults();
    this.resultIndex = this.clampIndex(this.resultIndex, this.orderedResults.length);
    this.renderResultsList(results);
  }

  private renderGhost(): void {
    const { ghost, input } = this.options;
    if (!ghost || !input) {
      return;
    }
    const value = input.value;
    let html = escapeHtml(value);
    let placeholder = '';
    if (this.activeMode === 'profile' && !(this.cachedState.profileQuery ?? '').trim()) {
      placeholder = '<profile>';
    } else if (this.activeMode === 'scope' && !(this.cachedState.scopeQuery ?? '').trim()) {
      placeholder = '<plugin>';
    } else if (this.activeMode === 'query' && !(this.cachedState.query ?? '').trim()) {
      placeholder = '<query>';
    }
    if (placeholder) {
      const spacer = value.length > 0 && !/\s$/.test(value) ? ' ' : '';
      html += `${escapeHtml(spacer)}<span class="command-palette-placeholder">${escapeHtml(
        placeholder,
      )}</span>`;
    }
    ghost.innerHTML = html || '&nbsp;';
    this.syncGhostScroll();
  }

  private renderOptionList(
    container: HTMLElement,
    options: OptionItem[],
    focusedIndex: number,
  ): void {
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No matches';
      container.appendChild(empty);
      return;
    }

    options.forEach((option, index) => {
      const row = document.createElement('div');
      row.className = 'command-palette-item';
      if (index === focusedIndex) {
        row.classList.add('focused');
      }

      const content = document.createElement('div');
      content.className = 'command-palette-item-content';

      const title = document.createElement('div');
      title.className = 'command-palette-item-title';
      title.textContent = option.label;
      content.appendChild(title);

      if (option.description) {
        const subtitle = document.createElement('div');
        subtitle.className = 'command-palette-item-subtitle';
        subtitle.textContent = option.description;
        content.appendChild(subtitle);
      }

      row.appendChild(content);
      row.addEventListener('click', () => {
        this.optionIndex = index;
        this.handleOptionSelection();
      });

      container.appendChild(row);
    });
  }

  private renderResultsList(container: HTMLElement): void {
    const query = this.cachedState.query?.trim() ?? '';
    const orderedResults = this.orderedResults;
    if (!query && orderedResults.length === 0) {
      return;
    }

    if (this.loading && query) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'Searching...';
      container.appendChild(empty);
      return;
    }

    if (orderedResults.length === 0 && query) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No results';
      container.appendChild(empty);
      return;
    }

    const entries = this.buildGroupedEntries(orderedResults);
    let renderIndex = 0;
    entries.forEach((entry) => {
      if (entry.type === 'header') {
        const header = document.createElement('div');
        header.className = 'command-palette-group';
        header.textContent = entry.label;
        container.appendChild(header);
        return;
      }

      const result = entry.result;
      const row = document.createElement('div');
      row.className = 'command-palette-item';
      const entryIndex = renderIndex;
      renderIndex += 1;
      if (entryIndex === this.resultIndex) {
        row.classList.add('focused');
      }

      const icon = document.createElement('div');
      icon.className = 'command-palette-item-icon';
      const iconSvg = this.options.resolveIcon?.(result) ?? null;
      if (iconSvg) {
        icon.innerHTML = iconSvg;
      } else {
        icon.textContent = '•';
      }

      const content = document.createElement('div');
      content.className = 'command-palette-item-content';

      const title = document.createElement('div');
      title.className = 'command-palette-item-title';
      title.textContent = result.title;
      content.appendChild(title);

      if (result.subtitle) {
        const subtitle = document.createElement('div');
        subtitle.className = 'command-palette-item-subtitle';
        subtitle.textContent = result.subtitle;
        content.appendChild(subtitle);
      }

      const meta = document.createElement('div');
      meta.className = 'command-palette-item-meta';
      meta.textContent = `${result.pluginId}:${result.instanceId}`;
      content.appendChild(meta);

      if (result.snippet) {
        const snippet = document.createElement('div');
        snippet.className = 'command-palette-item-snippet';
        snippet.textContent = result.snippet;
        content.appendChild(snippet);
      }

      row.appendChild(icon);
      row.appendChild(content);

      row.addEventListener('click', (event) => {
        this.resultIndex = entryIndex;
        if (this.options.isMobileViewport?.()) {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenus();
          this.render();
          this.openActionMenu();
          return;
        }
        this.handleDefaultLaunch(false);
      });
      row.addEventListener('dblclick', () => {
        this.resultIndex = entryIndex;
        this.handleDefaultLaunch(false);
      });

      container.appendChild(row);
    });
  }

  private buildOrderedResults(): SearchApiResult[] {
    if (this.results.length === 0) {
      return [];
    }
    if (this.sortMode === 'items') {
      return this.sortItemsFirst(this.results);
    }
    if (this.sortMode === 'plugin') {
      return this.sortByPlugin(this.results);
    }
    return [...this.results];
  }

  private getActiveResults(): SearchApiResult[] {
    if (this.orderedResults.length === this.results.length) {
      return this.orderedResults;
    }
    return this.buildOrderedResults();
  }

  private sortItemsFirst(results: SearchApiResult[]): SearchApiResult[] {
    const buckets: Record<ResultCategory, SearchApiResult[]> = {
      listItem: [],
      list: [],
      note: [],
      other: [],
    };
    results.forEach((result) => {
      buckets[this.getResultCategory(result)].push(result);
    });
    return [
      ...buckets.listItem,
      ...buckets.list,
      ...buckets.note,
      ...buckets.other,
    ];
  }

  private sortByPlugin(results: SearchApiResult[]): SearchApiResult[] {
    const indexed = results.map((result, index) => ({
      result,
      index,
      pluginKey: result.pluginId.toLowerCase(),
    }));
    indexed.sort((a, b) => {
      if (a.pluginKey < b.pluginKey) return -1;
      if (a.pluginKey > b.pluginKey) return 1;
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.result);
  }

  private buildGroupedEntries(results: SearchApiResult[]): DisplayEntry[] {
    if (this.groupMode === 'none') {
      return results.map((result) => ({ type: 'result', result }));
    }
    if (this.groupMode === 'plugin') {
      const order: string[] = [];
      const grouped = new Map<string, SearchApiResult[]>();
      results.forEach((result) => {
        const key = result.pluginId || 'unknown';
        if (!grouped.has(key)) {
          grouped.set(key, []);
          order.push(key);
        }
        grouped.get(key)?.push(result);
      });
      const entries: DisplayEntry[] = [];
      order.forEach((key) => {
        entries.push({ type: 'header', label: key });
        grouped.get(key)?.forEach((result) => {
          entries.push({ type: 'result', result });
        });
      });
      return entries;
    }

    const grouped = new Map<ResultCategory, SearchApiResult[]>(
      RESULT_CATEGORY_ORDER.map((category) => [category, []]),
    );
    results.forEach((result) => {
      grouped.get(this.getResultCategory(result))?.push(result);
    });
    const entries: DisplayEntry[] = [];
    RESULT_CATEGORY_ORDER.forEach((category) => {
      const groupResults = grouped.get(category) ?? [];
      if (groupResults.length === 0) {
        return;
      }
      entries.push({ type: 'header', label: RESULT_CATEGORY_LABELS[category] });
      groupResults.forEach((result) => {
        entries.push({ type: 'result', result });
      });
    });
    return entries;
  }

  private getResultCategory(result: SearchApiResult): ResultCategory {
    const panelType = result.launch.panelType;
    if (panelType === 'lists') {
      const payload = result.launch.payload;
      if (
        payload &&
        typeof payload === 'object' &&
        typeof (payload as Record<string, unknown>)['itemId'] === 'string'
      ) {
        return 'listItem';
      }
      return 'list';
    }
    if (panelType === 'notes') {
      return 'note';
    }
    return 'other';
  }

  private filterCommandOptions(query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [...COMMAND_OPTIONS];
    }
    return COMMAND_OPTIONS.filter((option) => option.id.startsWith(normalized));
  }

  private buildProfileOptions(query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    const options: OptionItem[] = [
      {
        id: '__all__',
        label: 'All',
        description: 'All profiles',
        type: 'profile',
      },
    ];
    for (const profile of this.getProfiles()) {
      const idMatch = profile.id.toLowerCase().includes(normalized);
      const labelMatch = profile.label.toLowerCase().includes(normalized);
      if (!normalized || idMatch || labelMatch) {
        const label = profile.label?.trim() || profile.id;
        options.push({
          id: profile.id,
          label,
          type: 'profile',
        });
      }
    }
    return options;
  }

  private buildScopeOptions(profileId: string | null, query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    const options: OptionItem[] = [
      {
        id: '__all__',
        label: 'All',
        description: 'All plugins',
        type: 'scope',
        profileId,
      },
    ];
    const normalizedProfile = profileId?.toLowerCase() ?? null;
    for (const scope of this.scopes) {
      if (
        normalizedProfile &&
        !scope.instances.some(
          (instance) => instance.id.toLowerCase() === normalizedProfile,
        )
      ) {
        continue;
      }
      const idMatch = scope.pluginId.toLowerCase().includes(normalized);
      const labelMatch = scope.label.toLowerCase().includes(normalized);
      if (!normalized || idMatch || labelMatch) {
        const label = scope.label?.trim() || scope.pluginId;
        options.push({
          id: scope.pluginId,
          label,
          type: 'scope',
          profileId,
        });
      }
    }
    return options;
  }

  private handleOptionSelection(): void {
    const option = this.activeOptions[this.optionIndex];
    if (!option) {
      return;
    }
    if (option.type === 'command') {
      if (option.id === 'pinned') {
        this.setInputValue('/pinned');
        this.profileSkipped = false;
        this.pluginSkipped = false;
        return;
      }
      this.setInputValue('/search ');
      this.profileSkipped = false;
      this.pluginSkipped = false;
      return;
    }
    if (option.type === 'profile') {
      if (option.id === '__all__') {
        this.profileSkipped = true;
        this.pluginSkipped = false;
        this.setInputValue('/search ');
        return;
      }
      this.profileSkipped = false;
      this.pluginSkipped = false;
      this.setInputValue(`/search ${option.id} `);
      return;
    }
    if (option.type === 'scope') {
      const profileId = option.profileId ?? this.cachedState.profileId ?? '';
      if (!profileId) {
        return;
      }
      if (option.id === '__all__') {
        this.pluginSkipped = true;
        this.setInputValue(`/search ${profileId} `);
        return;
      }
      this.pluginSkipped = false;
      this.setInputValue(`/search ${profileId} ${option.id} `);
    }
  }

  private handleDefaultLaunch(forceReplace: boolean): void {
    const result = this.getActiveResults()[this.resultIndex];
    if (!result) {
      return;
    }
    if (forceReplace) {
      const selectedPanelId = this.options.getSelectedPanelId();
      if (!selectedPanelId) {
        return;
      }
    }
    const action: LaunchAction = forceReplace ? { type: 'replace' } : { type: 'modal' };
    const launched = this.options.onLaunch(result, action);
    if (launched !== false) {
      this.close();
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) {
      return;
    }
    const consumeEvent = () => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    if (event.key === 'Escape') {
      consumeEvent();
      if (this.menuState) {
        this.closeMenus();
        return;
      }
      this.close();
      return;
    }

    if (event.key === 'ArrowDown') {
      consumeEvent();
      if (this.menuState) {
        this.moveMenuFocus(1);
        return;
      }
      this.moveFocus(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      consumeEvent();
      if (this.menuState) {
        this.moveMenuFocus(-1);
        return;
      }
      this.moveFocus(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      if (this.menuState) {
        consumeEvent();
        return;
      }
      if (this.isSearchMode()) {
        consumeEvent();
        this.openActionMenu();
      }
      return;
    }

    if (event.key === 'Enter') {
      consumeEvent();
      if (this.menuState) {
        this.executeMenuSelection();
        return;
      }
      if (
        this.activeMode === 'command' ||
        this.activeMode === 'profile' ||
        this.activeMode === 'scope'
      ) {
        this.handleOptionSelection();
        return;
      }
      if (this.isSearchMode()) {
        this.handleDefaultLaunch(event.shiftKey);
        return;
      }
      return;
    }

    if (event.key === 'Backspace') {
      if (this.handleBackspace()) {
        consumeEvent();
      }
      return;
    }
  };

  private handleBackspace(): boolean {
    const input = this.options.input;
    if (!input) {
      return false;
    }
    if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) {
      return false;
    }

    if (this.activeMode === 'query' && !(this.cachedState.query ?? '').trim()) {
      if (this.pluginSkipped || this.cachedState.scopeId) {
        this.pluginSkipped = false;
        const profileId = this.cachedState.profileId ?? '';
        this.setInputValue(profileId ? `/search ${profileId} ` : '/search ');
        return true;
      }
      if (this.profileSkipped) {
        this.profileSkipped = false;
        this.setInputValue('/search ');
        return true;
      }
    }
    if (this.activeMode === 'scope' && !(this.cachedState.scopeQuery ?? '').trim()) {
      this.pluginSkipped = false;
      this.profileSkipped = false;
      this.setInputValue('/search ');
      return true;
    }
    if (this.activeMode === 'profile' && !(this.cachedState.profileQuery ?? '').trim()) {
      this.profileSkipped = false;
      this.setInputValue('/');
      return true;
    }
    return false;
  }

  private setInputValue(value: string): void {
    const input = this.options.input;
    if (!input) {
      return;
    }
    input.value = value;
    this.handleInput();
    input.focus();
    this.moveCaretToEnd();
  }

  private moveCaretToEnd(): void {
    const input = this.options.input;
    if (!input) {
      return;
    }
    const length = input.value.length;
    input.setSelectionRange(length, length);
  }

  private moveFocus(delta: number): void {
    if (
      this.activeMode === 'command' ||
      this.activeMode === 'profile' ||
      this.activeMode === 'scope'
    ) {
      if (this.activeOptions.length === 0) {
        this.optionIndex = 0;
        return;
      }
      this.optionIndex = this.wrapIndex(this.optionIndex + delta, this.activeOptions.length);
      this.render();
      this.scrollFocusedItem();
      return;
    }
    const resultsLength = this.getActiveResults().length;
    if (resultsLength === 0) {
      this.resultIndex = 0;
      return;
    }
    this.resultIndex = this.wrapIndex(this.resultIndex + delta, resultsLength);
    this.render();
    this.scrollFocusedItem();
  }

  private clampIndex(index: number, length: number): number {
    if (length <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(index, length - 1));
  }

  private wrapIndex(index: number, length: number): number {
    if (length <= 0) {
      return 0;
    }
    if (index < 0) {
      return length - 1;
    }
    if (index >= length) {
      return 0;
    }
    return index;
  }

  private scrollFocusedItem(): void {
    const container = this.options.results;
    if (!container) {
      return;
    }
    const focused = container.querySelector<HTMLElement>('.command-palette-item.focused');
    focused?.scrollIntoView({ block: 'nearest' });
  }

  private syncGhostScroll(): void {
    const { ghost, input } = this.options;
    if (!ghost || !input) {
      return;
    }
    ghost.scrollLeft = input.scrollLeft;
  }

  private updateSortControl(): void {
    const button = this.options.sortButton;
    if (!button) {
      return;
    }
    const shouldShow = this.isSearchMode();
    button.classList.toggle('is-hidden', !shouldShow);
    button.disabled = !shouldShow;
    const isActive =
      this.sortMode !== DEFAULT_SORT_MODE || this.groupMode !== DEFAULT_GROUP_MODE;
    button.classList.toggle('is-active', isActive);
    if (!shouldShow) {
      this.setSortButtonExpanded(false);
    }
  }

  private setSortButtonExpanded(expanded: boolean): void {
    const button = this.options.sortButton;
    if (!button) {
      return;
    }
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  private toggleSortMenu(): void {
    if (!this.isSearchMode()) {
      return;
    }
    if (this.menuState?.kind === 'sort') {
      this.closeMenus();
      return;
    }
    this.closeMenus();
    this.openSortMenu();
  }

  private openSortMenu(): void {
    const button = this.options.sortButton;
    if (!button) {
      return;
    }
    const { entries, initialIndex } = this.buildSortMenuEntries();
    if (entries.length === 0) {
      return;
    }
    this.menuEntries = entries;
    this.menuState = { index: initialIndex, anchor: button, kind: 'sort' };
    this.renderMenu();
    this.setSortButtonExpanded(true);
  }

  private buildSortMenuEntries(): { entries: MenuEntry[]; initialIndex: number } {
    const entries: MenuEntry[] = [];
    const sortEntries: Array<{ id: SortMode; label: string }> = [
      { id: 'relevance', label: 'Relevance' },
      { id: 'items', label: 'Items first' },
      { id: 'plugin', label: 'Plugin A-Z' },
    ];
    const groupEntries: Array<{ id: GroupMode; label: string }> = [
      { id: 'none', label: 'None' },
      { id: 'plugin', label: 'By plugin' },
      { id: 'type', label: 'By result type' },
    ];

    sortEntries.forEach((entry) => {
      entries.push({
        id: `sort:${entry.id}`,
        label: entry.label,
        section: 'Sort',
        selected: entry.id === this.sortMode,
        onSelect: () => {
          this.setSortMode(entry.id);
        },
      });
    });

    groupEntries.forEach((entry) => {
      entries.push({
        id: `group:${entry.id}`,
        label: entry.label,
        section: 'Group',
        selected: entry.id === this.groupMode,
        onSelect: () => {
          this.setGroupMode(entry.id);
        },
      });
    });

    let initialIndex = entries.findIndex((entry) => entry.selected);
    if (initialIndex < 0) {
      initialIndex = 0;
    }
    return { entries, initialIndex };
  }

  private setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this.persistPreferences();
    this.closeMenus();
    this.render();
  }

  private setGroupMode(mode: GroupMode): void {
    this.groupMode = mode;
    this.persistPreferences();
    this.closeMenus();
    this.render();
  }

  private openActionMenu(): void {
    if (this.menuState) {
      return;
    }
    const container = this.options.results;
    if (!container) {
      return;
    }
    const focused = container.querySelector<HTMLElement>('.command-palette-item.focused');
    if (!focused) {
      return;
    }
    const hasSelection = Boolean(this.options.getSelectedPanelId());
    const entries = MAIN_MENU_ITEMS.map((item) => ({
      id: item.id,
      label: item.label,
      disabled: Boolean(item.requiresSelection && !hasSelection),
      onSelect: () => this.executeAction(item.action),
    }));
    let index = entries.findIndex((entry) => !entry.disabled);
    if (index < 0) {
      index = 0;
    }
    this.menuEntries = entries;
    this.menuState = { index, anchor: focused, kind: 'action' };
    this.renderMenu();
  }

  private renderMenu(): void {
    this.removeMenuElements();
    const state = this.menuState;
    if (!state) {
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'command-palette-menu';

    const items: HTMLButtonElement[] = [];
    let currentSection: string | undefined;
    this.menuEntries.forEach((entry, index) => {
      if (entry.section && entry.section !== currentSection) {
        currentSection = entry.section;
        const heading = document.createElement('div');
        heading.className = 'command-palette-menu-heading';
        heading.textContent = entry.section;
        menu.appendChild(heading);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-palette-menu-item';
      button.textContent = entry.label;
      if (entry.selected) {
        button.classList.add('selected');
        const check = document.createElement('span');
        check.className = 'command-palette-menu-check';
        check.textContent = '✓';
        button.appendChild(check);
      }
      if (entry.disabled) {
        button.disabled = true;
      }
      if (index === state.index) {
        button.classList.add('focused');
      }
      button.addEventListener('click', () => {
        if (entry.disabled) {
          return;
        }
        entry.onSelect();
      });
      items.push(button);
      menu.appendChild(button);
    });

    document.body.appendChild(menu);
    this.menuEl = menu;
    this.menuItems = items;
    this.positionMenu(menu, state.anchor);

    const handlePointerDown = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        this.closeMenus();
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    this.menuCleanup = () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }
  private menuCleanup: (() => void) | null = null;

  private executeMenuSelection(): void {
    if (!this.menuState) {
      return;
    }
    const entry = this.menuEntries[this.menuState.index];
    if (!entry || entry.disabled) {
      return;
    }
    entry.onSelect();
  }

  private executeAction(action: LaunchAction): void {
    const result = this.getActiveResults()[this.resultIndex];
    if (!result) {
      return;
    }
    if (action.type === 'replace' && !this.options.getSelectedPanelId()) {
      return;
    }
    const launched = this.options.onLaunch(result, action);
    if (launched !== false) {
      this.close();
    }
  }

  private moveMenuFocus(delta: number): void {
    if (!this.menuState) {
      return;
    }
    if (this.menuItems.length === 0) {
      return;
    }
    this.menuState = {
      ...this.menuState,
      index: this.wrapIndex(this.menuState.index + delta, this.menuItems.length),
    };
    this.updateMenuFocus();
  }

  private updateMenuFocus(): void {
    if (!this.menuState) {
      return;
    }
    this.menuItems.forEach((item, index) => {
      item.classList.toggle('focused', index === this.menuState?.index);
    });
  }

  private closeMenus(): void {
    this.removeMenuElements();
    this.menuState = null;
    this.menuEntries = [];
    this.setSortButtonExpanded(false);
  }

  private removeMenuElements(): void {
    if (this.menuCleanup) {
      this.menuCleanup();
      this.menuCleanup = null;
    }
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    this.menuItems = [];
  }

  private positionMenu(menu: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = anchorRect.right - menuRect.width;
    let top = anchorRect.top;
    const padding = 8;
    if (left < padding) {
      left = padding;
    }
    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
      top = window.innerHeight - menuRect.height - padding;
    }
    if (top < padding) {
      top = padding;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
}
