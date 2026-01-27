// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CollectionBrowserController,
  type CollectionPreviewCacheEntry,
} from './collectionBrowserController';
import { DialogManager } from './dialogManager';
import { CollectionPanelSearchController } from './collectionPanelSearchController';

describe('CollectionBrowserController list CRUD UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeController(
    overrides?: Partial<ConstructorParameters<typeof CollectionBrowserController>[0]>,
  ) {
    const containerEl = document.createElement('div');
    const sharedSearchHost = document.createElement('div');
    document.body.appendChild(sharedSearchHost);
    const sharedSearchController = new CollectionPanelSearchController({
      containerEl: sharedSearchHost,
      icons: { x: 'x' },
    });
    const options: ConstructorParameters<typeof CollectionBrowserController>[0] = {
      containerEl,
      getAvailableItems: () => [],
      getSupportedTypes: () => ['list'],
      getAllTags: () => [],
      getGroupLabel: (type) => (type.toLowerCase() === 'list' ? 'Lists' : 'Other'),
      getActiveItemReference: () => null,
      selectItem: vi.fn(),
      refreshItems: vi.fn(async () => {}),
      dialogManager: new DialogManager(),
      icons: {
        plus: '',
        edit: '',
        chevronDown: '',
        clock: '',
        sortAlpha: '',
        fileText: '',
        list: '',
        pin: '',
        favorite: '',
      },
      viewModeStorageKey: 'collectionBrowserTestViewMode',
      sortModeStorageKey: 'collectionBrowserTestSortMode',
      openNoteEditor: vi.fn(),
      ...overrides,
    };
    const controller = new CollectionBrowserController(options);
    return { controller, containerEl, options, sharedSearchController };
  }

  it('renders a simple Add button when only lists are supported', () => {
    const { controller, containerEl } = makeController();
    controller.show(false);

    // Check for simple add button (no dropdown menu)
    const addBtn = containerEl.querySelector<HTMLButtonElement>('.collection-browser-add-button');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.classList.contains('collection-browser-add-button--simple')).toBe(true);

    // No dropdown menu should be present
    const addMenu = containerEl.querySelector<HTMLElement>('.collection-browser-add-menu');
    expect(addMenu).toBeNull();
  });

  it('renders an Add dropdown with Note and List options when both types are supported', () => {
    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['note', 'list'],
    });
    controller.show(false);

    // Check for add dropdown button
    const addBtn = containerEl.querySelector<HTMLButtonElement>('.collection-browser-add-button');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.classList.contains('collection-browser-add-button--simple')).toBe(false);

    // Check for dropdown menu with both options
    const menuItems = containerEl.querySelectorAll<HTMLButtonElement>(
      '.collection-browser-add-menu-item',
    );
    expect(menuItems.length).toBe(2);
  });

  it('adds an edit affordance to list items and does not select on edit click', async () => {
    const selectItem = vi.fn();
    const { controller, containerEl } = makeController({
      getAvailableItems: () => [
        { type: 'list', id: 'list1', name: 'List 1', tags: ['a'] },
        { type: 'note', id: 'note1', name: 'Note 1' },
      ],
      selectItem,
      listApi: {
        getList: async () => ({
          id: 'list1',
          name: 'List 1',
          description: 'desc',
          tags: ['a'],
          items: [{ title: 'Item 1' }, { title: 'Item 2' }],
        }),
      },
    });
    controller.show(false);

    const listItem = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="list1"]',
    );
    expect(listItem).not.toBeNull();

    const editEl = listItem?.querySelector<HTMLElement>('.collection-browser-item-edit');
    expect(editEl).not.toBeNull();

    editEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selectItem).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.querySelector('.list-metadata-dialog-overlay')).not.toBeNull();
  });

  it('renders note and list previews in cards view', async () => {
    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['list', 'note'],
      getGroupLabel: (type) => {
        const lowered = type.toLowerCase();
        if (lowered === 'list') return 'Lists';
        if (lowered === 'note') return 'Notes';
        return 'Other';
      },
      getAvailableItems: () => [
        { type: 'note', id: 'note1', name: 'Note 1', tags: ['t1', 't2'] },
        { type: 'list', id: 'list1', name: 'List 1', tags: ['alpha'] },
      ],
      fetchPreview: async (itemType, itemId) => {
        if (itemType === 'note' && itemId === 'note1') {
          return {
            kind: 'note',
            content: '# Heading\n\nHello **world**.\nSecond line.',
          };
        }
        if (itemType === 'list' && itemId === 'list1') {
          return {
            kind: 'list',
            items: [
              { title: 'First', position: 1, completed: false, tags: [] },
              { title: 'Second', position: 2, completed: false, tags: [] },
              { title: 'Third', position: 3, completed: false, tags: [] },
              { title: 'Fourth', position: 4, completed: false, tags: [] },
            ],
          };
        }
        return null;
      },
    });

    controller.show(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const noteEl = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type="note"][data-collection-id="note1"] .collection-browser-item-preview',
    );
    expect(noteEl).not.toBeNull();
    expect(noteEl?.textContent).toContain('Hello');
    expect(noteEl?.textContent).toContain('Second line');

    const listPreviewItems = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id="list1"] .collection-browser-item-preview-list li',
      ),
    ).map((el) => el.textContent);
    expect(listPreviewItems).toEqual(['First', 'Second', 'Third', 'Fourth']);

    const noteTags = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-type="note"][data-collection-id="note1"] .collection-browser-item-tag',
      ),
    ).map((el) => el.textContent);
    expect(noteTags).toEqual(['t1', 't2']);

    const listTags = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id="list1"] .collection-browser-item-tag',
      ),
    ).map((el) => el.textContent);
    expect(listTags).toEqual(['alpha']);
  });

  it('creates a list via simple add button when only lists are supported', async () => {
    const refreshItems = vi.fn(async () => {});
    const selectItem = vi.fn(async () => {});

    const { controller, containerEl } = makeController({
      refreshItems,
      selectItem,
      listApi: {
        createList: async () => 'new-list',
      },
    });
    controller.show(false);

    // Click the simple add button (no dropdown)
    const addBtn = containerEl.querySelector<HTMLButtonElement>('.collection-browser-add-button');
    expect(addBtn).not.toBeNull();
    expect(addBtn?.classList.contains('collection-browser-add-button--simple')).toBe(true);
    addBtn?.click();

    const overlay = document.body.querySelector<HTMLElement>('.list-metadata-dialog-overlay');
    expect(overlay).not.toBeNull();

    const inputs = overlay?.querySelectorAll<HTMLInputElement>('.list-item-form-input') ?? [];
    const nameInput = inputs[0];
    expect(nameInput).not.toBeUndefined();
    if (nameInput) {
      nameInput.value = 'My List';
    }

    const form = overlay?.querySelector<HTMLFormElement>('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshItems).toHaveBeenCalledTimes(1);
    expect(selectItem).toHaveBeenCalledWith({
      type: 'list',
      id: 'new-list',
    });
  });

  it('creates a list via dropdown menu when both types are supported', async () => {
    const refreshItems = vi.fn(async () => {});
    const selectItem = vi.fn(async () => {});

    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['note', 'list'],
      refreshItems,
      selectItem,
      listApi: {
        createList: async () => 'new-list',
      },
    });
    controller.show(false);

    // Open the add dropdown menu
    const addBtn = containerEl.querySelector<HTMLButtonElement>('.collection-browser-add-button');
    expect(addBtn).not.toBeNull();
    addBtn?.click();

    // Click the List menu item
    const listMenuItem = Array.from(
      containerEl.querySelectorAll<HTMLButtonElement>('.collection-browser-add-menu-item'),
    ).find((el) => el.textContent?.includes('List'));
    expect(listMenuItem).not.toBeUndefined();
    listMenuItem?.click();

    const overlay = document.body.querySelector<HTMLElement>('.list-metadata-dialog-overlay');
    expect(overlay).not.toBeNull();

    const inputs = overlay?.querySelectorAll<HTMLInputElement>('.list-item-form-input') ?? [];
    const nameInput = inputs[0];
    expect(nameInput).not.toBeUndefined();
    if (nameInput) {
      nameInput.value = 'My List';
    }

    const form = overlay?.querySelector<HTMLFormElement>('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshItems).toHaveBeenCalledTimes(1);
    expect(selectItem).toHaveBeenCalledWith({
      type: 'list',
      id: 'new-list',
    });
  });

  it('sorts items by last updated and persists the choice', () => {
    window.localStorage.setItem('collectionBrowserTestSortMode', 'updated');

    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['note'],
      getGroupLabel: () => 'Notes',
      getAvailableItems: () => [
        {
          type: 'note',
          id: 'older',
          name: 'A Note',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          type: 'note',
          id: 'newer',
          name: 'Z Note',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    controller.show(false);

    const ids = () =>
      Array.from(
        containerEl.querySelectorAll<HTMLElement>(
          '.collection-search-dropdown-item[data-collection-type="note"]',
        ),
      )
        .map((el) => el.dataset['collectionId'])
        .filter((id): id is string => typeof id === 'string');

    expect(ids()).toEqual(['newer', 'older']);

    const alphaBtn = containerEl.querySelector<HTMLButtonElement>(
      '.collection-browser-view-button[aria-label="Sort alphabetically"]',
    );
    expect(alphaBtn).not.toBeNull();
    alphaBtn?.click();

    expect(window.localStorage.getItem('collectionBrowserTestSortMode')).toBe('alpha');
    expect(ids()).toEqual(['older', 'newer']);
  });

  it('searches note content and list items, and filters list card preview items', async () => {
    const { controller, containerEl, sharedSearchController } = makeController({
      getSupportedTypes: () => ['list', 'note'],
      getGroupLabel: (type) => {
        const lowered = type.toLowerCase();
        if (lowered === 'list') return 'Lists';
        if (lowered === 'note') return 'Notes';
        return 'Other';
      },
      getAvailableItems: () => [
        { type: 'note', id: 'n1', name: 'Journal' },
        { type: 'list', id: 'l1', name: 'Groceries' },
      ],
      fetchPreview: async (itemType, itemId) => {
        if (itemType === 'note' && itemId === 'n1') {
          return { kind: 'note', content: 'Today I bought milk.\nAnd bread.' };
        }
        if (itemType === 'list' && itemId === 'l1') {
          return {
            kind: 'list',
            items: [
              { title: 'Milk', position: 1, tags: ['urgent'], completed: false },
              { title: 'Bread', position: 2, tags: [], completed: false },
            ],
          };
        }
        return null;
      },
    });

    controller.show(false);

    controller.setSharedSearchElements({
      searchInput: sharedSearchController.getSearchInputEl(),
      tagController: sharedSearchController.getTagController(),
      tagsContainer: sharedSearchController.getTagsContainerEl(),
      activeTagsContainer: null,
    });
    sharedSearchController.setTagsProvider(() => controller.getAllKnownTags());
    sharedSearchController.setOnQueryChanged((query) => controller.applySearchQuery(query));

    const search = sharedSearchController.getSearchInputEl();
    expect(search).not.toBeNull();

    if (!search) return;
    search.value = 'milk';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const noteEl = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type="note"][data-collection-id="n1"]',
    );
    const listEl = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id="l1"]',
    );
    expect(noteEl).not.toBeNull();
    expect(listEl).not.toBeNull();
    expect(noteEl?.style.display).not.toBe('none');
    expect(listEl?.style.display).not.toBe('none');

    await new Promise((resolve) => setTimeout(resolve, 0));

    const listPreviewItems = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id="l1"] .collection-browser-item-preview-list li',
      ),
    ).map((el) => el.textContent);
    expect(listPreviewItems).toEqual(['Milk']);

    search.value = '@urgent ';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(noteEl?.style.display).toBe('none');
    expect(listEl?.style.display).not.toBe('none');
  });

  it('applies search when shared search elements are set before showing', async () => {
    const { controller, containerEl, sharedSearchController } = makeController({
      getAvailableItems: () => [
        { type: 'list', id: 'l1', name: 'Alpha' },
        { type: 'list', id: 'l2', name: 'Beta' },
      ],
    });

    controller.setSharedSearchElements({
      searchInput: sharedSearchController.getSearchInputEl(),
      tagController: sharedSearchController.getTagController(),
      tagsContainer: sharedSearchController.getTagsContainerEl(),
      activeTagsContainer: null,
    });
    sharedSearchController.setTagsProvider(() => controller.getAllKnownTags());
    sharedSearchController.setOnQueryChanged((query) => controller.applySearchQuery(query));

    controller.show(false);

    const search = sharedSearchController.getSearchInputEl();
    expect(search).not.toBeNull();
    if (!search) return;

    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alpha = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l1"]',
    );
    const beta = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l2"]',
    );
    expect(alpha?.style.display).not.toBe('none');
    expect(beta?.style.display).toBe('none');
  });

  it('invalidates list preview on updates so browser reflects reorders', async () => {
    const responses: Record<'before' | 'after', CollectionPreviewCacheEntry> = {
      before: {
        kind: 'list',
        items: [
          { title: 'First', position: 2, completed: false, tags: [] },
          { title: 'Second', position: 1, completed: false, tags: [] },
        ],
      },
      after: {
        kind: 'list',
        items: [
          { title: 'First', position: 1, completed: false, tags: [] },
          { title: 'Second', position: 2, completed: false, tags: [] },
        ],
      },
    };
    let mode: 'before' | 'after' = 'before';

    const fetchPreview = vi.fn(async () => responses[mode]);

    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['list'],
      getGroupLabel: () => 'Lists',
      getAvailableItems: () => [{ type: 'list', id: 'l1', name: 'Groceries' }],
      fetchPreview,
    });

    controller.show(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const listPreviewItems = () =>
      Array.from(
        containerEl.querySelectorAll<HTMLElement>(
          '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id="l1"] .collection-browser-item-preview-list li',
        ),
      ).map((el) => el.textContent);

    expect(listPreviewItems()).toEqual(['Second', 'First']);

    mode = 'after';
    controller.invalidatePreview({ type: 'list', id: 'l1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listPreviewItems()).toEqual(['First', 'Second']);
    expect(fetchPreview).toHaveBeenCalledTimes(2);
  });

  it('supports !@tag to exclude list items without hiding the list (unless list tag matches)', async () => {
    const fetchPreview = vi.fn(
      async (
        _type: 'list' | 'note',
        itemId: string,
      ): Promise<CollectionPreviewCacheEntry | null> => {
        if (itemId === 'l1') {
          return {
            kind: 'list',
            items: [{ title: 'Done 1', tags: ['done'], position: 1, completed: false }],
          };
        }
        if (itemId === 'l2') {
          return {
            kind: 'list',
            items: [
              { title: 'Keep me', tags: ['work'], position: 1, completed: false },
              { title: 'Done 2', tags: ['done'], position: 2, completed: false },
            ],
          };
        }
        if (itemId === 'l3') {
          return {
            kind: 'list',
            items: [{ title: 'Keep', tags: ['work'], position: 1, completed: false }],
          };
        }
        return null;
      },
    );

    const { controller, containerEl, sharedSearchController } = makeController({
      getSupportedTypes: () => ['list'],
      getGroupLabel: () => 'Lists',
      getAvailableItems: () => [
        { type: 'list', id: 'l1', name: 'All done' },
        { type: 'list', id: 'l2', name: 'Mixed' },
        { type: 'list', id: 'l3', name: 'Tagged done', tags: ['done'] },
      ],
      fetchPreview,
    });

    controller.show(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.setSharedSearchElements({
      searchInput: sharedSearchController.getSearchInputEl(),
      tagController: sharedSearchController.getTagController(),
      tagsContainer: sharedSearchController.getTagsContainerEl(),
      activeTagsContainer: null,
    });
    sharedSearchController.setTagsProvider(() => controller.getAllKnownTags());
    sharedSearchController.setOnQueryChanged((query) => controller.applySearchQuery(query));

    const search = sharedSearchController.getSearchInputEl();
    expect(search).not.toBeNull();
    if (!search) return;

    search.value = '!@done ';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const l1 = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l1"]',
    );
    const l2 = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l2"]',
    );
    const l3 = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l3"]',
    );
    expect(l1?.style.display).not.toBe('none');
    expect(l2?.style.display).not.toBe('none');
    expect(l3?.style.display).toBe('none');

    const l1Preview = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-id="l1"] .collection-browser-item-preview-list li',
      ),
    ).map((el) => el.textContent);
    expect(l1Preview).toEqual([]);

    const l2Preview = Array.from(
      containerEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-id="l2"] .collection-browser-item-preview-list li',
      ),
    ).map((el) => el.textContent);
    expect(l2Preview).toEqual(['Keep me']);
  });

  it('renders instance badges when enabled', () => {
    const { controller, containerEl } = makeController({
      getSupportedTypes: () => ['list'],
      getAvailableItems: () => [
        {
          type: 'list',
          id: 'l1',
          name: 'Work list',
          instanceId: 'work',
          instanceLabel: 'Work',
        },
      ],
      shouldShowInstanceBadge: () => true,
    });

    controller.show(false);

    const badge = containerEl.querySelector<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-id="l1"] .collection-browser-item-badge',
    );
    expect(badge?.textContent).toBe('Work');
  });
});
