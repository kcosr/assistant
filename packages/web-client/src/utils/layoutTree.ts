import type { LayoutNode, LayoutTab, PanelPlacement } from '@assistant/shared';

export interface PanelContainerSize {
  width: number;
  height: number;
}

export type LayoutPath = number[];

export function collectSplitIds(node: LayoutNode): string[] {
  if (node.kind === 'pane') {
    return [];
  }
  return [node.splitId, ...node.children.flatMap((child) => collectSplitIds(child))];
}

export function findPanelPath(node: LayoutNode, panelId: string): LayoutPath | null {
  if (node.kind === 'pane') {
    return node.tabs.some((tab) => tab.panelId === panelId) ? [] : null;
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
  if (node.kind === 'pane') {
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
  if (node.kind === 'pane') {
    return node.tabs.map((tab) => tab.panelId);
  }
  return node.children.flatMap((child) => collectPanelIds(child));
}

export function containsPanelId(node: LayoutNode, panelId: string): boolean {
  return collectPanelIds(node).includes(panelId);
}

export function findFirstPanelId(node: LayoutNode): string | null {
  if (node.kind === 'pane') {
    return node.tabs[0]?.panelId ?? null;
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
  if (node.kind === 'pane') {
    return new Set([resolveActivePanelId(node)]);
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
  if (node.kind === 'pane') {
    return [resolveActivePanelId(node)];
  }
  const ordered: string[] = [];
  for (const child of node.children) {
    ordered.push(...collectVisiblePanelIdsInOrder(child));
  }
  return ordered;
}

export function removePanel(node: LayoutNode, panelId: string): LayoutNode | null {
  if (node.kind === 'pane') {
    const nextTabs = node.tabs.filter((tab) => tab.panelId !== panelId);
    if (nextTabs.length === node.tabs.length) {
      return node;
    }
    if (nextTabs.length === 0) {
      return null;
    }
    const nextActivePanelId =
      node.activePanelId === panelId ? nextTabs[0]!.panelId : node.activePanelId;
    return {
      ...node,
      tabs: nextTabs,
      activePanelId: nextTabs.some((tab) => tab.panelId === nextActivePanelId)
        ? nextActivePanelId
        : nextTabs[0]!.panelId,
    };
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

  return {
    kind: 'split',
    splitId: node.splitId,
    direction: node.direction,
    sizes: normalizeSplitSizes(nextSizes, nextChildren.length),
    children: nextChildren,
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
  const paneIds = new Set(collectPaneIds(node));
  if (targetPanelId) {
    const result = insertPanelRelative(
      node,
      panelId,
      placement,
      targetPanelId,
      containerSize,
      splitIds,
      paneIds,
    );
    if (result.inserted) {
      return result.node;
    }
  }

  return createPlacementNode(node, panelId, placement, containerSize, splitIds, paneIds);
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
    return createPaneNode(panelId);
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
  paneIds: Set<string>,
): { node: LayoutNode; inserted: boolean } {
  if (node.kind === 'pane') {
    if (!containsPanelId(node, targetPanelId)) {
      return { node, inserted: false };
    }
    return {
      node: createPlacementNode(node, panelId, placement, containerSize, splitIds, paneIds, {
        targetPanelId,
      }),
      inserted: true,
    };
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
      paneIds,
    );
    inserted = result.inserted;
    return result.node;
  });

  if (!inserted) {
    return { node, inserted: false };
  }

  return {
    node: {
      ...node,
      children: nextChildren,
    },
    inserted: true,
  };
}

function createPlacementNode(
  target: LayoutNode,
  panelId: string,
  placement: PanelPlacement,
  containerSize: PanelContainerSize | undefined,
  splitIds: Set<string>,
  paneIds: Set<string>,
  options?: { targetPanelId?: string },
): LayoutNode {
  const region = placement.region;

  if (region === 'center') {
    if (target.kind === 'pane') {
      const insertionIndex = options?.targetPanelId
        ? target.tabs.findIndex((tab) => tab.panelId === options.targetPanelId)
        : target.tabs.length - 1;
      return insertPanelIntoPane(target, panelId, insertionIndex);
    }
    return insertPanelIntoLastPane(target, panelId);
  }

  const paneNode = createPaneNode(panelId, paneIds);
  const direction = region === 'left' || region === 'right' ? 'horizontal' : 'vertical';
  const primaryFirst = region === 'left' || region === 'top';
  const children = primaryFirst ? [paneNode, target] : [target, paneNode];
  const ratio = resolveSplitRatio(placement, containerSize, primaryFirst);

  return {
    kind: 'split',
    splitId: createSplitId(splitIds),
    direction,
    sizes: [ratio, 1 - ratio],
    children,
  };
}

function insertPanelIntoLastPane(node: LayoutNode, panelId: string): LayoutNode {
  if (node.kind === 'pane') {
    return insertPanelIntoPane(node, panelId);
  }
  const nextChildren = node.children.slice();
  for (let index = nextChildren.length - 1; index >= 0; index -= 1) {
    const child = nextChildren[index];
    if (!child) {
      continue;
    }
    if (containsAnyPane(child)) {
      nextChildren[index] = insertPanelIntoLastPane(child, panelId);
      return {
        ...node,
        children: nextChildren,
      };
    }
  }
  return node;
}

function containsAnyPane(node: LayoutNode): boolean {
  if (node.kind === 'pane') {
    return true;
  }
  return node.children.some((child) => containsAnyPane(child));
}

function insertPanelIntoPane(
  pane: Extract<LayoutNode, { kind: 'pane' }>,
  panelId: string,
  targetIndex?: number,
): Extract<LayoutNode, { kind: 'pane' }> {
  const safeIndex =
    typeof targetIndex === 'number' && targetIndex >= 0 ? targetIndex : pane.tabs.length - 1;
  const nextTabs = pane.tabs.slice();
  nextTabs.splice(safeIndex + 1, 0, createPaneTab(panelId));
  return {
    ...pane,
    tabs: nextTabs,
    activePanelId: panelId,
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

function collectPaneIds(node: LayoutNode): string[] {
  if (node.kind === 'pane') {
    return [node.paneId];
  }
  return node.children.flatMap((child) => collectPaneIds(child));
}

function createPaneId(existing?: Set<string>): string {
  if (!existing) {
    return `pane-${Math.random().toString(36).slice(2, 10)}`;
  }
  let index = existing.size + 1;
  let candidate = `pane-${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `pane-${index}`;
  }
  existing.add(candidate);
  return candidate;
}

function createPaneTab(panelId: string): LayoutTab {
  return { panelId };
}

export function createPaneNode(
  panelId: string,
  existingPaneIds?: Set<string>,
): Extract<LayoutNode, { kind: 'pane' }> {
  return {
    kind: 'pane',
    paneId: createPaneId(existingPaneIds),
    tabs: [createPaneTab(panelId)],
    activePanelId: panelId,
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

function resolveActivePanelId(node: Extract<LayoutNode, { kind: 'pane' }>): string {
  if (node.tabs.some((tab) => tab.panelId === node.activePanelId)) {
    return node.activePanelId;
  }
  return node.tabs[0]!.panelId;
}
