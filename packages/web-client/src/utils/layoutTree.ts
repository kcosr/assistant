import type { LayoutNode, PanelPlacement } from '@assistant/shared';

export interface PanelContainerSize {
  width: number;
  height: number;
}

export type LayoutPath = number[];

export function collectSplitIds(node: LayoutNode): string[] {
  if (node.kind === 'panel') {
    return [];
  }
  return [node.splitId, ...node.children.flatMap((child) => collectSplitIds(child))];
}

export function findPanelPath(node: LayoutNode, panelId: string): LayoutPath | null {
  if (node.kind === 'panel') {
    return node.panelId === panelId ? [] : null;
  }
  for (const [index, child] of node.children.entries()) {
    const childPath = findPanelPath(child, panelId);
    if (childPath) {
      return [index, ...childPath];
    }
  }
  return null;
}

export function findSplitPath(node: LayoutNode, splitId: string): LayoutPath | null {
  if (node.kind === 'panel') {
    return null;
  }
  if (node.splitId === splitId) {
    return [];
  }
  for (const [index, child] of node.children.entries()) {
    const childPath = findSplitPath(child, splitId);
    if (childPath) {
      return [index, ...childPath];
    }
  }
  return null;
}

export function getNodeAtPath(node: LayoutNode, path: LayoutPath): LayoutNode | null {
  let current: LayoutNode = node;
  for (const index of path) {
    if (current.kind !== 'split') {
      return null;
    }
    const next = current.children[index];
    if (!next) {
      return null;
    }
    current = next;
  }
  return current;
}

export function getParentPath(path: LayoutPath): LayoutPath | null {
  if (path.length === 0) {
    return null;
  }
  return path.slice(0, -1);
}

export function collectPanelIds(node: LayoutNode): string[] {
  if (node.kind === 'panel') {
    return [node.panelId];
  }
  return node.children.flatMap((child) => collectPanelIds(child));
}

export function containsPanelId(node: LayoutNode, panelId: string): boolean {
  return collectPanelIds(node).includes(panelId);
}

export function findFirstPanelId(node: LayoutNode): string | null {
  if (node.kind === 'panel') {
    return node.panelId;
  }
  for (const child of node.children) {
    const found = findFirstPanelId(child);
    if (found) {
      return found;
    }
  }
  return null;
}

export function collectVisiblePanelIds(node: LayoutNode): Set<string> {
  if (node.kind === 'panel') {
    return new Set([node.panelId]);
  }
  if (node.viewMode === 'tabs') {
    const activeChild =
      node.children.find((child) => containsPanelId(child, node.activeId ?? '')) ??
      node.children[0];
    return activeChild ? collectVisiblePanelIds(activeChild) : new Set<string>();
  }
  const ids = new Set<string>();
  for (const child of node.children) {
    for (const id of collectVisiblePanelIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

export function collectVisiblePanelIdsInOrder(node: LayoutNode): string[] {
  if (node.kind === 'panel') {
    return [node.panelId];
  }
  if (node.viewMode === 'tabs') {
    const activeChild =
      node.children.find((child) => containsPanelId(child, node.activeId ?? '')) ??
      node.children[0];
    return activeChild ? collectVisiblePanelIdsInOrder(activeChild) : [];
  }
  const ordered: string[] = [];
  for (const child of node.children) {
    ordered.push(...collectVisiblePanelIdsInOrder(child));
  }
  return ordered;
}

export function removePanel(node: LayoutNode, panelId: string): LayoutNode | null {
  if (node.kind === 'panel') {
    return node.panelId === panelId ? null : node;
  }

  const nextChildren: LayoutNode[] = [];
  const nextSizes: number[] = [];
  node.children.forEach((child, index) => {
    const nextChild = removePanel(child, panelId);
    if (!nextChild) {
      return;
    }
    nextChildren.push(nextChild);
    nextSizes.push(node.sizes[index] ?? 0);
  });

  if (nextChildren.length === 0) {
    return null;
  }
  if (nextChildren.length === 1) {
    return nextChildren[0] ?? null;
  }

  let nextActiveId = node.activeId;
  if (node.viewMode === 'tabs') {
    let hasActive = false;
    if (typeof nextActiveId === 'string') {
      const activeId = nextActiveId;
      hasActive = nextChildren.some((child) => containsPanelId(child, activeId));
    }
    if (!hasActive) {
      const firstTab = nextChildren[0];
      if (firstTab) {
        nextActiveId = findFirstPanelId(firstTab) ?? nextActiveId;
      }
    }
  }

  return {
    kind: 'split',
    splitId: node.splitId,
    direction: node.direction,
    sizes: normalizeSplitSizes(nextSizes, nextChildren.length),
    children: nextChildren,
    ...(node.viewMode ? { viewMode: node.viewMode } : {}),
    ...(nextActiveId ? { activeId: nextActiveId } : {}),
  };
}

export function insertPanel(
  node: LayoutNode,
  panelId: string,
  placement: PanelPlacement,
  targetPanelId?: string,
  containerSize?: PanelContainerSize,
): LayoutNode {
  const splitIds = new Set(collectSplitIds(node));
  if (targetPanelId) {
    const result = insertPanelRelative(
      node,
      panelId,
      placement,
      targetPanelId,
      containerSize,
      splitIds,
    );
    if (result.inserted) {
      return result.node;
    }
  }

  return createPlacementNode(node, panelId, placement, containerSize, splitIds);
}

export function movePanel(
  node: LayoutNode,
  panelId: string,
  placement: PanelPlacement,
  targetPanelId?: string,
  containerSize?: PanelContainerSize,
): LayoutNode {
  const pruned = removePanel(node, panelId);
  if (!pruned) {
    return { kind: 'panel', panelId };
  }
  const resolvedTarget = targetPanelId === panelId ? undefined : targetPanelId;
  return insertPanel(pruned, panelId, placement, resolvedTarget, containerSize);
}

function insertPanelRelative(
  node: LayoutNode,
  panelId: string,
  placement: PanelPlacement,
  targetPanelId: string,
  containerSize: PanelContainerSize | undefined,
  splitIds: Set<string>,
): { node: LayoutNode; inserted: boolean } {
  if (node.kind === 'panel') {
    if (node.panelId !== targetPanelId) {
      return { node, inserted: false };
    }
    return {
      node: createPlacementNode(node, panelId, placement, containerSize, splitIds),
      inserted: true,
    };
  }

  if (placement.region === 'center' && containsPanelId(node, targetPanelId)) {
    const targetIndex = node.children.findIndex((child) => containsPanelId(child, targetPanelId));
    const insertion = insertPanelIntoSplit(node, { kind: 'panel', panelId }, targetIndex);
    const nextSplit =
      insertion.viewMode === 'tabs' ? { ...insertion, activeId: panelId } : insertion;
    return { node: nextSplit, inserted: true };
  }

  let inserted = false;
  const nextChildren = node.children.map((child) => {
    if (inserted || !containsPanelId(child, targetPanelId)) {
      return child;
    }
    const result = insertPanelRelative(
      child,
      panelId,
      placement,
      targetPanelId,
      containerSize,
      splitIds,
    );
    inserted = result.inserted;
    return result.node;
  });

  return {
    node: {
      ...node,
      children: nextChildren,
    },
    inserted,
  };
}

function createPlacementNode(
  target: LayoutNode,
  panelId: string,
  placement: PanelPlacement,
  containerSize: PanelContainerSize | undefined,
  splitIds?: Set<string>,
): LayoutNode {
  const panelNode: LayoutNode = { kind: 'panel', panelId };
  const region = placement.region;

  if (region === 'center') {
    if (target.kind === 'split') {
      const insertion = insertPanelIntoSplit(target, panelNode);
      return insertion.viewMode === 'tabs' ? { ...insertion, activeId: panelId } : insertion;
    }
    return {
      kind: 'split',
      splitId: createSplitId(splitIds),
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      viewMode: 'tabs',
      activeId: panelId,
      children: [target, panelNode],
    };
  }

  const direction = region === 'left' || region === 'right' ? 'horizontal' : 'vertical';
  const primaryFirst = region === 'left' || region === 'top';
  const children = primaryFirst ? [panelNode, target] : [target, panelNode];
  const ratio = resolveSplitRatio(placement, containerSize, primaryFirst);

  return {
    kind: 'split',
    splitId: createSplitId(splitIds),
    direction,
    sizes: [ratio, 1 - ratio],
    children,
  };
}

function resolveSplitRatio(
  placement: PanelPlacement,
  containerSize: PanelContainerSize | undefined,
  primaryFirst: boolean,
): number {
  const region = placement.region;
  const size = placement.size;
  if (!size || !containerSize) {
    return 0.5;
  }

  const available =
    region === 'left' || region === 'right' ? containerSize.width : containerSize.height;
  const desired = region === 'left' || region === 'right' ? size.width : size.height;
  if (!available || !desired || desired <= 0) {
    return 0.5;
  }

  const portion = clamp(desired / available, 0.05, 0.95);
  return primaryFirst ? portion : 1 - portion;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createSplitId(existing: Set<string> | undefined): string {
  if (!existing) {
    return `split-${Math.random().toString(36).slice(2, 10)}`;
  }
  let index = existing.size + 1;
  let candidate = `split-${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `split-${index}`;
  }
  existing.add(candidate);
  return candidate;
}

function insertPanelIntoSplit(
  split: LayoutNode & { kind: 'split' },
  panel: LayoutNode,
  targetIndex?: number,
): LayoutNode & { kind: 'split' } {
  const safeIndex =
    typeof targetIndex === 'number' && targetIndex >= 0 ? targetIndex : split.children.length - 1;
  const insertIndex = safeIndex + 1;
  const nextChildren = split.children.slice();
  nextChildren.splice(insertIndex, 0, panel);

  const baseSizes = normalizeSplitSizes(split.sizes, split.children.length);
  const nextSizes = baseSizes.slice();
  const targetSize = nextSizes[safeIndex] ?? 1 / nextChildren.length;
  const half = targetSize / 2;
  nextSizes[safeIndex] = half;
  nextSizes.splice(insertIndex, 0, half);

  return {
    ...split,
    children: nextChildren,
    sizes: normalizeSplitSizes(nextSizes, nextChildren.length),
  };
}

export function normalizeSplitSizes(sizes: number[] | undefined, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (!sizes || sizes.length !== count) {
    return new Array(count).fill(1 / count);
  }
  const total = sizes.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0);
  if (!Number.isFinite(total) || total <= 0) {
    return new Array(count).fill(1 / count);
  }
  return sizes.map((value) => (Number.isFinite(value) && value > 0 ? value / total : 0));
}
