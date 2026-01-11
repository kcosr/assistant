import { describe, expect, it } from 'vitest';
import type { LayoutNode } from '@assistant/shared';
import {
  collectPanelIds,
  collectVisiblePanelIds,
  insertPanel,
  movePanel,
  removePanel,
} from './layoutTree';

const split = (
  splitId: string,
  direction: 'horizontal' | 'vertical',
  sizes: number[],
  children: LayoutNode[],
  options?: { viewMode?: 'split' | 'tabs'; activeId?: string },
): LayoutNode => ({
  kind: 'split',
  splitId,
  direction,
  sizes,
  children,
  ...(options?.viewMode ? { viewMode: options.viewMode } : {}),
  ...(options?.activeId ? { activeId: options.activeId } : {}),
});

describe('layoutTree', () => {
  it('collects panel ids in depth-first order', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        split(
          'split-2',
          'vertical',
          [0.5, 0.5],
          [
            { kind: 'panel', panelId: 'a' },
            { kind: 'panel', panelId: 'b' },
          ],
        ),
      ],
      { viewMode: 'tabs', activeId: 'b' },
    );

    expect(collectPanelIds(layout)).toEqual(['left', 'a', 'b']);
  });

  it('removes a panel and collapses split nodes', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        { kind: 'panel', panelId: 'right' },
      ],
    );

    const result = removePanel(layout, 'right');
    expect(result).toEqual({ kind: 'panel', panelId: 'left' });
  });

  it('collects visible panel ids for split tabs view', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        { kind: 'panel', panelId: 'right' },
      ],
      { viewMode: 'tabs', activeId: 'right' },
    );

    expect(Array.from(collectVisiblePanelIds(layout))).toEqual(['right']);
  });

  it('falls back to the first tab when activeId is missing', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'first' },
        { kind: 'panel', panelId: 'second' },
      ],
      { viewMode: 'tabs', activeId: 'missing' },
    );

    expect(Array.from(collectVisiblePanelIds(layout))).toEqual(['first']);
  });

  it('updates split tabs activeId when the active panel is removed', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        split(
          'split-2',
          'horizontal',
          [0.5, 0.5],
          [
            { kind: 'panel', panelId: 'mid' },
            { kind: 'panel', panelId: 'right' },
          ],
        ),
      ],
      { viewMode: 'tabs', activeId: 'mid' },
    );

    expect(removePanel(layout, 'mid')).toEqual(
      split(
        'split-1',
        'horizontal',
        [0.5, 0.5],
        [
          { kind: 'panel', panelId: 'left' },
          { kind: 'panel', panelId: 'right' },
        ],
        { viewMode: 'tabs', activeId: 'left' },
      ),
    );
  });

  it('inserts a panel into tabs when placed at center', () => {
    const layout: LayoutNode = { kind: 'panel', panelId: 'a' };

    expect(insertPanel(layout, 'b', { region: 'center' })).toEqual(
      split(
        'split-1',
        'horizontal',
        [0.5, 0.5],
        [
          { kind: 'panel', panelId: 'a' },
          { kind: 'panel', panelId: 'b' },
        ],
        { viewMode: 'tabs', activeId: 'b' },
      ),
    );
  });

  it('adds a panel to an existing split when placed at center', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'a' },
        { kind: 'panel', panelId: 'b' },
      ],
      { viewMode: 'tabs', activeId: 'a' },
    );

    expect(insertPanel(layout, 'c', { region: 'center' }, 'a')).toEqual(
      split(
        'split-1',
        'horizontal',
        [0.25, 0.25, 0.5],
        [
          { kind: 'panel', panelId: 'a' },
          { kind: 'panel', panelId: 'c' },
          { kind: 'panel', panelId: 'b' },
        ],
        { viewMode: 'tabs', activeId: 'c' },
      ),
    );
  });

  it('inserts a panel relative to a target inside a split', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        { kind: 'panel', panelId: 'right' },
      ],
    );

    expect(insertPanel(layout, 'new', { region: 'left' }, 'right')).toEqual(
      split(
        'split-1',
        'horizontal',
        [0.5, 0.5],
        [
          { kind: 'panel', panelId: 'left' },
          split(
            'split-2',
            'horizontal',
            [0.5, 0.5],
            [
              { kind: 'panel', panelId: 'new' },
              { kind: 'panel', panelId: 'right' },
            ],
          ),
        ],
      ),
    );
  });

  it('respects placement size when inserting a split', () => {
    const layout: LayoutNode = { kind: 'panel', panelId: 'root' };
    const result = insertPanel(
      layout,
      'sidebar',
      { region: 'right', size: { width: 200 } },
      undefined,
      {
        width: 1000,
        height: 800,
      },
    );

    expect(result).toMatchObject({
      kind: 'split',
      splitId: 'split-1',
      direction: 'horizontal',
      children: [
        { kind: 'panel', panelId: 'root' },
        { kind: 'panel', panelId: 'sidebar' },
      ],
    });
    if (result.kind === 'split') {
      expect(result.sizes[0]).toBeCloseTo(0.8, 5);
      expect(result.sizes[1]).toBeCloseTo(0.2, 5);
    }
  });

  it('moves a panel to the left of the remaining layout', () => {
    const layout: LayoutNode = split(
      'split-1',
      'horizontal',
      [0.5, 0.5],
      [
        { kind: 'panel', panelId: 'left' },
        { kind: 'panel', panelId: 'right' },
      ],
    );

    expect(movePanel(layout, 'right', { region: 'left' })).toEqual(
      split(
        'split-1',
        'horizontal',
        [0.5, 0.5],
        [
          { kind: 'panel', panelId: 'right' },
          { kind: 'panel', panelId: 'left' },
        ],
      ),
    );
  });
});
