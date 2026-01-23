import { describe, it, expect } from 'vitest';
import {
  sortItems,
  toggleSort,
  getSortTypeForColumn,
  parseFieldValueToDate,
  getTimelineFields,
  isTimelineField,
  type ListItem,
  type SortState,
} from './listSorting';
import type { ListCustomFieldDefinition } from '../controllers/listCustomFields';

describe('listSorting', () => {
  describe('getSortTypeForColumn', () => {
    it('returns correct type for built-in columns', () => {
      const customFields: ListCustomFieldDefinition[] = [];
      expect(getSortTypeForColumn('position', customFields)).toBe('position');
      expect(getSortTypeForColumn('title', customFields)).toBe('text');
      expect(getSortTypeForColumn('url', customFields)).toBe('text');
      expect(getSortTypeForColumn('notes', customFields)).toBe('text');
      expect(getSortTypeForColumn('tags', customFields)).toBe('text');
      expect(getSortTypeForColumn('added', customFields)).toBe('datetime');
      expect(getSortTypeForColumn('updated', customFields)).toBe('datetime');
      expect(getSortTypeForColumn('touched', customFields)).toBe('datetime');
    });

    it('returns correct type for custom fields', () => {
      const customFields: ListCustomFieldDefinition[] = [
        { key: 'priority', label: 'Priority', type: 'number' },
        { key: 'due_date', label: 'Due Date', type: 'date' },
        { key: 'start_time', label: 'Start Time', type: 'time' },
        { key: 'deadline', label: 'Deadline', type: 'datetime' },
        { key: 'status', label: 'Status', type: 'select', options: ['Open', 'Closed'] },
        { key: 'important', label: 'Important', type: 'checkbox' },
        { key: 'description', label: 'Description', type: 'text' },
      ];
      expect(getSortTypeForColumn('priority', customFields)).toBe('number');
      expect(getSortTypeForColumn('due_date', customFields)).toBe('date');
      expect(getSortTypeForColumn('start_time', customFields)).toBe('time');
      expect(getSortTypeForColumn('deadline', customFields)).toBe('datetime');
      expect(getSortTypeForColumn('status', customFields)).toBe('text');
      expect(getSortTypeForColumn('important', customFields)).toBe('checkbox');
      expect(getSortTypeForColumn('description', customFields)).toBe('text');
    });

    it('returns text for unknown custom fields', () => {
      expect(getSortTypeForColumn('unknown', [])).toBe('text');
    });
  });

  describe('sortItems', () => {
    const baseItems: ListItem[] = [
      { id: '1', title: 'Banana', position: 2 },
      { id: '2', title: 'Apple', position: 1 },
      { id: '3', title: 'Cherry', position: 0 },
    ];

    it('sorts by position when no sort state', () => {
      const sorted = sortItems(baseItems, null, []);
      expect(sorted.map((i) => i.title)).toEqual(['Cherry', 'Apple', 'Banana']);
    });

    it('sorts by position when sort state is position', () => {
      const sorted = sortItems(baseItems, { column: 'position', direction: 'asc' }, []);
      expect(sorted.map((i) => i.title)).toEqual(['Cherry', 'Apple', 'Banana']);
    });

    it('sorts by position descending', () => {
      const sorted = sortItems(baseItems, { column: 'position', direction: 'desc' }, []);
      expect(sorted.map((i) => i.title)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('sorts by title ascending', () => {
      const sorted = sortItems(baseItems, { column: 'title', direction: 'asc' }, []);
      expect(sorted.map((i) => i.title)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('sorts by title descending', () => {
      const sorted = sortItems(baseItems, { column: 'title', direction: 'desc' }, []);
      expect(sorted.map((i) => i.title)).toEqual(['Cherry', 'Banana', 'Apple']);
    });

    it('sorts by title with pinned items first', () => {
      const items: ListItem[] = [
        { id: '1', title: 'Banana', tags: ['pinned'] },
        { id: '2', title: 'Apple' },
        { id: '3', title: 'Cherry', tags: ['pinned'] },
        { id: '4', title: 'Date' },
      ];

      const asc = sortItems(items, { column: 'title', direction: 'asc' }, []);
      expect(asc.map((i) => i.title)).toEqual(['Banana', 'Cherry', 'Apple', 'Date']);

      const desc = sortItems(items, { column: 'title', direction: 'desc' }, []);
      expect(desc.map((i) => i.title)).toEqual(['Cherry', 'Banana', 'Date', 'Apple']);
    });

    it('sorts by number custom field', () => {
      const items: ListItem[] = [
        { id: '1', title: 'A', customFields: { priority: 3 } },
        { id: '2', title: 'B', customFields: { priority: 1 } },
        { id: '3', title: 'C', customFields: { priority: 2 } },
      ];
      const customFields: ListCustomFieldDefinition[] = [
        { key: 'priority', label: 'Priority', type: 'number' },
      ];
      const sorted = sortItems(items, { column: 'priority', direction: 'asc' }, customFields);
      expect(sorted.map((i) => i.title)).toEqual(['B', 'C', 'A']);
    });

    it('sorts by date custom field', () => {
      const items: ListItem[] = [
        { id: '1', title: 'A', customFields: { due: '2025-12-20' } },
        { id: '2', title: 'B', customFields: { due: '2025-12-15' } },
        { id: '3', title: 'C', customFields: { due: '2025-12-25' } },
      ];
      const customFields: ListCustomFieldDefinition[] = [
        { key: 'due', label: 'Due', type: 'date' },
      ];
      const sorted = sortItems(items, { column: 'due', direction: 'asc' }, customFields);
      expect(sorted.map((i) => i.title)).toEqual(['B', 'A', 'C']);
    });

    it('keeps completed items at the end', () => {
      const items: ListItem[] = [
        { id: '1', title: 'Banana', position: 2, completed: true },
        { id: '2', title: 'Apple', position: 1 },
        { id: '3', title: 'Cherry', position: 0 },
      ];
      const sorted = sortItems(items, { column: 'title', direction: 'asc' }, []);
      expect(sorted.map((i) => i.title)).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('handles null values by sorting them to the end', () => {
      const items: ListItem[] = [
        { id: '1', title: 'A', customFields: { priority: 3 } },
        { id: '2', title: 'B', customFields: {} },
        { id: '3', title: 'C', customFields: { priority: 1 } },
      ];
      const customFields: ListCustomFieldDefinition[] = [
        { key: 'priority', label: 'Priority', type: 'number' },
      ];
      const sorted = sortItems(items, { column: 'priority', direction: 'asc' }, customFields);
      expect(sorted.map((i) => i.title)).toEqual(['C', 'A', 'B']);
    });
  });

  describe('toggleSort', () => {
    it('starts with ascending when clicking new column', () => {
      const result = toggleSort(null, 'title');
      expect(result).toEqual({ column: 'title', direction: 'asc' });
    });

    it('toggles to descending when clicking same column', () => {
      const current: SortState = { column: 'title', direction: 'asc' };
      const result = toggleSort(current, 'title');
      expect(result).toEqual({ column: 'title', direction: 'desc' });
    });

    it('resets to position when clicking same column in desc', () => {
      const current: SortState = { column: 'title', direction: 'desc' };
      const result = toggleSort(current, 'title');
      expect(result).toEqual({ column: 'position', direction: 'asc' });
    });

    it('starts ascending when clicking different column', () => {
      const current: SortState = { column: 'title', direction: 'desc' };
      const result = toggleSort(current, 'url');
      expect(result).toEqual({ column: 'url', direction: 'asc' });
    });
  });

  describe('parseFieldValueToDate', () => {
    it('parses date field', () => {
      const result = parseFieldValueToDate('2025-12-15', 'date');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getMonth()).toBe(11); // December
      expect(result?.getDate()).toBe(15);
    });

    it('parses time field', () => {
      const result = parseFieldValueToDate('14:30', 'time');
      expect(result).not.toBeNull();
      expect(result?.getHours()).toBe(14);
      expect(result?.getMinutes()).toBe(30);
    });

    it('parses datetime field', () => {
      const result = parseFieldValueToDate('2025-12-15T14:30:00', 'datetime');
      expect(result).not.toBeNull();
      expect(result?.getFullYear()).toBe(2025);
      expect(result?.getHours()).toBe(14);
    });

    it('returns null for empty values', () => {
      expect(parseFieldValueToDate('', 'date')).toBeNull();
      expect(parseFieldValueToDate(null, 'date')).toBeNull();
      expect(parseFieldValueToDate(undefined, 'date')).toBeNull();
    });

    it('returns null for invalid date', () => {
      expect(parseFieldValueToDate('not-a-date', 'date')).toBeNull();
    });
  });

  describe('isTimelineField', () => {
    it('returns true for date/time/datetime fields', () => {
      expect(isTimelineField({ key: 'a', label: 'A', type: 'date' })).toBe(true);
      expect(isTimelineField({ key: 'a', label: 'A', type: 'time' })).toBe(true);
      expect(isTimelineField({ key: 'a', label: 'A', type: 'datetime' })).toBe(true);
    });

    it('returns false for other field types', () => {
      expect(isTimelineField({ key: 'a', label: 'A', type: 'text' })).toBe(false);
      expect(isTimelineField({ key: 'a', label: 'A', type: 'number' })).toBe(false);
      expect(isTimelineField({ key: 'a', label: 'A', type: 'checkbox' })).toBe(false);
      expect(isTimelineField({ key: 'a', label: 'A', type: 'select', options: [] })).toBe(false);
    });
  });

  describe('getTimelineFields', () => {
    it('filters to only date/time/datetime fields', () => {
      const fields: ListCustomFieldDefinition[] = [
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'priority', label: 'Priority', type: 'number' },
        { key: 'start', label: 'Start', type: 'time' },
        { key: 'deadline', label: 'Deadline', type: 'datetime' },
        { key: 'done', label: 'Done', type: 'checkbox' },
      ];
      const result = getTimelineFields(fields);
      expect(result.map((f) => f.key)).toEqual(['due', 'start', 'deadline']);
    });
  });
});
