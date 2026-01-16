export interface SearchableScope {
  pluginId: string;
  label: string;
  instances: Array<{ id: string; label: string }>;
}

export interface GlobalSearchOptions {
  query: string;
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

export type LaunchAction = { type: 'replace' } | { type: 'workspace' };

export interface CommandPaletteControllerOptions {
  overlay: HTMLElement | null;
  palette?: HTMLElement | null;
  input: HTMLInputElement | null;
  ghost: HTMLElement | null;
  results: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  triggerButton: HTMLButtonElement | null;
  fetchScopes: () => Promise<SearchableScope[]>;
  fetchResults: (options: GlobalSearchOptions) => Promise<SearchApiResponse>;
  getSelectedPanelId: () => string | null;
  onLaunch: (result: SearchApiResult, action: LaunchAction) => boolean | void;
  resolveIcon?: (panelType: string) => string | null;
  setStatus?: (message: string) => void;
}

type PaletteMode = 'idle' | 'global' | 'command' | 'scope' | 'instance' | 'query';

type ParsedState = {
  mode: PaletteMode;
  commandQuery?: string;
  scopeId?: string | null;
  scopeQuery?: string;
  instanceId?: string | null;
  instanceQuery?: string;
  query?: string;
};

type OptionItem = {
  id: string;
  label: string;
  description?: string;
  type: 'command' | 'scope' | 'instance';
  scopeId?: string | null;
};

type MenuState = {
  index: number;
  anchor: HTMLElement;
};

const COMMAND_OPTIONS: OptionItem[] = [
  {
    id: 'search',
    label: 'search',
    description: 'Search notes, lists, and more',
    type: 'command',
  },
];

const MAIN_MENU_ITEMS: Array<{
  id: string;
  label: string;
  action: LaunchAction;
  requiresSelection?: boolean;
}> = [
  { id: 'replace', label: 'Replace', action: { type: 'replace' }, requiresSelection: true },
  { id: 'workspace', label: 'Open workspace', action: { type: 'workspace' } },
];

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
  private scopeSkipped = false;
  private instanceSkipped = false;
  private activeMode: PaletteMode = 'idle';
  private activeOptions: OptionItem[] = [];
  private optionIndex = 0;
  private resultIndex = 0;
  private menuState: MenuState | null = null;
  private menuEl: HTMLElement | null = null;
  private menuItems: HTMLButtonElement[] = [];
  private searchTimer: number | null = null;
  private searchToken = 0;
  private lastQueryKey = '';
  private cachedState: ParsedState = { mode: 'idle' };

  constructor(private readonly options: CommandPaletteControllerOptions) {}

  attach(): void {
    const { triggerButton, closeButton, input, overlay } = this.options;
    triggerButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    closeButton?.addEventListener('click', () => {
      this.close();
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
    this.closeMenus();
    this.isOpen = true;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    input.value = '';
    this.scopeSkipped = false;
    this.instanceSkipped = false;
    this.activeMode = 'idle';
    this.optionIndex = 0;
    this.resultIndex = 0;
    this.results = [];
    this.loading = false;
    this.cachedState = { mode: 'idle' };
    this.loadScopes();
    this.render();
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
      this.scopeSkipped = false;
      this.instanceSkipped = false;
    }
    const state = this.parseInput(value);
    this.cachedState = state;
    this.activeMode = state.mode;
    this.moveCaretToEnd();
    this.render();
    this.scheduleSearch(state);
  }

  private scheduleSearch(state: ParsedState): void {
    if (state.mode !== 'global' && state.mode !== 'query') {
      this.loading = false;
      this.results = [];
      this.lastQueryKey = '';
      return;
    }
    const query = state.query?.trim() ?? '';
    if (!query) {
      this.loading = false;
      this.results = [];
      this.lastQueryKey = '';
      return;
    }
    const scopeId = state.mode === 'query' ? state.scopeId ?? undefined : undefined;
    const instanceId = state.mode === 'query' ? state.instanceId ?? undefined : undefined;
    const key = `${query}::${scopeId ?? ''}::${instanceId ?? ''}`;
    if (key === this.lastQueryKey) {
      return;
    }
    this.lastQueryKey = key;
    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
    }
    const token = ++this.searchToken;
    this.loading = true;
    this.searchTimer = window.setTimeout(async () => {
      try {
        const response = await this.options.fetchResults({
          query,
          ...(scopeId ? { scope: scopeId } : {}),
          ...(instanceId ? { instance: instanceId } : {}),
        });
        if (token !== this.searchToken) {
          return;
        }
        this.results = Array.isArray(response.results) ? response.results : [];
        this.resultIndex = 0;
      } catch (err) {
        if (token !== this.searchToken) {
          return;
        }
        this.results = [];
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
      return { mode: 'idle' };
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
    if (!'search'.startsWith(normalizedCommand)) {
      return { mode: 'command', commandQuery: commandToken };
    }
    const commandConfirmed =
      normalizedCommand === 'search' && (hasTrailingSpace || rest.trim().length > 0);
    if (!commandConfirmed) {
      return { mode: 'command', commandQuery: commandToken };
    }

    if (this.scopeSkipped) {
      return { mode: 'query', scopeId: null, instanceId: null, query: rest.trimStart() };
    }

    const { tokens, hasTrailingSpace: restTrailing } = splitTokens(rest);
    if (tokens.length === 0) {
      return { mode: 'scope', scopeQuery: '' };
    }
    const scopeToken = tokens[0] ?? '';
    const scope = this.findScope(scopeToken);
    const scopeConfirmed = scope && (tokens.length > 1 || restTrailing);
    if (!scopeConfirmed) {
      return { mode: 'scope', scopeQuery: scopeToken };
    }

    if (this.instanceSkipped) {
      return {
        mode: 'query',
        scopeId: scope.pluginId,
        instanceId: null,
        query: stripLeadingToken(rest).trimStart(),
      };
    }

    const restAfterScope = stripLeadingToken(rest);
    const instanceInfo = splitTokens(restAfterScope);
    if (instanceInfo.tokens.length === 0) {
      return { mode: 'instance', scopeId: scope.pluginId, instanceQuery: '' };
    }
    const instanceToken = instanceInfo.tokens[0] ?? '';
    const instance = scope.instances.find(
      (entry) => entry.id.toLowerCase() === instanceToken.toLowerCase(),
    );
    const instanceConfirmed =
      instance && (instanceInfo.tokens.length > 1 || instanceInfo.hasTrailingSpace);
    if (!instanceConfirmed) {
      return {
        mode: 'instance',
        scopeId: scope.pluginId,
        instanceQuery: instanceToken,
      };
    }
    return {
      mode: 'query',
      scopeId: scope.pluginId,
      instanceId: instance.id,
      query: instanceInfo.tokens.slice(1).join(' '),
    };
  }

  private findScope(token: string): SearchableScope | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return this.scopes.find((scope) => scope.pluginId.toLowerCase() === normalized) ?? null;
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

    if (this.activeMode === 'command') {
      this.activeOptions = this.filterCommandOptions(this.cachedState.commandQuery ?? '');
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }
    if (this.activeMode === 'scope') {
      const scopeQuery = this.cachedState.scopeQuery ?? '';
      this.activeOptions = this.buildScopeOptions(scopeQuery);
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }
    if (this.activeMode === 'instance') {
      const scopeId = this.cachedState.scopeId ?? null;
      const instanceQuery = this.cachedState.instanceQuery ?? '';
      this.activeOptions = this.buildInstanceOptions(scopeId, instanceQuery);
      this.optionIndex = this.clampIndex(this.optionIndex, this.activeOptions.length);
      this.renderOptionList(results, this.activeOptions, this.optionIndex);
      return;
    }

    this.activeOptions = [];
    this.resultIndex = this.clampIndex(this.resultIndex, this.results.length);
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
    if (this.activeMode === 'scope' && !(this.cachedState.scopeQuery ?? '').trim()) {
      placeholder = '<scope>';
    } else if (this.activeMode === 'instance' && !(this.cachedState.instanceQuery ?? '').trim()) {
      placeholder = '<instance>';
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
    if (!query) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = this.activeMode === 'global' ? 'Type to search' : 'Type to search';
      container.appendChild(empty);
      return;
    }

    if (this.loading) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'Searching...';
      container.appendChild(empty);
      return;
    }

    if (this.results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No results';
      container.appendChild(empty);
      return;
    }

    this.results.forEach((result, index) => {
      const row = document.createElement('div');
      row.className = 'command-palette-item';
      if (index === this.resultIndex) {
        row.classList.add('focused');
      }

      const icon = document.createElement('div');
      icon.className = 'command-palette-item-icon';
      const iconSvg = this.options.resolveIcon?.(result.launch.panelType) ?? null;
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

      row.addEventListener('click', () => {
        this.resultIndex = index;
        this.handleDefaultLaunch(false);
      });
      row.addEventListener('dblclick', () => {
        this.resultIndex = index;
        this.handleDefaultLaunch(false);
      });

      container.appendChild(row);
    });
  }

  private filterCommandOptions(query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [...COMMAND_OPTIONS];
    }
    return COMMAND_OPTIONS.filter((option) => option.id.startsWith(normalized));
  }

  private buildScopeOptions(query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    const options: OptionItem[] = [
      {
        id: '__all__',
        label: '(all)',
        description: 'Search everything',
        type: 'scope',
      },
    ];
    for (const scope of this.scopes) {
      const idMatch = scope.pluginId.toLowerCase().includes(normalized);
      const labelMatch = scope.label.toLowerCase().includes(normalized);
      if (!normalized || idMatch || labelMatch) {
        options.push({
          id: scope.pluginId,
          label: scope.pluginId,
          description: scope.label,
          type: 'scope',
        });
      }
    }
    return options;
  }

  private buildInstanceOptions(scopeId: string | null, query: string): OptionItem[] {
    const normalized = query.trim().toLowerCase();
    const options: OptionItem[] = [
      {
        id: '__all__',
        label: '(all)',
        description: 'All instances',
        type: 'instance',
        scopeId,
      },
    ];
    const scope = this.scopes.find((entry) => entry.pluginId === scopeId);
    if (!scope) {
      return options;
    }
    for (const instance of scope.instances) {
      const idMatch = instance.id.toLowerCase().includes(normalized);
      const labelMatch = instance.label.toLowerCase().includes(normalized);
      if (!normalized || idMatch || labelMatch) {
        options.push({
          id: instance.id,
          label: instance.id,
          description: instance.label,
          type: 'instance',
          scopeId: scope.pluginId,
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
      this.setInputValue('/search ');
      this.scopeSkipped = false;
      this.instanceSkipped = false;
      return;
    }
    if (option.type === 'scope') {
      if (option.id === '__all__') {
        this.scopeSkipped = true;
        this.instanceSkipped = false;
        this.setInputValue('/search ');
        return;
      }
      this.scopeSkipped = false;
      this.instanceSkipped = false;
      this.setInputValue(`/search ${option.id} `);
      return;
    }
    if (option.type === 'instance') {
      const scopeId = option.scopeId ?? this.cachedState.scopeId ?? '';
      if (!scopeId) {
        return;
      }
      if (option.id === '__all__') {
        this.instanceSkipped = true;
        this.setInputValue(`/search ${scopeId} `);
        return;
      }
      this.instanceSkipped = false;
      this.setInputValue(`/search ${scopeId} ${option.id} `);
    }
  }

  private handleDefaultLaunch(forceReplace: boolean): void {
    const result = this.results[this.resultIndex];
    if (!result) {
      return;
    }
    if (forceReplace) {
      const selectedPanelId = this.options.getSelectedPanelId();
      if (!selectedPanelId) {
        return;
      }
    }
    const action: LaunchAction = forceReplace ? { type: 'replace' } : { type: 'workspace' };
    const launched = this.options.onLaunch(result, action);
    if (launched !== false) {
      this.close();
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.menuState) {
        this.closeMenus();
        return;
      }
      this.close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.menuState) {
        this.moveMenuFocus(1);
        return;
      }
      this.moveFocus(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.menuState) {
        this.moveMenuFocus(-1);
        return;
      }
      this.moveFocus(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      if (this.menuState) {
        event.preventDefault();
        return;
      }
      if (this.activeMode === 'global' || this.activeMode === 'query') {
        event.preventDefault();
        this.openActionMenu();
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.menuState) {
        this.executeMenuSelection();
        return;
      }
      if (this.activeMode === 'command' || this.activeMode === 'scope' || this.activeMode === 'instance') {
        this.handleOptionSelection();
        return;
      }
      if (this.activeMode === 'global' || this.activeMode === 'query') {
        this.handleDefaultLaunch(event.shiftKey);
        return;
      }
      return;
    }

    if (event.key === 'Backspace') {
      if (this.handleBackspace()) {
        event.preventDefault();
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
      if (this.instanceSkipped || this.cachedState.instanceId) {
        this.instanceSkipped = false;
        const scopeId = this.cachedState.scopeId ?? '';
        this.setInputValue(scopeId ? `/search ${scopeId} ` : '/search ');
        return true;
      }
      if (this.scopeSkipped) {
        this.scopeSkipped = false;
        this.setInputValue('/search ');
        return true;
      }
    }
    if (this.activeMode === 'instance' && !(this.cachedState.instanceQuery ?? '').trim()) {
      this.instanceSkipped = false;
      this.setInputValue('/search ');
      return true;
    }
    if (this.activeMode === 'scope' && !(this.cachedState.scopeQuery ?? '').trim()) {
      this.scopeSkipped = false;
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
    if (this.activeMode === 'command' || this.activeMode === 'scope' || this.activeMode === 'instance') {
      if (this.activeOptions.length === 0) {
        this.optionIndex = 0;
        return;
      }
      this.optionIndex = this.wrapIndex(this.optionIndex + delta, this.activeOptions.length);
      this.render();
      this.scrollFocusedItem();
      return;
    }
    if (this.results.length === 0) {
      this.resultIndex = 0;
      return;
    }
    this.resultIndex = this.wrapIndex(this.resultIndex + delta, this.results.length);
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
    let index = 0;
    if (!hasSelection) {
      const fallback = MAIN_MENU_ITEMS.findIndex((item) => !item.requiresSelection);
      index = fallback >= 0 ? fallback : 0;
    }
    this.menuState = { index, anchor: focused };
    this.renderMenu();
  }

  private renderMenu(): void {
    this.removeMenuElements();
    const state = this.menuState;
    if (!state) {
      return;
    }
    const hasSelection = Boolean(this.options.getSelectedPanelId());
    const menu = document.createElement('div');
    menu.className = 'command-palette-menu';

    const items: HTMLButtonElement[] = [];
    MAIN_MENU_ITEMS.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-palette-menu-item';
      button.textContent = entry.label;
      if (entry.requiresSelection && !hasSelection) {
        button.disabled = true;
      }
      if (index === state.index) {
        button.classList.add('focused');
      }
      button.addEventListener('click', () => {
        this.executeAction(entry.action);
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
    const item = MAIN_MENU_ITEMS[this.menuState.index];
    if (!item) {
      return;
    }
    if (item.requiresSelection && !this.options.getSelectedPanelId()) {
      return;
    }
    this.executeAction(item.action);
  }

  private executeAction(action: LaunchAction): void {
    const result = this.results[this.resultIndex];
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
