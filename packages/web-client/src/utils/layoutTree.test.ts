import { describe, expect, it } from 'vitest';
import type { LayoutNode } from '@assistant/shared';
import {
  collectPanelIds,
  collectVisiblePanelIds,
  insertPanel,
  movePanel,
  removePanel,
} from './layoutTree';

const pane = (
  paneId: string,
  panelIds: string[],
  activePanelId = panelIds[0] ?? '',
): Extract<LayoutNode, { kind: 'pane' }> => ({
  kind: 'pane',
  paneId,
  tabs: panelIds.map((panelId) => ({ panelId })),
  activePanelId,
});

const split = (
  splitId: string,
  direction: 'horizontal' | 'vertical',
  sizes: number[],
  children: LayoutNode[],
): LayoutNode => ({
  kind: 'split',
  splitId,
  direction,
  sizes,
  children,
});

describe('layoutTree', () => {
  it('collects panel ids in depth-first order', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['left']),
      split('split-2', 'vertical', [0.5, 0.5], [pane('pane-2', ['a']), pane('pane-3', ['b'])]),
    ]);

    expect(collectPanelIds(layout)).toEqual(['left', 'a', 'b']);
  });

  it('removes a panel and collapses split nodes', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['left']),
      pane('pane-2', ['right']),
    ]);

    expect(removePanel(layout, 'right')).toEqual(pane('pane-1', ['left']));
  });

  it('collects visible panel ids for the active pane tab', () => {
    const layout: LayoutNode = pane('pane-1', ['left', 'right'], 'right');

    expect(Array.from(collectVisiblePanelIds(layout))).toEqual(['right']);
  });

  it('falls back to the first pane tab when activePanelId is missing', () => {
    const layout: LayoutNode = pane('pane-1', ['first', 'second'], 'missing');

    expect(Array.from(collectVisiblePanelIds(layout))).toEqual(['first']);
  });

  it('updates pane activePanelId when the active tab is removed', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['left']),
      pane('pane-2', ['mid', 'right'], 'mid'),
    ]);

    expect(removePanel(layout, 'mid')).toEqual(
      split('split-1', 'horizontal', [0.5, 0.5], [
        pane('pane-1', ['left']),
        pane('pane-2', ['right'], 'right'),
      ]),
    );
  });

  it('inserts a panel into a pane when placed at center', () => {
    const layout: LayoutNode = pane('pane-1', ['a']);

    expect(insertPanel(layout, 'b', { region: 'center' })).toEqual(
      pane('pane-1', ['a', 'b'], 'b'),
    );
  });

  it('adds a panel tab to the targeted pane inside a split', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['a']),
      pane('pane-2', ['b']),
    ]);

    expect(insertPanel(layout, 'c', { region: 'center' }, 'a')).toEqual(
      split('split-1', 'horizontal', [0.5, 0.5], [
        pane('pane-1', ['a', 'c'], 'c'),
        pane('pane-2', ['b']),
      ]),
    );
  });

  it('inserts a panel relative to a target inside a split', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['left']),
      pane('pane-2', ['right']),
    ]);

    expect(insertPanel(layout, 'new', { region: 'left' }, 'right')).toEqual(
      split('split-1', 'horizontal', [0.5, 0.5], [
        pane('pane-1', ['left']),
        split('split-2', 'horizontal', [0.5, 0.5], [
          pane('pane-3', ['new']),
          pane('pane-2', ['right']),
        ]),
      ]),
    );
  });

  it('respects placement size when inserting a split', () => {
    const layout: LayoutNode = pane('pane-1', ['root']);
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
      children: [pane('pane-1', ['root']), pane('pane-2', ['sidebar'])],
    });
    if (result.kind === 'split') {
      expect(result.sizes[0]).toBeCloseTo(0.8, 5);
      expect(result.sizes[1]).toBeCloseTo(0.2, 5);
    }
  });

  it('moves a panel to the left of the remaining layout', () => {
    const layout: LayoutNode = split('split-1', 'horizontal', [0.5, 0.5], [
      pane('pane-1', ['left']),
      pane('pane-2', ['right']),
    ]);

    expect(movePanel(layout, 'right', { region: 'left' })).toEqual(
      split('split-1', 'horizontal', [0.5, 0.5], [
        pane('pane-2', ['right']),
        pane('pane-1', ['left']),
      ]),
    );
  });
});
