export type DiffHunkDescriptor = {
  path: string;
  hunkIndex: number;
  listIndex?: number;
  hunkHash: string;
  header?: string;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
};

export type DiffHunkSnapshot = {
  panelId: string;
  target: 'working' | 'staged';
  repoPath?: string;
  path?: string;
  hunks: DiffHunkDescriptor[];
  updatedAt: string;
};

export type DiffHunkSelection = DiffHunkDescriptor & {
  panelId: string;
  target: 'working' | 'staged';
  repoPath?: string;
  updatedAt: string;
};

type DiffPanelState = {
  panelId: string;
  snapshot: DiffHunkSnapshot | null;
  selection: DiffHunkSelection | null;
};

const panelState = new Map<string, DiffPanelState>();

function ensureState(panelId: string): DiffPanelState {
  const existing = panelState.get(panelId);
  if (existing) {
    return existing;
  }
  const next: DiffPanelState = {
    panelId,
    snapshot: null,
    selection: null,
  };
  panelState.set(panelId, next);
  return next;
}

function normalizeTarget(value: unknown): 'working' | 'staged' {
  if (value === 'staged') {
    return 'staged';
  }
  return 'working';
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeDescriptor(raw: unknown): DiffHunkDescriptor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const path = normalizeString(obj['path']);
  const hunkHash = normalizeString(obj['hunkHash']);
  const hunkIndex = normalizeNumber(obj['hunkIndex']);
  if (!path || !hunkHash || hunkIndex === undefined) {
    return null;
  }
  const descriptor: DiffHunkDescriptor = {
    path,
    hunkIndex,
    hunkHash,
  };
  const listIndex = normalizeNumber(obj['listIndex']);
  if (listIndex !== undefined) {
    descriptor.listIndex = listIndex;
  }
  const header = normalizeString(obj['header']);
  if (header) {
    descriptor.header = header;
  }
  const oldStart = normalizeNumber(obj['oldStart']);
  if (oldStart !== undefined) {
    descriptor.oldStart = oldStart;
  }
  const oldLines = normalizeNumber(obj['oldLines']);
  if (oldLines !== undefined) {
    descriptor.oldLines = oldLines;
  }
  const newStart = normalizeNumber(obj['newStart']);
  if (newStart !== undefined) {
    descriptor.newStart = newStart;
  }
  const newLines = normalizeNumber(obj['newLines']);
  if (newLines !== undefined) {
    descriptor.newLines = newLines;
  }
  return descriptor;
}

function updateSelectionWithSnapshot(
  selection: DiffHunkSelection,
  snapshot: DiffHunkSnapshot | null,
): DiffHunkSelection {
  if (!snapshot) {
    return selection;
  }
  const match = snapshot.hunks.find(
    (entry) => entry.path === selection.path && entry.hunkHash === selection.hunkHash,
  );
  if (!match) {
    return selection;
  }
  const next: DiffHunkSelection = { ...selection };
  if (next.header === undefined && match.header !== undefined) {
    next.header = match.header;
  }
  if (next.listIndex === undefined && match.listIndex !== undefined) {
    next.listIndex = match.listIndex;
  }
  if (next.oldStart === undefined && match.oldStart !== undefined) {
    next.oldStart = match.oldStart;
  }
  if (next.oldLines === undefined && match.oldLines !== undefined) {
    next.oldLines = match.oldLines;
  }
  if (next.newStart === undefined && match.newStart !== undefined) {
    next.newStart = match.newStart;
  }
  if (next.newLines === undefined && match.newLines !== undefined) {
    next.newLines = match.newLines;
  }
  return next;
}

export function updateDiffHunksSnapshot(panelId: string, raw: unknown): DiffHunkSnapshot {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hunksRaw = obj['hunks'];
  const hunks: DiffHunkDescriptor[] = Array.isArray(hunksRaw)
    ? hunksRaw.map(normalizeDescriptor).filter((entry): entry is DiffHunkDescriptor => !!entry)
    : [];
  const snapshot: DiffHunkSnapshot = {
    panelId,
    target: normalizeTarget(obj['target']),
    hunks,
    updatedAt: new Date().toISOString(),
  };
  const repoPath = normalizeString(obj['repoPath']);
  if (repoPath) {
    snapshot.repoPath = repoPath;
  }
  const selectedPath = normalizeString(obj['path']) ?? hunks[0]?.path;
  if (selectedPath) {
    snapshot.path = selectedPath;
  }

  const state = ensureState(panelId);
  state.snapshot = snapshot;
  if (state.selection) {
    state.selection = updateSelectionWithSnapshot(state.selection, snapshot);
  }
  return snapshot;
}

export function updateDiffSelection(panelId: string, raw: unknown): DiffHunkSelection | null {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const selectionRaw = obj['selection'] ?? raw;
  const descriptor = normalizeDescriptor(selectionRaw);
  if (!descriptor) {
    return null;
  }
  const state = ensureState(panelId);
  const hasTarget = obj['target'] !== undefined;
  const target = hasTarget ? normalizeTarget(obj['target']) : (state.snapshot?.target ?? 'working');
  const selection: DiffHunkSelection = {
    ...descriptor,
    panelId,
    target,
    updatedAt: new Date().toISOString(),
  };
  const repoPath = normalizeString(obj['repoPath']);
  if (repoPath) {
    selection.repoPath = repoPath;
  }

  state.selection = updateSelectionWithSnapshot(selection, state.snapshot);
  return state.selection;
}

export function clearDiffSelection(panelId: string): void {
  const state = ensureState(panelId);
  state.selection = null;
}

export function clearDiffPanelState(panelId: string): void {
  panelState.delete(panelId);
}

export function getDiffSnapshot(panelId: string): DiffHunkSnapshot | null {
  return panelState.get(panelId)?.snapshot ?? null;
}

export function getDiffSelection(panelId: string): DiffHunkSelection | null {
  return panelState.get(panelId)?.selection ?? null;
}
