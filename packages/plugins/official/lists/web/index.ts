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
import { ListColumnPreferencesClient } from '../../../../web-client/src/utils/listColumnPreferences';
import { ICONS } from '../../../../web-client/src/utils/icons';
import { applyTagColorToElement, normalizeTag } from '../../../../web-client/src/utils/tagColors';
import {
  CORE_PANEL_SERVICES_CONTEXT_KEY,
  type PanelCoreServices,
} from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';

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
              <input
                type="text"
                class="panel-chrome-instance-search"
                data-role="instance-search"
                placeholder="Search instances..."
                aria-label="Search instances"
                autocomplete="off"
              />
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
  defaultTags?: string[];
  customFields?: ListCustomFieldDefinition[];
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
    result.push({ key, label, type: type as ListCustomFieldDefinition['type'], options });
  }
  return result.length > 0 ? result : undefined;
}

function parseListSummary(value: unknown): ListSummary | null {
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
  const updatedAt = typeof obj['updatedAt'] === 'string' ? obj['updatedAt'] : undefined;

  return {
    id,
    name,
    description,
    tags: tags.length > 0 ? tags : undefined,
    defaultTags: defaultTags.length > 0 ? defaultTags : undefined,
    customFields,
    updatedAt,
  };
}

function parseListSummaries(value: unknown): ListSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ListSummary[] = [];
  for (const entry of value) {
    const parsed = parseListSummary(entry);
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
    if (!tag) {
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

      const services = resolveServices(host);
      const preferencesLoaded = services.listColumnPreferencesClient.load();

      const sharedSearchController = new CollectionPanelSearchController({
        containerEl: sharedSearchEl,
        icons: { x: ICONS.x },
      });

      const bodyManager = new CollectionPanelBodyManager(panelContent);
      const recentUserItemUpdates = new Set<string>();

      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceId = DEFAULT_INSTANCE_ID;
      let availableLists: ListSummary[] = [];
      let activeListId: string | null = null;
      let activeListSummary: ListSummary | null = null;
      let activeListData: ListPanelData | null = null;
      let mode: ViewMode = 'browser';
      let isVisible = false;
      let isFocused = false;
      let panelKeydownAttached = false;
      let refreshToken = 0;
      let refreshInFlight = false;
      let loadToken = 0;
      let browserController: CollectionBrowserController | null = null;
      let dropdownController: CollectionDropdownController | null = null;
      let chromeController: PanelChromeController | null = null;

      const contextKey = getPanelContextKey(host.panelId());

      const persistState = (): void => {
        host.persistPanelState({
          selectedListId: activeListId,
          mode,
          instanceId: selectedInstanceId,
        });
      };

      const callInstanceOperation = async <T>(
        operation: string,
        body: Record<string, unknown>,
      ): Promise<T> =>
        callOperation(operation, {
          ...body,
          instance_id: selectedInstanceId,
        });

      const getAvailableItems = (): CollectionItemSummary[] =>
        availableLists.map((list) => ({
          type: 'list',
          id: list.id,
          name: list.name,
          tags: list.tags,
          updatedAt: list.updatedAt,
        }));

      const getActiveReference = (): CollectionReference | null =>
        activeListId ? { type: 'list', id: activeListId } : null;

      const updateDropdownSelection = (reference: CollectionReference | null): void => {
        if (!dropdownTriggerText) {
          return;
        }
        if (!reference) {
          dropdownTriggerText.textContent = 'Select a list...';
          chromeController?.scheduleLayoutCheck();
          return;
        }
        const list = availableLists.find((entry) => entry.id === reference.id) ?? activeListSummary;
        dropdownTriggerText.textContent = list?.name ?? 'Select a list...';
        chromeController?.scheduleLayoutCheck();
      };

      const getInstanceLabel = (instanceId: string): string => {
        const match = instances.find((instance) => instance.id === instanceId);
        return match?.label ?? formatInstanceLabel(instanceId);
      };

      const updatePanelMetadata = (): void => {
        if (selectedInstanceId === DEFAULT_INSTANCE_ID) {
          host.setPanelMetadata({ title: 'Lists' });
          return;
        }
        host.setPanelMetadata({ title: `Lists (${getInstanceLabel(selectedInstanceId)})` });
      };

      const renderInstanceSelect = (): void => {
        chromeController?.setInstances(instances, selectedInstanceId);
      };

      const setActiveInstance = (instanceId: string): void => {
        if (instanceId === selectedInstanceId) {
          return;
        }
        selectedInstanceId = instanceId;
        availableLists = [];
        activeListId = null;
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
        const contextAttributes: Record<string, string> = {
          'instance-id': selectedInstanceId,
        };
        if (!activeListSummary) {
          host.setContext(contextKey, {
            instance_id: selectedInstanceId,
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
          instance_id: selectedInstanceId,
          description: activeListSummary.description ?? activeListData?.description ?? '',
          tags: activeListSummary.tags ?? [],
          selectedItemIds,
          selectedItems,
          selectedItemCount: selectedItemIds.length,
          contextAttributes,
        });
        services.notifyContextAvailabilityChange();
      };

      const handlePanelKeydown = (event: KeyboardEvent): void => {
        if (!isVisible || !isFocused) {
          return;
        }
        if (services.dialogManager.hasOpenDialog) {
          return;
        }
        if (mode !== 'list' || !activeListId) {
          return;
        }
        if (!event.ctrlKey || !event.metaKey || !event.shiftKey) {
          return;
        }
        if (event.key.toLowerCase() !== 'n') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        listPanelController.openAddItemDialog(activeListId);
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

      const listPanelController = new ListPanelController({
        bodyEl: panelContent,
        getSearchQuery: () => sharedSearchController.getQuery(),
        getSearchTagController: () => sharedSearchController.getTagController(),
        callOperation: (operation, args) => callInstanceOperation(operation, args),
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
        getMoveTargetLists: () =>
          availableLists.map((list) => ({
            id: list.id,
            name: list.name,
          })),
        openListMetadataDialog: (listId, data) => {
          browserController?.openListMetadataEditor(listId, data);
        },
        getListColumnPreferences: (listId) =>
          services.listColumnPreferencesClient.getListPreferences(listId),
        updateListColumnPreferences: (listId, columnKey, patch) => {
          void services.listColumnPreferencesClient.updateColumn(listId, columnKey, patch);
        },
        getSortState: (listId) => services.listColumnPreferencesClient.getSortState(listId),
        updateSortState: (listId, sortState) => {
          void services.listColumnPreferencesClient.updateSortState(listId, sortState);
        },
        getTimelineField: (listId) => services.listColumnPreferencesClient.getTimelineField(listId),
        updateTimelineField: (listId, timelineField) => {
          void services.listColumnPreferencesClient.updateTimelineField(listId, timelineField);
        },
        getFocusMarkerItemId: (listId) =>
          services.listColumnPreferencesClient.getFocusMarkerItemId(listId),
        getFocusMarkerExpanded: (listId) =>
          services.listColumnPreferencesClient.getFocusMarkerExpanded(listId),
        updateFocusMarker: (listId, focusMarkerItemId, focusMarkerExpanded) => {
          void services.listColumnPreferencesClient.updateFocusMarker(
            listId,
            focusMarkerItemId,
            focusMarkerExpanded,
          );
        },
        updateFocusMarkerExpanded: (listId, focusMarkerExpanded) => {
          void services.listColumnPreferencesClient.updateFocusMarkerExpanded(
            listId,
            focusMarkerExpanded,
          );
        },
        setRightControls: (elements) => {
          sharedSearchController.setRightControls(elements);
        },
      });

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
          void selectList(item.id, { focus: false });
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
        },
        listApi: {
          getList: async (listId) => {
            const raw = await callInstanceOperation<unknown>('get', { id: listId });
            const list = parseListSummary(raw);
            if (!list) {
              return null;
            }
            return {
              id: list.id,
              name: list.name,
              description: list.description ?? '',
              tags: list.tags ?? [],
              defaultTags: list.defaultTags ?? [],
              customFields: list.customFields ?? [],
            };
          },
          createList: async (payload) => {
            const result = await callInstanceOperation<unknown>('create', buildListArgs(payload));
            const list = parseListSummary(result);
            return list?.id ?? null;
          },
          updateList: async (listId, payload) => {
            await callInstanceOperation('update', {
              id: listId,
              ...buildListArgs(payload, { includeEmpty: true }),
            });
            return true;
          },
          deleteList: async (listId) => {
            await callInstanceOperation('delete', { id: listId });
            return true;
          },
        },
        fetchPreview: async (itemType, itemId) => {
          if (itemType !== 'list') {
            return null;
          }
          try {
            return await fetchListPreview(itemId, callInstanceOperation);
          } catch (err) {
            console.error('Failed to load list preview', err);
            return null;
          }
        },
        viewModeStorageKey: 'aiAssistantListsBrowserViewMode',
        sortModeStorageKey: 'aiAssistantListsBrowserSortMode',
        openNoteEditor: () => undefined,
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
          void selectList(item.id, { focus: false });
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
          if (type !== 'list' || !listId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void selectList(listId, { focus: false });
        });
      }

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
          const controls = browserController
            ? browserController.getSharedSearchRightControls()
            : [];
          sharedSearchController.setRightControls(controls.length > 0 ? controls : null);
          browserController?.show(false);
        } else {
          if (!activeListData) {
            sharedSearchController.setRightControls(null);
          }
          sharedSearchController.setPlaceholder('Search items...');
          sharedSearchController.setTagsProvider(() => listPanelController.getAvailableTags());
          sharedSearchController.setKeydownHandler(null);
        }
        sharedSearchController.setVisible(true);
        applySearch(sharedSearchController.getQuery());
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
          const hasSelected = instances.some((instance) => instance.id === selectedInstanceId);
          if (!hasSelected) {
            selectedInstanceId = DEFAULT_INSTANCE_ID;
            availableLists = [];
            activeListId = null;
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
          const raw = await callInstanceOperation<unknown>('list', {});
          if (currentToken !== refreshToken) {
            return;
          }
          availableLists = parseListSummaries(raw);
          dropdownController?.populate(getAvailableItems());
          browserController?.refresh();
          if (activeListId) {
            const updated = availableLists.find((list) => list.id === activeListId);
            if (updated) {
              activeListSummary = updated;
              updatePanelContext();
            }
          }
          if (activeListId && !availableLists.some((list) => list.id === activeListId)) {
            activeListId = null;
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

      async function loadList(listId: string, options?: { silent?: boolean }): Promise<void> {
        const currentToken = ++loadToken;
        bodyManager.renderLoading({ type: 'list', id: listId });
        try {
          const rawList = await callInstanceOperation<unknown>('get', { id: listId });
          const list = parseListSummary(rawList);
          if (!list) {
            throw new Error('List not found');
          }
          const rawItems = await callInstanceOperation<unknown>('items-list', {
            listId,
            limit: 0,
            sort: 'position',
          });
          if (currentToken !== loadToken) {
            return;
          }
          const items = parseListItems(rawItems);
          const data: ListPanelData = {
            id: list.id,
            name: list.name,
            description: list.description,
            tags: list.tags,
            defaultTags: list.defaultTags,
            customFields: list.customFields,
            items,
          };
          activeListId = list.id;
          activeListSummary = list;
          activeListData = data;
          updateDropdownSelection({ type: 'list', id: list.id });
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

      async function selectList(listId: string, options?: { focus?: boolean }): Promise<void> {
        if (!listId) {
          return;
        }
        if (activeListId === listId && activeListData) {
          updateDropdownSelection({ type: 'list', id: listId });
          const controls = listPanelController.render(listId, activeListData);
          sharedSearchController.setRightControls(controls.rightControls);
          updatePanelContext();
          setMode('list');
          return;
        }
        await loadList(listId);
        if (options?.focus) {
          sharedSearchController.focus(false);
        }
      }

      const updateAvailableList = (list: ListSummary): void => {
        const index = availableLists.findIndex((entry) => entry.id === list.id);
        if (index >= 0) {
          availableLists[index] = list;
        } else {
          availableLists.push(list);
        }
      };

      const removeAvailableList = (listId: string): void => {
        availableLists = availableLists.filter((entry) => entry.id !== listId);
      };

      const refreshListBrowser = (): void => {
        dropdownController?.populate(getAvailableItems());
        dropdownController?.refreshFilter();
        browserController?.refresh();
        updateDropdownSelection(getActiveReference());
      };

      const updateListUpdatedAt = (listId: string, updatedAt: string | undefined): void => {
        if (!updatedAt) {
          return;
        }
        const index = availableLists.findIndex((entry) => entry.id === listId);
        if (index === -1) {
          return;
        }
        const entry = availableLists[index];
        if (entry) {
          availableLists[index] = { ...entry, updatedAt };
        }
      };

      const updateActiveListMetadata = (list: ListSummary): void => {
        if (activeListId !== list.id) {
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

        const refresh = payload['refresh'] === true;
        const listSummary = parseListSummary(payload['list']);
        const item = parseListItem(payload['item']);
        const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'].trim() : '';

        let listsChanged = false;

        if (listSummary) {
          updateAvailableList(listSummary);
          updateActiveListMetadata(listSummary);
          listsChanged = true;
        } else if (action === 'list_deleted') {
          removeAvailableList(listId);
          listsChanged = true;
        }

        if (item?.updatedAt) {
          updateListUpdatedAt(listId, item.updatedAt);
          listsChanged = true;
        }

        if (action === 'list_deleted' && activeListId === listId) {
          activeListId = null;
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
          browserController?.invalidatePreview({ type: 'list', id: listId });
        }

        if (activeListId !== listId || !activeListData) {
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
            await loadList(listId, { silent: true });
            return;
          }
          if (action === 'item_updated' && item) {
            if (mode === 'list') {
              const handled = listPanelController.applyItemUpdate(item);
              if (!handled) {
                await loadList(listId, { silent: true });
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
            await loadList(listId, { silent: true });
            return;
          }
          if (action === 'item_added' && item) {
            await loadList(listId, { silent: true });
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

      if (browserButton) {
        browserButton.addEventListener('click', () => {
          setMode('browser');
        });
      }
      if (listButton) {
        listButton.addEventListener('click', () => {
          if (activeListId) {
            void selectList(activeListId, { focus: true });
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
        onInstanceChange: (instanceId) => {
          setActiveInstance(instanceId);
        },
      });
      chromeController.setInstances(instances, selectedInstanceId);

      sharedSearchController.setOnQueryChanged(applySearch);
      sharedSearchController.setVisible(true);

      const stored = host.loadPanelState();
      let initialListId: string | null = null;
      let initialMode: ViewMode | null = null;
      let initialInstanceId: string | null = null;
      if (stored && typeof stored === 'object') {
        const data = stored as Record<string, unknown>;
        if (typeof data['selectedListId'] === 'string') {
          initialListId = data['selectedListId'];
        }
        if (data['mode'] === 'browser' || data['mode'] === 'list') {
          initialMode = data['mode'] as ViewMode;
        }
        if (typeof data['instanceId'] === 'string') {
          selectedInstanceId = data['instanceId'];
          initialInstanceId = data['instanceId'];
        }
      }

      // Wait for preferences to load before initializing list view
      void preferencesLoaded.then(() => {
        void refreshInstances({ silent: true }).then(() => {
          if (initialInstanceId && initialInstanceId !== selectedInstanceId) {
            initialListId = null;
          }
          void refreshLists().then(() => {
            if (initialListId) {
              void selectList(initialListId).then(() => {
                if (initialMode) {
                  setMode(initialMode);
                }
              });
              return;
            }
            setMode('browser');
          });
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
          isFocused = true;
          attachPanelShortcuts();
          void refreshLists({ silent: true });
        },
        onBlur: () => {
          isFocused = false;
          detachPanelShortcuts();
        },
        onEvent: (event: PanelEventEnvelope) => {
          const payload = event.payload as Record<string, unknown> | null;
          if (!payload) {
            return;
          }
          const type = payload['type'];
          if (type === 'lists_show') {
            const eventInstanceId = resolveEventInstanceId(payload);
            if (eventInstanceId !== selectedInstanceId) {
              return;
            }
            const listId = typeof payload['listId'] === 'string' ? payload['listId'].trim() : '';
            if (!listId) {
              return;
            }
            void selectList(listId, { focus: true });
            return;
          }
          if (type === 'panel_update') {
            const eventInstanceId = resolveEventInstanceId(payload);
            if (eventInstanceId !== selectedInstanceId) {
              return;
            }
            void handlePanelUpdate(payload);
          }
        },
        onSessionChange: () => {
          void refreshLists({ silent: true });
        },
        unmount() {
          detachPanelShortcuts();
          chromeController?.destroy();
          host.setContext(contextKey, null);
          container.innerHTML = '';
        },
      };
    },
  }));
}
