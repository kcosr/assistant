import type { ListCustomFieldDefinition } from '../controllers/listCustomFields';
import {
  formatListItemReferenceLabel,
  parseListItemReference,
} from './listCustomFieldReference';
import { hasPinnedTag } from './pinnedTag';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface ListItem {
  id?: string;
  title: string;
  url?: string;
  notes?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  addedAt?: string;
  updatedAt?: string;
  touchedAt?: string;
  position?: number;
  completed?: boolean;
  completedAt?: string;
}

/**
 * Get the sort type for a column based on its key and custom field definitions.
 */
export function getSortTypeForColumn(
  columnKey: string,
  customFields: ListCustomFieldDefinition[],
): 'text' | 'number' | 'date' | 'time' | 'datetime' | 'checkbox' | 'position' {
  // Built-in columns
  if (columnKey === 'position') return 'position';
  if (columnKey === 'title') return 'text';
  if (columnKey === 'url') return 'text';
  if (columnKey === 'notes') return 'text';
  if (columnKey === 'tags') return 'text';
  if (columnKey === 'added') return 'datetime';
  if (columnKey === 'updated') return 'datetime';
  if (columnKey === 'touched') return 'datetime';

  // Custom fields
  const field = customFields.find((f) => f.key === columnKey);
  if (!field) return 'text';

  switch (field.type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'datetime':
      return 'datetime';
    case 'checkbox':
      return 'checkbox';
    case 'select':
    case 'text':
    case 'ref':
    default:
      return 'text';
  }
}

/**
 * Parse a time string (HH:MM or HH:MM:SS) into minutes since midnight for comparison.
 */
function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  return hours * 60 + minutes;
}

/**
 * Parse a date string (YYYY-MM-DD) into a timestamp for comparison.
 */
function parseDateToTimestamp(dateStr: string): number | null {
  const date = new Date(dateStr.trim() + 'T00:00:00');
  return isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Parse a datetime string into a timestamp for comparison.
 */
function parseDatetimeToTimestamp(datetimeStr: string): number | null {
  const date = new Date(datetimeStr.trim());
  return isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Get a comparable value from an item for a given column.
 */
function getComparableValue(
  item: ListItem,
  columnKey: string,
  sortType: ReturnType<typeof getSortTypeForColumn>,
): string | number | boolean | null {
  // Handle built-in columns
  if (columnKey === 'position') {
    return item.position ?? 0;
  }
  if (columnKey === 'title') {
    return item.title.toLowerCase();
  }
  if (columnKey === 'url') {
    return (item.url ?? '').toLowerCase();
  }
  if (columnKey === 'notes') {
    return (item.notes ?? '').toLowerCase();
  }
  if (columnKey === 'tags') {
    return (item.tags ?? []).join(', ').toLowerCase();
  }
  if (columnKey === 'added') {
    return parseDatetimeToTimestamp(item.addedAt ?? '') ?? 0;
  }
  if (columnKey === 'updated') {
    const timestamp = parseDatetimeToTimestamp(item.updatedAt ?? '');
    return timestamp ?? null;
  }
  if (columnKey === 'touched') {
    const timestamp = parseDatetimeToTimestamp(item.touchedAt ?? '');
    return timestamp ?? null;
  }

  // Handle custom fields
  const value = item.customFields?.[columnKey];

  if (value === null || value === undefined) {
    return null;
  }

  switch (sortType) {
    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      }
      return null;

    case 'date':
      if (typeof value === 'string') {
        return parseDateToTimestamp(value);
      }
      return null;

    case 'time':
      if (typeof value === 'string') {
        return parseTimeToMinutes(value);
      }
      return null;

    case 'datetime':
      if (typeof value === 'string') {
        return parseDatetimeToTimestamp(value);
      }
      return null;

    case 'checkbox':
      return value === true;

    case 'text':
    default:
      if (typeof value === 'string') {
        return value.toLowerCase();
      }
      const reference = parseListItemReference(value);
      if (reference) {
        return formatListItemReferenceLabel(reference).toLowerCase();
      }
      return String(value).toLowerCase();
  }
}

/**
 * Compare two values for sorting.
 * nulls are sorted to the end regardless of direction.
 */
function compareValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
  direction: SortDirection,
): number {
  // Nulls always go to the end
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let result: number;

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    // true > false
    result = a === b ? 0 : a ? -1 : 1;
  } else if (typeof a === 'number' && typeof b === 'number') {
    result = a - b;
  } else if (typeof a === 'string' && typeof b === 'string') {
    result = a.localeCompare(b);
  } else {
    // Fallback: convert to string
    result = String(a).localeCompare(String(b));
  }

  return direction === 'desc' ? -result : result;
}

/**
 * Sort items by a column.
 * Completed items are kept at the end of the list, sorted separately.
 */
export function sortItems(
  items: ListItem[],
  sortState: SortState | null,
  customFields: ListCustomFieldDefinition[],
): ListItem[] {
  // Default: sort by position
  if (!sortState || sortState.column === 'position') {
    const direction = sortState?.direction ?? 'asc';
    const multiplier = direction === 'desc' ? -1 : 1;
    const uncompleted = items
      .filter((item) => !item.completed)
      .sort((a, b) => multiplier * ((a.position ?? 0) - (b.position ?? 0)));
    const completed = items
      .filter((item) => item.completed)
      .sort((a, b) => multiplier * ((a.position ?? 0) - (b.position ?? 0)));
    return [...uncompleted, ...completed];
  }

  const sortType = getSortTypeForColumn(sortState.column, customFields);

  const sortFn = (a: ListItem, b: ListItem): number => {
    if (sortState.column === 'title') {
      const aPinned = hasPinnedTag(a.tags);
      const bPinned = hasPinnedTag(b.tags);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }
    }
    const aVal = getComparableValue(a, sortState.column, sortType);
    const bVal = getComparableValue(b, sortState.column, sortType);
    return compareValues(aVal, bVal, sortState.direction);
  };

  // Keep completed items at the end, sorted separately
  const uncompleted = items.filter((item) => !item.completed).sort(sortFn);
  const completed = items.filter((item) => item.completed).sort(sortFn);

  return [...uncompleted, ...completed];
}

/**
 * Toggle sort state when clicking a column header.
 */
export function toggleSort(currentState: SortState | null, columnKey: string): SortState {
  if (!currentState || currentState.column !== columnKey) {
    // New column: start with ascending
    return { column: columnKey, direction: 'asc' };
  }

  // Same column: toggle direction, or reset to position if already desc
  if (currentState.direction === 'asc') {
    return { column: columnKey, direction: 'desc' };
  }

  // Was desc, reset to default (position)
  return { column: 'position', direction: 'asc' };
}

/**
 * Check if a custom field is a date/time type suitable for timeline view.
 */
export function isTimelineField(field: ListCustomFieldDefinition): boolean {
  return field.type === 'date' || field.type === 'time' || field.type === 'datetime';
}

/**
 * Get available timeline fields from custom field definitions.
 */
export function getTimelineFields(
  customFields: ListCustomFieldDefinition[],
): ListCustomFieldDefinition[] {
  return customFields.filter(isTimelineField);
}

/**
 * Parse any date/time/datetime field value to a Date object for comparison with "now".
 * For time-only fields, uses today's date.
 */
export function parseFieldValueToDate(
  value: unknown,
  fieldType: 'date' | 'time' | 'datetime',
): Date | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();

  if (fieldType === 'date') {
    const date = new Date(trimmed + 'T00:00:00');
    return isNaN(date.getTime()) ? null : date;
  }

  if (fieldType === 'time') {
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const now = new Date();
    now.setHours(parseInt(match[1]!, 10), parseInt(match[2]!, 10), 0, 0);
    return now;
  }

  if (fieldType === 'datetime') {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}
