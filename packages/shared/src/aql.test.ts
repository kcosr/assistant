import { describe, expect, it } from 'vitest';

import type { AqlItem, ListCustomFieldDefinition } from './aql';
import { evaluateAql, parseAql, sortItemsByOrderBy } from './aql';

const customFields: ListCustomFieldDefinition[] = [
  { key: 'status', label: 'Status', type: 'select', options: ['Ready', 'Blocked'] },
  { key: 'priority', label: 'Priority', type: 'number' },
  { key: 'ref', label: 'Reference', type: 'ref' },
  { key: 'summary', label: 'Summary', type: 'text' },
];

describe('aql', () => {
  it('parses and evaluates AQL clauses', () => {
    const result = parseAql('status = "Ready" AND NOT title : "wip"', {
      customFields,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const matching: AqlItem = {
      title: 'Launch',
      customFields: { status: 'Ready' },
    };
    const rejected: AqlItem = {
      title: 'WIP Launch',
      customFields: { status: 'Ready' },
    };
    expect(evaluateAql(result.query, matching)).toBe(true);
    expect(evaluateAql(result.query, rejected)).toBe(false);
  });

  it('supports IN and !: operators', () => {
    const result = parseAql('tag IN (urgent, "needs-review") AND notes !: "todo"', {
      customFields,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const matching: AqlItem = {
      title: 'Ship',
      notes: 'ready to go',
      tags: ['urgent'],
    };
    const rejected: AqlItem = {
      title: 'Ship',
      notes: 'todo later',
      tags: ['urgent'],
    };
    expect(evaluateAql(result.query, matching)).toBe(true);
    expect(evaluateAql(result.query, rejected)).toBe(false);
  });

  it('supports ~ and !~ operators', () => {
    const result = parseAql('title ~ "launch" AND title !~ "wip"', {
      customFields,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const matching: AqlItem = {
      title: 'Launch Plan',
    };
    const rejected: AqlItem = {
      title: 'WIP Launch Plan',
    };
    expect(evaluateAql(result.query, matching)).toBe(true);
    expect(evaluateAql(result.query, rejected)).toBe(false);
  });

  it('supports text pseudo-field search across text fields', () => {
    const result = parseAql('text : "urgent"', { customFields });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const matchingTag: AqlItem = {
      title: 'Item',
      tags: ['Urgent'],
    };
    const matchingCustom: AqlItem = {
      title: 'Item',
      customFields: { summary: 'Urgent follow-up' },
    };
    const rejected: AqlItem = {
      title: 'Item',
      notes: 'nope',
    };
    expect(evaluateAql(result.query, matchingTag)).toBe(true);
    expect(evaluateAql(result.query, matchingCustom)).toBe(true);
    expect(evaluateAql(result.query, rejected)).toBe(false);
  });

  it('rejects unsupported operators for text pseudo-field', () => {
    const result = parseAql('text = "foo"', { customFields });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Operator = is not supported');
    }
  });

  it('supports IS EMPTY', () => {
    const result = parseAql('notes IS EMPTY', { customFields });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(
      evaluateAql(result.query, {
        title: 'Alpha',
        notes: '',
      }),
    ).toBe(true);
    expect(
      evaluateAql(result.query, {
        title: 'Beta',
        notes: 'has notes',
      }),
    ).toBe(false);
  });

  it('treats reference fields as text in queries', () => {
    const result = parseAql('ref : "project"', { customFields });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const matching: AqlItem = {
      title: 'Item',
      customFields: {
        ref: {
          kind: 'panel',
          panelType: 'notes',
          id: 'Project Plan',
          label: 'Project Plan',
        },
      },
    };
    const rejected: AqlItem = {
      title: 'Item',
      customFields: {
        ref: {
          kind: 'panel',
          panelType: 'notes',
          id: 'Other Note',
          label: 'Other Note',
        },
      },
    };
    expect(evaluateAql(result.query, matching)).toBe(true);
    expect(evaluateAql(result.query, rejected)).toBe(false);
  });

  it('parses SHOW without a match term', () => {
    const result = parseAql('SHOW title, notes', { customFields });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.query.show?.map((field) => field.key)).toEqual(['title', 'notes']);
  });

  it('parses ORDER BY and SHOW', () => {
    const result = parseAql('priority >= 2 ORDER BY updated DESC, priority ASC SHOW title, status', {
      customFields,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.query.orderBy).toHaveLength(2);
    expect(result.query.show?.map((field) => field.key)).toEqual(['title', 'status']);
  });

  it('sorts with ORDER BY', () => {
    const result = parseAql('ORDER BY updated DESC, priority ASC', { customFields });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const items: AqlItem[] = [
      {
        title: 'First',
        updatedAt: '2024-01-01T00:00:00Z',
        customFields: { priority: 2 },
      },
      {
        title: 'Second',
        updatedAt: '2024-01-02T00:00:00Z',
        customFields: { priority: 1 },
      },
      {
        title: 'Third',
        updatedAt: '2024-01-02T00:00:00Z',
        customFields: { priority: 3 },
      },
    ];
    const sorted = sortItemsByOrderBy(items, result.query.orderBy, customFields);
    expect(sorted.map((item) => item.title)).toEqual(['Second', 'Third', 'First']);
  });
});
