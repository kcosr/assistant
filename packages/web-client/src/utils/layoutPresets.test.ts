import { describe, expect, it } from 'vitest';
import type { LayoutNode } from '@assistant/shared';
import { collectPanelIds } from './layoutTree';
import { buildPanelLayoutPreset } from './layoutPresets';

describe('layoutPresets', () => {
  it('keeps tab groups intact when building presets', () => {
    const root: LayoutNode = {
      kind: 'split',
      splitId: 'split-1',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      viewMode: 'tabs',
      activeId: 'panel-a',
      children: [
        { kind: 'panel', panelId: 'panel-a' },
        { kind: 'panel', panelId: 'panel-b' },
      ],
    };

    const result = buildPanelLayoutPreset(root, { id: 'auto' });

    expect(result.kind).toBe('split');
    if (result.kind !== 'split') return;
    expect(result.viewMode).toBe('tabs');
    expect(collectPanelIds(result)).toEqual(['panel-a', 'panel-b']);
  });

  it('builds a near-square grid for auto presets', () => {
    const root: LayoutNode = {
      kind: 'split',
      splitId: 'split-root',
      direction: 'vertical',
      sizes: [0.34, 0.33, 0.33],
      children: [
        { kind: 'panel', panelId: 'panel-a' },
        { kind: 'panel', panelId: 'panel-b' },
        { kind: 'panel', panelId: 'panel-c' },
      ],
    };

    const result = buildPanelLayoutPreset(root, { id: 'auto' });

    expect(result.kind).toBe('split');
    if (result.kind !== 'split') return;
    expect(result.direction).toBe('vertical');
    expect(result.children).toHaveLength(2);
    expect(collectPanelIds(result)).toEqual(['panel-a', 'panel-b', 'panel-c']);

    const firstRow = result.children[0];
    expect(firstRow?.kind).toBe('split');
    if (firstRow?.kind !== 'split') return;
    expect(firstRow.direction).toBe('horizontal');
    expect(firstRow.children).toHaveLength(2);
  });

  it('uses the requested column count for column presets', () => {
    const root: LayoutNode = {
      kind: 'split',
      splitId: 'split-root',
      direction: 'vertical',
      sizes: [0.34, 0.33, 0.33],
      children: [
        { kind: 'panel', panelId: 'panel-a' },
        { kind: 'panel', panelId: 'panel-b' },
        { kind: 'panel', panelId: 'panel-c' },
      ],
    };

    const result = buildPanelLayoutPreset(root, { id: 'columns', columns: 1 });

    expect(result.kind).toBe('split');
    if (result.kind !== 'split') return;
    expect(result.direction).toBe('vertical');
    expect(result.children).toHaveLength(3);
    expect(collectPanelIds(result)).toEqual(['panel-a', 'panel-b', 'panel-c']);
  });
});
