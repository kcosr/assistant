import type { ListCustomFieldDefinition, ListCustomFieldType } from '@assistant/shared';

export type { ListCustomFieldDefinition, ListCustomFieldType };

export interface ListDefinition {
  id: string; // Slug identifier (lowercase alphanumeric with hyphens)
  name: string; // Display name
  description?: string;
  tags: string[];
  /**
   * Default tags applied to new items in this list.
   * These are merged with item-specific tags on creation.
   */
  defaultTags?: string[];
  /**
   * Optional custom field configuration for items in this list.
   */
  customFields?: ListCustomFieldDefinition[];
  /**
   * Optional saved AQL queries for this list.
   */
  savedQueries?: ListSavedQuery[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface ListItem {
  id: string; // UUID
  listId: string; // Foreign key to ListDefinition.id
  title: string;
  url?: string;
  notes?: string;
  tags: string[];
  addedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  touchedAt?: string; // ISO 8601 timestamp for manual review/touch
  /**
   * Optional custom field values keyed by custom field key.
   */
  customFields?: Record<string, unknown>;
  position: number; // Zero-based position within the list
  completed?: boolean; // Whether the item is marked as completed
  completedAt?: string; // ISO 8601 timestamp when completed
}

export interface ListsData {
  lists: ListDefinition[];
  items: ListItem[];
}

export interface ListSavedQuery {
  id: string; // UUID
  name: string;
  query: string;
  isDefault?: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
