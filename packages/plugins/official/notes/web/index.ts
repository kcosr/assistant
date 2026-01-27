import type { PanelEventEnvelope } from '@assistant/shared';

import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { apiFetch } from '../../../../web-client/src/utils/api';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';
import { CollectionPanelSearchController } from '../../../../web-client/src/controllers/collectionPanelSearchController';
import {
  CollectionBrowserController,
  type CollectionPreviewCacheEntry,
} from '../../../../web-client/src/controllers/collectionBrowserController';
import { CollectionDropdownController } from '../../../../web-client/src/controllers/collectionDropdown';
import type {
  CollectionItemSummary,
  CollectionReference,
} from '../../../../web-client/src/controllers/collectionTypes';
import { CollectionPanelBodyManager } from '../../../../web-client/src/controllers/collectionPanelBody';
import { ContextMenuManager } from '../../../../web-client/src/controllers/contextMenu';
import { DialogManager } from '../../../../web-client/src/controllers/dialogManager';
import { MarkdownViewerController } from '../../../../web-client/src/controllers/markdownViewerController';
import { ListColumnPreferencesClient } from '../../../../web-client/src/utils/listColumnPreferences';
import { applyTagColorToElement, normalizeTag } from '../../../../web-client/src/utils/tagColors';
import {
  applyPinnedTag,
  hasPinnedTag,
  isPinnedTag,
  withoutPinnedTag,
  PINNED_TAG,
} from '../../../../web-client/src/utils/pinnedTag';
import { ICONS } from '../../../../web-client/src/utils/icons';
import {
  CORE_PANEL_SERVICES_CONTEXT_KEY,
  type PanelCoreServices,
} from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';

const NOTES_PANEL_TEMPLATE = `
  <aside class="notes-panel collection-panel" aria-label="Notes panel">
    <div class="panel-header panel-chrome-row" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Notes</span>
        <div class="panel-chrome-instance" data-role="instance-actions">
          <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
            <button
              type="button"
              class="panel-chrome-instance-trigger"
              data-role="instance-trigger"
              aria-label="Select instance"
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              <span class="panel-chrome-instance-trigger-text" data-role="instance-trigger-text">Default</span>
              <svg class="panel-chrome-instance-trigger-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div
              class="panel-chrome-instance-menu"
              data-role="instance-menu"
              role="listbox"
              aria-label="Instances"
            >
              <div class="panel-chrome-instance-search-row">
                <input
                  type="text"
                  class="panel-chrome-instance-search"
                  data-role="instance-search"
                  placeholder="Search instances..."
                  aria-label="Search instances"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="panel-chrome-instance-clear"
                  data-role="instance-clear"
                  aria-label="Clear selection"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6l-12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div class="panel-chrome-instance-list" data-role="instance-list"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
        <div
          class="collection-panel-mode-toggle"
          data-role="notes-mode-toggle"
          role="tablist"
          aria-label="Notes panel display mode"
        >
          <button
            type="button"
            class="collection-panel-mode-button"
            data-role="notes-mode-browser"
            role="tab"
            aria-selected="true"
          >
            Browser
          </button>
          <button
            type="button"
            class="collection-panel-mode-button"
            data-role="notes-mode-note"
            role="tab"
            aria-selected="false"
          >
            Note
          </button>
        </div>
        <div class="collection-search-dropdown-container" data-role="notes-dropdown-container">
          <button
            type="button"
            class="collection-search-dropdown-trigger"
            data-role="notes-dropdown-trigger"
            aria-label="Select a note"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span
              class="collection-search-dropdown-trigger-text"
              data-role="notes-dropdown-trigger-text"
              >Select a note&hellip;</span
            >
            <svg class="collection-search-dropdown-trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div
            class="collection-search-dropdown"
            data-role="notes-dropdown"
            role="listbox"
            aria-label="Notes"
          >
            <input
              type="text"
              class="collection-search-dropdown-search"
              data-role="notes-dropdown-search"
              placeholder="Search notes..."
              aria-label="Search notes"
              autocomplete="off"
            />
            <div class="collection-search-dropdown-active-tags" data-role="notes-dropdown-active">
              <!-- Active tag filters shown here -->
            </div>
            <div class="collection-search-dropdown-tags" data-role="notes-dropdown-tags">
              <!-- Tag suggestions shown here -->
            </div>
            <div class="collection-search-dropdown-list" data-role="notes-dropdown-list">
              <!-- Notes populated dynamically -->
            </div>
          </div>
        </div>
        <button
          type="button"
          class="panel-close-button collection-back-button"
          data-role="notes-back"
          aria-label="Back to notes browser"
        >
          <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <div class="panel-chrome-frame-controls" data-role="chrome-controls">
        <button type="button" class="panel-chrome-button panel-chrome-toggle" data-action="toggle" aria-label="Panel controls" title="Panel controls">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div class="panel-chrome-frame-buttons">
          <button type="button" class="panel-chrome-button" data-action="move" aria-label="Move panel" title="Move">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="reorder" aria-label="Reorder panel" title="Reorder">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="menu" aria-label="More actions" title="More actions">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </div>
        <button type="button" class="panel-chrome-button panel-chrome-close" data-action="close" aria-label="Close panel" title="Close">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="collection-panel-shared-search" data-role="notes-shared-search"></div>
    <div class="panel-body collection-panel-body" data-role="notes-panel-body">
      <div class="collection-panel-content" data-role="notes-panel-content"></div>
    </div>
  </aside>
`;

const DEFAULT_INSTANCE_ID = 'default';
const NOTE_SEARCH_HIT_CLASS = 'notes-search-hit';
const NOTE_SEARCH_ACTIVE_CLASS = 'notes-search-hit-active';
const NOTE_SEARCH_IGNORE_SELECTORS = [
  '.markdown-code-copy-wrapper',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'svg',
];

type NoteMetadata = {
  title: string;
  tags: string[];
  favorite?: boolean;
  created: string;
  updated: string;
  description?: string;
};

type NoteSummary = NoteMetadata & {
  instanceId: string;
  instanceLabel?: string;
};

type Note = NoteMetadata & {
  content: string;
};

type Instance = {
  id: string;
  label: string;
};

type OperationResponse<T> = { ok: true; result: T } | { error: string };

type ViewMode = 'browser' | 'note';

const registry = window.ASSISTANT_PANEL_REGISTRY;

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function formatInstanceLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseInstance(value: unknown): Instance | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = raw['id'];
  if (typeof id !== 'string') {
    return null;
  }
  const label =
    typeof raw['label'] === 'string' && raw['label'].trim().length > 0
      ? raw['label']
      : formatInstanceLabel(id);
  return { id, label };
}

function parseNoteMetadata(value: unknown): NoteMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const title = typeof obj['title'] === 'string' ? obj['title'].trim() : '';
  if (!title) {
    return null;
  }
  const tags = parseStringArray(obj['tags']);
  const created = typeof obj['created'] === 'string' ? obj['created'] : '';
  const updated = typeof obj['updated'] === 'string' ? obj['updated'] : '';
  const description = typeof obj['description'] === 'string' ? obj['description'] : '';
  const favorite = obj['favorite'] === true;
  return {
    title,
    tags,
    ...(favorite ? { favorite: true } : {}),
    created,
    updated,
    ...(description.trim().length > 0 ? { description } : {}),
  };
}

function parseNoteMetadataList(value: unknown, instanceId: string): NoteSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: NoteSummary[] = [];
  for (const entry of value) {
    const parsed = parseNoteMetadata(entry);
    if (parsed) {
      result.push({ ...parsed, instanceId });
    }
  }
  return result;
}

function parseNote(value: unknown): Note | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const metadata = parseNoteMetadata(obj);
  if (!metadata) {
    return null;
  }
  const content = typeof obj['content'] === 'string' ? obj['content'] : '';
  return {
    ...metadata,
    content,
  };
}

function sortNotes<T extends NoteMetadata>(entries: T[]): T[] {
  return entries.slice().sort((a, b) => {
    const aDate = Date.parse(a.updated || a.created || '');
    const bDate = Date.parse(b.updated || b.created || '');
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
      if (aDate !== bDate) {
        return bDate - aDate;
      }
    }
    return a.title.localeCompare(b.title);
  });
}

function renderNoteTags(tags: string[] | undefined): HTMLElement | null {
  if (!tags || tags.length === 0) {
    return null;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'collection-tags';
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || isPinnedTag(tag)) {
      continue;
    }
    const pill = document.createElement('span');
    pill.className = 'collection-tag';
    pill.textContent = rawTag;
    pill.dataset['tag'] = normalizeTag(tag);
    applyTagColorToElement(pill, tag);
    wrapper.appendChild(pill);
  }
  return wrapper.firstChild ? wrapper : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
}

function createTagChipsInput(options: { availableTags: string[]; initialTags: string[] }): {
  wrapper: HTMLElement;
  inputId: string;
  getTags: () => string[];
  focus: () => void;
} {
  const tagInputWrap = document.createElement('div');
  tagInputWrap.className = 'tag-chips-input';

  const tagChipsContainer = document.createElement('div');
  tagChipsContainer.className = 'tag-chips-input-chips';

  const tagEntryInput = document.createElement('input');
  tagEntryInput.type = 'text';
  tagEntryInput.className = 'tag-chips-input-field';
  tagEntryInput.placeholder = 'Add tag...';
  tagEntryInput.autocomplete = 'off';
  tagEntryInput.id = `notes-tags-input-${Math.random().toString(36).slice(2)}`;

  const tagSuggestions = document.createElement('div');
  tagSuggestions.className = 'tag-chips-input-suggestions';

  tagChipsContainer.appendChild(tagEntryInput);
  tagInputWrap.appendChild(tagChipsContainer);
  tagInputWrap.appendChild(tagSuggestions);

  const canonicalTagByLower = new Map<string, string>();
  for (const tag of options.availableTags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!canonicalTagByLower.has(lower)) {
      canonicalTagByLower.set(lower, trimmed);
    }
  }

  const selectedTagsLower = new Set<string>();
  const selectedTags: string[] = [];

  const renderSelectedTags = (): void => {
    tagChipsContainer.querySelectorAll('.tag-chip').forEach((el) => el.remove());
    for (const tag of selectedTags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      chip.dataset['tag'] = normalizeTag(tag);
      applyTagColorToElement(chip, tag);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-chip-remove';
      removeBtn.tabIndex = -1;
      removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
      removeBtn.textContent = 'x';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeTagByLower(tag.toLowerCase());
      });
      chip.appendChild(removeBtn);
      tagChipsContainer.insertBefore(chip, tagEntryInput);
    }
  };

  const addTag = (raw: string): void => {
    const trimmed = raw.trim().replace(/^@+/, '');
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (selectedTagsLower.has(lower)) return;

    const canonical = canonicalTagByLower.get(lower) ?? trimmed;
    selectedTagsLower.add(lower);
    selectedTags.push(canonical);
    renderSelectedTags();
    renderTagSuggestions();
  };

  const addTagsFromText = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    for (const part of parts) {
      addTag(part);
    }
  };

  const removeTagByLower = (lower: string): void => {
    if (!selectedTagsLower.has(lower)) {
      return;
    }
    selectedTagsLower.delete(lower);
    const idx = selectedTags.findIndex((t) => t.toLowerCase() === lower);
    if (idx >= 0) {
      selectedTags.splice(idx, 1);
    }
    renderSelectedTags();
    renderTagSuggestions();
  };

  const removeLastTag = (): void => {
    const tag = selectedTags.pop();
    if (!tag) return;
    selectedTagsLower.delete(tag.toLowerCase());
    renderSelectedTags();
    renderTagSuggestions();
  };

  let currentMatches: string[] = [];
  let isClickingSuggestion = false;

  const renderTagSuggestions = (): void => {
    const query = tagEntryInput.value.trim().toLowerCase();
    tagSuggestions.innerHTML = '';
    currentMatches = [];
    if (!query) {
      tagSuggestions.classList.remove('visible');
      return;
    }

    const matches: string[] = [];
    for (const [lower, canonical] of canonicalTagByLower.entries()) {
      if (selectedTagsLower.has(lower)) continue;
      if (lower.startsWith(query)) {
        matches.push(canonical);
      }
    }

    matches.sort((a, b) => a.localeCompare(b));
    currentMatches = matches.slice(0, 12);
    if (currentMatches.length === 0) {
      tagSuggestions.classList.remove('visible');
      return;
    }

    tagSuggestions.classList.add('visible');
    for (const tag of currentMatches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-chip-suggestion';
      btn.tabIndex = -1;
      btn.textContent = tag;
      btn.dataset['tag'] = normalizeTag(tag);
      applyTagColorToElement(btn, tag);
      // Use mousedown to fire before blur
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur from firing
        isClickingSuggestion = true;
        tagEntryInput.value = '';
        addTag(tag);
        renderTagSuggestions();
        tagEntryInput.focus();
        isClickingSuggestion = false;
      });
      tagSuggestions.appendChild(btn);
    }
  };

  tagEntryInput.addEventListener('input', () => {
    renderTagSuggestions();
  });

  tagEntryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagEntryInput.value.trim().length > 0) {
        // If there's exactly one matching suggestion, use it
        const singleMatch = currentMatches.length === 1 ? currentMatches[0] : null;
        if (singleMatch) {
          tagEntryInput.value = '';
          addTag(singleMatch);
        } else {
          addTagsFromText(tagEntryInput.value);
          tagEntryInput.value = '';
        }
        renderTagSuggestions();
      }
      return;
    }
    if (e.key === 'Backspace' && tagEntryInput.value.length === 0) {
      removeLastTag();
    }
  });

  tagEntryInput.addEventListener('blur', () => {
    // Don't process blur if we're clicking a suggestion (mousedown handles it)
    if (isClickingSuggestion) {
      return;
    }
    if (tagEntryInput.value.trim().length > 0) {
      addTagsFromText(tagEntryInput.value);
      tagEntryInput.value = '';
      renderTagSuggestions();
    }
  });

  for (const tag of options.initialTags) {
    addTag(tag);
  }

  return {
    wrapper: tagInputWrap,
    inputId: tagEntryInput.id,
    getTags: () => selectedTags.slice(),
    focus: () => tagEntryInput.focus(),
  };
}

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/notes/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore JSON parsing failures
  }

  if (!response.ok || !payload || 'error' in payload) {
    const message =
      payload && 'error' in payload && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

const fallbackDialogManager = new DialogManager();
const fallbackContextMenuManager = new ContextMenuManager({
  isSessionPinned: () => false,
  pinSession: () => undefined,
  clearHistory: () => undefined,
  deleteSession: () => undefined,
  renameSession: () => undefined,
});
const fallbackListColumnPreferencesClient = new ListColumnPreferencesClient();
void fallbackListColumnPreferencesClient.load();

function resolveServices(host: PanelHost): PanelCoreServices {
  const raw = host.getContext(CORE_PANEL_SERVICES_CONTEXT_KEY);
  const core =
    raw && typeof raw === 'object'
      ? (raw as PanelCoreServices)
      : (null as PanelCoreServices | null);
  if (core) {
    return core;
  }
  return {
    dialogManager: fallbackDialogManager,
    contextMenuManager: fallbackContextMenuManager,
    listColumnPreferencesClient: fallbackListColumnPreferencesClient,
    focusInput: () => {
      host.openPanel('chat', { focus: true });
    },
    setStatus: () => undefined,
    isMobileViewport: () => {
      if (typeof window === 'undefined') {
        return false;
      }
      try {
        if (typeof window.matchMedia === 'function') {
          return window.matchMedia('(max-width: 600px)').matches;
        }
      } catch {
        // Ignore matchMedia errors and fall back to window size.
      }
      return window.innerWidth <= 600;
    },
    notifyContextAvailabilityChange: () => undefined,
  };
}

if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for notes plugin.');
} else {
  registry.registerPanel('notes', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = NOTES_PANEL_TEMPLATE.trim();

      const root = container.firstElementChild as HTMLElement | null;
      if (!root) {
        throw new Error('Failed to render notes panel');
      }

      const browserButton = root.querySelector<HTMLButtonElement>(
        '[data-role="notes-mode-browser"]',
      );
      const noteButton = root.querySelector<HTMLButtonElement>('[data-role="notes-mode-note"]');
      const backButton = root.querySelector<HTMLButtonElement>('[data-role="notes-back"]');
      const dropdownContainer = root.querySelector<HTMLElement>(
        '[data-role="notes-dropdown-container"]',
      );
      const dropdownTrigger = root.querySelector<HTMLButtonElement>(
        '[data-role="notes-dropdown-trigger"]',
      );
      const dropdownTriggerText = root.querySelector<HTMLElement>(
        '[data-role="notes-dropdown-trigger-text"]',
      );
      const dropdown = root.querySelector<HTMLElement>('[data-role="notes-dropdown"]');
      const dropdownSearch = root.querySelector<HTMLInputElement>(
        '[data-role="notes-dropdown-search"]',
      );
      const dropdownTags = root.querySelector<HTMLElement>('[data-role="notes-dropdown-tags"]');
      const dropdownActiveTags = root.querySelector<HTMLElement>(
        '[data-role="notes-dropdown-active"]',
      );
      const dropdownList = root.querySelector<HTMLElement>('[data-role="notes-dropdown-list"]');
      const sharedSearchEl = root.querySelector<HTMLElement>('[data-role="notes-shared-search"]');
      const panelContent = root.querySelector<HTMLElement>('[data-role="notes-panel-content"]');

      const services = resolveServices(host);

      const sharedSearchController = new CollectionPanelSearchController({
        containerEl: sharedSearchEl,
        icons: { x: ICONS.x },
      });

      const bodyManager = new CollectionPanelBodyManager(panelContent);

      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceIds: string[] = [DEFAULT_INSTANCE_ID];
      let activeInstanceId = DEFAULT_INSTANCE_ID;
      let availableNotes: NoteSummary[] = [];
      let activeNoteTitle: string | null = null;
      let activeNoteInstanceId: string | null = null;
      let activeNote: Note | null = null;
      let mode: ViewMode = 'browser';
      let isVisible = false;
      let isEditing = false;
      let refreshToken = 0;
      let refreshInFlight = false;
      let loadToken = 0;
      let browserController: CollectionBrowserController | null = null;
      let dropdownController: CollectionDropdownController | null = null;
      let markdownViewer: MarkdownViewerController | null = null;
      let selectedNoteText: string | null = null;
      let expandCollapseToggle: HTMLButtonElement | null = null;
      let chromeController: PanelChromeController | null = null;
      let panelKeydownAttached = false;
      let isPanelSelected = false;
      let unsubscribePanelActive: (() => void) | null = null;
      let pendingShowEvent: { title: string; instanceId: string } | null = null;

      const persistState = (): void => {
        host.persistPanelState({
          selectedNoteTitle: activeNoteTitle,
          selectedNoteInstanceId: activeNoteInstanceId,
          mode,
          instanceIds: selectedInstanceIds,
        });
      };

      const callInstanceOperation = async <T>(
        instanceId: string,
        operation: string,
        body: Record<string, unknown>,
      ): Promise<T> =>
        callOperation(operation, {
          ...body,
          instance_id: instanceId,
        });

      /**
       * Update the expand/collapse toggle button label based on current state.
       */
      const updateExpandCollapseToggleLabel = (): void => {
        if (!expandCollapseToggle || !markdownViewer) {
          return;
        }
        expandCollapseToggle.textContent = markdownViewer.getExpandCollapseLabel();
        expandCollapseToggle.setAttribute(
          'aria-label',
          markdownViewer.getExpandCollapseAriaLabel(),
        );
      };

      /**
       * Called when user manually toggles an individual section.
       */
      const handleManualSectionToggle = (): void => {
        updateExpandCollapseToggleLabel();
      };

      const panelId = host.panelId();
      const contextKey = getPanelContextKey(panelId);

      const updatePanelSelection = (value: unknown): void => {
        if (!value || typeof value !== 'object') {
          isPanelSelected = false;
          return;
        }
        const raw = value as { panelId?: unknown };
        isPanelSelected = typeof raw.panelId === 'string' && raw.panelId === panelId;
      };
      updatePanelSelection(host.getContext('panel.active'));
      unsubscribePanelActive = host.subscribeContext('panel.active', updatePanelSelection);

      const isKnownInstance = (instanceId: string): boolean =>
        instances.some((instance) => instance.id === instanceId);

      const applyPendingShowEvent = (): void => {
        if (!pendingShowEvent) {
          return;
        }
        const { title, instanceId } = pendingShowEvent;
        if (!isKnownInstance(instanceId)) {
          return;
        }
        pendingShowEvent = null;
        if (!selectedInstanceIds.includes(instanceId)) {
          setActiveInstances([instanceId, ...selectedInstanceIds]);
        }
        void selectNote(title, instanceId, { focus: false });
      };

      const getAvailableItems = (): CollectionItemSummary[] =>
        availableNotes.map((note) => ({
          type: 'note',
          id: note.title,
          name: note.title,
          tags: note.tags,
          favorite: note.favorite,
          updatedAt: note.updated,
          instanceId: note.instanceId,
          instanceLabel: note.instanceLabel ?? getInstanceLabel(note.instanceId),
        }));

      const getActiveReference = (): CollectionReference | null =>
        activeNoteTitle && activeNoteInstanceId
          ? { type: 'note', id: activeNoteTitle, instanceId: activeNoteInstanceId }
          : null;

      const updateDropdownSelection = (reference: CollectionReference | null): void => {
        if (!dropdownTriggerText) {
          return;
        }
        if (!reference) {
          dropdownTriggerText.textContent = 'Select a note...';
        } else {
          const note =
            availableNotes.find(
              (entry) =>
                entry.title === reference.id && entry.instanceId === reference.instanceId,
            ) ?? activeNote;
          const noteInstanceId = note?.instanceId ?? activeNoteInstanceId;
          if (note && noteInstanceId && selectedInstanceIds.length > 1) {
            dropdownTriggerText.textContent = `${note.title} (${getInstanceLabel(
              noteInstanceId,
            )})`;
          } else {
            dropdownTriggerText.textContent = note?.title ?? 'Select a note...';
          }
        }
        chromeController?.scheduleLayoutCheck();
      };

      const getInstanceLabel = (instanceId: string): string => {
        const match = instances.find((instance) => instance.id === instanceId);
        return match?.label ?? formatInstanceLabel(instanceId);
      };

      const normalizeInstanceSelection = (instanceIds: string[]): string[] => {
        const unique: string[] = [];
        for (const id of instanceIds) {
          if (typeof id !== 'string') {
            continue;
          }
          const trimmed = id.trim();
          if (!trimmed || unique.includes(trimmed)) {
            continue;
          }
          unique.push(trimmed);
        }
        const known = new Set(instances.map((instance) => instance.id));
        const filtered = unique.filter((id) => known.has(id));
        if (filtered.length > 0) {
          return filtered;
        }
        return [DEFAULT_INSTANCE_ID];
      };

      const formatInstanceSelectionLabel = (instanceIds: string[]): string => {
        const labels = instanceIds.map((id) => getInstanceLabel(id));
        if (labels.length === 0) {
          return getInstanceLabel(DEFAULT_INSTANCE_ID);
        }
        if (labels.length === 1) {
          return labels[0] ?? getInstanceLabel(DEFAULT_INSTANCE_ID);
        }
        if (labels.length === 2) {
          return `${labels[0]} + ${labels[1]}`;
        }
        return `${labels[0]} + ${labels.length - 1}`;
      };

      const getInstanceSelectionOptions = (): {
        options: Instance[];
        preferredInstanceId?: string;
      } | null => {
        if (selectedInstanceIds.length <= 1) {
          return null;
        }
        const selected = selectedInstanceIds
          .map((id) => instances.find((instance) => instance.id === id))
          .filter((instance): instance is Instance => !!instance);
        if (selected.length <= 1) {
          return null;
        }
        const sorted = [...selected].sort((a, b) => {
          const aDefault = a.id === DEFAULT_INSTANCE_ID;
          const bDefault = b.id === DEFAULT_INSTANCE_ID;
          if (aDefault !== bDefault) {
            return aDefault ? -1 : 1;
          }
          return getInstanceLabel(a.id).localeCompare(getInstanceLabel(b.id), undefined, {
            sensitivity: 'base',
          });
        });
        const preferredInstanceId = selectedInstanceIds.includes(DEFAULT_INSTANCE_ID)
          ? DEFAULT_INSTANCE_ID
          : sorted[0]?.id;
        return { options: sorted, preferredInstanceId };
      };

      const updatePanelMetadata = (): void => {
        if (selectedInstanceIds.length === 1 && selectedInstanceIds[0] === DEFAULT_INSTANCE_ID) {
          host.setPanelMetadata({ title: 'Notes' });
          return;
        }
        host.setPanelMetadata({
          title: `Notes (${formatInstanceSelectionLabel(selectedInstanceIds)})`,
        });
      };

      const renderInstanceSelect = (): void => {
        chromeController?.setInstances(instances, selectedInstanceIds);
      };

      const setActiveInstances = (instanceIds: string[]): void => {
        const normalized = normalizeInstanceSelection(instanceIds);
        if (normalized.join('|') === selectedInstanceIds.join('|')) {
          return;
        }
        selectedInstanceIds = normalized;
        activeInstanceId = selectedInstanceIds[0] ?? DEFAULT_INSTANCE_ID;
        availableNotes = [];
        activeNoteTitle = null;
        activeNoteInstanceId = null;
        activeNote = null;
        loadToken += 1;
        refreshInFlight = false;
        refreshToken += 1;
        updatePanelContext();
        updateDropdownSelection(null);
        refreshBrowser();
        setMode('browser');
        renderInstanceSelect();
        updatePanelMetadata();
        persistState();
        void refreshNotes({ silent: true });
      };

      const updatePanelContext = (): void => {
        const contextInstanceId = activeNoteInstanceId ?? activeInstanceId;
        const contextAttributes: Record<string, string> = {
          'instance-id': contextInstanceId,
          'instance-ids': selectedInstanceIds.join(','),
        };
        if (!activeNote || !activeNoteInstanceId) {
          host.setContext(contextKey, {
            instance_id: contextInstanceId,
            instance_ids: selectedInstanceIds,
            contextAttributes,
          });
          services.notifyContextAvailabilityChange();
          return;
        }
        // Include selected text as a context attribute if available
        if (selectedNoteText && selectedNoteText.trim().length > 0) {
          contextAttributes['selected-text'] = selectedNoteText.trim();
        }
        const context: Record<string, unknown> = {
          type: 'note',
          id: activeNote.title,
          title: activeNote.title,
          tags: activeNote.tags,
          created: activeNote.created,
          updated: activeNote.updated,
          instance_id: activeNoteInstanceId,
          instance_ids: selectedInstanceIds,
          contextAttributes,
        };
        host.setContext(contextKey, context);
        // Notify chat inputs to update their context preview
        services.notifyContextAvailabilityChange();
      };

      const isEditableTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Element)) {
          return false;
        }
        if ((target as HTMLElement).isContentEditable) {
          return true;
        }
        return Boolean(
          target.closest(
            'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
          ),
        );
      };

      const hasBlockingOverlay = (): boolean => {
        const modalOverlay = document.querySelector<HTMLElement>('.panel-modal-overlay.open');
        if (modalOverlay && !modalOverlay.contains(root)) {
          return true;
        }
        if (document.querySelector('.command-palette-overlay.open')) {
          return true;
        }
        const dockPopover = document.querySelector<HTMLElement>('.panel-dock-popover.open');
        if (dockPopover && !dockPopover.contains(root)) {
          return true;
        }
        return false;
      };

      const hasOpenDropdowns = (): boolean => {
        if (
          root.querySelector('.collection-search-dropdown-container.open') ||
          root.querySelector('.panel-chrome-instance-menu.open')
        ) {
          return true;
        }
        return false;
      };

      const isPanelOverlay = (): boolean =>
        Boolean(root.closest('.panel-modal')) || Boolean(root.closest('.panel-dock-popover'));

      const canHandlePanelShortcuts = (
        event: KeyboardEvent,
        options?: { requireNoteMode?: boolean },
      ): boolean => {
        if (!isVisible) {
          return false;
        }
        if (services.dialogManager.hasOpenDialog) {
          return false;
        }
        if (hasBlockingOverlay()) {
          return false;
        }
        if (!isPanelSelected && !isPanelOverlay()) {
          return false;
        }
        if (document.querySelector('.context-menu')) {
          return false;
        }
        if (hasOpenDropdowns()) {
          return false;
        }
        if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
          return false;
        }
        const requireNoteMode = options?.requireNoteMode ?? true;
        if (requireNoteMode && mode !== 'note') {
          return false;
        }
        return true;
      };

      const handlePanelKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          const searchInput = sharedSearchController.getSearchInputEl();
          if (searchInput && document.activeElement === searchInput) {
            const tagController = sharedSearchController.getTagController();
            const hasFilters =
              searchInput.value.trim().length > 0 ||
              (tagController?.getActiveTagFilters().length ?? 0) > 0 ||
              (tagController?.getActiveExcludedTagFilters().length ?? 0) > 0;
            if (!hasFilters) {
              event.preventDefault();
              event.stopPropagation();
              searchInput.blur();
              return;
            }
          }
        }
        const isSearchShortcut =
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'f';
        if (isSearchShortcut) {
          if (!canHandlePanelShortcuts(event, { requireNoteMode: false })) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          sharedSearchController.focus(true);
          return;
        }
        if (!canHandlePanelShortcuts(event, { requireNoteMode: mode === 'note' })) {
          return;
        }
        if (mode === 'note' && event.key === 'Escape') {
          setMode('browser');
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (mode === 'browser') {
          const handled = browserController?.handleKeyboardEvent(event) ?? false;
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      };

      const attachPanelShortcuts = (): void => {
        if (panelKeydownAttached) {
          return;
        }
        document.addEventListener('keydown', handlePanelKeydown, true);
        panelKeydownAttached = true;
      };

      const detachPanelShortcuts = (): void => {
        if (!panelKeydownAttached) {
          return;
        }
        document.removeEventListener('keydown', handlePanelKeydown, true);
        panelKeydownAttached = false;
      };

      const refreshInstances = async (options?: { silent?: boolean }): Promise<void> => {
        try {
          const raw = await callOperation<unknown>('instance_list', {});
          const list = Array.isArray(raw) ? raw.map(parseInstance).filter(Boolean) : [];
          const resolved =
            list.length > 0
              ? (list as Instance[])
              : [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          instances = resolved;
          const normalized = normalizeInstanceSelection(selectedInstanceIds);
          if (normalized.join('|') !== selectedInstanceIds.join('|')) {
            selectedInstanceIds = normalized;
            activeInstanceId = selectedInstanceIds[0] ?? DEFAULT_INSTANCE_ID;
            availableNotes = [];
            activeNoteTitle = null;
            activeNoteInstanceId = null;
            activeNote = null;
            updatePanelContext();
            updateDropdownSelection(null);
            refreshBrowser();
            setMode('browser');
            persistState();
          }
          updatePanelContext();
          renderInstanceSelect();
          updatePanelMetadata();
          applyPendingShowEvent();
        } catch (error) {
          if (!options?.silent) {
            services.setStatus('Failed to load instances');
          }
          console.error('Failed to refresh instances', error);
          instances = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          updatePanelContext();
          renderInstanceSelect();
          updatePanelMetadata();
        }
      };

      /**
       * Get the currently selected text within the note content element.
       * Returns null if the selection is not within the note content.
       */
      const getCurrentSelectionInNoteContent = (): string | null => {
        const contentEl = markdownViewer?.getContentElement();
        if (!contentEl || !contentEl.isConnected) {
          return null;
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return null;
        }
        const text = selection.toString().trim();
        if (text.length === 0) {
          return null;
        }
        // Check that the selection is within the note content
        const range = selection.getRangeAt(0);
        const commonAncestor = range.commonAncestorContainer;
        const ancestorEl =
          commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
        if (!ancestorEl || !contentEl.contains(ancestorEl)) {
          return null;
        }
        return text;
      };

      /**
       * Clear the stored text selection.
       */
      const clearStoredSelection = (): void => {
        if (selectedNoteText !== null) {
          selectedNoteText = null;
          updatePanelContext();
        }
      };

      /**
       * Capture the current text selection on mouseup within note content.
       * Only captures if Shift key is held (Shift+drag to select for context).
       */
      const handleNoteContentMouseUp = (event: MouseEvent): void => {
        if (isEditing || mode !== 'note') {
          return;
        }
        // Only capture selection for context when Shift is held
        if (!event.shiftKey) {
          return;
        }
        // Use a small delay to ensure the selection is finalized
        setTimeout(() => {
          const currentSelection = getCurrentSelectionInNoteContent();
          if (currentSelection) {
            selectedNoteText = currentSelection;
            updatePanelContext();
          }
        }, 0);
      };

      /**
       * Clear selection when clicking in note content without making a new selection.
       * Only clears if not holding Shift (to allow Shift+click to extend selection).
       */
      const handleNoteContentMouseDown = (event: MouseEvent): void => {
        if (isEditing || mode !== 'note') {
          return;
        }
        // Don't clear if Shift is held (user might be extending selection)
        if (event.shiftKey) {
          return;
        }
        // Clear stored selection on mousedown - if user makes a new selection,
        // it will be captured on mouseup (if Shift is held)
        clearStoredSelection();
      };

      /**
       * Handle external request to clear context selection (e.g., from chat input preview).
       */
      const handleClearContextSelectionEvent = (): void => {
        clearStoredSelection();
      };
      document.addEventListener(
        'assistant:clear-context-selection',
        handleClearContextSelectionEvent,
      );

      const getAllNoteTags = (): string[] => {
        const tags = new Set<string>();
        for (const note of availableNotes) {
          for (const tag of note.tags) {
            tags.add(tag.toLowerCase());
          }
        }
        return Array.from(tags).sort();
      };

      const updateAvailableNote = (note: NoteSummary): void => {
        const index = availableNotes.findIndex(
          (entry) => entry.title === note.title && entry.instanceId === note.instanceId,
        );
        if (index >= 0) {
          availableNotes[index] = note;
        } else {
          availableNotes.push(note);
        }
        availableNotes = sortNotes(availableNotes);
      };

      const removeAvailableNote = (title: string, instanceId: string): void => {
        availableNotes = availableNotes.filter(
          (entry) => !(entry.title === title && entry.instanceId === instanceId),
        );
      };

      const refreshBrowser = (): void => {
        dropdownController?.populate(getAvailableItems());
        dropdownController?.refreshFilter();
        browserController?.refresh();
        updateDropdownSelection(getActiveReference());
      };

      const applyNoteSearch = (query: string): void => {
        if (!markdownViewer || isEditing) {
          return;
        }
        markdownViewer.applySearch(query);
      };

      const renderNoteView = (note: Note, options?: { savedScrollTop?: number }): void => {
        const bodyEl = bodyManager.getBodyEl();
        if (!bodyEl) {
          return;
        }
        // Use provided scroll position or current position
        const savedScrollTop = options?.savedScrollTop ?? bodyEl.scrollTop;

        bodyEl.innerHTML = '';
        bodyEl.classList.remove('note-edit-mode');
        isEditing = false;
        // Clear previous markdown viewer
        markdownViewer?.destroy();
        markdownViewer = null;
        // Clear text selection when rendering a new note view
        selectedNoteText = null;

        const header = document.createElement('div');
        header.className = 'collection-note-header';

        const titleRow = document.createElement('div');
        titleRow.className = 'collection-note-title-row';

        const titleEl = document.createElement('div');
        titleEl.textContent = note.title;
        titleRow.appendChild(titleEl);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'collection-note-button-group';

        // Copy dropdown
        const copyWrapper = document.createElement('div');
        copyWrapper.className = 'collection-note-copy-wrapper';

        const copyMainButton = document.createElement('button');
        copyMainButton.type = 'button';
        copyMainButton.className = 'collection-note-copy-button collection-note-copy-main-button';
        copyMainButton.textContent = 'Copy';
        copyMainButton.setAttribute('aria-label', 'Copy note as plain text');

        const copyToggleButton = document.createElement('button');
        copyToggleButton.type = 'button';
        copyToggleButton.className =
          'collection-note-copy-button collection-note-copy-toggle-button';
        copyToggleButton.setAttribute('aria-label', 'Copy options');

        const copyMenu = document.createElement('div');
        copyMenu.className = 'collection-note-copy-menu';

        const copyMarkdownItem = document.createElement('button');
        copyMarkdownItem.type = 'button';
        copyMarkdownItem.className = 'collection-note-copy-menu-item';
        copyMarkdownItem.textContent = 'Copy Markdown';

        copyMenu.appendChild(copyMarkdownItem);
        copyWrapper.appendChild(copyMainButton);
        copyWrapper.appendChild(copyToggleButton);
        copyWrapper.appendChild(copyMenu);
        buttonGroup.appendChild(copyWrapper);

        let copyMenuOpen = false;
        const setCopyMenuOpen = (open: boolean): void => {
          if (copyMenuOpen === open) {
            return;
          }
          copyMenuOpen = open;
          copyMenu.classList.toggle('open', copyMenuOpen);

          const handleDocumentClick = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target && (copyWrapper.contains(target) || target === copyToggleButton)) {
              return;
            }
            setCopyMenuOpen(false);
            document.removeEventListener('click', handleDocumentClick);
            document.removeEventListener('keydown', handleCopyMenuKeyDown);
          };

          const handleCopyMenuKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setCopyMenuOpen(false);
              document.removeEventListener('click', handleDocumentClick);
              document.removeEventListener('keydown', handleCopyMenuKeyDown);
            }
          };

          if (copyMenuOpen) {
            document.addEventListener('click', handleDocumentClick);
            document.addEventListener('keydown', handleCopyMenuKeyDown);
          }
        };

        const showCopySuccess = (): void => {
          const originalText = copyMainButton.textContent ?? 'Copy';
          copyMainButton.textContent = 'Copied';
          copyMainButton.disabled = true;
          setTimeout(() => {
            copyMainButton.textContent = originalText;
            copyMainButton.disabled = false;
          }, 1500);
        };

        const copyPlainText = async (text: string): Promise<boolean> => {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch {
            return false;
          }
        };

        copyToggleButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setCopyMenuOpen(!copyMenuOpen);
        });

        copyMainButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setCopyMenuOpen(false);
          // Copy plain text (rendered text content)
          const contentEl = bodyEl.querySelector('.collection-note-content');
          const textToCopy = contentEl?.textContent || note.content;
          void copyPlainText(textToCopy).then((ok) => {
            if (ok) {
              showCopySuccess();
            }
          });
        });

        copyMarkdownItem.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setCopyMenuOpen(false);
          // Copy raw markdown source
          void copyPlainText(note.content).then((ok) => {
            if (ok) {
              showCopySuccess();
            }
          });
        });

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'collection-note-edit-button';
        editButton.setAttribute('aria-label', `Edit note ${note.title}`);
        editButton.innerHTML = ICONS.edit;
        editButton.addEventListener('click', (event) => {
          event.preventDefault();
          renderNoteEditor(note, false);
        });
        buttonGroup.appendChild(editButton);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'collection-list-actions-button notes-delete-button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async (event) => {
          event.preventDefault();
          if (!window.confirm(`Delete note "${note.title}"?`)) {
            return;
          }
          try {
            const targetInstanceId = activeNoteInstanceId ?? activeInstanceId;
            await callInstanceOperation(targetInstanceId, 'delete', { title: note.title });
            activeNote = null;
            activeNoteTitle = null;
            activeNoteInstanceId = null;
            updatePanelContext();
            updateDropdownSelection(null);
            setMode('browser');
            removeAvailableNote(note.title, targetInstanceId);
            refreshBrowser();
          } catch (err) {
            console.error('Failed to delete note', err);
            services.setStatus('Failed to delete note');
          }
        });
        buttonGroup.appendChild(deleteButton);

        const newButton = document.createElement('button');
        newButton.type = 'button';
        newButton.className = 'collection-list-actions-button';
        newButton.textContent = 'New';
        newButton.addEventListener('click', (event) => {
          event.preventDefault();
          openNewNoteEditor();
        });
        buttonGroup.appendChild(newButton);

        // Expand/Collapse level toggle - hidden by default, shown when note has sections
        // Cycles through: level 0 (all collapsed) → level 1 → level 2 → ... → all expanded → level 0
        // If user manually toggles sections, shows mixed icon and resets cycle on next click
        expandCollapseToggle = document.createElement('button');
        expandCollapseToggle.type = 'button';
        expandCollapseToggle.className = 'collection-note-collapse-toggle';
        expandCollapseToggle.setAttribute('aria-label', 'Cycle section expansion level');
        expandCollapseToggle.style.display = 'none';
        expandCollapseToggle.addEventListener('click', (event) => {
          event.preventDefault();
          if (!markdownViewer) {
            return;
          }
          markdownViewer.cycleExpandLevel();
          updateExpandCollapseToggleLabel();
        });
        buttonGroup.appendChild(expandCollapseToggle);

        titleRow.appendChild(buttonGroup);
        header.appendChild(titleRow);

        const tagsEl = renderNoteTags(note.tags);
        const descriptionText = note.description?.trim();
        if (descriptionText) {
          const descriptionEl = document.createElement('div');
          descriptionEl.className = 'collection-note-description';
          descriptionEl.textContent = descriptionText;
          header.appendChild(descriptionEl);
        }

        if (tagsEl) {
          header.appendChild(tagsEl);
        }

        if (note.created || note.updated) {
          const timestampsEl = document.createElement('div');
          timestampsEl.className = 'collection-timestamps';
          const parts: string[] = [];
          if (note.created) {
            const createdText = formatTimestamp(note.created);
            if (createdText) {
              parts.push(`Created: ${createdText}`);
            }
          }
          if (note.updated) {
            const updatedText = formatTimestamp(note.updated);
            if (updatedText) {
              parts.push(`Updated: ${updatedText}`);
            }
          }
          if (parts.length > 0) {
            timestampsEl.textContent = parts.join(' - ');
            header.appendChild(timestampsEl);
          }
        }

        bodyEl.appendChild(header);

        // Create container for markdown viewer
        const contentContainer = document.createElement('div');
        contentContainer.className = 'collection-note-content';
        bodyEl.appendChild(contentContainer);

        // Initialize markdown viewer controller
        markdownViewer = new MarkdownViewerController({
          container: contentContainer,
          contentClass: 'collection-note-content-inner',
          searchHitClass: NOTE_SEARCH_HIT_CLASS,
          searchActiveClass: NOTE_SEARCH_ACTIVE_CLASS,
          searchIgnoreSelectors: NOTE_SEARCH_IGNORE_SELECTORS,
        });

        // Render markdown with collapsible sections
        markdownViewer.render(note.content, handleManualSectionToggle);

        // Show/hide expand-collapse toggle based on whether sections exist
        if (expandCollapseToggle) {
          expandCollapseToggle.style.display = markdownViewer.hasSections()
            ? 'inline-flex'
            : 'none';
          updateExpandCollapseToggleLabel();
        }

        // Attach selection handlers to capture text selection
        const contentEl = markdownViewer.getContentElement();
        if (contentEl) {
          contentEl.addEventListener('mousedown', handleNoteContentMouseDown);
          contentEl.addEventListener('mouseup', handleNoteContentMouseUp);
        }

        // Restore scroll position after re-rendering (use rAF to ensure DOM is laid out)
        requestAnimationFrame(() => {
          bodyEl.scrollTop = savedScrollTop;
        });
      };

      const renderNoteEditor = (note: Note, isNew: boolean): void => {
        const bodyEl = bodyManager.getBodyEl();
        if (!bodyEl) {
          return;
        }
        bodyEl.innerHTML = '';
        bodyEl.classList.add('note-edit-mode');
        isEditing = true;
        // Clear markdown viewer when entering edit mode
        markdownViewer?.destroy();
        markdownViewer = null;

        const header = document.createElement('div');
        header.className = 'collection-note-header';

        const titleRow = document.createElement('div');
        titleRow.className = 'collection-note-title-row';

        const titleEl = document.createElement('div');
        titleEl.textContent = isNew ? 'New note' : note.title;
        titleRow.appendChild(titleEl);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'collection-note-button-group';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'collection-list-actions-button';
        cancelButton.textContent = 'Cancel';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'collection-list-actions-button';
        saveButton.textContent = 'Save';

        buttonGroup.appendChild(cancelButton);
        buttonGroup.appendChild(saveButton);

        titleRow.appendChild(buttonGroup);
        header.appendChild(titleRow);
        bodyEl.appendChild(header);

        const form = document.createElement('form');
        form.className = 'list-item-form';
        const instanceSelection = getInstanceSelectionOptions();
        let selectedInstanceId = isNew
          ? (instanceSelection?.preferredInstanceId ?? activeInstanceId)
          : (activeNoteInstanceId ?? activeInstanceId);

        const titleLabel = document.createElement('label');
        titleLabel.className = 'list-item-form-label';
        titleLabel.textContent = 'Title';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'list-item-form-input';
        titleInput.value = note.title;
        titleInput.required = true;
        if (!isNew) {
          titleInput.disabled = true;
          titleInput.title = 'Note title cannot be changed';
        }
        titleLabel.appendChild(titleInput);
        form.appendChild(titleLabel);

        if (instanceSelection?.options.length) {
          const optionIds = new Set(instanceSelection.options.map((option) => option.id));
          if (!selectedInstanceId || !optionIds.has(selectedInstanceId)) {
            selectedInstanceId =
              instanceSelection.preferredInstanceId ?? instanceSelection.options[0]?.id;
          }

          const instanceRow = document.createElement('label');
          instanceRow.className = 'list-item-form-label';
          instanceRow.textContent = 'Profile';

          const instanceSelect = document.createElement('select');
          instanceSelect.className = 'list-item-form-select';
          for (const option of instanceSelection.options) {
            const optionEl = document.createElement('option');
            optionEl.value = option.id;
            optionEl.textContent = option.label ?? getInstanceLabel(option.id);
            instanceSelect.appendChild(optionEl);
          }
          if (selectedInstanceId) {
            instanceSelect.value = selectedInstanceId;
          }
          instanceSelect.addEventListener('change', () => {
            selectedInstanceId = instanceSelect.value;
          });

          instanceRow.appendChild(instanceSelect);
          form.appendChild(instanceRow);
        }

        const descriptionLabel = document.createElement('label');
        descriptionLabel.className = 'list-item-form-label';
        descriptionLabel.textContent = 'Description';
        const descriptionInput = document.createElement('textarea');
        descriptionInput.className = 'list-item-form-textarea note-description-textarea';
        descriptionInput.value = note.description ?? '';
        descriptionLabel.appendChild(descriptionInput);
        form.appendChild(descriptionLabel);

        const tagsRow = document.createElement('div');
        tagsRow.className = 'list-item-form-label';

        const tagsLabel = document.createElement('label');
        tagsLabel.textContent = 'Tags';

        const initialTags = withoutPinnedTag(note.tags);
        const initialPinned = hasPinnedTag(note.tags);
        const initialFavorite = note.favorite === true;
        const tagInput = createTagChipsInput({
          availableTags: withoutPinnedTag(getAllNoteTags()),
          initialTags,
        });
        tagsLabel.htmlFor = tagInput.inputId;

        tagsRow.appendChild(tagsLabel);
        tagsRow.appendChild(tagInput.wrapper);
        form.appendChild(tagsRow);

        const pinnedRow = document.createElement('div');
        pinnedRow.className = 'list-item-form-checkbox-row';

        const pinnedCheckbox = document.createElement('input');
        pinnedCheckbox.type = 'checkbox';
        pinnedCheckbox.id = `note-pinned-${Math.random().toString(36).slice(2)}`;
        pinnedCheckbox.className = 'list-item-form-checkbox';
        pinnedCheckbox.checked = initialPinned;

        const pinnedLabel = document.createElement('label');
        pinnedLabel.htmlFor = pinnedCheckbox.id;
        pinnedLabel.textContent = 'Pinned';

        pinnedRow.appendChild(pinnedCheckbox);
        pinnedRow.appendChild(pinnedLabel);
        form.appendChild(pinnedRow);

        const favoriteRow = document.createElement('div');
        favoriteRow.className = 'list-item-form-checkbox-row';

        const favoriteCheckbox = document.createElement('input');
        favoriteCheckbox.type = 'checkbox';
        favoriteCheckbox.id = `note-favorite-${Math.random().toString(36).slice(2)}`;
        favoriteCheckbox.className = 'list-item-form-checkbox';
        favoriteCheckbox.checked = initialFavorite;

        const favoriteLabel = document.createElement('label');
        favoriteLabel.htmlFor = favoriteCheckbox.id;
        favoriteLabel.textContent = 'Favorite';

        favoriteRow.appendChild(favoriteCheckbox);
        favoriteRow.appendChild(favoriteLabel);
        form.appendChild(favoriteRow);

        const contentLabel = document.createElement('label');
        contentLabel.className = 'list-item-form-label';
        contentLabel.textContent = 'Content (Markdown)';

        const contentInput = document.createElement('textarea');
        contentInput.className = 'list-item-form-textarea note-content-textarea';
        contentInput.value = note.content;
        contentInput.required = true;

        contentLabel.appendChild(contentInput);
        form.appendChild(contentLabel);

        bodyEl.appendChild(form);

        let isSaving = false;

        const save = async (): Promise<void> => {
          if (isSaving) {
            return;
          }
          const title = titleInput.value.trim();
          const content = contentInput.value.trim();
          const description = descriptionInput.value.trim();
          if (!title) {
            services.setStatus('Title is required');
            titleInput.focus();
            return;
          }
          if (!content) {
            services.setStatus('Content is required');
            contentInput.focus();
            return;
          }

          isSaving = true;
          saveButton.disabled = true;
          cancelButton.disabled = true;
          try {
            const sourceInstanceId = activeNoteInstanceId ?? activeInstanceId;
            const targetInstanceId = selectedInstanceId ?? sourceInstanceId;
            if (!isNew && sourceInstanceId !== targetInstanceId) {
              await callInstanceOperation(sourceInstanceId, 'move', {
                title,
                target_instance_id: targetInstanceId,
              });
            }
            const nextTags = applyPinnedTag(tagInput.getTags(), pinnedCheckbox.checked);
            const result = await callInstanceOperation<unknown>(targetInstanceId, 'write', {
              title,
              content: contentInput.value,
              description,
              tags: nextTags,
              favorite: favoriteCheckbox.checked,
            });
            const metadata = parseNoteMetadata(result);
            const savedTags = metadata?.tags ?? nextTags;
            const savedDescription =
              metadata?.description ?? (description.length > 0 ? description : undefined);
            const savedFavorite = metadata?.favorite ?? (favoriteCheckbox.checked ? true : undefined);
            const updatedNote: Note = {
              title,
              content: contentInput.value,
              tags: savedTags,
              ...(savedFavorite ? { favorite: true } : {}),
              created: metadata?.created ?? note.created,
              updated: metadata?.updated ?? note.updated,
              ...(savedDescription ? { description: savedDescription } : {}),
            };
            activeNote = updatedNote;
            activeNoteTitle = title;
            activeNoteInstanceId = targetInstanceId;
            updatePanelContext();
            updateDropdownSelection({ type: 'note', id: title, instanceId: targetInstanceId });
            if (metadata) {
              updateAvailableNote({
                ...metadata,
                instanceId: targetInstanceId,
                instanceLabel: getInstanceLabel(targetInstanceId),
              });
              refreshBrowser();
            }
            browserController?.invalidatePreview({
              type: 'note',
              id: title,
              instanceId: targetInstanceId,
            });
            renderNoteView(updatedNote);
            setMode('note');
          } catch (err) {
            console.error('Failed to save note', err);
            services.setStatus('Failed to save note');
          } finally {
            isSaving = false;
            saveButton.disabled = false;
            cancelButton.disabled = false;
          }
        };

        cancelButton.addEventListener('click', (event) => {
          event.preventDefault();
          if (isNew) {
            activeNote = null;
            activeNoteTitle = null;
            updatePanelContext();
            updateDropdownSelection(null);
            setMode('browser');
            return;
          }
          renderNoteView(note);
          setMode('note');
        });

        saveButton.addEventListener('click', (event) => {
          event.preventDefault();
          void save();
        });

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          void save();
        });

        contentInput.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!isSaving) {
              cancelButton.click();
            }
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        });

        // Shift+Enter to save from any field (including tags input)
        form.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            void save();
          }
        });

        if (isNew) {
          titleInput.focus();
        } else {
          contentInput.focus();
        }
      };

      const openNewNoteEditor = (instanceId?: string): void => {
        const resolvedInstanceId =
          instanceId ?? getInstanceSelectionOptions()?.preferredInstanceId ?? activeInstanceId;
        const draft: Note = {
          title: '',
          content: '',
          tags: [],
          favorite: false,
          created: '',
          updated: '',
        };
        activeNote = null;
        activeNoteTitle = null;
        activeNoteInstanceId = resolvedInstanceId;
        updatePanelContext();
        updateDropdownSelection(null);
        renderNoteEditor(draft, true);
        setMode('note');
      };

      const openExistingNoteEditor = async (
        title: string,
        instanceId: string,
      ): Promise<void> => {
        if (!title || !instanceId) {
          return;
        }
        if (activeNoteTitle !== title || activeNoteInstanceId !== instanceId || !activeNote) {
          await loadNote(title, instanceId, { silent: true, editAfterLoad: true });
          return;
        }
        renderNoteEditor(activeNote, false);
        setMode('note');
      };

      browserController = new CollectionBrowserController({
        containerEl: panelContent,
        getAvailableItems,
        getSupportedTypes: () => ['note'],
        getAllTags: getAllNoteTags,
        getGroupLabel: () => '',
        getActiveItemReference: getActiveReference,
        selectItem: (item) => {
          if (!item) {
            setMode('browser');
            return;
          }
          const instanceId = item.instanceId ?? activeInstanceId;
          void selectNote(item.id, instanceId, { focus: false });
        },
        refreshItems: async () => {
          await refreshNotes({ silent: true });
        },
        dialogManager: services.dialogManager,
        icons: {
          plus: ICONS.plus,
          edit: ICONS.edit,
          chevronDown: ICONS.chevronDown,
          clock: ICONS.clock,
          sortAlpha: ICONS.sortAlpha,
          fileText: ICONS.fileText,
          list: ICONS.list,
          pin: ICONS.pin,
          favorite: ICONS.heart,
        },
        onTogglePinned: (item, isPinned) => {
          if (item.type !== 'note') {
            return;
          }
          const targetInstanceId = item.instanceId ?? activeInstanceId;
          const operation = isPinned ? 'tags-remove' : 'tags-add';
          void (async () => {
            try {
              await callInstanceOperation(targetInstanceId, operation, {
                title: item.id,
                tags: [PINNED_TAG],
              });
            } catch (err) {
              console.error('Failed to toggle pinned note', err);
              services.setStatus('Failed to update pinned note');
            }
          })();
        },
        fetchPreview: async (itemType, itemId, instanceId) => {
          if (itemType !== 'note') {
            return null;
          }
          const targetInstanceId = instanceId ?? activeInstanceId;
          try {
            const raw = await callInstanceOperation<unknown>(targetInstanceId, 'read', {
              title: itemId,
            });
            const note = parseNote(raw);
            if (!note) {
              return null;
            }
            return { kind: 'note', content: note.content } satisfies CollectionPreviewCacheEntry;
          } catch (err) {
            console.error('Failed to load note preview', err);
            return null;
          }
        },
        viewModeStorageKey: 'aiAssistantNotesBrowserViewMode',
        sortModeStorageKey: 'aiAssistantNotesBrowserSortMode',
        openNoteEditor: (mode, noteId, instanceId) => {
          if (mode === 'create') {
            openNewNoteEditor(instanceId);
            return;
          }
          const targetInstanceId = instanceId ?? activeInstanceId;
          if (noteId) {
            void openExistingNoteEditor(noteId, targetInstanceId);
          }
        },
        shouldShowInstanceBadge: () => selectedInstanceIds.length > 1,
        onSortModeChanged: () => {
          dropdownController?.populate(getAvailableItems());
          dropdownController?.refreshFilter();
        },
      });

      dropdownController = new CollectionDropdownController({
        container: dropdownContainer,
        dropdown,
        trigger: dropdownTrigger,
        triggerText: dropdownTriggerText,
        searchInput: dropdownSearch,
        list: dropdownList,
        tagsContainer: dropdownTags,
        activeTagsContainer: dropdownActiveTags,
        focusInput: services.focusInput,
        isDialogOpen: () => services.dialogManager.hasOpenDialog,
        isPanelOpen: () => isVisible,
        isMobileViewport: services.isMobileViewport,
        setPanelOpen: (open) => {
          if (open) {
            host.openPanel('notes', { focus: true });
          } else {
            host.closePanel(host.panelId());
          }
        },
        getAllTags: getAllNoteTags,
        getGroupLabel: () => '',
        getSupportedTypes: () => ['note'],
        getSortMode: () => browserController?.getSortMode() ?? 'alpha',
        getActiveItemReference: getActiveReference,
        updateSelection: updateDropdownSelection,
        selectItem: (item) => {
          if (!item) {
            return;
          }
          const instanceId = item.instanceId ?? activeInstanceId;
          void selectNote(item.id, instanceId, { focus: false });
        },
      });
      dropdownController?.attach();

      function applySearch(query: string): void {
        browserController?.applySearchQuery(query);
        if (mode === 'note') {
          applyNoteSearch(query);
        }
      }

      const handleNoteSearchKeydown = (event: KeyboardEvent): boolean => {
        if (event.key !== 'Enter') {
          return false;
        }
        const tagController = sharedSearchController.getTagController();
        if (tagController?.isSuggestionsMode) {
          return false;
        }
        const searchState = markdownViewer?.getSearchState();
        if (!searchState || searchState.matches.length === 0) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        markdownViewer?.nextSearchMatch();
        return true;
      };

      function setMode(nextMode: ViewMode): void {
        if (nextMode === 'note' && !activeNoteTitle && !isEditing) {
          nextMode = 'browser';
        }
        const modeChanged = mode !== nextMode;
        if (nextMode === 'browser') {
          isEditing = false;
          // Clear text selection when leaving note view
          if (selectedNoteText !== null) {
            selectedNoteText = null;
          }
        }
        mode = nextMode;

        browserButton?.classList.toggle('active', mode === 'browser');
        noteButton?.classList.toggle('active', mode === 'note');
        browserButton?.setAttribute('aria-selected', mode === 'browser' ? 'true' : 'false');
        noteButton?.setAttribute('aria-selected', mode === 'note' ? 'true' : 'false');
        if (noteButton) {
          noteButton.disabled = !activeNoteTitle && !isEditing;
        }
        if (backButton) {
          backButton.style.display = mode === 'browser' ? 'none' : '';
        }
        chromeController?.scheduleLayoutCheck();

        if (mode === 'browser') {
          browserController?.show(false);
          browserController?.setSharedSearchElements({
            searchInput: sharedSearchController.getSearchInputEl(),
            tagController: sharedSearchController.getTagController(),
            tagsContainer: sharedSearchController.getTagsContainerEl(),
            activeTagsContainer: null,
          });
          sharedSearchController.setPlaceholder('Search notes...');
          sharedSearchController.setTagsProvider(() => browserController?.getAllKnownTags() ?? []);
          sharedSearchController.setKeydownHandler((event) =>
            browserController ? browserController.handleSharedSearchKeyDown(event) : false,
          );
          const controls = browserController
            ? browserController.getSharedSearchRightControls()
            : [];
          sharedSearchController.setRightControls(controls.length > 0 ? controls : null);
        } else {
          sharedSearchController.setPlaceholder('Search this note...');
          sharedSearchController.setTagsProvider(getAllNoteTags);
          sharedSearchController.setKeydownHandler(handleNoteSearchKeydown);
          sharedSearchController.setRightControls(null);
          browserController?.hide();
        }

        sharedSearchController.setVisible(true);
        applySearch(sharedSearchController.getQuery());
        if (mode === 'browser') {
          browserController?.focusActiveItem();
        }
        if (modeChanged) {
          persistState();
        }
      }

      async function refreshNotes(options?: { silent?: boolean }): Promise<void> {
        if (refreshInFlight) {
          return;
        }
        refreshInFlight = true;
        const currentToken = ++refreshToken;
        try {
          const results = await Promise.all(
            selectedInstanceIds.map(async (instanceId) => {
              const raw = await callInstanceOperation<unknown>(instanceId, 'list', {});
              const notes = parseNoteMetadataList(raw, instanceId).map((note) => ({
                ...note,
                instanceLabel: getInstanceLabel(instanceId),
              }));
              return notes;
            }),
          );
          if (currentToken !== refreshToken) {
            return;
          }
          availableNotes = sortNotes(results.flat());
          refreshBrowser();

          if (activeNoteTitle && activeNoteInstanceId) {
            const updated = availableNotes.find(
              (entry) =>
                entry.title === activeNoteTitle && entry.instanceId === activeNoteInstanceId,
            );
            if (updated && activeNote) {
              activeNote = { ...activeNote, ...updated };
              updatePanelContext();
            }
            if (!updated) {
              activeNoteTitle = null;
              activeNoteInstanceId = null;
              activeNote = null;
              updatePanelContext();
              setMode('browser');
            }
          }
        } catch (err) {
          if (!options?.silent) {
            services.setStatus('Failed to load notes');
          }
          console.error('Failed to load notes', err);
        } finally {
          refreshInFlight = false;
        }
      }

      async function loadNote(
        title: string,
        instanceId: string,
        options?: { silent?: boolean; editAfterLoad?: boolean },
      ): Promise<void> {
        const currentToken = ++loadToken;
        // Save scroll position before any DOM changes
        const bodyEl = bodyManager.getBodyEl();
        const savedScrollTop = bodyEl?.scrollTop ?? 0;

        // Only show loading indicator for non-silent loads
        if (!options?.silent) {
          bodyManager.renderLoading({ type: 'note', id: title });
        }
        try {
          const raw = await callInstanceOperation<unknown>(instanceId, 'read', { title });
          if (currentToken !== loadToken) {
            return;
          }
          const note = parseNote(raw);
          if (!note) {
            throw new Error('Note not found');
          }
          activeNoteTitle = note.title;
          activeNoteInstanceId = instanceId;
          activeNote = note;
          updateDropdownSelection({ type: 'note', id: note.title, instanceId });
          updatePanelContext();
          if (options?.editAfterLoad) {
            renderNoteEditor(note, false);
          } else {
            // Pass saved scroll position for silent reloads (e.g., websocket updates)
            renderNoteView(note, options?.silent ? { savedScrollTop } : undefined);
          }
          setMode('note');
        } catch (err) {
          if (!options?.silent) {
            services.setStatus('Failed to load note');
          }
          console.error('Failed to load note', err);
          bodyManager.renderError('Failed to load note.');
        }
      }

      async function selectNote(
        title: string,
        instanceId: string,
        options?: { focus?: boolean },
      ): Promise<void> {
        if (!title) {
          return;
        }
        if (activeNoteTitle === title && activeNoteInstanceId === instanceId && activeNote && !isEditing) {
          updateDropdownSelection({ type: 'note', id: title, instanceId });
          renderNoteView(activeNote);
          setMode('note');
          if (options?.focus) {
            sharedSearchController.focus(false);
          }
          return;
        }
        await loadNote(title, instanceId);
        if (options?.focus) {
          sharedSearchController.focus(false);
        }
      }

      async function handlePanelUpdate(payload: Record<string, unknown>): Promise<void> {
        const action = typeof payload['action'] === 'string' ? payload['action'] : '';
        const title = typeof payload['title'] === 'string' ? payload['title'].trim() : '';
        if (!action) {
          return;
        }
        const instanceId = resolveEventInstanceId(payload);
        if (!selectedInstanceIds.includes(instanceId)) {
          return;
        }

        const noteSummary = parseNoteMetadata(payload['note']);
        if (noteSummary) {
          updateAvailableNote({
            ...noteSummary,
            instanceId,
            instanceLabel: getInstanceLabel(instanceId),
          });
        }
        if (action === 'note_deleted' && title) {
          removeAvailableNote(title, instanceId);
        }
        refreshBrowser();

        if (title && action !== 'note_deleted') {
          browserController?.invalidatePreview({ type: 'note', id: title, instanceId });
        }

        if (!title || activeNoteTitle !== title || activeNoteInstanceId !== instanceId) {
          return;
        }

        if (action === 'note_deleted') {
          activeNoteTitle = null;
          activeNoteInstanceId = null;
          activeNote = null;
          updatePanelContext();
          setMode('browser');
          return;
        }

        if (!isEditing) {
          await loadNote(title, instanceId, { silent: true });
        }
      }

      const resolveEventInstanceId = (payload: Record<string, unknown>): string => {
        const rawInstance = payload['instance_id'];
        return typeof rawInstance === 'string' && rawInstance.length > 0
          ? rawInstance
          : DEFAULT_INSTANCE_ID;
      };

      const handleShowEvent = (title: string, instanceId: string): void => {
        if (!isKnownInstance(instanceId)) {
          pendingShowEvent = { title, instanceId };
          void refreshInstances({ silent: true });
          return;
        }
        if (!selectedInstanceIds.includes(instanceId)) {
          setActiveInstances([instanceId, ...selectedInstanceIds]);
        }
        void selectNote(title, instanceId, { focus: false });
      };

      if (browserButton) {
        browserButton.addEventListener('click', () => {
          setMode('browser');
        });
      }
      if (noteButton) {
        noteButton.addEventListener('click', () => {
          if (activeNoteTitle && activeNoteInstanceId) {
            void selectNote(activeNoteTitle, activeNoteInstanceId, { focus: false });
            return;
          }
          if (isEditing) {
            setMode('note');
            return;
          }
          setMode('browser');
        });
      }
      if (backButton) {
        backButton.addEventListener('click', () => {
          setMode('browser');
        });
      }
      chromeController = new PanelChromeController({
        root,
        host,
        title: 'Notes',
        instanceSelectionMode: 'multi',
        onInstanceChange: (instanceIds) => {
          setActiveInstances(instanceIds);
        },
      });
      chromeController.setInstances(instances, selectedInstanceIds);

      sharedSearchController.setOnQueryChanged(applySearch);
      sharedSearchController.setVisible(true);
      attachPanelShortcuts();

      const stored = host.loadPanelState();
      let initialTitle: string | null = null;
      let initialMode: ViewMode | null = null;
      let initialInstanceIds: string[] | null = null;
      let initialNoteInstanceId: string | null = null;
      if (stored && typeof stored === 'object') {
        const data = stored as Record<string, unknown>;
        if (typeof data['selectedNoteTitle'] === 'string') {
          initialTitle = data['selectedNoteTitle'];
        }
        if (typeof data['selectedNoteInstanceId'] === 'string') {
          initialNoteInstanceId = data['selectedNoteInstanceId'];
        }
        if (data['mode'] === 'browser' || data['mode'] === 'note') {
          initialMode = data['mode'] as ViewMode;
        }
        if (Array.isArray(data['instanceIds'])) {
          selectedInstanceIds = data['instanceIds'].filter(
            (id): id is string => typeof id === 'string',
          );
          initialInstanceIds = [...selectedInstanceIds];
        } else if (typeof data['instanceId'] === 'string') {
          selectedInstanceIds = [data['instanceId']];
          initialInstanceIds = [...selectedInstanceIds];
        }
        if (selectedInstanceIds.length === 0) {
          selectedInstanceIds = [DEFAULT_INSTANCE_ID];
        }
        activeInstanceId = selectedInstanceIds[0] ?? DEFAULT_INSTANCE_ID;
      }

      void refreshInstances({ silent: true }).then(() => {
        if (
          initialInstanceIds &&
          initialInstanceIds.join('|') !== selectedInstanceIds.join('|')
        ) {
          initialTitle = null;
          initialNoteInstanceId = null;
        }
        void refreshNotes().then(() => {
          if (initialTitle) {
            const resolvedInstanceId =
              initialNoteInstanceId ??
              availableNotes.find((entry) => entry.title === initialTitle)?.instanceId ??
              activeInstanceId;
            void selectNote(initialTitle, resolvedInstanceId).then(() => {
              if (initialMode) {
                setMode(initialMode);
              }
            });
            return;
          }
          setMode('browser');
        });
      });

      return {
        onVisibilityChange: (visible) => {
          isVisible = visible;
          if (visible) {
            void refreshNotes({ silent: true });
            chromeController?.scheduleLayoutCheck();
          }
        },
        onFocus: () => {
          void refreshNotes({ silent: true });
        },
        onEvent: (event: PanelEventEnvelope) => {
          const payload = event.payload as Record<string, unknown> | null;
          if (!payload) {
            return;
          }
          const type = payload['type'];
          if (type === 'notes_show') {
            const eventInstanceId = resolveEventInstanceId(payload);
            const title = typeof payload['title'] === 'string' ? payload['title'].trim() : '';
            if (!title) {
              return;
            }
            handleShowEvent(title, eventInstanceId);
            return;
          }
          if (type === 'panel_update') {
            void handlePanelUpdate(payload);
          }
        },
        onSessionChange: () => {
          void refreshNotes({ silent: true });
        },
        unmount() {
          document.removeEventListener(
            'assistant:clear-context-selection',
            handleClearContextSelectionEvent,
          );
          detachPanelShortcuts();
          unsubscribePanelActive?.();
          chromeController?.destroy();
          host.setContext(contextKey, null);
          container.innerHTML = '';
        },
      };
    },
  }));
}
