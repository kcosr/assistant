import type { ListCustomFieldDefinition } from '../controllers/listCustomFields';
import type { ListPanelItem } from '../controllers/listPanelController';
import type { ColumnVisibility } from './listColumnPreferences';
import { parseListItemReference } from './listCustomFieldReference';

export type ListColumnPresence = {
  hasUrl: boolean;
  hasNotes: boolean;
  hasTags: boolean;
  hasAdded: boolean;
  hasUpdated: boolean;
  hasTouched: boolean;
};

export function getListColumnPresence(items: ListPanelItem[]): ListColumnPresence {
  let hasUrl = false;
  let hasNotes = false;
  let hasTags = false;
  let hasAdded = false;
  let hasUpdated = false;
  let hasTouched = false;

  for (const item of items) {
    if (!hasUrl && typeof item.url === 'string' && item.url.trim().length > 0) {
      hasUrl = true;
    }
    if (!hasNotes && typeof item.notes === 'string' && item.notes.trim().length > 0) {
      hasNotes = true;
    }
    if (!hasTags && Array.isArray(item.tags) && item.tags.length > 0) {
      hasTags = true;
    }
    if (!hasAdded && typeof item.addedAt === 'string' && item.addedAt.trim().length > 0) {
      hasAdded = true;
    }
    if (!hasUpdated && typeof item.updatedAt === 'string' && item.updatedAt.trim().length > 0) {
      hasUpdated = true;
    }
    if (!hasTouched && typeof item.touchedAt === 'string' && item.touchedAt.trim().length > 0) {
      hasTouched = true;
    }

    if (hasUrl && hasNotes && hasTags && hasAdded && hasUpdated && hasTouched) {
      break;
    }
  }

  return {
    hasUrl,
    hasNotes,
    hasTags,
    hasAdded,
    hasUpdated,
    hasTouched,
  };
}

export function normalizeListCustomFields(
  customFields: ListCustomFieldDefinition[] | undefined,
): ListCustomFieldDefinition[] {
  if (!Array.isArray(customFields)) {
    return [];
  }
  return customFields.filter(
    (field): field is ListCustomFieldDefinition =>
      !!field &&
      typeof field === 'object' &&
      typeof field.key === 'string' &&
      field.key.trim().length > 0 &&
      typeof field.label === 'string' &&
      field.label.trim().length > 0 &&
      (field.type === 'text' ||
        field.type === 'number' ||
        field.type === 'date' ||
        field.type === 'time' ||
        field.type === 'datetime' ||
        field.type === 'select' ||
        field.type === 'checkbox' ||
        field.type === 'ref'),
  );
}

export function getVisibleCustomFields(options: {
  customFields: ListCustomFieldDefinition[] | undefined;
  items: ListPanelItem[];
  showAllColumns: boolean;
  getColumnVisibility?: (columnKey: string) => ColumnVisibility;
}): ListCustomFieldDefinition[] {
  const { customFields, items, showAllColumns, getColumnVisibility } = options;
  const normalizedCustomFields = normalizeListCustomFields(customFields);
  const visibleCustomFields: ListCustomFieldDefinition[] = [];

  for (const field of normalizedCustomFields) {
    const key = field.key.trim();
    if (!key) continue;

    const visibility = getColumnVisibility ? getColumnVisibility(key) : 'show-with-data';
    if (visibility === 'always-show') {
      visibleCustomFields.push(field);
      continue;
    }

    const hasData = items.some((item) => {
      const value = item.customFields ? item.customFields[key] : undefined;
      if (value === undefined || value === null) {
        return false;
      }
      if (field.type === 'checkbox') {
        return typeof value === 'boolean';
      }
      if (field.type === 'number') {
        return typeof value === 'number' || typeof value === 'string';
      }
      if (
        field.type === 'select' ||
        field.type === 'date' ||
        field.type === 'time' ||
        field.type === 'datetime' ||
        field.type === 'text'
      ) {
        return typeof value === 'string' && value.trim().length > 0;
      }
      if (field.type === 'ref') {
        return parseListItemReference(value) !== null;
      }
      return true;
    });

    if (visibility === 'hide-in-compact' && !showAllColumns) {
      continue;
    }
    if (showAllColumns || hasData) {
      visibleCustomFields.push(field);
    }
  }

  return visibleCustomFields;
}
