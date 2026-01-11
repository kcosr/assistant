import type { ListItem } from './types';

function sortItemsByPositionAndTime(a: ListItem, b: ListItem): number {
  const aHasPosition = typeof a.position === 'number';
  const bHasPosition = typeof b.position === 'number';

  if (aHasPosition && bHasPosition && a.position !== b.position) {
    return a.position - b.position;
  }

  const aTime = new Date(a.addedAt).getTime();
  const bTime = new Date(b.addedAt).getTime();
  return aTime - bTime;
}

export function reflowPositions(items: ListItem[], listId: string): void {
  const itemsInList = items.filter((item) => item.listId === listId);
  if (itemsInList.length === 0) {
    return;
  }

  itemsInList.sort(sortItemsByPositionAndTime);

  itemsInList.forEach((item, index) => {
    item.position = index;
  });
}

export function repositionItem(
  items: ListItem[],
  listId: string,
  itemId: string,
  position?: number,
): void {
  const itemsInList = items.filter((item) => item.listId === listId);
  if (itemsInList.length === 0) {
    return;
  }

  const targetItem = itemsInList.find((item) => item.id === itemId);
  if (!targetItem) {
    return;
  }

  const otherItems = itemsInList.filter((item) => item.id !== itemId);
  otherItems.sort(sortItemsByPositionAndTime);

  let insertIndex: number;
  if (position === undefined || Number.isNaN(position)) {
    insertIndex = otherItems.length;
  } else {
    const clamped = Math.max(0, Math.floor(position));
    insertIndex = clamped > otherItems.length ? otherItems.length : clamped;
  }

  const orderedItems = [...otherItems];
  orderedItems.splice(insertIndex, 0, targetItem);

  orderedItems.forEach((item, index) => {
    item.position = index;
  });
}
