// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DialogManager } from './dialogManager';
import type { SearchApiResult } from './commandPaletteController';
import {
  getListItemSearchRef,
  isListItemSearchResult,
  promptAndMoveListItemFromSearch,
} from './searchListItemMove';

const createDialogManager = (): DialogManager =>
  ({
    hasOpenDialog: false,
    showConfirmDialog: vi.fn(),
    showTextInputDialog: vi.fn(),
    registerExternalDialog: vi.fn(),
    releaseExternalDialog: vi.fn(),
    closeOpenDialog: vi.fn(),
  }) as unknown as DialogManager;

const listItemResult = (overrides?: Partial<SearchApiResult>): SearchApiResult => ({
  pluginId: 'lists',
  instanceId: 'default',
  id: 'item-1',
  title: 'Buy milk',
  subtitle: 'Groceries',
  launch: {
    panelType: 'lists',
    payload: {
      type: 'lists_show',
      instance_id: 'default',
      listId: 'groceries',
      itemId: 'item-1',
    },
  },
  ...overrides,
});

describe('searchListItemMove', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('identifies list item search results', () => {
    expect(isListItemSearchResult(listItemResult())).toBe(true);
    expect(
      isListItemSearchResult({
        pluginId: 'lists',
        instanceId: 'default',
        id: 'list:groceries',
        title: 'Groceries',
        launch: {
          panelType: 'lists',
          payload: { type: 'lists_show', listId: 'groceries' },
        },
      }),
    ).toBe(false);
    expect(
      isListItemSearchResult({
        pluginId: 'notes',
        instanceId: 'default',
        id: 'note-1',
        title: 'A note',
        launch: {
          panelType: 'notes',
          payload: { type: 'notes_show', title: 'A note' },
        },
      }),
    ).toBe(false);
  });

  it('extracts item/list/instance from the launch payload', () => {
    expect(getListItemSearchRef(listItemResult())).toEqual({
      itemId: 'item-1',
      listId: 'groceries',
      instanceId: 'default',
    });
    expect(
      getListItemSearchRef(
        listItemResult({
          instanceId: 'home',
          launch: {
            panelType: 'lists',
            payload: {
              type: 'lists_show',
              instance_id: 'work',
              listId: 'tasks',
              itemId: 'item-9',
            },
          },
        }),
      ),
    ).toEqual({
      itemId: 'item-9',
      listId: 'tasks',
      instanceId: 'work',
    });
  });

  it('prompts for a list and moves the item via the lists API', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { id: 'groceries', name: 'Groceries' },
              { id: 'today', name: 'Today' },
              { id: 'work', name: 'Work' },
            ],
          }),
        };
      }
      if (url.endsWith('/item-move')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: { id: 'item-1', listId: 'today' },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof import('../utils/api').apiFetch;

    const promise = promptAndMoveListItemFromSearch({
      result: listItemResult(),
      dialogManager: createDialogManager(),
      setStatus,
      fetchImpl,
    });

    await vi.waitFor(() => {
      expect(document.querySelector('.list-selection-dialog')).not.toBeNull();
    });

    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-selection-item'),
    );
    // Source list excluded
    expect(items.map((item) => item.dataset['listId'])).toEqual(['today', 'work']);

    const today = items.find((item) => item.dataset['listId'] === 'today');
    today?.click();
    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary')?.click();

    await expect(promise).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/plugins/lists/operations/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ instance_id: 'default' }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/plugins/lists/operations/item-move',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          instance_id: 'default',
          id: 'item-1',
          targetListId: 'today',
        }),
      }),
    );
    expect(setStatus).toHaveBeenCalledWith('Loading lists…');
    expect(setStatus).toHaveBeenCalledWith('Moved "Buy milk" to "Today"');
  });

  it('reports when no other lists are available', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: [{ id: 'groceries', name: 'Groceries' }],
      }),
    })) as unknown as typeof import('../utils/api').apiFetch;

    await expect(
      promptAndMoveListItemFromSearch({
        result: listItemResult(),
        dialogManager: createDialogManager(),
        setStatus,
        fetchImpl,
      }),
    ).resolves.toBe(false);

    expect(setStatus).toHaveBeenCalledWith('No other lists available');
    expect(document.querySelector('.list-selection-dialog')).toBeNull();
  });

  it('returns false when the picker is cancelled', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: [
          { id: 'groceries', name: 'Groceries' },
          { id: 'today', name: 'Today' },
        ],
      }),
    })) as unknown as typeof import('../utils/api').apiFetch;

    const promise = promptAndMoveListItemFromSearch({
      result: listItemResult(),
      dialogManager: createDialogManager(),
      setStatus,
      fetchImpl,
    });

    await vi.waitFor(() => {
      expect(document.querySelector('.list-selection-dialog')).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.cancel')?.click();
    await expect(promise).resolves.toBe(false);
    expect(setStatus).toHaveBeenCalledWith('Loading lists…');
    expect(setStatus).not.toHaveBeenCalledWith(expect.stringContaining('Moved'));
  });

  it('rejects non-list-item results', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn();

    await expect(
      promptAndMoveListItemFromSearch({
        result: {
          pluginId: 'notes',
          instanceId: 'default',
          id: 'note-1',
          title: 'A note',
          launch: {
            panelType: 'notes',
            payload: { type: 'notes_show', title: 'A note' },
          },
        },
        dialogManager: createDialogManager(),
        setStatus,
        fetchImpl: fetchImpl as unknown as typeof import('../utils/api').apiFetch,
      }),
    ).resolves.toBe(false);

    expect(setStatus).toHaveBeenCalledWith('Move to list is only available for list items');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults instanceId when payload and result omit it', () => {
    expect(
      getListItemSearchRef({
        pluginId: 'lists',
        instanceId: '',
        id: 'item-2',
        title: 'Milk',
        launch: {
          panelType: 'lists',
          payload: {
            type: 'lists_show',
            listId: 'groceries',
            itemId: 'item-2',
          },
        },
      }),
    ).toEqual({
      itemId: 'item-2',
      listId: 'groceries',
      instanceId: 'default',
    });
  });

  it('reports when loading destination lists fails', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })) as unknown as typeof import('../utils/api').apiFetch;

    await expect(
      promptAndMoveListItemFromSearch({
        result: listItemResult(),
        dialogManager: createDialogManager(),
        setStatus,
        fetchImpl,
      }),
    ).resolves.toBe(false);

    expect(setStatus).toHaveBeenCalledWith('Loading lists…');
    expect(setStatus).toHaveBeenCalledWith('Failed to load lists');
    expect(document.querySelector('.list-selection-dialog')).toBeNull();
  });

  it('reports when the item-move API fails', async () => {
    const setStatus = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { id: 'groceries', name: 'Groceries' },
              { id: 'today', name: 'Today' },
            ],
          }),
        };
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'move failed' }),
      };
    }) as unknown as typeof import('../utils/api').apiFetch;

    const promise = promptAndMoveListItemFromSearch({
      result: listItemResult(),
      dialogManager: createDialogManager(),
      setStatus,
      fetchImpl,
    });

    await vi.waitFor(() => {
      expect(document.querySelector('.list-selection-dialog')).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary')?.click();
    await expect(promise).resolves.toBe(false);
    expect(setStatus).toHaveBeenCalledWith('Failed to move item');
  });
});
