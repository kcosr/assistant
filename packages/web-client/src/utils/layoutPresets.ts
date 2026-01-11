import type { LayoutNode } from '@assistant/shared';
import { collectSplitIds, normalizeSplitSizes } from './layoutTree';

export type PanelLayoutPreset = { id: 'auto' } | { id: 'columns'; columns: number };

export function buildPanelLayoutPreset(root: LayoutNode, preset: PanelLayoutPreset): LayoutNode {
  const groups = collectLayoutGroups(root);
  if (groups.length === 0) {
    return root;
  }
  if (groups.length === 1) {
    return groups[0] ?? root;
  }

  const columnCount = resolveColumnCount(groups.length, preset);
  const splitIds = new Set(collectSplitIds(root));
  return buildGridLayout(groups, columnCount, splitIds);
}

export function collectLayoutGroups(root: LayoutNode): LayoutNode[] {
  if (root.kind === 'panel') {
    return [root];
  }
  if (root.viewMode === 'tabs') {
    return [root];
  }
  return root.children.flatMap((child) => collectLayoutGroups(child));
}

function resolveColumnCount(count: number, preset: PanelLayoutPreset): number {
  if (count <= 1) {
    return 1;
  }
  if (preset.id === 'auto') {
    return Math.max(1, Math.ceil(Math.sqrt(count)));
  }
  return Math.max(1, Math.min(preset.columns, count));
}

function buildGridLayout(
  groups: LayoutNode[],
  columnCount: number,
  splitIds: Set<string>,
): LayoutNode {
  const rows: LayoutNode[] = [];
  for (let index = 0; index < groups.length; index += columnCount) {
    const rowChildren = groups.slice(index, index + columnCount);
    if (rowChildren.length === 1) {
      const single = rowChildren[0];
      if (single) {
        rows.push(single);
      }
      continue;
    }
    rows.push(
      createSplitNode({
        direction: 'horizontal',
        children: rowChildren,
        splitIds,
      }),
    );
  }

  if (rows.length === 1) {
    const onlyRow = rows[0];
    if (onlyRow) {
      return onlyRow;
    }
  }

  return createSplitNode({
    direction: 'vertical',
    children: rows,
    splitIds,
  });
}

function createSplitNode(options: {
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  splitIds: Set<string>;
}): LayoutNode {
  const { direction, children, splitIds } = options;
  return {
    kind: 'split',
    splitId: createSplitId(splitIds),
    direction,
    sizes: normalizeSplitSizes(new Array(children.length).fill(1), children.length),
    children,
  };
}

function createSplitId(existing: Set<string>): string {
  let index = existing.size + 1;
  let candidate = `split-${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `split-${index}`;
  }
  existing.add(candidate);
  return candidate;
}
