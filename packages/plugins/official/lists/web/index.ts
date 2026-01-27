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
import {
  ListPanelController,
  type ListPanelData,
  type ListPanelItem,
} from '../../../../web-client/src/controllers/listPanelController';
import type { ListCustomFieldDefinition } from '../../../../web-client/src/controllers/listCustomFields';
import type { ListMetadataDialogPayload } from '../../../../web-client/src/controllers/listMetadataDialog';
import { ContextMenuManager } from '../../../../web-client/src/controllers/contextMenu';
import { DialogManager } from '../../../../web-client/src/controllers/dialogManager';
import {
  ListColumnPreferencesClient,
  type ListColumnPreferences,
  type ListViewPreferences,
} from '../../../../web-client/src/utils/listColumnPreferences';
import { isCapacitorAndroid } from '../../../../web-client/src/utils/capacitor';
import { ICONS } from '../../../../web-client/src/utils/icons';
import { applyTagColorToElement, normalizeTag } from '../../../../web-client/src/utils/tagColors';
import { PINNED_TAG, isPinnedTag } from '../../../../web-client/src/utils/pinnedTag';
import { buildAqlString, parseAql, type AqlQuery } from '../../../../web-client/src/utils/listItemQuery';
import type { KeyboardShortcut } from '../../../../web-client/src/utils/keyboardShortcuts';
import {
  CORE_PANEL_SERVICES_CONTEXT_KEY,
  type PanelCoreServices,
} from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';
import type { ListItemReference } from '../../../../web-client/src/utils/listCustomFieldReference';

const LISTS_PANEL_TEMPLATE = `
  <aside class="lists-panel collection-panel" aria-label="Lists panel">
    <div class="panel-header panel-chrome-row" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Lists</span>
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
              <span class="panel-chrome-instance-trigger-text" data-role="instance-trigger-text"
                >Default</span
              >
              <svg
                class="panel-chrome-instance-trigger-icon"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                aria-hidden="true"
              >
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
          data-role="lists-mode-toggle"
          role="tablist"
          aria-label="Lists panel display mode"
        >
          <button
            type="button"
            class="collection-panel-mode-button"
            data-role="lists-mode-browser"
            role="tab"
            aria-selected="true"
          >
            Browser
          </button>
          <button
            type="button"
            class="collection-panel-mode-button"
            data-role="lists-mode-list"
            role="tab"
            aria-selected="false"
          >
            List
          </button>
        </div>
        <div class="collection-search-dropdown-container" data-role="lists-dropdown-container">
          <button
            type="button"
            class="collection-search-dropdown-trigger"
            data-role="lists-dropdown-trigger"
            aria-label="Select a list"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span
              class="collection-search-dropdown-trigger-text"
              data-role="lists-dropdown-trigger-text"
              >Select a list&hellip;</span
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
            data-role="lists-dropdown"
            role="listbox"
            aria-label="Lists"
          >
            <input
              type="text"
              class="collection-search-dropdown-search"
              data-role="lists-dropdown-search"
              placeholder="Search lists..."
              aria-label="Search lists"
              autocomplete="off"
            />
            <div class="collection-search-dropdown-active-tags" data-role="lists-dropdown-active">
              <!-- Active tag filters shown here -->
            </div>
            <div class="collection-search-dropdown-tags" data-role="lists-dropdown-tags">
              <!-- Tag suggestions shown here -->
            </div>
            <div class="collection-search-dropdown-list" data-role="lists-dropdown-list">
              <!-- Lists populated dynamically -->
            </div>
          </div>
        </div>
        <button
          type="button"
          class="panel-close-button collection-back-button"
          data-role="lists-back"
          aria-label="Back to list browser"
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
    <div class="collection-panel-shared-search" data-role="lists-shared-search"></div>
    <div class="panel-body collection-panel-body" data-role="lists-panel-body">
      <div class="collection-panel-content" data-role="lists-panel-content"></div>
    </div>
    <button
      type="button"
      class="lists-fab-add"
      data-role="lists-fab-add"
      aria-label="Add item"
      title="Add item"
    ></button>
    <button
      type="button"
      class="lists-fab-search"
      data-role="lists-fab-search"
      aria-label="Search items"
      title="Search items"
    ></button>
  </aside>
`;

const USER_UPDATE_TIMEOUT_MS = 5000;
const DEFAULT_INSTANCE_ID = 'default';

type ViewMode = 'browser' | 'list';

type Instance = {
  id: string;
  label: string;
};

type ListSummary = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  favorite?: boolean;
  defaultTags?: string[];
  customFields?: ListCustomFieldDefinition[];
  savedQueries?: SavedAqlQuery[];
  updatedAt?: string;
  instanceId: string;
  instanceLabel?: string;
};

type NoteSummary = {
  title: string;
  tags: string[];
  favorite?: boolean;
  created?: string;
  updated?: string;
  description?: string;
  instanceId: string;
  instanceLabel?: string;
};

type SavedAqlQuery = {
  id: string;
  name: string;
  query: string;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type OperationResponse<T> = { ok: true; result: T } | { error: string };

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

function parseCustomFields(value: unknown): ListCustomFieldDefinition[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: ListCustomFieldDefinition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const key = typeof obj['key'] === 'string' ? obj['key'].trim() : '';
    const label = typeof obj['label'] === 'string' ? obj['label'].trim() : '';
    const type = obj['type'];
    if (!key || !label || typeof type !== 'string') {
      continue;
    }
    let options: string[] | undefined;
    if (type === 'select') {
      options = parseStringArray(obj['options']);
      if (options.length === 0) {
        options = undefined;
      }
    }
    const markdown = type === 'text' && obj['markdown'] === true;
    result.push({
      key,
      label,
      type: type as ListCustomFieldDefinition['type'],
      options,
      ...(markdown ? { markdown: true } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseNoteMetadata(value: unknown): Omit<NoteSummary, 'instanceId' | 'instanceLabel'> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const title = typeof obj['title'] === 'string' ? obj['title'].trim() : '';
  if (!title) {
    return null;
  }
  const tags = parseStringArray(obj['tags']);
  const created = typeof obj['created'] === 'string' ? obj['created'] : undefined;
  const updated = typeof obj['updated'] === 'string' ? obj['updated'] : undefined;
  const description = typeof obj['description'] === 'string' ? obj['description'] : undefined;
  const favorite = obj['favorite'] === true;
  return {
    title,
    tags,
    ...(favorite ? { favorite: true } : {}),
    ...(created ? { created } : {}),
    ...(updated ? { updated } : {}),
    ...(description ? { description } : {}),
  };
}

function parseNoteMetadataList(
  value: unknown,
  instanceId: string,
  instanceLabel?: string,
): NoteSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: NoteSummary[] = [];
  for (const entry of value) {
    const parsed = parseNoteMetadata(entry);
    if (parsed) {
      result.push({
        ...parsed,
        instanceId,
        ...(instanceLabel ? { instanceLabel } : {}),
      });
    }
  }
  return result;
}

function parseSavedQueries(value: unknown): SavedAqlQuery[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: SavedAqlQuery[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const id = typeof obj['id'] === 'string' ? obj['id'].trim() : '';
    const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
    const query = typeof obj['query'] === 'string' ? obj['query'].trim() : '';
    if (!id || !name || !query) {
      continue;
    }
    const createdAt = typeof obj['createdAt'] === 'string' ? obj['createdAt'] : undefined;
    const updatedAt = typeof obj['updatedAt'] === 'string' ? obj['updatedAt'] : undefined;
    const isDefault = obj['isDefault'] === true;
    result.push({
      id,
      name,
      query,
      ...(isDefault ? { isDefault: true } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return result.length > 0 ? result : undefined;
}

function parseListSummary(value: unknown, instanceId: string): ListSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = typeof obj['id'] === 'string' ? obj['id'].trim() : '';
  const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
  if (!id || !name) {
    return null;
  }
  const description = typeof obj['description'] === 'string' ? obj['description'] : undefined;
  const tags = parseStringArray(obj['tags']);
  const defaultTags = parseStringArray(obj['defaultTags']);
  const customFields = parseCustomFields(obj['customFields']);
  const savedQueries = parseSavedQueries(obj['savedQueries']);
  const updatedAt = typeof obj['updatedAt'] === 'string' ? obj['updatedAt'] : undefined;
  const favorite = obj['favorite'] === true;

  return {
    id,
    name,
    description,
    tags: tags.length > 0 ? tags : undefined,
    ...(favorite ? { favorite: true } : {}),
    defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
    customFields,
    savedQueries,
    updatedAt,
    instanceId,
  };
}

function parseListSummaries(value: unknown, instanceId: string): ListSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ListSummary[] = [];
  for (const entry of value) {
    const parsed = parseListSummary(entry, instanceId);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function parseListItem(value: unknown): ListPanelItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['title'] !== 'string') {
    return null;
  }
  return obj as ListPanelItem;
}

function parseListItems(value: unknown): ListPanelItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ListPanelItem[] = [];
  for (const entry of value) {
    const parsed = parseListItem(entry);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function renderListTags(tags: string[] | undefined): HTMLElement | null {
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

function buildListPreviewItems(items: ListPanelItem[]): Array<{
  title: string;
  notes?: string;
  url?: string;
  tags: string[];
  completed: boolean;
  position: number;
}> {
  return items
    .map((item) => {
      const title = typeof item.title === 'string' ? item.title : '';
      if (!title.trim()) {
        return null;
      }
      const tags = Array.isArray(item.tags)
        ? item.tags
            .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
            .map((tag) => tag.toLowerCase().trim())
        : [];
      const completed = typeof item.completed === 'boolean' ? item.completed : false;
      const position = typeof item.position === 'number' ? item.position : 0;
      const preview: {
        title: string;
        notes?: string;
        url?: string;
        tags: string[];
        completed: boolean;
        position: number;
      } = {
        title,
        tags,
        completed,
        position,
      };
      if (typeof item.notes === 'string' && item.notes.trim()) {
        preview.notes = item.notes;
      }
      if (typeof item.url === 'string' && item.url.trim()) {
        preview.url = item.url;
      }
      return preview;
    })
    .filter(
      (
        entry,
      ): entry is {
        title: string;
        notes?: string;
        url?: string;
        tags: string[];
        completed: boolean;
        position: number;
      } => !!entry,
    );
}

async function fetchListPreview(
  listId: string,
  callInstanceOperation: <T>(operation: string, body: Record<string, unknown>) => Promise<T>,
): Promise<CollectionPreviewCacheEntry | null> {
  const rawItems = await callInstanceOperation<unknown>('items-list', {
    listId,
    limit: 50,
    sort: 'position',
  });
  const items = buildListPreviewItems(parseListItems(rawItems));
  if (items.length === 0) {
    return null;
  }
  return { kind: 'list', items };
}

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/lists/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore json parsing failures
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

async function callNotesOperation<T>(
  operation: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await apiFetch(`/api/plugins/notes/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore json parsing failures
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
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for lists plugin.');
} else {
  registry.registerPanel('lists', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = LISTS_PANEL_TEMPLATE.trim();

      const root = container.firstElementChild as HTMLElement | null;
      if (!root) {
        throw new Error('Failed to render lists panel');
      }

      const browserButton = root.querySelector<HTMLButtonElement>(
        '[data-role="lists-mode-browser"]',
      );
      const listButton = root.querySelector<HTMLButtonElement>('[data-role="lists-mode-list"]');
      const backButton = root.querySelector<HTMLButtonElement>('[data-role="lists-back"]');
      const dropdownContainer = root.querySelector<HTMLElement>(
        '[data-role="lists-dropdown-container"]',
      );
      const dropdownTrigger = root.querySelector<HTMLButtonElement>(
        '[data-role="lists-dropdown-trigger"]',
      );
      const dropdownTriggerText = root.querySelector<HTMLElement>(
        '[data-role="lists-dropdown-trigger-text"]',
      );
      const dropdown = root.querySelector<HTMLElement>('[data-role="lists-dropdown"]');
      const dropdownSearch = root.querySelector<HTMLInputElement>(
        '[data-role="lists-dropdown-search"]',
      );
      const dropdownTags = root.querySelector<HTMLElement>('[data-role="lists-dropdown-tags"]');
      const dropdownActiveTags = root.querySelector<HTMLElement>(
        '[data-role="lists-dropdown-active"]',
      );
      const dropdownList = root.querySelector<HTMLElement>('[data-role="lists-dropdown-list"]');
      const sharedSearchEl = root.querySelector<HTMLElement>('[data-role="lists-shared-search"]');
      const panelContent = root.querySelector<HTMLElement>('[data-role="lists-panel-content"]');
      const fabAddButton = root.querySelector<HTMLButtonElement>('[data-role="lists-fab-add"]');
      const fabSearchButton = root.querySelector<HTMLButtonElement>(
        '[data-role="lists-fab-search"]',
      );

      const services = resolveServices(host);
      const isCapacitor = isCapacitorAndroid();

      const sharedSearchController = new CollectionPanelSearchController({
        containerEl: sharedSearchEl,
        icons: { x: ICONS.x },
      });

      const aqlToggleButton = document.createElement('button');
      aqlToggleButton.type = 'button';
      aqlToggleButton.className = 'list-search-mode-toggle';
      aqlToggleButton.textContent = 'AQL';
      aqlToggleButton.setAttribute('aria-label', 'Toggle AQL mode');
      aqlToggleButton.setAttribute('aria-pressed', 'false');

      const aqlApplyButton = document.createElement('button');
      aqlApplyButton.type = 'button';
      aqlApplyButton.className = 'list-search-apply';
      aqlApplyButton.innerHTML = ICONS.check;
      aqlApplyButton.setAttribute('aria-label', 'Apply AQL query');
      aqlApplyButton.setAttribute('title', 'Apply');
      aqlApplyButton.disabled = true;

      const aqlSavedSelect = document.createElement('select');
      aqlSavedSelect.className = 'list-search-aql-select';
      aqlSavedSelect.setAttribute('aria-label', 'Saved AQL queries');

      const aqlSaveButton = document.createElement('button');
      aqlSaveButton.type = 'button';
      aqlSaveButton.className = 'list-search-aql-save';
      aqlSaveButton.innerHTML = ICONS.save;
      aqlSaveButton.setAttribute('aria-label', 'Save AQL query');
      aqlSaveButton.setAttribute('title', 'Save');

      const aqlDeleteButton = document.createElement('button');
      aqlDeleteButton.type = 'button';
      aqlDeleteButton.className = 'list-search-aql-delete';
      aqlDeleteButton.innerHTML = ICONS.trash;
      aqlDeleteButton.setAttribute('aria-label', 'Delete saved AQL query');
      aqlDeleteButton.setAttribute('title', 'Delete');

      const aqlDefaultButton = document.createElement('button');
      aqlDefaultButton.type = 'button';
      aqlDefaultButton.className = 'list-search-aql-default';
      aqlDefaultButton.innerHTML = ICONS.star;
      aqlDefaultButton.setAttribute('aria-label', 'Set default AQL query');
      aqlDefaultButton.setAttribute('title', 'Set default');

      const aqlActionGroup = document.createElement('div');
      aqlActionGroup.className = 'list-search-aql-actions';
      aqlActionGroup.appendChild(aqlSaveButton);
      aqlActionGroup.appendChild(aqlDeleteButton);
      aqlActionGroup.appendChild(aqlApplyButton);
      aqlActionGroup.appendChild(aqlDefaultButton);

      const aqlControls = document.createElement('div');
      aqlControls.className = 'list-search-aql-controls';
      aqlControls.appendChild(aqlToggleButton);
      aqlControls.appendChild(aqlSavedSelect);
      aqlControls.appendChild(aqlActionGroup);

      if (fabAddButton) {
        fabAddButton.innerHTML = ICONS.plus;
      }
      if (fabSearchButton) {
        fabSearchButton.innerHTML = ICONS.search;
      }

      const bodyManager = new CollectionPanelBodyManager(panelContent);
      let highlightTimeout: number | null = null;
      const highlightListItem = (itemId: string): void => {
        const bodyEl = bodyManager.getBodyEl();
        if (!bodyEl) {
          return;
        }
        listPanelController.selectItemById(itemId, { scroll: false });
        const safeId =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(itemId)
            : itemId;
        const row = bodyEl.querySelector<HTMLElement>(
          `.list-item-row[data-item-id="${safeId}"]`,
        );
        if (!row) {
          return;
        }
        bodyEl
          .querySelectorAll<HTMLElement>('.list-item-row.list-item-highlight')
          .forEach((el) => el.classList.remove('list-item-highlight'));
        row.classList.add('list-item-highlight');
        row.scrollIntoView({ block: 'center' });
        if (highlightTimeout) {
          window.clearTimeout(highlightTimeout);
        }
        highlightTimeout = window.setTimeout(() => {
          row.classList.remove('list-item-highlight');
        }, 1500);
      };
      const recentUserItemUpdates = new Set<string>();

      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceIds: string[] = [DEFAULT_INSTANCE_ID];
      let activeInstanceId = DEFAULT_INSTANCE_ID;
      let availableLists: ListSummary[] = [];
      let availableNotes: NoteSummary[] = [];
      let notesLoadedInstances = new Set<string>();
      let activeListId: string | null = null;
      let activeListInstanceId: string | null = null;
      let activeListSummary: ListSummary | null = null;
      let activeListData: ListPanelData | null = null;
      let panelListViewPrefs: Record<string, ListViewPreferences> = {};
      let searchMode: 'raw' | 'aql' = 'raw';
      let rawQueryText = '';
      let aqlQueryText = '';
      let aqlAppliedQueryText: string | null = null;
      let aqlAppliedQuery: AqlQuery | null = null;
      let aqlError: string | null = null;
      let aqlDirty = false;
      let savedAqlQueries: SavedAqlQuery[] = [];
      let selectedAqlQueryId: string | null = null;
      let ignoreSearchChange = false;
      let mode: ViewMode = 'browser';
      let isVisible = false;
      let isPanelSelected = false;
      let refreshToken = 0;
      let refreshInFlight = false;
      let loadToken = 0;
      let browserController: CollectionBrowserController | null = null;
      let dropdownController: CollectionDropdownController | null = null;
      let chromeController: PanelChromeController | null = null;
      let unsubscribePanelActive: (() => void) | null = null;
      let unsubscribeViewportResize: (() => void) | null = null;
      let pendingShowEvent: { listId: string; instanceId: string; itemId?: string } | null = null;
      let pendingAqlApplyEvent: { listId: string; instanceId: string; query: string } | null = null;
      const panelShortcutUnsubscribers: Array<() => void> = [];
      let refPickerShortcutIndex = 0;

      const contextKey = getPanelContextKey(host.panelId());
      const panelId = host.panelId();
      const panelShortcutScope = { scope: 'panelInstance' as const, panelId };

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
        const { listId, instanceId, itemId } = pendingShowEvent;
        if (!isKnownInstance(instanceId)) {
          return;
        }
        pendingShowEvent = null;
        if (!selectedInstanceIds.includes(instanceId)) {
          setActiveInstances([instanceId, ...selectedInstanceIds]);
        }
        void selectList(listId, instanceId, { focus: false }).then(() => {
          if (itemId) {
            highlightListItem(itemId);
          }
        });
      };

      const applyAqlQueryForList = async (
        listId: string,
        instanceId: string,
        query: string,
      ): Promise<void> => {
        if (!selectedInstanceIds.includes(instanceId)) {
          setActiveInstances([instanceId, ...selectedInstanceIds]);
        }
        await selectList(listId, instanceId, { focus: false });
        aqlQueryText = query;
        if (searchMode !== 'aql') {
          setSearchMode('aql');
        }
        applyAqlQueryText(query, true);
      };

      const applyPendingAqlApplyEvent = (): void => {
        if (!pendingAqlApplyEvent) {
          return;
        }
        const { listId, instanceId, query } = pendingAqlApplyEvent;
        if (!isKnownInstance(instanceId)) {
          return;
        }
        pendingAqlApplyEvent = null;
        void applyAqlQueryForList(listId, instanceId, query);
      };

      const persistState = (): void => {
        host.persistPanelState({
          selectedListId: activeListId,
          selectedListInstanceId: activeListInstanceId,
          mode,
          instanceIds: selectedInstanceIds,
          listViewPrefs: panelListViewPrefs,
          searchMode,
          rawQueryText,
          aqlQueryText,
          aqlAppliedQueryText,
        });
      };

      const normalizeColumnWidths = (
        value: unknown,
      ): Record<string, Record<string, number>> => {
        if (!value || typeof value !== 'object') {
          return {};
        }
        const result: Record<string, Record<string, number>> = {};
        for (const [listId, rawWidths] of Object.entries(value as Record<string, unknown>)) {
          if (!rawWidths || typeof rawWidths !== 'object' || Array.isArray(rawWidths)) {
            continue;
          }
          const widths: Record<string, number> = {};
          for (const [columnKey, rawWidth] of Object.entries(
            rawWidths as Record<string, unknown>,
          )) {
            if (typeof rawWidth !== 'number' || !Number.isFinite(rawWidth)) {
              continue;
            }
            const rounded = Math.round(rawWidth);
            if (rounded <= 0) {
              continue;
            }
            widths[columnKey] = rounded;
          }
          if (Object.keys(widths).length > 0) {
            result[listId] = widths;
          }
        }
        return result;
      };

      const normalizeListViewPrefs = (
        value: unknown,
      ): Record<string, ListViewPreferences> => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return {};
        }
        const result: Record<string, ListViewPreferences> = {};
        for (const [listId, rawPrefs] of Object.entries(value as Record<string, unknown>)) {
          if (!rawPrefs || typeof rawPrefs !== 'object' || Array.isArray(rawPrefs)) {
            continue;
          }
          const prefs: ListViewPreferences = {};
          const rawColumns = (rawPrefs as Record<string, unknown>)['columns'];
          if (rawColumns && typeof rawColumns === 'object' && !Array.isArray(rawColumns)) {
            const columns: ListColumnPreferences = {};
            for (const [columnKey, rawConfig] of Object.entries(
              rawColumns as Record<string, unknown>,
            )) {
              if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
                continue;
              }
              const config = rawConfig as Record<string, unknown>;
              const width =
                typeof config['width'] === 'number' && Number.isFinite(config['width'])
                  ? Math.round(config['width'] as number)
                  : undefined;
              const visibility = config['visibility'];
              const normalizedVisibility =
                visibility === 'always-show' ||
                visibility === 'show-with-data' ||
                visibility === 'hide-in-compact' ||
                visibility === 'always-hide'
                  ? visibility
                  : undefined;
              const entry: { width?: number; visibility?: typeof normalizedVisibility } = {};
              if (width && width > 0) entry.width = width;
              if (normalizedVisibility) entry.visibility = normalizedVisibility;
              if (Object.keys(entry).length > 0) {
                columns[columnKey] = entry;
              }
            }
            if (Object.keys(columns).length > 0) {
              prefs.columns = columns;
            }
          }
          const rawSortState = (rawPrefs as Record<string, unknown>)['sortState'];
          if (
            rawSortState &&
            typeof rawSortState === 'object' &&
            !Array.isArray(rawSortState)
          ) {
            const column = (rawSortState as Record<string, unknown>)['column'];
            const direction = (rawSortState as Record<string, unknown>)['direction'];
            if (typeof column === 'string' && (direction === 'asc' || direction === 'desc')) {
              prefs.sortState = { column: column.trim(), direction };
            }
          }
          const rawTimeline = (rawPrefs as Record<string, unknown>)['timelineField'];
          if (rawTimeline === null) {
            prefs.timelineField = null;
          } else if (typeof rawTimeline === 'string') {
            const trimmed = rawTimeline.trim();
            prefs.timelineField = trimmed.length > 0 ? trimmed : null;
          }
          const rawFocusId = (rawPrefs as Record<string, unknown>)['focusMarkerItemId'];
          if (rawFocusId === null) {
            prefs.focusMarkerItemId = null;
          } else if (typeof rawFocusId === 'string') {
            const trimmed = rawFocusId.trim();
            prefs.focusMarkerItemId = trimmed.length > 0 ? trimmed : null;
          }
          const rawExpanded = (rawPrefs as Record<string, unknown>)['focusMarkerExpanded'];
          if (typeof rawExpanded === 'boolean') {
            prefs.focusMarkerExpanded = rawExpanded;
          }
          if (Object.keys(prefs).length > 0) {
            result[listId] = prefs;
          }
        }
        return result;
      };

      const mergeColumnWidthsIntoViewPrefs = (
        prefs: Record<string, ListViewPreferences>,
        widths: Record<string, Record<string, number>>,
      ): Record<string, ListViewPreferences> => {
        const merged: Record<string, ListViewPreferences> = { ...prefs };
        for (const [listId, listWidths] of Object.entries(widths)) {
          const existing = merged[listId] ?? {};
          const columns: ListColumnPreferences = { ...(existing.columns ?? {}) };
          for (const [columnKey, width] of Object.entries(listWidths)) {
            columns[columnKey] = {
              ...(columns[columnKey] ?? {}),
              width,
            };
          }
          merged[listId] = { ...existing, columns };
        }
        return merged;
      };

      const getListColumnPreferences = (listId: string): ListColumnPreferences | null => {
        const prefs = panelListViewPrefs[listId]?.columns ?? null;
        return prefs && Object.keys(prefs).length > 0 ? prefs : null;
      };

      const updatePanelColumnWidth = (listId: string, columnKey: string, width: number): void => {
        if (!listId || !columnKey || !Number.isFinite(width)) {
          return;
        }
        const normalizedWidth = Math.round(width);
        if (normalizedWidth <= 0) {
          return;
        }
        const current = panelListViewPrefs[listId] ?? {};
        const columns: ListColumnPreferences = { ...(current.columns ?? {}) };
        columns[columnKey] = {
          ...(columns[columnKey] ?? {}),
          width: normalizedWidth,
        };
        panelListViewPrefs = {
          ...panelListViewPrefs,
          [listId]: { ...current, columns },
        };
        persistState();
      };

      const updateListViewPrefs = (
        listId: string,
        patch: Partial<ListViewPreferences>,
      ): void => {
        if (!listId) {
          return;
        }
        const current = panelListViewPrefs[listId] ?? {};
        const next: ListViewPreferences = { ...current, ...patch };
        if (patch.columns) {
          next.columns = { ...(current.columns ?? {}), ...patch.columns };
        }
        panelListViewPrefs = { ...panelListViewPrefs, [listId]: next };
        persistState();
      };

      const updateFabVisibility = (): void => {
        const shouldShow =
          mode === 'list' &&
          !!activeListId &&
          (isCapacitor || services.isMobileViewport());
        if (fabAddButton) {
          fabAddButton.classList.toggle('is-visible', shouldShow);
        }
        if (fabSearchButton) {
          fabSearchButton.classList.toggle('is-visible', shouldShow);
        }
      };

      if (typeof window !== 'undefined') {
        const handleResize = () => updateFabVisibility();
        window.addEventListener('resize', handleResize);
        unsubscribeViewportResize = () => {
          window.removeEventListener('resize', handleResize);
        };
      }

      const callInstanceOperation = async <T>(
        instanceId: string,
        operation: string,
        body: Record<string, unknown>,
      ): Promise<T> =>
        callOperation(operation, {
          ...body,
          instance_id: instanceId,
        });

      const refreshNoteInstances = async (): Promise<Instance[]> => {
        try {
          const raw = await callNotesOperation<unknown>('instance_list', {});
          if (!Array.isArray(raw)) {
            return [];
          }
          const parsed = raw.map(parseInstance).filter((entry): entry is Instance => !!entry);
          return parsed;
        } catch {
          return [];
        }
      };

      const refreshAvailableNotes = async (): Promise<void> => {
        const noteInstances = await refreshNoteInstances();
        const summaries: NoteSummary[] = [];
        for (const instance of noteInstances) {
          try {
            const raw = await callNotesOperation<unknown>('list', {
              instance_id: instance.id,
            });
            const notes = parseNoteMetadataList(raw, instance.id, instance.label);
            summaries.push(...notes);
            notesLoadedInstances.add(instance.id);
          } catch {
            // Ignore note list failures for a single instance.
          }
        }
        availableNotes = summaries;
      };

      const getAvailableItems = (): CollectionItemSummary[] =>
        availableLists.map((list) => ({
          type: 'list',
          id: list.id,
          name: list.name,
          tags: list.tags,
          favorite: list.favorite,
          updatedAt: list.updatedAt,
          instanceId: list.instanceId,
          instanceLabel: list.instanceLabel ?? getInstanceLabel(list.instanceId),
        }));

      const buildReferenceItems = (): CollectionItemSummary[] => {
        const listItems = availableLists.map((list) => ({
          type: 'list',
          id: list.id,
          name: list.name,
          tags: list.tags,
          favorite: list.favorite,
          updatedAt: list.updatedAt,
          instanceId: list.instanceId,
          instanceLabel: list.instanceLabel ?? formatInstanceLabel(list.instanceId),
        }));
        const noteItems = availableNotes.map((note) => ({
          type: 'note',
          id: note.title,
          name: note.title,
          tags: note.tags,
          favorite: note.favorite,
          updatedAt: note.updated ?? note.created,
          instanceId: note.instanceId,
          instanceLabel: note.instanceLabel ?? formatInstanceLabel(note.instanceId),
        }));
        return [...noteItems, ...listItems];
      };

      const getActiveReference = (): CollectionReference | null =>
        activeListId && activeListInstanceId
          ? { type: 'list', id: activeListId, instanceId: activeListInstanceId }
          : null;

      const openReference = (reference: ListItemReference): void => {
        const normalized = reference.panelType.toLowerCase().trim();
        if (normalized !== 'notes' && normalized !== 'lists') {
          return;
        }
        const instanceId = reference.instanceId ?? DEFAULT_INSTANCE_ID;
        const state =
          normalized === 'notes'
            ? {
                selectedNoteTitle: reference.id,
                selectedNoteInstanceId: instanceId,
                instanceIds: [instanceId],
                mode: 'note',
              }
            : {
                selectedListId: reference.id,
                selectedListInstanceId: instanceId,
                instanceIds: [instanceId],
                mode: 'list',
              };
        const panelType = normalized === 'notes' ? 'notes' : 'lists';
        if (typeof host.openModalPanel === 'function') {
          const panelId = host.openModalPanel(panelType, { state, focus: true });
          if (panelId) {
            return;
          }
        }
        host.openPanel(panelType, { state, focus: true });
      };

      const isReferenceAvailable = (reference: ListItemReference): boolean => {
        if (reference.kind !== 'panel') {
          return true;
        }
        const instanceId = reference.instanceId ?? DEFAULT_INSTANCE_ID;
        const panelType = reference.panelType.toLowerCase().trim();
        if (panelType === 'notes') {
          if (!notesLoadedInstances.has(instanceId)) {
            return true;
          }
          return availableNotes.some(
            (note) => note.title === reference.id && note.instanceId === instanceId,
          );
        }
        if (panelType === 'lists') {
          if (!selectedInstanceIds.includes(instanceId)) {
            return true;
          }
          return availableLists.some(
            (list) => list.id === reference.id && list.instanceId === instanceId,
          );
        }
        return true;
      };

      const checkReferenceAvailability = async (
        reference: ListItemReference,
      ): Promise<boolean | null> => {
        if (reference.kind !== 'panel') {
          return null;
        }
        const instanceId = reference.instanceId ?? DEFAULT_INSTANCE_ID;
        const panelType = reference.panelType.toLowerCase().trim();
        if (panelType === 'notes') {
          try {
            await callNotesOperation('read', {
              instance_id: instanceId,
              title: reference.id,
            });
            return true;
          } catch {
            return false;
          }
        }
        if (panelType === 'lists') {
          if (!isKnownInstance(instanceId)) {
            return null;
          }
          try {
            await callInstanceOperation(instanceId, 'get', { id: reference.id });
            return true;
          } catch {
            return false;
          }
        }
        return null;
      };

      const openReferencePicker = async (options: {
        listId: string;
        field: ListCustomFieldDefinition;
        item?: ListPanelItem;
        currentValue: ListItemReference | null;
      }): Promise<ListItemReference | null> => {
        const { currentValue } = options;
        try {
          await refreshAvailableNotes();
        } catch {
          // Ignore note refresh errors and show lists only.
        }

        let pickerItems = buildReferenceItems();
        pickerItems = pickerItems.sort((a, b) => {
          const typeRank = (entry: CollectionItemSummary) => (entry.type === 'note' ? 0 : 1);
          const typeDiff = typeRank(a) - typeRank(b);
          if (typeDiff !== 0) {
            return typeDiff;
          }
          const aLabel = (a.name ?? a.id).toLowerCase();
          const bLabel = (b.name ?? b.id).toLowerCase();
          return aLabel.localeCompare(bLabel);
        });

        const toReference = (entry: CollectionItemSummary): ListItemReference => {
          const panelType = entry.type === 'note' ? 'notes' : 'lists';
          return {
            kind: 'panel',
            panelType,
            id: entry.id,
            ...(entry.instanceId ? { instanceId: entry.instanceId } : {}),
            ...(entry.name ? { label: entry.name } : {}),
          };
        };

      const formatEntryLabel = (entry: CollectionItemSummary): string => {
        const name = entry.name?.trim() || entry.id;
        const instanceId = entry.instanceId ?? DEFAULT_INSTANCE_ID;
        const instanceLabel = entry.instanceLabel ?? formatInstanceLabel(instanceId);
        const showInstance =
          selectedInstanceIds.length > 1 && instanceId && instanceId !== DEFAULT_INSTANCE_ID;
        return `${name}${showInstance ? ` (${instanceLabel})` : ''}`;
      };

        return new Promise((resolve) => {
          const underlyingOverlay = document.querySelector<HTMLElement>(
            '.confirm-dialog-overlay.list-item-dialog-overlay',
          );
          const previousOverlayDisplay = underlyingOverlay?.style.display ?? null;
          const previousOverlayAriaHidden = underlyingOverlay?.getAttribute('aria-hidden');
          if (underlyingOverlay) {
            underlyingOverlay.style.display = 'none';
            underlyingOverlay.setAttribute('aria-hidden', 'true');
          }

          const overlay = document.createElement('div');
          overlay.className = 'confirm-dialog-overlay list-ref-picker-overlay';

          const dialog = document.createElement('div');
          dialog.className = 'confirm-dialog list-ref-picker-dialog';
          dialog.setAttribute('role', 'dialog');
          dialog.setAttribute('aria-modal', 'true');

          const titleEl = document.createElement('h3');
          titleEl.className = 'confirm-dialog-title';
          titleEl.textContent = 'Select reference';
          dialog.appendChild(titleEl);

          const body = document.createElement('div');
          body.className = 'list-ref-picker-body';
          dialog.appendChild(body);

          const searchInput = document.createElement('input');
          searchInput.type = 'search';
          searchInput.className = 'list-ref-picker-search-input';
          searchInput.placeholder = 'Search notes and lists...';
          searchInput.autocomplete = 'off';

          const listContainer = document.createElement('div');
          listContainer.className = 'list-ref-picker-list';

          body.appendChild(searchInput);
          body.appendChild(listContainer);

          const buttons = document.createElement('div');
          buttons.className = 'confirm-dialog-buttons';

          const cancelButton = document.createElement('button');
          cancelButton.className = 'confirm-dialog-button cancel';
          cancelButton.textContent = 'Cancel';
          buttons.appendChild(cancelButton);
          dialog.appendChild(buttons);

          overlay.appendChild(dialog);
          document.body.appendChild(overlay);

          const previousDialogState = services.dialogManager.hasOpenDialog;
          services.dialogManager.hasOpenDialog = true;

          let escapeCleanup: (() => void) | null = null;

          const close = (value: ListItemReference | null): void => {
            overlay.remove();
            escapeCleanup?.();
            escapeCleanup = null;
            services.dialogManager.hasOpenDialog = previousDialogState;
            if (underlyingOverlay) {
              underlyingOverlay.style.display = previousOverlayDisplay ?? '';
              if (previousOverlayAriaHidden === null) {
                underlyingOverlay.removeAttribute('aria-hidden');
              } else {
                underlyingOverlay.setAttribute('aria-hidden', previousOverlayAriaHidden);
              }
            }
            resolve(value);
          };

          const registerEscapeHandler = (): (() => void) => {
            if (services.keyboardShortcuts) {
              const shortcutId = `lists-${panelId}-ref-picker-${refPickerShortcutIndex++}`;
              return services.keyboardShortcuts.register({
                id: shortcutId,
                key: 'escape',
                modifiers: [],
                description: 'Close reference picker',
                scope: 'panelInstance',
                panelId,
                allowWhenDisabled: true,
                handler: (event) => {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                  close(null);
                },
              });
            }

            const handleKeyDown = (event: KeyboardEvent) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close(null);
              }
            };

            document.addEventListener('keydown', handleKeyDown, { capture: true });
            return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
          };

          escapeCleanup = registerEscapeHandler();

          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
              close(null);
            }
          });

          cancelButton.addEventListener('click', () => close(null));

          const isCurrentEntry = (entry: CollectionItemSummary): boolean => {
            if (!currentValue || currentValue.kind !== 'panel') {
              return false;
            }
            const currentType =
              currentValue.panelType.toLowerCase().trim() === 'notes' ? 'note' : 'list';
            const currentInstance = currentValue.instanceId ?? DEFAULT_INSTANCE_ID;
            const entryInstance = entry.instanceId ?? DEFAULT_INSTANCE_ID;
            return (
              entry.type === currentType &&
              entry.id === currentValue.id &&
              entryInstance === currentInstance
            );
          };

          const buildSearchText = (entry: CollectionItemSummary): string =>
            [
              entry.name ?? '',
              entry.id,
              entry.instanceLabel ?? '',
              entry.type,
            ]
              .join(' ')
              .toLowerCase();

          let searchIndex = pickerItems.map((entry) => ({
            entry,
            searchText: buildSearchText(entry),
          }));

          const renderList = (): void => {
            listContainer.innerHTML = '';
            const query = searchInput.value.trim().toLowerCase();
            const filtered = query
              ? searchIndex
                  .filter((item) => item.searchText.includes(query))
                  .map((item) => item.entry)
              : pickerItems;
            if (filtered.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'list-ref-picker-empty';
              empty.textContent = 'No matches.';
              listContainer.appendChild(empty);
              return;
            }
            for (const entry of filtered) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'list-ref-picker-item';
              if (isCurrentEntry(entry)) {
                button.classList.add('is-selected');
              }
              const nameSpan = document.createElement('span');
              nameSpan.className = 'list-ref-picker-item-name';
              nameSpan.textContent = formatEntryLabel(entry);

              const badge = document.createElement('span');
              badge.className = 'list-ref-picker-item-badge';
              badge.textContent = entry.type === 'note' ? 'NOTE' : 'LIST';

              button.appendChild(nameSpan);
              button.appendChild(badge);
              button.addEventListener('click', () => close(toReference(entry)));
              listContainer.appendChild(button);
            }
          };

          let renderTimeout: ReturnType<typeof setTimeout> | null = null;
          const scheduleRender = (): void => {
            if (renderTimeout) {
              clearTimeout(renderTimeout);
            }
            renderTimeout = setTimeout(() => {
              renderTimeout = null;
              renderList();
            }, 120);
          };

          searchInput.addEventListener('input', scheduleRender);
          renderList();
          searchInput.focus();
        });
      };

      const updateDropdownSelection = (reference: CollectionReference | null): void => {
        if (!dropdownTriggerText) {
          return;
        }
        if (!reference) {
          dropdownTriggerText.textContent = 'Select a list...';
          chromeController?.scheduleLayoutCheck();
          return;
        }
        const list =
          availableLists.find(
            (entry) =>
              entry.id === reference.id && entry.instanceId === reference.instanceId,
          ) ?? activeListSummary;
        if (list && selectedInstanceIds.length > 1) {
          dropdownTriggerText.textContent = `${list.name} (${getInstanceLabel(
            list.instanceId,
          )})`;
        } else {
          dropdownTriggerText.textContent = list?.name ?? 'Select a list...';
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
          host.setPanelMetadata({ title: 'Lists' });
          return;
        }
        host.setPanelMetadata({
          title: `Lists (${formatInstanceSelectionLabel(selectedInstanceIds)})`,
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
        availableLists = [];
        activeListId = null;
        activeListInstanceId = null;
        activeListSummary = null;
        activeListData = null;
        loadToken += 1;
        refreshInFlight = false;
        refreshToken += 1;
        updatePanelContext();
        updateDropdownSelection(null);
        refreshListBrowser();
        setMode('browser');
        renderInstanceSelect();
        updatePanelMetadata();
        persistState();
        void refreshLists({ silent: true });
      };

      const updatePanelContext = (): void => {
        const contextInstanceId = activeListInstanceId ?? activeInstanceId;
        const contextAttributes: Record<string, string> = {
          'instance-id': contextInstanceId,
          'instance-ids': selectedInstanceIds.join(','),
        };
        if (!activeListSummary || !activeListInstanceId) {
          host.setContext(contextKey, {
            instance_id: contextInstanceId,
            instance_ids: selectedInstanceIds,
            contextAttributes,
          });
          services.notifyContextAvailabilityChange();
          return;
        }
        const selectedItemIds = bodyManager.getSelectedItemIds();
        const selectedItems = selectedItemIds
          .map((id) => {
            const item = activeListData?.items?.find((entry) => entry.id === id);
            if (!item || typeof item.title !== 'string' || !item.title.trim()) {
              return null;
            }
            return { id, title: item.title };
          })
          .filter((entry): entry is { id: string; title: string } => !!entry);
        host.setContext(contextKey, {
          type: 'list',
          id: activeListSummary.id,
          name: activeListSummary.name,
          instance_id: activeListInstanceId,
          instance_ids: selectedInstanceIds,
          description: activeListSummary.description ?? activeListData?.description ?? '',
          tags: activeListSummary.tags ?? [],
          selectedItemIds,
          selectedItems,
          selectedItemCount: selectedItemIds.length,
          contextAttributes,
        });
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
          root.querySelector('.collection-list-actions-menu.open') ||
          root.querySelector('.collection-list-actions-submenu.open') ||
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
        options?: { requireListMode?: boolean },
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
        const requireListMode = options?.requireListMode ?? true;
        if (requireListMode && (mode !== 'list' || !activeListId)) {
          return false;
        }
        return true;
      };

      const handlePanelShortcut = (event: KeyboardEvent): boolean => {
        const isSearchShortcut =
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'f';
        if (isSearchShortcut) {
          if (!canHandlePanelShortcuts(event, { requireListMode: false })) {
            return false;
          }
          sharedSearchController.focus(true);
          return true;
        }
        if (!canHandlePanelShortcuts(event, { requireListMode: mode === 'list' })) {
          return false;
        }
        const lowerKey = event.key.toLowerCase();
        const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
        if (mode === 'list' && !hasModifier && lowerKey === 'a') {
          setSearchMode(searchMode === 'aql' ? 'raw' : 'aql');
          return true;
        }
        if (mode === 'list' && event.key === 'Escape' && bodyManager.getSelectedItemCount() === 0) {
          setMode('browser');
          return true;
        }
        if (mode === 'browser') {
          return browserController?.handleKeyboardEvent(event) ?? false;
        }
        return listPanelController.handleKeyboardEvent(event);
      };

      const registerPanelShortcut = (shortcut: KeyboardShortcut): void => {
        if (!services.keyboardShortcuts) {
          return;
        }
        panelShortcutUnsubscribers.push(services.keyboardShortcuts.register(shortcut));
      };

      const registerPanelShortcuts = (): void => {
        if (!services.keyboardShortcuts) {
          return;
        }
        const description = 'Lists panel shortcut';
        const registerPlain = (
          idSuffix: string,
          key: string,
          options: Partial<KeyboardShortcut> = {},
        ): void => {
          registerPanelShortcut({
            id: `lists-${panelId}-${idSuffix}`,
            bindingId: `lists.${idSuffix}`,
            key,
            modifiers: [],
            description,
            handler: handlePanelShortcut,
            ...panelShortcutScope,
            ...options,
          });
        };
        const registerCommand = (idSuffix: string, key: string): void => {
          registerPanelShortcut({
            id: `lists-${panelId}-${idSuffix}`,
            bindingId: `lists.${idSuffix}`,
            key,
            modifiers: ['ctrl'],
            cmdOrCtrl: true,
            description,
            handler: handlePanelShortcut,
            ...panelShortcutScope,
          });
        };

        registerPlain('search-focus', 'f');
        registerPlain('toggle-aql', 'a');
        registerPlain('escape', 'escape');
        registerPlain('arrow-up', 'arrowup', { allowShift: true });
        registerPlain('arrow-down', 'arrowdown', { allowShift: true });
        registerPlain('arrow-left', 'arrowleft', { allowShift: true });
        registerPlain('arrow-right', 'arrowright', { allowShift: true });
        registerPlain('enter', 'enter');
        registerPlain('space', ' ');
        registerPlain('spacebar', 'spacebar');
        registerPlain('delete', 'd');
        registerPlain('pin', 'p');
        registerPlain('new', 'n');
        registerPlain('move-top', 't');
        registerPlain('move-bottom', 'b');
        registerPlain('move-up', 'w');
        registerPlain('move-down', 's');
        registerCommand('copy', 'c');
        registerCommand('cut', 'x');
        registerCommand('paste', 'v');
      };

      const listPanelController = new ListPanelController({
        bodyEl: panelContent,
        getSearchQuery: () => sharedSearchController.getQuery(),
        getSearchTagController: () => sharedSearchController.getTagController(),
        getActiveInstanceId: () => activeListInstanceId ?? activeInstanceId,
        callOperation: (operation, args) => {
          const { instanceId, ...rest } = args as Record<string, unknown> & {
            instanceId?: unknown;
          };
          const overrideInstanceId = typeof instanceId === 'string' ? instanceId : null;
          const targetInstanceId = overrideInstanceId ?? activeListInstanceId ?? activeInstanceId;
          return callInstanceOperation(targetInstanceId, operation, rest);
        },
        icons: {
          copy: ICONS.copy,
          duplicate: ICONS.duplicate,
          move: ICONS.move,
          plus: ICONS.plus,
          edit: ICONS.edit,
          trash: ICONS.trash,
          moreVertical: ICONS.moreVertical,
          x: ICONS.x,
          clock: ICONS.clock,
          clockOff: ICONS.clockOff,
          moveTop: ICONS.chevronUp,
          moveBottom: ICONS.chevronDown,
          pin: ICONS.pin,
        },
        renderTags: renderListTags,
        setStatus: services.setStatus,
        dialogManager: services.dialogManager,
        contextMenuManager: services.contextMenuManager,
        recentUserItemUpdates,
        userUpdateTimeoutMs: USER_UPDATE_TIMEOUT_MS,
        getSelectedItemIds: () => bodyManager.getSelectedItemIds(),
        getSelectedItemCount: () => bodyManager.getSelectedItemCount(),
        onSelectionChange: updatePanelContext,
        getMoveTargetLists: () => {
          const instanceId = activeListInstanceId ?? activeInstanceId;
          return availableLists
            .filter((list) => list.instanceId === instanceId)
            .map((list) => ({
              id: list.id,
              name: list.name,
            }));
        },
        openListMetadataDialog: (listId, data) => {
          browserController?.openListMetadataEditor(listId, data);
        },
        getListColumnPreferences,
        updateListColumnPreferences: (listId, columnKey, patch) => {
          if (patch.width !== undefined) {
            updatePanelColumnWidth(listId, columnKey, patch.width);
          }
          if (patch.visibility !== undefined) {
            const current = panelListViewPrefs[listId] ?? {};
            const columns: ListColumnPreferences = { ...(current.columns ?? {}) };
            columns[columnKey] = {
              ...(columns[columnKey] ?? {}),
              visibility: patch.visibility,
            };
            panelListViewPrefs = {
              ...panelListViewPrefs,
              [listId]: { ...current, columns },
            };
            persistState();
            updateAqlShowFromVisibility(columnKey, patch.visibility);
          }
        },
        getSortState: (listId) => panelListViewPrefs[listId]?.sortState ?? null,
        updateSortState: (listId, sortState) => {
          updateListViewPrefs(listId, { sortState: sortState ?? null });
          updateAqlOrderFromSort(sortState ?? null);
        },
        getTimelineField: (listId) => panelListViewPrefs[listId]?.timelineField ?? null,
        updateTimelineField: (listId, timelineField) => {
          updateListViewPrefs(listId, { timelineField });
        },
        getFocusMarkerItemId: (listId) =>
          panelListViewPrefs[listId]?.focusMarkerItemId ?? null,
        getFocusMarkerExpanded: (listId) =>
          panelListViewPrefs[listId]?.focusMarkerExpanded ?? false,
        updateFocusMarker: (listId, focusMarkerItemId, focusMarkerExpanded) => {
          const current = panelListViewPrefs[listId] ?? {};
          const next: ListViewPreferences = { ...current, focusMarkerItemId };
          if (focusMarkerExpanded !== undefined) {
            next.focusMarkerExpanded = focusMarkerExpanded;
          }
          if (focusMarkerItemId === null) {
            delete next.focusMarkerExpanded;
          }
          panelListViewPrefs = { ...panelListViewPrefs, [listId]: next };
          persistState();
        },
        updateFocusMarkerExpanded: (listId, focusMarkerExpanded) => {
          updateListViewPrefs(listId, { focusMarkerExpanded });
        },
        getAqlMode: () => mode === 'list' && searchMode === 'aql',
        getAqlQuery: () => (mode === 'list' && searchMode === 'aql' ? aqlAppliedQuery : null),
        setRightControls: (elements) => {
          sharedSearchController.setRightControls(elements);
        },
        openReferencePicker,
        openReference,
        isReferenceAvailable,
        checkReferenceAvailability,
      });

      if (fabAddButton) {
        fabAddButton.addEventListener('click', () => {
          if (!activeListId) {
            return;
          }
          listPanelController.openAddItemDialog(activeListId);
        });
      }
      if (fabSearchButton) {
        fabSearchButton.addEventListener('click', () => {
          if (services.openCommandPalette) {
            services.openCommandPalette();
            return;
          }
          const trigger = document.getElementById('command-palette-button');
          if (trigger instanceof HTMLButtonElement) {
            trigger.click();
          }
        });
      }

      const buildListArgs = (
        payload: ListMetadataDialogPayload,
        options?: { includeEmpty?: boolean },
      ): Record<string, unknown> => {
        const includeEmpty = options?.includeEmpty ?? false;
        const args: Record<string, unknown> = { name: payload.name };
        if (includeEmpty || payload.description.trim().length > 0) {
          args['description'] = payload.description;
        }
        if (includeEmpty || payload.tags.length > 0) {
          args['tags'] = payload.tags;
        }
        if (typeof payload.favorite === 'boolean') {
          args['favorite'] = payload.favorite;
        }
        if (includeEmpty || payload.defaultTags.length > 0) {
          args['defaultTags'] = payload.defaultTags;
        }
        if (includeEmpty || payload.customFields.length > 0) {
          args['customFields'] = payload.customFields;
        }
        return args;
      };

      browserController = new CollectionBrowserController({
        containerEl: panelContent,
        getAvailableItems,
        getSupportedTypes: () => ['list'],
        getAllTags: () => {
          const tags = new Set<string>();
          for (const list of availableLists) {
            for (const tag of list.tags ?? []) {
              tags.add(tag.toLowerCase());
            }
          }
          return Array.from(tags).sort();
        },
        getGroupLabel: () => '',
        getActiveItemReference: getActiveReference,
        selectItem: (item) => {
          if (!item) {
            setMode('browser');
            return;
          }
          const instanceId = item.instanceId ?? activeInstanceId;
          void selectList(item.id, instanceId, { focus: false });
        },
        refreshItems: async () => {
          await refreshLists({ silent: true });
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
          if (item.type !== 'list') {
            return;
          }
          const targetInstanceId = item.instanceId ?? activeInstanceId;
          const operation = isPinned ? 'tags-remove' : 'tags-add';
          void (async () => {
            try {
              await callInstanceOperation(targetInstanceId, operation, {
                id: item.id,
                tags: [PINNED_TAG],
              });
            } catch (err) {
              console.error('Failed to toggle pinned list', err);
              services.setStatus('Failed to update pinned list');
            }
          })();
        },
        listApi: {
          getList: async (listId, instanceId) => {
            const targetInstanceId = instanceId ?? activeListInstanceId ?? activeInstanceId;
            const raw = await callInstanceOperation<unknown>(targetInstanceId, 'get', {
              id: listId,
            });
            const list = parseListSummary(raw, targetInstanceId);
            if (!list) {
              return null;
            }
            return {
              id: list.id,
              name: list.name,
              description: list.description ?? '',
              tags: list.tags ?? [],
              favorite: list.favorite,
              defaultTags: list.defaultTags ?? [],
              customFields: list.customFields ?? [],
              instanceId: targetInstanceId,
            };
          },
          createList: async (payload) => {
            const targetInstanceId = payload.instanceId ?? activeInstanceId;
            const result = await callInstanceOperation<unknown>(
              targetInstanceId,
              'create',
              buildListArgs(payload),
            );
            const list = parseListSummary(result, targetInstanceId);
            return list?.id ?? null;
          },
          updateList: async (listId, payload) => {
            const sourceInstanceId = payload.sourceInstanceId ?? activeListInstanceId ?? activeInstanceId;
            const targetInstanceId = payload.instanceId ?? sourceInstanceId;
            if (targetInstanceId !== sourceInstanceId) {
              await callInstanceOperation(sourceInstanceId, 'move', {
                id: listId,
                target_instance_id: targetInstanceId,
              });
            }
            await callInstanceOperation(targetInstanceId, 'update', {
              id: listId,
              ...buildListArgs(payload, { includeEmpty: true }),
            });
            if (
              targetInstanceId !== sourceInstanceId &&
              activeListId === listId &&
              activeListInstanceId === sourceInstanceId
            ) {
              await selectList(listId, targetInstanceId, { focus: false });
            }
            return true;
          },
          deleteList: async (listId) => {
            const targetInstanceId = activeListInstanceId ?? activeInstanceId;
            await callInstanceOperation(targetInstanceId, 'delete', { id: listId });
            return true;
          },
        },
        fetchPreview: async (itemType, itemId, instanceId) => {
          if (itemType !== 'list') {
            return null;
          }
          try {
            const targetInstanceId = instanceId ?? activeInstanceId;
            return await fetchListPreview(itemId, (operation, args) =>
              callInstanceOperation(targetInstanceId, operation, args),
            );
          } catch (err) {
            console.error('Failed to load list preview', err);
            return null;
          }
        },
        viewModeStorageKey: 'aiAssistantListsBrowserViewMode',
        sortModeStorageKey: 'aiAssistantListsBrowserSortMode',
        openNoteEditor: () => undefined,
        shouldShowInstanceBadge: () => selectedInstanceIds.length > 1,
        getListInstanceSelection: () => {
          const selection = getInstanceSelectionOptions();
          if (!selection) {
            return null;
          }
          return {
            options: selection.options.map((instance) => ({
              id: instance.id,
              label: instance.label ?? getInstanceLabel(instance.id),
            })),
            preferredInstanceId: selection.preferredInstanceId,
          };
        },
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
            host.openPanel('lists', { focus: true });
          } else {
            host.closePanel(host.panelId());
          }
        },
        getAllTags: () => {
          const tags = new Set<string>();
          for (const list of availableLists) {
            for (const tag of list.tags ?? []) {
              tags.add(tag.toLowerCase());
            }
          }
          return Array.from(tags).sort();
        },
        getGroupLabel: () => 'Lists',
        getSupportedTypes: () => ['list'],
        getSortMode: () => browserController?.getSortMode() ?? 'alpha',
        getActiveItemReference: getActiveReference,
        updateSelection: updateDropdownSelection,
        selectItem: (item) => {
          if (!item) {
            return;
          }
          const instanceId = item.instanceId ?? activeInstanceId;
          void selectList(item.id, instanceId, { focus: false });
        },
        renderItemActions: (actionsEl, item) => {
          if (item.type !== 'list') {
            return;
          }
          const addButton = document.createElement('span');
          addButton.className = 'collection-search-dropdown-item-add';
          addButton.title = 'Add item to this list';
          addButton.innerHTML = ICONS.plus;
          addButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dropdownController?.close(false);
            const instanceId = item.instanceId ?? activeInstanceId;
            const listSummary =
              availableLists.find(
                (list) => list.id === item.id && list.instanceId === instanceId,
              ) ?? null;
            listPanelController.openAddItemDialog(item.id, {
              instanceId,
              openOptions: {
                availableTags: [],
                defaultTags: listSummary?.defaultTags ?? [],
                customFields: listSummary?.customFields ?? [],
              },
            });
          });
          actionsEl.appendChild(addButton);
        },
      });
      dropdownController?.attach();
      if (panelContent) {
        panelContent.addEventListener('click', (event) => {
          const target = event.target as HTMLElement | null;
          if (!target) {
            return;
          }
          if (target.closest('.collection-browser-item-edit')) {
            return;
          }
          const item = target.closest<HTMLElement>('.collection-search-dropdown-item');
          if (!item) {
            return;
          }
          const type = item.dataset['collectionType'];
          const listId = item.dataset['collectionId'];
          const instanceId = item.dataset['collectionInstanceId'] ?? activeInstanceId;
          if (type !== 'list' || !listId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void selectList(listId, instanceId, { focus: false });
        });
      }

      const isAqlEnabled = (): boolean => mode === 'list' && searchMode === 'aql';

      const getSavedQueryById = (id: string | null): SavedAqlQuery | null => {
        if (!id) {
          return null;
        }
        return savedAqlQueries.find((entry) => entry.id === id) ?? null;
      };

      const getDefaultSavedQuery = (): SavedAqlQuery | null =>
        savedAqlQueries.find((entry) => entry.isDefault) ?? null;

      const renderSavedQueryOptions = (): void => {
        aqlSavedSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = savedAqlQueries.length > 0 ? 'Saved queries' : 'No saved queries';
        aqlSavedSelect.appendChild(placeholder);
        for (const entry of savedAqlQueries) {
          const option = document.createElement('option');
          option.value = entry.id;
          option.textContent = entry.isDefault ? `★ ${entry.name}` : entry.name;
          aqlSavedSelect.appendChild(option);
        }
        aqlSavedSelect.value = selectedAqlQueryId ?? '';
      };

      const updateAqlStatusMessage = (): void => {
        if (!isAqlEnabled()) {
          sharedSearchController.setStatusMessage(null);
          return;
        }
        if (aqlError) {
          sharedSearchController.setStatusMessage(aqlError, 'error');
          return;
        }
        const hasAppliedQuery =
          !!(aqlAppliedQueryText && aqlAppliedQueryText.trim()) || !!aqlAppliedQuery;
        const isClearing = hasAppliedQuery && !aqlQueryText.trim();
        if (isClearing) {
          sharedSearchController.setStatusMessage('Press enter to clear');
          return;
        }
        if (aqlDirty) {
          sharedSearchController.setStatusMessage('Press Enter or Apply to run.');
          return;
        }
        sharedSearchController.setStatusMessage(null);
      };

      const confirmDialog = (options: {
        title: string;
        message: string;
        confirmText: string;
        confirmClassName?: string;
      }): Promise<boolean> => {
        return new Promise((resolve) => {
          let resolved = false;
          services.dialogManager.showConfirmDialog({
            title: options.title,
            message: options.message,
            confirmText: options.confirmText,
            confirmClassName: options.confirmClassName,
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

          const overlays = Array.from(
            document.querySelectorAll<HTMLElement>('.confirm-dialog-overlay'),
          );
          const overlay = overlays[overlays.length - 1];
          if (!overlay) {
            if (!resolved) {
              resolved = true;
              resolve(false);
            }
            return;
          }
          const observer = new MutationObserver(() => {
            if (!overlay.isConnected && !resolved) {
              resolved = true;
              resolve(false);
            }
            if (resolved) {
              observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true });
        });
      };

      const updateAqlControls = (): void => {
        const enabled = isAqlEnabled();
        aqlToggleButton.classList.toggle('active', enabled);
        aqlToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        aqlToggleButton.disabled = mode !== 'list';
        aqlActionGroup.classList.toggle('visible', enabled);
        aqlApplyButton.disabled = !enabled || !!aqlError;
        aqlApplyButton.classList.toggle('dirty', enabled && aqlDirty);
        aqlSavedSelect.classList.toggle('visible', enabled);
        aqlSavedSelect.disabled = mode !== 'list';
        aqlSaveButton.disabled = !enabled || !aqlQueryText.trim();
        const selected = getSavedQueryById(selectedAqlQueryId);
        const hasSelection = !!selected;
        aqlDeleteButton.disabled = !enabled || !hasSelection;
        aqlDefaultButton.disabled = !enabled || !hasSelection;
        aqlDefaultButton.classList.toggle('active', !!selected?.isDefault);
        aqlDefaultButton.innerHTML = selected?.isDefault ? ICONS.starFilled : ICONS.star;
        aqlDefaultButton.setAttribute(
          'aria-label',
          selected?.isDefault ? 'Clear default AQL query' : 'Set default AQL query',
        );
        aqlDefaultButton.setAttribute(
          'title',
          selected?.isDefault ? 'Clear default' : 'Set default',
        );
      };

      const rerenderList = (): void => {
        if (!activeListId || !activeListData) {
          return;
        }
        const controls = listPanelController.render(activeListId, activeListData);
        sharedSearchController.setRightControls(controls.rightControls);
      };

      const setSavedQueries = (queries: SavedAqlQuery[]): void => {
        savedAqlQueries = queries;
        if (activeListData) {
          activeListData.savedQueries = queries;
        }
        if (selectedAqlQueryId) {
          const stillExists = savedAqlQueries.some((entry) => entry.id === selectedAqlQueryId);
          if (!stillExists) {
            selectedAqlQueryId = null;
          }
        }
        renderSavedQueryOptions();
        updateAqlControls();
      };

      const fetchSavedQueries = async (
        listId: string,
        instanceId: string,
      ): Promise<SavedAqlQuery[]> => {
        const raw = await callInstanceOperation<unknown>(instanceId, 'aql-query-list', {
          listId,
        });
        return parseSavedQueries(raw) ?? [];
      };

      const applySavedQuery = (entry: SavedAqlQuery): void => {
        if (mode !== 'list') {
          return;
        }
        if (searchMode !== 'aql') {
          setSearchMode('aql');
        }
        selectedAqlQueryId = entry.id;
        applyAqlQueryText(entry.query, true);
        renderSavedQueryOptions();
      };

      const applyDefaultQuery = (): void => {
        const defaultQuery = getDefaultSavedQuery();
        if (!defaultQuery) {
          return;
        }
        applySavedQuery(defaultQuery);
      };

      const applyAqlQueryText = (nextText: string, syncInput: boolean): void => {
        if (!isAqlEnabled()) {
          return;
        }
        const trimmed = nextText.trim();
        aqlQueryText = nextText;
        if (syncInput) {
          const searchInput = sharedSearchController.getSearchInputEl();
          if (searchInput) {
            searchInput.value = nextText;
          }
        }
        if (!trimmed) {
          aqlAppliedQuery = null;
          aqlAppliedQueryText = null;
          aqlError = null;
          aqlDirty = false;
          selectedAqlQueryId = null;
          renderSavedQueryOptions();
          updateAqlStatusMessage();
          updateAqlControls();
          persistState();
          rerenderList();
          return;
        }
        const result = parseAql(nextText, {
          customFields: activeListData?.customFields ?? [],
        });
        if (!result.ok) {
          aqlError = result.error;
          aqlDirty = (aqlAppliedQueryText ?? '') !== aqlQueryText;
          updateAqlStatusMessage();
          updateAqlControls();
          return;
        }
        aqlAppliedQuery = result.query;
        aqlAppliedQueryText = nextText;
        aqlError = null;
        aqlDirty = false;
        const matchingSaved = savedAqlQueries.find((entry) => entry.query === trimmed);
        selectedAqlQueryId = matchingSaved?.id ?? selectedAqlQueryId;
        renderSavedQueryOptions();
        updateAqlStatusMessage();
        updateAqlControls();
        persistState();
        rerenderList();
      };

      const applyAqlQuery = (): void => {
        applyAqlQueryText(aqlQueryText, false);
      };

      const ensureAqlAppliedQuery = (): void => {
        if (!isAqlEnabled()) {
          aqlAppliedQuery = null;
          return;
        }
        if (!aqlAppliedQueryText || !aqlAppliedQueryText.trim()) {
          aqlAppliedQuery = null;
          return;
        }
        const result = parseAql(aqlAppliedQueryText, {
          customFields: activeListData?.customFields ?? [],
        });
        if (!result.ok) {
          aqlAppliedQuery = null;
          aqlError = result.error;
          updateAqlStatusMessage();
          updateAqlControls();
          return;
        }
        aqlAppliedQuery = result.query;
        aqlError = null;
        updateAqlStatusMessage();
        updateAqlControls();
      };

      const handleSearchInputChange = (query: string): void => {
        if (ignoreSearchChange) {
          return;
        }
        if (searchMode === 'aql' && mode === 'list') {
          aqlQueryText = query;
          aqlError = null;
          aqlDirty = (aqlAppliedQueryText ?? '') !== aqlQueryText;
          const selected = getSavedQueryById(selectedAqlQueryId);
          if (selected && selected.query !== aqlQueryText.trim()) {
            selectedAqlQueryId = null;
            renderSavedQueryOptions();
          }
          updateAqlStatusMessage();
          updateAqlControls();
          persistState();
          return;
        }

        rawQueryText = query;
        applySearch(query);
        persistState();
      };

      const buildFieldRef = (key: string) => ({
        key,
        label: key,
        type: 'text' as const,
        kind: 'builtin' as const,
        displayable: true,
      });

      const getDefaultColumnOrder = (): string[] => {
        const order: string[] = ['title', 'url', 'notes'];
        const customFields = activeListData?.customFields ?? [];
        for (const field of customFields) {
          if (field.key) {
            order.push(field.key);
          }
        }
        order.push('tags', 'added', 'updated', 'touched');
        return order;
      };

      const updateAqlOrderFromSort = (sortState: { column: string; direction: 'asc' | 'desc' } | null): void => {
        if (!isAqlEnabled() || !aqlAppliedQuery) {
          return;
        }
        const orderBy = sortState
          ? [{ field: buildFieldRef(sortState.column), direction: sortState.direction }]
          : [];
        const nextText = buildAqlString(aqlAppliedQuery.base, orderBy, aqlAppliedQuery.show);
        applyAqlQueryText(nextText, true);
      };

      const updateAqlShowFromVisibility = (columnKey: string, visibility: string): void => {
        if (!isAqlEnabled() || !aqlAppliedQuery) {
          return;
        }
        const shouldShow = visibility !== 'always-hide';
        const currentKeys = aqlAppliedQuery.show
          ? aqlAppliedQuery.show.map((field) => field.key)
          : getDefaultColumnOrder();
        const nextKeys = [...currentKeys];
        const index = nextKeys.indexOf(columnKey);
        if (shouldShow) {
          if (index === -1) {
            nextKeys.push(columnKey);
          }
        } else if (index !== -1) {
          nextKeys.splice(index, 1);
        }
        const orderedKeys = aqlAppliedQuery.show ? nextKeys : getDefaultColumnOrder().filter((key) => nextKeys.includes(key));
        const showFields = orderedKeys.map((key) => buildFieldRef(key));
        const nextText = buildAqlString(aqlAppliedQuery.base, aqlAppliedQuery.orderBy, showFields);
        applyAqlQueryText(nextText, true);
      };

      const setSearchMode = (nextMode: 'raw' | 'aql'): void => {
        if (mode !== 'list' && nextMode === 'aql') {
          return;
        }
        if (searchMode === nextMode) {
          return;
        }
        searchMode = nextMode;
        const searchInput = sharedSearchController.getSearchInputEl();
        if (searchMode === 'aql') {
          sharedSearchController.setTagFilteringEnabled(false);
          sharedSearchController.setPlaceholder('Enter AQL...');
          sharedSearchController.setKeydownHandler(handleAqlKeydown);
          if (searchInput) {
            searchInput.value = aqlQueryText;
          }
          ensureAqlAppliedQuery();
          handleSearchInputChange(aqlQueryText);
          rerenderList();
        } else {
          sharedSearchController.setTagFilteringEnabled(true);
          sharedSearchController.setPlaceholder('Search items...');
          sharedSearchController.setKeydownHandler(null);
          aqlAppliedQuery = null;
          aqlError = null;
          aqlDirty = false;
          sharedSearchController.setStatusMessage(null);
          if (searchInput) {
            searchInput.value = rawQueryText;
          }
          applySearch(rawQueryText);
          rerenderList();
        }
        updateAqlControls();
        persistState();
      };

      const handleAqlKeydown = (event: KeyboardEvent): boolean => {
        if (!isAqlEnabled()) {
          return false;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          applyAqlQuery();
          return true;
        }
        return false;
      };

      const validateAqlInput = (queryText: string): AqlQuery | null => {
        const trimmed = queryText.trim();
        if (!trimmed) {
          aqlError = 'AQL query cannot be empty.';
          updateAqlStatusMessage();
          updateAqlControls();
          return null;
        }
        const result = parseAql(trimmed, {
          customFields: activeListData?.customFields ?? [],
        });
        if (!result.ok) {
          aqlError = result.error;
          updateAqlStatusMessage();
          updateAqlControls();
          return null;
        }
        aqlError = null;
        updateAqlStatusMessage();
        updateAqlControls();
        return result.query;
      };

      const handleSaveAqlQuery = async (): Promise<void> => {
        if (!activeListId || !activeListInstanceId) {
          return;
        }
        if (!isAqlEnabled()) {
          setSearchMode('aql');
        }
        const selected = getSavedQueryById(selectedAqlQueryId);
        const name = await services.dialogManager.showTextInputDialog({
          title: 'Save AQL query',
          message: 'Name this query for quick access.',
          confirmText: 'Save',
          labelText: 'Query name',
          initialValue: selected?.name ?? '',
          placeholder: 'e.g. Ready items',
          validate: (value) => (value.trim().length === 0 ? 'Name is required.' : null),
        });
        if (!name) {
          return;
        }
        const trimmedName = name.trim();
        if (!validateAqlInput(aqlQueryText)) {
          return;
        }
        const existing = savedAqlQueries.find(
          (entry) => entry.name.trim().toLowerCase() === trimmedName.toLowerCase(),
        );
        const isSame = existing && existing.id === selected?.id;
        if (existing && !isSame) {
          const confirmed = await confirmDialog({
            title: 'Overwrite saved query?',
            message: `A saved query named "${existing.name}" already exists. Overwrite it?`,
            confirmText: 'Overwrite',
            confirmClassName: 'danger',
          });
          if (!confirmed) {
            return;
          }
        }
        try {
          const raw = await callInstanceOperation<unknown>(
            activeListInstanceId,
            'aql-query-save',
            {
              listId: activeListId,
              name: trimmedName,
              query: aqlQueryText.trim(),
              ...(existing ? { overwrite: true } : {}),
            },
          );
          const parsed = parseSavedQueries(raw) ?? [];
          const saved = parsed.find(
            (entry) => entry.name.trim().toLowerCase() === trimmedName.toLowerCase(),
          );
          selectedAqlQueryId = saved?.id ?? null;
          setSavedQueries(parsed);
        } catch (error) {
          sharedSearchController.setStatusMessage('Failed to save query.', 'error');
          console.error('Failed to save AQL query', error);
        }
      };

      const handleDeleteAqlQuery = async (): Promise<void> => {
        if (!activeListId || !activeListInstanceId) {
          return;
        }
        const selected = getSavedQueryById(selectedAqlQueryId);
        if (!selected) {
          return;
        }
        const confirmed = await confirmDialog({
          title: 'Delete saved query?',
          message: `Delete saved query "${selected.name}"?`,
          confirmText: 'Delete',
          confirmClassName: 'danger',
        });
        if (!confirmed) {
          return;
        }
        try {
          const raw = await callInstanceOperation<unknown>(
            activeListInstanceId,
            'aql-query-delete',
            {
              listId: activeListId,
              id: selected.id,
            },
          );
          selectedAqlQueryId = null;
          setSavedQueries(parseSavedQueries(raw) ?? []);
        } catch (error) {
          sharedSearchController.setStatusMessage('Failed to delete query.', 'error');
          console.error('Failed to delete AQL query', error);
        }
      };

      const handleToggleDefaultAqlQuery = async (): Promise<void> => {
        if (!activeListId || !activeListInstanceId) {
          return;
        }
        const selected = getSavedQueryById(selectedAqlQueryId);
        if (!selected) {
          return;
        }
        try {
          const raw = await callInstanceOperation<unknown>(
            activeListInstanceId,
            'aql-query-default',
            {
              listId: activeListId,
              ...(selected.isDefault ? {} : { id: selected.id }),
            },
          );
          setSavedQueries(parseSavedQueries(raw) ?? []);
        } catch (error) {
          sharedSearchController.setStatusMessage('Failed to update default query.', 'error');
          console.error('Failed to update default AQL query', error);
        }
      };

      aqlToggleButton.addEventListener('click', () => {
        if (mode !== 'list') {
          return;
        }
        setSearchMode(searchMode === 'aql' ? 'raw' : 'aql');
      });

      aqlApplyButton.addEventListener('click', () => {
        applyAqlQuery();
      });

      aqlSavedSelect.addEventListener('change', () => {
        const id = aqlSavedSelect.value;
        if (!id) {
          selectedAqlQueryId = null;
          renderSavedQueryOptions();
          updateAqlControls();
          return;
        }
        const entry = savedAqlQueries.find((item) => item.id === id);
        if (entry) {
          applySavedQuery(entry);
        }
      });

      aqlSaveButton.addEventListener('click', () => {
        void handleSaveAqlQuery();
      });

      aqlDeleteButton.addEventListener('click', () => {
        void handleDeleteAqlQuery();
      });

      aqlDefaultButton.addEventListener('click', () => {
        void handleToggleDefaultAqlQuery();
      });

      function applySearch(query: string): void {
        if (mode === 'browser') {
          browserController?.applySearchQuery(query);
          return;
        }
        if (mode === 'list') {
          listPanelController.applySearch(query);
        }
      }

      function setMode(nextMode: ViewMode): void {
        if (nextMode === 'list' && !activeListId) {
          nextMode = 'browser';
        }
        mode = nextMode;
        browserButton?.classList.toggle('active', mode === 'browser');
        listButton?.classList.toggle('active', mode === 'list');
        browserButton?.setAttribute('aria-selected', mode === 'browser' ? 'true' : 'false');
        listButton?.setAttribute('aria-selected', mode === 'list' ? 'true' : 'false');
        if (listButton) {
          listButton.disabled = !activeListId;
        }
        if (backButton) {
          backButton.style.display = mode === 'browser' ? 'none' : '';
        }
        chromeController?.scheduleLayoutCheck();
        if (mode === 'browser') {
          searchMode = 'raw';
          aqlAppliedQuery = null;
          aqlError = null;
          aqlDirty = false;
          sharedSearchController.setTagFilteringEnabled(true);
          const searchInput = sharedSearchController.getSearchInputEl();
          if (searchInput) {
            searchInput.value = rawQueryText;
          }
          browserController?.setSharedSearchElements({
            searchInput: sharedSearchController.getSearchInputEl(),
            tagController: sharedSearchController.getTagController(),
            tagsContainer: sharedSearchController.getTagsContainerEl(),
            activeTagsContainer: null,
          });
          sharedSearchController.setPlaceholder('Search lists...');
          sharedSearchController.setTagsProvider(() => browserController?.getAllKnownTags() ?? []);
          sharedSearchController.setKeydownHandler((event) =>
            browserController ? browserController.handleSharedSearchKeyDown(event) : false,
          );
          sharedSearchController.setLeftControls(null);
          const controls = browserController
            ? browserController.getSharedSearchRightControls()
            : [];
          sharedSearchController.setRightControls(controls.length > 0 ? controls : null);
          browserController?.show(false);
        } else {
          if (!activeListData) {
            sharedSearchController.setRightControls(null);
          }
          const defaultQuery = getDefaultSavedQuery();
          if (defaultQuery) {
            searchMode = 'aql';
            aqlQueryText = defaultQuery.query;
            aqlAppliedQueryText = defaultQuery.query;
            aqlAppliedQuery = null;
            aqlError = null;
            aqlDirty = false;
            selectedAqlQueryId = defaultQuery.id;
            renderSavedQueryOptions();
          }
          sharedSearchController.setLeftControls([aqlControls]);
          const searchInput = sharedSearchController.getSearchInputEl();
          if (searchInput) {
            searchInput.value = searchMode === 'aql' ? aqlQueryText : rawQueryText;
          }
          if (searchMode === 'aql') {
            sharedSearchController.setTagFilteringEnabled(false);
            sharedSearchController.setPlaceholder('Enter AQL...');
            sharedSearchController.setKeydownHandler(handleAqlKeydown);
          } else {
            sharedSearchController.setTagFilteringEnabled(true);
            sharedSearchController.setPlaceholder('Search items...');
            sharedSearchController.setKeydownHandler(null);
          }
          sharedSearchController.setTagsProvider(() => listPanelController.getAvailableTags());
        }
        sharedSearchController.setVisible(true);
        const currentQuery = sharedSearchController.getQuery();
        if (mode === 'list' && searchMode === 'aql') {
          aqlQueryText = currentQuery;
          ensureAqlAppliedQuery();
          rerenderList();
        } else {
          applySearch(currentQuery);
        }
        updateAqlControls();
        updateAqlStatusMessage();
        if (mode === 'browser') {
          browserController?.focusActiveItem();
        }
        updateFabVisibility();
        persistState();
      }

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
            availableLists = [];
            activeListId = null;
            activeListInstanceId = null;
            activeListSummary = null;
            activeListData = null;
            updatePanelContext();
            updateDropdownSelection(null);
            refreshListBrowser();
            setMode('browser');
            persistState();
          }
          updatePanelContext();
          renderInstanceSelect();
          updatePanelMetadata();
          applyPendingShowEvent();
          applyPendingAqlApplyEvent();
        } catch (error) {
          if (!options?.silent) {
            services.setStatus('Failed to load instances');
          }
          console.error('Failed to load instances', error);
          instances = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          updatePanelContext();
          renderInstanceSelect();
          updatePanelMetadata();
        }
      };

      async function refreshLists(options?: { silent?: boolean }): Promise<void> {
        if (refreshInFlight) {
          return;
        }
        refreshInFlight = true;
        const currentToken = ++refreshToken;
        try {
          const results = await Promise.all(
            selectedInstanceIds.map(async (instanceId) => {
              const raw = await callInstanceOperation<unknown>(instanceId, 'list', {});
              return parseListSummaries(raw, instanceId).map((list) => ({
                ...list,
                instanceLabel: getInstanceLabel(instanceId),
              }));
            }),
          );
          if (currentToken !== refreshToken) {
            return;
          }
          availableLists = results.flat();
          dropdownController?.populate(getAvailableItems());
          browserController?.refresh();
          if (activeListId && activeListInstanceId) {
            const updated = availableLists.find(
              (list) =>
                list.id === activeListId && list.instanceId === activeListInstanceId,
            );
            if (updated) {
              activeListSummary = updated;
              updatePanelContext();
            }
          }
          if (
            activeListId &&
            activeListInstanceId &&
            !availableLists.some(
              (list) =>
                list.id === activeListId && list.instanceId === activeListInstanceId,
            )
          ) {
            activeListId = null;
            activeListInstanceId = null;
            activeListSummary = null;
            activeListData = null;
            updatePanelContext();
            setMode('browser');
          }
          updateDropdownSelection(getActiveReference());
        } catch (err) {
          if (!options?.silent) {
            services.setStatus('Failed to load lists');
          }
          console.error('Failed to load lists', err);
        } finally {
          refreshInFlight = false;
        }
      }

      async function loadList(
        listId: string,
        instanceId: string,
        options?: { silent?: boolean },
      ): Promise<void> {
        const currentToken = ++loadToken;
        const isSwitchingLists =
          !!activeListId && (activeListId !== listId || activeListInstanceId !== instanceId);
        bodyManager.renderLoading({ type: 'list', id: listId });
        try {
          const rawList = await callInstanceOperation<unknown>(instanceId, 'get', { id: listId });
          const list = parseListSummary(rawList, instanceId);
          if (!list) {
            throw new Error('List not found');
          }
          const rawItems = await callInstanceOperation<unknown>(instanceId, 'items-list', {
            listId,
            limit: 0,
            sort: 'position',
          });
          const rawSavedQueries = await callInstanceOperation<unknown>(
            instanceId,
            'aql-query-list',
            { listId },
          );
          if (currentToken !== loadToken) {
            return;
          }
          const items = parseListItems(rawItems);
          const savedQueries = parseSavedQueries(rawSavedQueries) ?? [];
          const defaultQuery = savedQueries.find((entry) => entry.isDefault) ?? null;
          if (isSwitchingLists) {
            aqlQueryText = '';
            aqlAppliedQueryText = null;
            aqlAppliedQuery = null;
            aqlError = null;
            aqlDirty = false;
            selectedAqlQueryId = defaultQuery?.id ?? null;
            if (defaultQuery) {
              searchMode = 'aql';
              aqlQueryText = defaultQuery.query;
              aqlAppliedQueryText = defaultQuery.query;
            }
          }
          setSavedQueries(savedQueries);
          const data: ListPanelData = {
            id: list.id,
            name: list.name,
            description: list.description,
            tags: list.tags,
            defaultTags: list.defaultTags,
            customFields: list.customFields,
            savedQueries,
            items,
          };
          activeListId = list.id;
          activeListInstanceId = instanceId;
          activeListSummary = list;
          activeListData = data;
          updateDropdownSelection({ type: 'list', id: list.id, instanceId });
          const controls = listPanelController.render(list.id, data);
          sharedSearchController.setRightControls(controls.rightControls);
          updatePanelContext();
          setMode('list');
        } catch (err) {
          if (!options?.silent) {
            services.setStatus('Failed to load list');
          }
          console.error('Failed to load list', err);
          bodyManager.renderError('Failed to load list.');
        }
      }

      async function selectList(
        listId: string,
        instanceId: string,
        options?: { focus?: boolean },
      ): Promise<void> {
        if (!listId || !instanceId) {
          return;
        }
        if (activeListId === listId && activeListInstanceId === instanceId && activeListData) {
          updateDropdownSelection({ type: 'list', id: listId, instanceId });
          const controls = listPanelController.render(listId, activeListData);
          sharedSearchController.setRightControls(controls.rightControls);
          updatePanelContext();
          setMode('list');
          return;
        }
        await loadList(listId, instanceId);
        if (options?.focus) {
          sharedSearchController.focus(false);
        }
      }

      const updateAvailableList = (list: ListSummary): void => {
        const index = availableLists.findIndex(
          (entry) => entry.id === list.id && entry.instanceId === list.instanceId,
        );
        if (index >= 0) {
          availableLists[index] = list;
        } else {
          availableLists.push(list);
        }
      };

      const removeAvailableList = (listId: string, instanceId: string): void => {
        availableLists = availableLists.filter(
          (entry) => !(entry.id === listId && entry.instanceId === instanceId),
        );
      };

      const refreshListBrowser = (): void => {
        dropdownController?.populate(getAvailableItems());
        dropdownController?.refreshFilter();
        browserController?.refresh();
        updateDropdownSelection(getActiveReference());
      };

      const updateListUpdatedAt = (
        listId: string,
        instanceId: string,
        updatedAt: string | undefined,
      ): void => {
        if (!updatedAt) {
          return;
        }
        const index = availableLists.findIndex(
          (entry) => entry.id === listId && entry.instanceId === instanceId,
        );
        if (index === -1) {
          return;
        }
        const entry = availableLists[index];
        if (entry) {
          availableLists[index] = { ...entry, updatedAt };
        }
      };

      const updateActiveListMetadata = (list: ListSummary): void => {
        if (activeListId !== list.id || activeListInstanceId !== list.instanceId) {
          return;
        }
        activeListSummary = list;
        if (activeListData) {
          activeListData.name = list.name;
          activeListData.description = list.description;
          activeListData.tags = list.tags;
          activeListData.defaultTags = list.defaultTags;
          activeListData.customFields = list.customFields;
        }
        updatePanelContext();
      };

      const updateActiveListItem = (item: ListPanelItem): boolean => {
        if (!activeListData || !Array.isArray(activeListData.items)) {
          return false;
        }
        const index = activeListData.items.findIndex((entry) => entry.id === item.id);
        if (index === -1) {
          return false;
        }
        activeListData.items[index] = item;
        return true;
      };

      async function handlePanelUpdate(payload: Record<string, unknown>): Promise<void> {
        const listId = typeof payload['listId'] === 'string' ? payload['listId'].trim() : '';
        const action = typeof payload['action'] === 'string' ? payload['action'] : '';
        if (!listId || !action) {
          return;
        }
        const instanceId = resolveEventInstanceId(payload);
        if (!selectedInstanceIds.includes(instanceId)) {
          return;
        }

        const refresh = payload['refresh'] === true;
        const listSummary = parseListSummary(payload['list'], instanceId);
        const item = parseListItem(payload['item']);
        const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'].trim() : '';

        let listsChanged = false;

        if (listSummary) {
          updateAvailableList(listSummary);
          updateActiveListMetadata(listSummary);
          listsChanged = true;
        } else if (action === 'list_deleted') {
          removeAvailableList(listId, instanceId);
          listsChanged = true;
        }

        if (item?.updatedAt) {
          updateListUpdatedAt(listId, instanceId, item.updatedAt);
          listsChanged = true;
        }

        if (
          action === 'list_deleted' &&
          activeListId === listId &&
          activeListInstanceId === instanceId
        ) {
          activeListId = null;
          activeListInstanceId = null;
          activeListSummary = null;
          activeListData = null;
          updatePanelContext();
          setMode('browser');
        }
        if (listsChanged) {
          refreshListBrowser();
        }

        if (action === 'list_deleted') {
          return;
        }

        if (action.startsWith('item_')) {
          browserController?.invalidatePreview({ type: 'list', id: listId, instanceId });
        }

        if (
          activeListId !== listId ||
          activeListInstanceId !== instanceId ||
          !activeListData
        ) {
          return;
        }

        if (action === 'list_updated' && listSummary && mode === 'list') {
          const controls = listPanelController.render(listId, activeListData);
          sharedSearchController.setRightControls(controls.rightControls);
          sharedSearchController.setTagsProvider(() => listPanelController.getAvailableTags());
          return;
        }

        if (action.startsWith('item_')) {
          if (refresh) {
            await loadList(listId, instanceId, { silent: true });
            return;
          }
          if (action === 'item_updated' && item) {
            if (mode === 'list') {
              const handled = listPanelController.applyItemUpdate(item);
              if (!handled) {
                await loadList(listId, instanceId, { silent: true });
              }
            } else {
              updateActiveListItem(item);
            }
            updatePanelContext();
            if (mode === 'list') {
              sharedSearchController.setTagsProvider(() => listPanelController.getAvailableTags());
            }
            return;
          }
          if (action === 'item_removed' && itemId) {
            await loadList(listId, instanceId, { silent: true });
            return;
          }
          if (action === 'item_added' && item) {
            await loadList(listId, instanceId, { silent: true });
            return;
          }
        }
      }

      const resolveEventInstanceId = (payload: Record<string, unknown>): string => {
        const rawInstance = payload['instance_id'];
        return typeof rawInstance === 'string' && rawInstance.length > 0
          ? rawInstance
          : DEFAULT_INSTANCE_ID;
      };

      const handleAqlApplyEvent = async (payload: Record<string, unknown>): Promise<void> => {
        const eventInstanceId = resolveEventInstanceId(payload);
        const listId = typeof payload['listId'] === 'string' ? payload['listId'].trim() : '';
        const query = typeof payload['query'] === 'string' ? payload['query'] : null;
        if (!listId || query === null) {
          return;
        }
        if (!isKnownInstance(eventInstanceId)) {
          pendingAqlApplyEvent = { listId, instanceId: eventInstanceId, query };
          void refreshInstances({ silent: true });
          return;
        }
        await applyAqlQueryForList(listId, eventInstanceId, query);
      };

      const handleShowEvent = (listId: string, instanceId: string, itemId?: string): void => {
        if (!isKnownInstance(instanceId)) {
          pendingShowEvent = { listId, instanceId, ...(itemId ? { itemId } : {}) };
          void refreshInstances({ silent: true });
          return;
        }
        if (!selectedInstanceIds.includes(instanceId)) {
          setActiveInstances([instanceId, ...selectedInstanceIds]);
        }
        void selectList(listId, instanceId, { focus: false }).then(() => {
          if (itemId) {
            highlightListItem(itemId);
          }
        });
      };

      if (browserButton) {
        browserButton.addEventListener('click', () => {
          setMode('browser');
        });
      }
      if (listButton) {
        listButton.addEventListener('click', () => {
          if (activeListId && activeListInstanceId) {
            void selectList(activeListId, activeListInstanceId, { focus: true });
          } else {
            setMode('browser');
          }
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
        title: 'Lists',
        instanceSelectionMode: 'multi',
        onInstanceChange: (instanceIds) => {
          setActiveInstances(instanceIds);
        },
      });
      chromeController.setInstances(instances, selectedInstanceIds);

      ignoreSearchChange = true;
      const initialSearchInput = sharedSearchController.getSearchInputEl();
      if (initialSearchInput) {
        initialSearchInput.value = searchMode === 'aql' ? aqlQueryText : rawQueryText;
      }
      sharedSearchController.setOnQueryChanged(handleSearchInputChange);
      ignoreSearchChange = false;
      sharedSearchController.setVisible(true);
      registerPanelShortcuts();

      const stored = host.loadPanelState();
      let initialListId: string | null = null;
      let initialMode: ViewMode | null = null;
      let initialInstanceIds: string[] | null = null;
      let initialListInstanceId: string | null = null;
      if (stored && typeof stored === 'object') {
        const data = stored as Record<string, unknown>;
        if (typeof data['selectedListId'] === 'string') {
          initialListId = data['selectedListId'];
        }
        if (typeof data['selectedListInstanceId'] === 'string') {
          initialListInstanceId = data['selectedListInstanceId'];
        }
        if (data['mode'] === 'browser' || data['mode'] === 'list') {
          initialMode = data['mode'] as ViewMode;
        }
        if (data['listViewPrefs']) {
          panelListViewPrefs = normalizeListViewPrefs(data['listViewPrefs']);
        }
        if (data['columnWidths']) {
          const legacyWidths = normalizeColumnWidths(data['columnWidths']);
          panelListViewPrefs = mergeColumnWidthsIntoViewPrefs(panelListViewPrefs, legacyWidths);
        }
        if (data['searchMode'] === 'raw' || data['searchMode'] === 'aql') {
          searchMode = data['searchMode'] as 'raw' | 'aql';
        }
        if (typeof data['rawQueryText'] === 'string') {
          rawQueryText = data['rawQueryText'];
        }
        if (typeof data['aqlQueryText'] === 'string') {
          aqlQueryText = data['aqlQueryText'];
        }
        if (typeof data['aqlAppliedQueryText'] === 'string') {
          aqlAppliedQueryText = data['aqlAppliedQueryText'];
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
          initialListId = null;
          initialListInstanceId = null;
        }
        void refreshLists().then(() => {
          if (activeListId) {
            setMode('list');
            return;
          }
          if (initialListId) {
            const resolvedInstanceId =
              initialListInstanceId ??
              availableLists.find((list) => list.id === initialListId)?.instanceId ??
              activeInstanceId;
            void selectList(initialListId, resolvedInstanceId).then(() => {
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
            void refreshLists({ silent: true });
            chromeController?.scheduleLayoutCheck();
          }
        },
        onFocus: () => {
          void refreshLists({ silent: true });
        },
        onBlur: () => {
        },
        onEvent: (event: PanelEventEnvelope) => {
          const payload = event.payload as Record<string, unknown> | null;
          if (!payload) {
            return;
          }
          const type = payload['type'];
          if (type === 'lists_show') {
            const eventInstanceId = resolveEventInstanceId(payload);
            const listId = typeof payload['listId'] === 'string' ? payload['listId'].trim() : '';
            const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'].trim() : '';
            if (!listId) {
              return;
            }
            handleShowEvent(listId, eventInstanceId, itemId || undefined);
            return;
          }
          if (type === 'lists_aql_apply') {
            void handleAqlApplyEvent(payload);
            return;
          }
          if (type === 'panel_update') {
            void handlePanelUpdate(payload);
          }
        },
        onSessionChange: () => {
          void refreshLists({ silent: true });
        },
        unmount() {
          for (const unsubscribe of panelShortcutUnsubscribers.splice(0)) {
            unsubscribe();
          }
          chromeController?.destroy();
          unsubscribePanelActive?.();
          unsubscribeViewportResize?.();
          host.setContext(contextKey, null);
          if (highlightTimeout) {
            window.clearTimeout(highlightTimeout);
            highlightTimeout = null;
          }
          container.innerHTML = '';
        },
      };
    },
  }));
}
