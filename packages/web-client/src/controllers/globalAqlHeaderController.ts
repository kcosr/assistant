import type { AqlBuiltinField, AqlQuery } from '@assistant/shared';
import {
  DEFAULT_AQL_BUILTIN_FIELDS,
  parseAql,
  type GlobalQuery,
} from '@assistant/shared';
import { CollectionPanelSearchController } from './collectionPanelSearchController';
import type { DialogManager } from './dialogManager';
import {
  loadGlobalQueryState,
  saveGlobalQueryState,
  type StoredGlobalQueryState,
} from '../utils/globalQueryStore';

type SavedQuery = { id: string; name: string; query: string };

export interface GlobalAqlHeaderControllerOptions {
  containerEl: HTMLElement | null;
  toggleButtonEl: HTMLButtonElement | null;
  dialogManager: DialogManager;
  windowId?: string;
  icons: {
    x: string;
    check: string;
    save: string;
    trash: string;
  };
  onQueryChanged: (query: GlobalQuery | null) => void;
  isCollapsed?: () => boolean;
}

const GLOBAL_AQL_ALLOWED_FIELDS = new Set([
  'text',
  'tag',
  'tags',
  'instance',
  'profile',
  'favorite',
  'pinned',
]);

const GLOBAL_AQL_BUILTINS: AqlBuiltinField[] = [
  ...DEFAULT_AQL_BUILTIN_FIELDS,
  {
    name: 'instance',
    key: 'instance',
    label: 'Instance',
    type: 'ref',
    kind: 'builtin',
    displayable: false,
  },
  {
    name: 'profile',
    key: 'instance',
    label: 'Instance',
    type: 'ref',
    kind: 'builtin',
    displayable: false,
  },
  {
    name: 'favorite',
    key: 'favorite',
    label: 'Favorite',
    type: 'boolean',
    kind: 'builtin',
    displayable: false,
  },
  {
    name: 'pinned',
    key: 'pinned',
    label: 'Pinned',
    type: 'boolean',
    kind: 'builtin',
    displayable: false,
  },
];

const DEFAULT_QUERY_STATE: StoredGlobalQueryState = {
  version: 1,
  mode: 'raw',
  rawText: '',
  rawIncludeTags: [],
  rawExcludeTags: [],
  aqlText: '',
  appliedAql: null,
  savedQueries: [],
  selectedSavedQueryId: null,
};

const normalizeSavedQueries = (queries: SavedQuery[]): SavedQuery[] =>
  queries
    .map((entry) => ({
      id: entry.id.trim(),
      name: entry.name.trim(),
      query: entry.query.trim(),
    }))
    .filter((entry) => entry.id && entry.name && entry.query);

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `global-query-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class GlobalAqlHeaderController {
  private readonly searchController: CollectionPanelSearchController;
  private readonly rootEl: HTMLElement | null;
  private readonly dialogManager: DialogManager;
  private readonly toggleButtonEl: HTMLButtonElement | null;
  private readonly onQueryChanged: (query: GlobalQuery | null) => void;
  private readonly windowId: string | undefined;
  private readonly isCollapsed: () => boolean;

  private searchMode: 'raw' | 'aql' = 'raw';
  private rawQueryText = '';
  private rawIncludeTags: string[] = [];
  private rawExcludeTags: string[] = [];
  private aqlQueryText = '';
  private aqlAppliedQueryText: string | null = null;
  private aqlAppliedQuery: AqlQuery | null = null;
  private aqlError: string | null = null;
  private aqlDirty = false;
  private savedQueries: SavedQuery[] = [];
  private selectedSavedQueryId: string | null = null;
  private ignoreSearchChange = false;

  private aqlToggleButton: HTMLButtonElement | null = null;
  private aqlApplyButton: HTMLButtonElement | null = null;
  private aqlSavedSelect: HTMLSelectElement | null = null;
  private aqlSaveButton: HTMLButtonElement | null = null;
  private aqlDeleteButton: HTMLButtonElement | null = null;
  private aqlActionGroup: HTMLElement | null = null;

  private tagSources = new Map<string, string[]>();
  private modalOverlay: HTMLElement | null = null;
  private modalContent: HTMLElement | null = null;
  private modalCloseButton: HTMLButtonElement | null = null;
  private isModalOpen = false;

  constructor(private readonly options: GlobalAqlHeaderControllerOptions) {
    this.dialogManager = options.dialogManager;
    this.toggleButtonEl = options.toggleButtonEl ?? null;
    this.onQueryChanged = options.onQueryChanged;
    this.windowId = options.windowId;
    this.isCollapsed = options.isCollapsed ?? (() => false);

    this.searchController = new CollectionPanelSearchController({
      containerEl: options.containerEl,
      icons: { x: options.icons.x },
    });
    this.rootEl = this.searchController.getRootEl();
    this.rootEl?.classList.add('global-aql-root');

    const aqlControls = this.buildAqlControls(options.icons);
    this.searchController.setLeftControls([aqlControls]);
    this.searchController.setRightControls(null);
    this.searchController.setTagsProvider(() => this.getAllTags());

    this.restoreState();

    this.searchController.setOnQueryChanged((query) => this.handleSearchInputChange(query));

    this.attachTagListener();
    this.attachToggleListener();
    this.attachViewportListener();
  }

  focus(select = true): boolean {
    if (this.isCollapsed()) {
      this.openModal();
    }
    return this.searchController.focus(select);
  }

  private buildAqlControls(icons: GlobalAqlHeaderControllerOptions['icons']): HTMLElement {
    const aqlToggleButton = document.createElement('button');
    aqlToggleButton.type = 'button';
    aqlToggleButton.className = 'list-search-mode-toggle';
    aqlToggleButton.textContent = 'AQL';
    aqlToggleButton.setAttribute('aria-label', 'Toggle AQL mode');
    aqlToggleButton.setAttribute('aria-pressed', 'false');

    const aqlApplyButton = document.createElement('button');
    aqlApplyButton.type = 'button';
    aqlApplyButton.className = 'list-search-apply';
    aqlApplyButton.innerHTML = icons.check;
    aqlApplyButton.setAttribute('aria-label', 'Apply AQL query');
    aqlApplyButton.setAttribute('title', 'Apply');
    aqlApplyButton.disabled = true;

    const aqlSavedSelect = document.createElement('select');
    aqlSavedSelect.className = 'list-search-aql-select';
    aqlSavedSelect.setAttribute('aria-label', 'Saved AQL queries');

    const aqlSaveButton = document.createElement('button');
    aqlSaveButton.type = 'button';
    aqlSaveButton.className = 'list-search-aql-save';
    aqlSaveButton.innerHTML = icons.save;
    aqlSaveButton.setAttribute('aria-label', 'Save AQL query');
    aqlSaveButton.setAttribute('title', 'Save');

    const aqlDeleteButton = document.createElement('button');
    aqlDeleteButton.type = 'button';
    aqlDeleteButton.className = 'list-search-aql-delete';
    aqlDeleteButton.innerHTML = icons.trash;
    aqlDeleteButton.setAttribute('aria-label', 'Delete saved AQL query');
    aqlDeleteButton.setAttribute('title', 'Delete');

    const aqlActionGroup = document.createElement('div');
    aqlActionGroup.className = 'list-search-aql-actions';
    aqlActionGroup.appendChild(aqlSaveButton);
    aqlActionGroup.appendChild(aqlDeleteButton);
    aqlActionGroup.appendChild(aqlApplyButton);

    const aqlControls = document.createElement('div');
    aqlControls.className = 'list-search-aql-controls';
    aqlControls.appendChild(aqlToggleButton);
    aqlControls.appendChild(aqlSavedSelect);
    aqlControls.appendChild(aqlActionGroup);

    aqlToggleButton.addEventListener('click', () => {
      this.setSearchMode(this.searchMode === 'aql' ? 'raw' : 'aql');
    });
    aqlApplyButton.addEventListener('click', () => {
      this.applyAqlQuery();
    });
    aqlSavedSelect.addEventListener('change', () => {
      const id = aqlSavedSelect.value;
      const selected = this.savedQueries.find((entry) => entry.id === id);
      if (selected) {
        this.applySavedQuery(selected);
      }
    });
    aqlSaveButton.addEventListener('click', () => {
      void this.handleSaveAqlQuery();
    });
    aqlDeleteButton.addEventListener('click', () => {
      void this.handleDeleteAqlQuery();
    });

    this.aqlToggleButton = aqlToggleButton;
    this.aqlApplyButton = aqlApplyButton;
    this.aqlSavedSelect = aqlSavedSelect;
    this.aqlSaveButton = aqlSaveButton;
    this.aqlDeleteButton = aqlDeleteButton;
    this.aqlActionGroup = aqlActionGroup;

    return aqlControls;
  }

  private handleSearchInputChange(query: string): void {
    if (this.ignoreSearchChange) {
      return;
    }
    if (this.searchMode === 'aql') {
      this.aqlQueryText = query;
      this.aqlError = null;
      this.aqlDirty = (this.aqlAppliedQueryText ?? '') !== this.aqlQueryText;
      const selected = this.getSavedQueryById(this.selectedSavedQueryId);
      if (selected && selected.query !== this.aqlQueryText.trim()) {
        this.selectedSavedQueryId = null;
        this.renderSavedQueryOptions();
      }
      this.updateAqlStatusMessage();
      this.updateAqlControls();
      this.persistState();
      return;
    }

    this.rawQueryText = query;
    this.applyRawQuery();
    this.persistState();
  }

  private handleAqlKeydown = (event: KeyboardEvent): boolean => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.applyAqlQuery();
      return true;
    }
    return false;
  };

  private setSearchMode(
    nextMode: 'raw' | 'aql',
    options?: { skipPublish?: boolean; skipPersist?: boolean; force?: boolean },
  ): void {
    if (this.searchMode === nextMode && !options?.force) {
      return;
    }
    this.searchMode = nextMode;
    const searchInput = this.searchController.getSearchInputEl();
    if (nextMode === 'aql') {
      const tagController = this.searchController.getTagController();
      if (tagController) {
        this.rawIncludeTags = tagController.getActiveTagFilters();
        this.rawExcludeTags = tagController.getActiveExcludedTagFilters();
      }
      this.searchController.setTagFilteringEnabled(false);
      this.searchController.setPlaceholder('Enter AQL...');
      this.searchController.setKeydownHandler(this.handleAqlKeydown);
      if (searchInput) {
        searchInput.value = this.aqlQueryText;
      }
      this.ensureAqlAppliedQuery();
      this.aqlDirty = (this.aqlAppliedQueryText ?? '') !== this.aqlQueryText;
    } else {
      this.searchController.setTagFilteringEnabled(true);
      this.searchController.setPlaceholder('Search all panels...');
      this.searchController.setKeydownHandler(null);
      const tagController = this.searchController.getTagController();
      if (tagController) {
        tagController.setActiveTagFilters(this.rawIncludeTags);
        tagController.setActiveExcludedTagFilters(this.rawExcludeTags);
      }
      if (searchInput) {
        searchInput.value = this.rawQueryText;
      }
    }
    this.updateAqlControls();
    this.updateAqlStatusMessage();
    if (!options?.skipPublish) {
      this.publishCurrentQuery();
    }
    if (!options?.skipPersist) {
      this.persistState();
    }
  }

  private applyRawQuery(): void {
    const tagController = this.searchController.getTagController();
    const parsed = tagController
      ? tagController.parseSearchQuery(this.rawQueryText)
      : {
          includeTags: [],
          excludeTags: [],
          text: this.rawQueryText,
          partialTag: null,
          partialTagIsExcluded: false,
        };

    const includeTags = Array.from(
      new Set([...(tagController?.getActiveTagFilters() ?? []), ...parsed.includeTags]),
    );
    const excludeTags = Array.from(
      new Set([...(tagController?.getActiveExcludedTagFilters() ?? []), ...parsed.excludeTags]),
    );
    const text = parsed.text.trim();
    const partialTag = parsed.partialTag?.trim() ?? '';

    if (!text && includeTags.length === 0 && excludeTags.length === 0 && !partialTag) {
      this.publishQuery(null);
      return;
    }

    this.publishQuery({
      mode: 'raw',
      text,
      includeTags,
      excludeTags,
      partialTag: partialTag || null,
      partialTagIsExcluded: parsed.partialTagIsExcluded,
    });
    if (tagController) {
      this.rawIncludeTags = tagController.getActiveTagFilters();
      this.rawExcludeTags = tagController.getActiveExcludedTagFilters();
    }
  }

  private applyAqlQueryText(nextText: string, syncInput: boolean): void {
    const trimmed = nextText.trim();
    this.aqlQueryText = nextText;
    if (syncInput) {
      const searchInput = this.searchController.getSearchInputEl();
      if (searchInput) {
        searchInput.value = nextText;
      }
    }
    if (!trimmed) {
      this.aqlAppliedQuery = null;
      this.aqlAppliedQueryText = null;
      this.aqlError = null;
      this.aqlDirty = false;
      this.selectedSavedQueryId = null;
      this.renderSavedQueryOptions();
      this.updateAqlStatusMessage();
      this.updateAqlControls();
      this.persistState();
      this.publishQuery(null);
      return;
    }

    const result = parseAql(trimmed, {
      customFields: [],
      builtinFields: GLOBAL_AQL_BUILTINS,
      allowedFields: Array.from(GLOBAL_AQL_ALLOWED_FIELDS),
      allowOrderBy: false,
      allowShow: false,
    });
    if (!result.ok) {
      this.aqlError = result.error;
      this.aqlDirty = (this.aqlAppliedQueryText ?? '') !== this.aqlQueryText;
      this.updateAqlStatusMessage();
      this.updateAqlControls();
      return;
    }

    this.aqlAppliedQuery = result.query;
    this.aqlAppliedQueryText = nextText;
    this.aqlError = null;
    this.aqlDirty = false;
    const matchingSaved = this.savedQueries.find((entry) => entry.query === trimmed);
    this.selectedSavedQueryId = matchingSaved?.id ?? this.selectedSavedQueryId;
    this.renderSavedQueryOptions();
    this.updateAqlStatusMessage();
    this.updateAqlControls();
    this.persistState();
    this.publishQuery({ mode: 'aql', raw: trimmed, parsed: result.query });
  }

  private applyAqlQuery(): void {
    this.applyAqlQueryText(this.aqlQueryText, false);
  }

  private ensureAqlAppliedQuery(): void {
    if (!this.aqlAppliedQueryText || !this.aqlAppliedQueryText.trim()) {
      this.aqlAppliedQuery = null;
      return;
    }
    const result = parseAql(this.aqlAppliedQueryText, {
      customFields: [],
      builtinFields: GLOBAL_AQL_BUILTINS,
      allowedFields: Array.from(GLOBAL_AQL_ALLOWED_FIELDS),
      allowOrderBy: false,
      allowShow: false,
    });
    if (!result.ok) {
      this.aqlAppliedQuery = null;
      this.aqlError = result.error;
      return;
    }
    this.aqlAppliedQuery = result.query;
    this.aqlError = null;
  }

  private validateAqlInput(queryText: string): AqlQuery | null {
    const trimmed = queryText.trim();
    if (!trimmed) {
      this.aqlError = 'AQL query cannot be empty.';
      this.updateAqlStatusMessage();
      this.updateAqlControls();
      return null;
    }
    const result = parseAql(trimmed, {
      customFields: [],
      builtinFields: GLOBAL_AQL_BUILTINS,
      allowedFields: Array.from(GLOBAL_AQL_ALLOWED_FIELDS),
      allowOrderBy: false,
      allowShow: false,
    });
    if (!result.ok) {
      this.aqlError = result.error;
      this.updateAqlStatusMessage();
      this.updateAqlControls();
      return null;
    }
    this.aqlError = null;
    this.updateAqlStatusMessage();
    this.updateAqlControls();
    return result.query;
  }

  private async handleSaveAqlQuery(): Promise<void> {
    if (this.searchMode !== 'aql') {
      this.setSearchMode('aql');
    }
    const selected = this.getSavedQueryById(this.selectedSavedQueryId);
    const name = await this.dialogManager.showTextInputDialog({
      title: 'Save global query',
      message: 'Name this query for quick access.',
      confirmText: 'Save',
      labelText: 'Query name',
      initialValue: selected?.name ?? '',
      placeholder: 'e.g. Pinned notes',
      validate: (value) => (value.trim().length === 0 ? 'Name is required.' : null),
    });
    if (!name) {
      return;
    }
    if (!this.validateAqlInput(this.aqlQueryText)) {
      return;
    }
    const trimmedName = name.trim();
    const trimmedQuery = this.aqlQueryText.trim();
    const existing = this.savedQueries.find(
      (entry) => entry.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    const isSame = existing && existing.id === selected?.id;
    if (existing && !isSame) {
      const confirmed = await this.confirmDialog({
        title: 'Overwrite saved query?',
        message: `A saved query named "${existing.name}" already exists. Overwrite it?`,
        confirmText: 'Overwrite',
        confirmClassName: 'danger',
      });
      if (!confirmed) {
        return;
      }
    }

    if (existing) {
      existing.name = trimmedName;
      existing.query = trimmedQuery;
      this.selectedSavedQueryId = existing.id;
    } else {
      const entry: SavedQuery = {
        id: generateId(),
        name: trimmedName,
        query: trimmedQuery,
      };
      this.savedQueries = [...this.savedQueries, entry];
      this.selectedSavedQueryId = entry.id;
    }

    this.savedQueries = normalizeSavedQueries(this.savedQueries);
    this.renderSavedQueryOptions();
    this.updateAqlControls();
    this.persistState();
  }

  private async handleDeleteAqlQuery(): Promise<void> {
    const selected = this.getSavedQueryById(this.selectedSavedQueryId);
    if (!selected) {
      return;
    }
    const confirmed = await this.confirmDialog({
      title: 'Delete saved query?',
      message: `Delete "${selected.name}" from saved queries?`,
      confirmText: 'Delete',
      confirmClassName: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.savedQueries = this.savedQueries.filter((entry) => entry.id !== selected.id);
    this.selectedSavedQueryId = null;
    this.renderSavedQueryOptions();
    this.updateAqlControls();
    this.persistState();
  }

  private applySavedQuery(entry: SavedQuery): void {
    if (this.searchMode !== 'aql') {
      this.setSearchMode('aql', { skipPublish: true });
    }
    this.selectedSavedQueryId = entry.id;
    this.applyAqlQueryText(entry.query, true);
    this.renderSavedQueryOptions();
  }

  private renderSavedQueryOptions(): void {
    const select = this.aqlSavedSelect;
    if (!select) {
      return;
    }
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Saved queries';
    select.appendChild(placeholder);

    for (const entry of this.savedQueries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      select.appendChild(option);
    }

    select.value = this.selectedSavedQueryId ?? '';
  }

  private updateAqlControls(): void {
    const enabled = this.searchMode === 'aql';
    if (this.aqlToggleButton) {
      this.aqlToggleButton.classList.toggle('active', enabled);
      this.aqlToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
    if (this.aqlActionGroup) {
      this.aqlActionGroup.classList.toggle('visible', enabled);
    }
    if (this.aqlApplyButton) {
      this.aqlApplyButton.disabled = !enabled || !!this.aqlError;
      this.aqlApplyButton.classList.toggle('dirty', enabled && this.aqlDirty);
    }
    if (this.aqlSavedSelect) {
      this.aqlSavedSelect.classList.toggle('visible', enabled);
    }
    if (this.aqlSaveButton) {
      this.aqlSaveButton.disabled = !enabled || !this.aqlQueryText.trim();
    }
    if (this.aqlDeleteButton) {
      this.aqlDeleteButton.disabled = !enabled || !this.getSavedQueryById(this.selectedSavedQueryId);
    }
  }

  private updateAqlStatusMessage(): void {
    if (this.searchMode !== 'aql') {
      this.searchController.setStatusMessage(null);
      return;
    }
    if (this.aqlError) {
      this.searchController.setStatusMessage(this.aqlError, 'error');
      return;
    }
    const hasAppliedQuery =
      !!(this.aqlAppliedQueryText && this.aqlAppliedQueryText.trim()) || !!this.aqlAppliedQuery;
    const isClearing = hasAppliedQuery && !this.aqlQueryText.trim();
    if (isClearing) {
      this.searchController.setStatusMessage('Press enter to clear');
      return;
    }
    if (this.aqlDirty) {
      this.searchController.setStatusMessage('Press Enter or Apply to run.');
      return;
    }
    this.searchController.setStatusMessage(null);
  }

  private publishCurrentQuery(): void {
    if (this.searchMode === 'aql') {
      if (this.aqlAppliedQuery && this.aqlAppliedQueryText) {
        this.publishQuery({
          mode: 'aql',
          raw: this.aqlAppliedQueryText.trim(),
          parsed: this.aqlAppliedQuery,
        });
      } else {
        this.publishQuery(null);
      }
      return;
    }
    this.applyRawQuery();
  }

  private publishQuery(query: GlobalQuery | null): void {
    this.onQueryChanged(query);
    const active = !!query;
    this.rootEl?.classList.toggle('global-aql-active', active);
    this.toggleButtonEl?.classList.toggle('active', active);
  }

  private persistState(): void {
    const tagController = this.searchController.getTagController();
    const rawIncludeTags =
      this.searchMode === 'raw'
        ? tagController?.getActiveTagFilters() ?? []
        : this.rawIncludeTags;
    const rawExcludeTags =
      this.searchMode === 'raw'
        ? tagController?.getActiveExcludedTagFilters() ?? []
        : this.rawExcludeTags;
    const state: StoredGlobalQueryState = {
      version: 1,
      mode: this.searchMode,
      rawText: this.rawQueryText,
      rawIncludeTags,
      rawExcludeTags,
      aqlText: this.aqlQueryText,
      appliedAql: this.aqlAppliedQueryText,
      savedQueries: this.savedQueries,
      selectedSavedQueryId: this.selectedSavedQueryId,
    };
    saveGlobalQueryState(state, this.windowId);
  }

  private restoreState(): void {
    const stored = loadGlobalQueryState(this.windowId) ?? DEFAULT_QUERY_STATE;
    this.searchMode = stored.mode;
    this.rawQueryText = stored.rawText;
    this.rawIncludeTags = stored.rawIncludeTags;
    this.rawExcludeTags = stored.rawExcludeTags;
    this.aqlQueryText = stored.aqlText;
    this.aqlAppliedQueryText = stored.appliedAql;
    this.savedQueries = normalizeSavedQueries(stored.savedQueries);
    this.selectedSavedQueryId = stored.selectedSavedQueryId;
    if (
      this.selectedSavedQueryId &&
      !this.savedQueries.some((entry) => entry.id === this.selectedSavedQueryId)
    ) {
      this.selectedSavedQueryId = null;
    }

    this.ensureAqlAppliedQuery();
    this.aqlDirty = (this.aqlAppliedQueryText ?? '') !== this.aqlQueryText;

    const tagController = this.searchController.getTagController();
    if (tagController) {
      tagController.setActiveTagFilters(stored.rawIncludeTags);
      tagController.setActiveExcludedTagFilters(stored.rawExcludeTags);
    }

    this.ignoreSearchChange = true;
    this.setSearchMode(this.searchMode, { skipPersist: true, skipPublish: true, force: true });
    const searchInput = this.searchController.getSearchInputEl();
    if (searchInput) {
      searchInput.value = this.searchMode === 'aql' ? this.aqlQueryText : this.rawQueryText;
    }
    this.renderSavedQueryOptions();
    this.updateAqlControls();
    this.updateAqlStatusMessage();
    this.ignoreSearchChange = false;

    this.publishCurrentQuery();
  }

  private getSavedQueryById(id: string | null): SavedQuery | null {
    if (!id) {
      return null;
    }
    return this.savedQueries.find((entry) => entry.id === id) ?? null;
  }

  private async confirmDialog(options: {
    title: string;
    message: string;
    confirmText: string;
    confirmClassName?: string;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      this.dialogManager.showConfirmDialog({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        ...(options.confirmClassName ? { confirmClassName: options.confirmClassName } : {}),
        onConfirm: () => {
          if (resolved) return;
          resolved = true;
          resolve(true);
        },
        onCancel: () => {
          if (resolved) return;
          resolved = true;
          resolve(false);
        },
      });
    });
  }

  private attachTagListener(): void {
    window.addEventListener('assistant:global-tags', (event) => {
      const detail = (event as CustomEvent).detail as { source?: unknown; tags?: unknown };
      const source = typeof detail?.source === 'string' ? detail.source.trim() : '';
      if (!source) {
        return;
      }
      const tags = Array.isArray(detail?.tags)
        ? detail.tags
            .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
            .filter((tag) => tag.length > 0)
        : [];
      this.tagSources.set(source, tags);
      this.searchController.setTagsProvider(() => this.getAllTags());
    });
  }

  private getAllTags(): string[] {
    const tags = new Set<string>();
    for (const entries of this.tagSources.values()) {
      for (const tag of entries) {
        if (tag) {
          tags.add(tag);
        }
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }

  private attachToggleListener(): void {
    if (!this.toggleButtonEl) {
      return;
    }
    this.toggleButtonEl.addEventListener('click', () => {
      if (this.isCollapsed()) {
        if (this.isModalOpen) {
          this.closeModal();
        } else {
          this.openModal();
        }
        return;
      }
      this.focus();
    });
  }

  private attachViewportListener(): void {
    window.addEventListener('resize', () => {
      if (this.isModalOpen && !this.isCollapsed()) {
        this.closeModal();
      }
    });
  }

  private openModal(): void {
    if (this.isModalOpen) {
      return;
    }
    const root = this.rootEl;
    if (!root) {
      return;
    }
    if (!this.modalOverlay) {
      this.buildModal();
    }
    if (!this.modalOverlay || !this.modalContent) {
      return;
    }
    this.modalOverlay.classList.add('open');
    this.modalContent.appendChild(root);
    this.isModalOpen = true;
    this.dialogManager.registerExternalDialog(this.modalOverlay, () => this.closeModal());
    this.searchController.focus(true);
  }

  private closeModal(): void {
    if (!this.isModalOpen) {
      return;
    }
    const root = this.rootEl;
    if (this.modalOverlay) {
      this.modalOverlay.classList.remove('open');
      this.dialogManager.releaseExternalDialog(this.modalOverlay);
    }
    if (root && this.options.containerEl) {
      this.options.containerEl.appendChild(root);
    }
    this.isModalOpen = false;
  }

  private buildModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'global-aql-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'global-aql-modal';

    const header = document.createElement('div');
    header.className = 'global-aql-modal-header';

    const title = document.createElement('div');
    title.className = 'global-aql-modal-title';
    title.textContent = 'Global query';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'global-aql-modal-close';
    closeButton.setAttribute('aria-label', 'Close global query');
    closeButton.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeButton);

    const content = document.createElement('div');
    content.className = 'global-aql-modal-content';

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.closeModal();
      }
    });

    closeButton.addEventListener('click', () => {
      this.closeModal();
    });

    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeModal();
      }
    });

    this.modalOverlay = overlay;
    this.modalContent = content;
    this.modalCloseButton = closeButton;
  }
}
