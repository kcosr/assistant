import { apiFetch } from '../utils/api';
import type { DialogManager } from './dialogManager';
import { openListSelectionDialog, type ListSelectionItem } from './listSelectionDialog';
import type { SearchApiResult } from './commandPaletteController';

export interface ListItemSearchRef {
  itemId: string;
  listId: string;
  instanceId: string;
}

export interface PromptAndMoveListItemOptions {
  result: SearchApiResult;
  dialogManager: DialogManager;
  setStatus: (message: string) => void;
  /** Optional fetch override for tests */
  fetchImpl?: typeof apiFetch;
}

type OperationResponse<T> = {
  result?: T;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getListItemSearchRef(result: SearchApiResult): ListItemSearchRef | null {
  if (result.launch.panelType !== 'lists') {
    return null;
  }
  const payload = asRecord(result.launch.payload);
  if (!payload) {
    return null;
  }
  const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'].trim() : '';
  const listId = typeof payload['listId'] === 'string' ? payload['listId'].trim() : '';
  if (!itemId || !listId) {
    return null;
  }
  const payloadInstance =
    typeof payload['instance_id'] === 'string' ? payload['instance_id'].trim() : '';
  const resultInstance = typeof result.instanceId === 'string' ? result.instanceId.trim() : '';
  const instanceId = payloadInstance || resultInstance || 'default';
  return { itemId, listId, instanceId };
}

export function isListItemSearchResult(result: SearchApiResult): boolean {
  return getListItemSearchRef(result) !== null;
}

type MoveTargetList = ListSelectionItem & {
  updatedAtMs: number;
};

function parseUpdatedAtMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseListSelectionItems(value: unknown): MoveTargetList[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: MoveTargetList[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    if (!id || !name) {
      continue;
    }
    items.push({
      id,
      name,
      updatedAtMs: parseUpdatedAtMs(record['updatedAt']),
    });
  }
  return items;
}

/** Newest-updated first, then name — matches lists panel "updated" move-target order. */
function sortMoveTargetsByUpdated(items: MoveTargetList[]): ListSelectionItem[] {
  return [...items]
    .sort((a, b) => {
      if (a.updatedAtMs !== b.updatedAtMs) {
        return b.updatedAtMs - a.updatedAtMs;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    })
    .map(({ id, name, instanceLabel }) => ({
      id,
      name,
      ...(instanceLabel ? { instanceLabel } : {}),
    }));
}

async function callListsOperation<T>(
  operation: string,
  body: Record<string, unknown>,
  fetchImpl: typeof apiFetch,
): Promise<T> {
  const response = await fetchImpl(`/api/plugins/lists/operations/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore JSON parse failures
  }

  if (!response.ok || !payload || payload.result === undefined || payload.error) {
    const message = payload?.error ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

/**
 * Open the searchable list picker and move a list item from a global search result.
 * Does not require a lists panel to be open.
 */
export async function promptAndMoveListItemFromSearch(
  options: PromptAndMoveListItemOptions,
): Promise<boolean> {
  const ref = getListItemSearchRef(options.result);
  if (!ref) {
    options.setStatus('Move to list is only available for list items');
    return false;
  }

  const fetchImpl = options.fetchImpl ?? apiFetch;
  const instanceBody = { instance_id: ref.instanceId };

  options.setStatus('Loading lists…');

  let targets: ListSelectionItem[] = [];
  try {
    const rawLists = await callListsOperation<unknown>('list', instanceBody, fetchImpl);
    targets = sortMoveTargetsByUpdated(
      parseListSelectionItems(rawLists).filter((list) => list.id !== ref.listId),
    );
  } catch (error) {
    console.error('Failed to load lists for search move:', error);
    options.setStatus('Failed to load lists');
    return false;
  }

  if (targets.length === 0) {
    options.setStatus('No other lists available');
    return false;
  }

  const itemLabel = options.result.title.trim() || ref.itemId;
  const selected = await openListSelectionDialog({
    dialogManager: options.dialogManager,
    title: 'Move Item',
    message: `Move "${itemLabel}" to which list?`,
    items: targets,
    confirmText: 'Move',
    emptyText: 'No matching lists',
    showIds: false,
  });

  if (!selected) {
    return false;
  }

  try {
    await callListsOperation(
      'item-move',
      {
        ...instanceBody,
        id: ref.itemId,
        targetListId: selected.id,
      },
      fetchImpl,
    );
    options.setStatus(`Moved "${itemLabel}" to "${selected.name}"`);
    return true;
  } catch (error) {
    console.error('Failed to move list item from search:', error);
    options.setStatus('Failed to move item');
    return false;
  }
}
