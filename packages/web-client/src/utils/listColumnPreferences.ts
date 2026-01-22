import type { SortState } from './listSorting';
import { apiFetch } from './api';

export type ColumnVisibility = 'always-show' | 'show-with-data' | 'hide-in-compact' | 'always-hide';

export interface ListColumnConfig {
  width?: number;
  visibility?: ColumnVisibility;
}

export type ListColumnPreferences = Record<string, ListColumnConfig>;

export interface ListViewPreferences {
  columns?: ListColumnPreferences;
  sortState?: SortState | null;
  timelineField?: string | null;
  focusMarkerItemId?: string | null;
  focusMarkerExpanded?: boolean | null;
}

export interface ViewDisplayPreferences {
  expandedMode?: boolean;
  columns?: ListColumnPreferences;
}

interface PreferencesResponse {
  listColumns?: Record<string, ListColumnPreferences>;
  listViewPrefs?: Record<string, ListViewPreferences>;
  viewPrefs?: Record<string, ViewDisplayPreferences>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVisibility(value: unknown): ColumnVisibility | undefined {
  if (value === 'always-show') return 'always-show';
  if (value === 'show-with-data') return 'show-with-data';
  if (value === 'hide-in-compact') return 'hide-in-compact';
  if (value === 'always-hide') return 'always-hide';
  return undefined;
}

function normalizeWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return undefined;
  }
  return rounded;
}

function normalizeSortState(value: unknown): SortState | undefined {
  if (!isRecord(value)) return undefined;
  const column = value['column'];
  const direction = value['direction'];
  if (typeof column !== 'string' || !column.trim()) return undefined;
  if (direction !== 'asc' && direction !== 'desc') return undefined;
  return { column: column.trim(), direction };
}

function normalizeTimelineField(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
}

function normalizeFocusMarkerItemId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
}

function normalizeFocusMarkerExpanded(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}


export class ListColumnPreferencesClient {
  private listColumns: Record<string, ListColumnPreferences> = {};
  private listViewPrefs: Record<string, ListViewPreferences> = {};
  private viewPrefs: Record<string, ViewDisplayPreferences> = {};

  async load(): Promise<void> {
    try {
      const response = await apiFetch('/preferences');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as unknown;
      const prefs = this.parsePreferencesResponse(data);
      if (prefs.listColumns) {
        this.listColumns = prefs.listColumns;
      }
      if (prefs.listViewPrefs) {
        this.listViewPrefs = prefs.listViewPrefs;
      }
      if (prefs.viewPrefs) {
        this.viewPrefs = prefs.viewPrefs;
      }
    } catch {
      // Ignore network errors when loading preferences.
    }
  }

  getListPreferences(listId: string): ListColumnPreferences | null {
    if (!listId) return null;
    // Check new structure first, fall back to legacy
    const viewPrefs = this.listViewPrefs[listId];
    if (viewPrefs?.columns && Object.keys(viewPrefs.columns).length > 0) {
      return viewPrefs.columns;
    }
    const prefs = this.listColumns[listId];
    if (!prefs || Object.keys(prefs).length === 0) {
      return null;
    }
    return prefs;
  }

  getColumnConfig(listId: string, columnKey: string): ListColumnConfig | null {
    if (!listId || !columnKey) return null;
    const listPrefs = this.getListPreferences(listId);
    if (!listPrefs) return null;
    const config = listPrefs[columnKey];
    if (!config) return null;
    const width = normalizeWidth(config.width);
    const visibility = normalizeVisibility(config.visibility);
    const hasWidth = typeof width === 'number';
    const hasVisibility = !!visibility;
    if (!hasWidth && !hasVisibility) {
      return null;
    }
    const result: ListColumnConfig = {};
    if (hasWidth) {
      result.width = width;
    }
    if (hasVisibility) {
      result.visibility = visibility;
    }
    return result;
  }

  getSortState(listId: string): SortState | null {
    if (!listId) return null;
    const viewPrefs = this.listViewPrefs[listId];
    return viewPrefs?.sortState ?? null;
  }

  getTimelineField(listId: string): string | null {
    if (!listId) return null;
    const viewPrefs = this.listViewPrefs[listId];
    return viewPrefs?.timelineField ?? null;
  }

  getFocusMarkerItemId(listId: string): string | null {
    if (!listId) return null;
    const viewPrefs = this.listViewPrefs[listId];
    return viewPrefs?.focusMarkerItemId ?? null;
  }

  getFocusMarkerExpanded(listId: string): boolean {
    if (!listId) return false;
    const viewPrefs = this.listViewPrefs[listId];
    return viewPrefs?.focusMarkerExpanded ?? false;
  }


  async updateColumn(
    listId: string,
    columnKey: string,
    patch: Partial<ListColumnConfig>,
  ): Promise<void> {
    const trimmedListId = listId.trim();
    const trimmedColumnKey = columnKey.trim();
    if (!trimmedListId || !trimmedColumnKey) {
      return;
    }

    const width = patch.width;
    const visibility = patch.visibility;

    const normalizedWidth =
      width === undefined
        ? undefined
        : (normalizeWidth(width) ??
          normalizeWidth(this.getColumnConfig(trimmedListId, trimmedColumnKey)?.width));
    const normalizedVisibility =
      visibility === undefined ? undefined : normalizeVisibility(visibility);

    const hasWidthUpdate = normalizedWidth !== undefined;
    const hasVisibilityUpdate = normalizedVisibility !== undefined;

    if (!hasWidthUpdate && !hasVisibilityUpdate) {
      return;
    }

    // Update local state
    const localList = (this.listColumns[trimmedListId] ??= {});
    const localConfig: ListColumnConfig = localList[trimmedColumnKey] ?? {};
    if (hasWidthUpdate) {
      localConfig.width = normalizedWidth;
    }
    if (hasVisibilityUpdate) {
      localConfig.visibility = normalizedVisibility;
    }
    localList[trimmedColumnKey] = localConfig;

    const payloadConfig: ListColumnConfig = {};
    if (hasWidthUpdate) {
      payloadConfig.width = normalizedWidth;
    }
    if (hasVisibilityUpdate) {
      payloadConfig.visibility = normalizedVisibility;
    }

    const body: PreferencesResponse = {
      listColumns: {
        [trimmedListId]: {
          [trimmedColumnKey]: payloadConfig,
        },
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }

  async updateSortState(listId: string, sortState: SortState | null): Promise<void> {
    const trimmedListId = listId.trim();
    if (!trimmedListId) return;

    // Update local state
    const localPrefs = (this.listViewPrefs[trimmedListId] ??= {});
    if (sortState) {
      localPrefs.sortState = sortState;
    } else {
      delete localPrefs.sortState;
    }

    const viewPrefsPayload: ListViewPreferences = {
      sortState: sortState ?? null,
    };

    const body: PreferencesResponse = {
      listViewPrefs: {
        [trimmedListId]: viewPrefsPayload,
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }

  async updateTimelineField(listId: string, timelineField: string | null): Promise<void> {
    const trimmedListId = listId.trim();
    if (!trimmedListId) return;

    // Update local state
    const localPrefs = (this.listViewPrefs[trimmedListId] ??= {});
    localPrefs.timelineField = timelineField;

    const body: PreferencesResponse = {
      listViewPrefs: {
        [trimmedListId]: {
          timelineField,
        },
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }

  async updateFocusMarker(
    listId: string,
    focusMarkerItemId: string | null,
    focusMarkerExpanded?: boolean,
  ): Promise<void> {
    const trimmedListId = listId.trim();
    if (!trimmedListId) return;

    // Update local state
    const localPrefs = (this.listViewPrefs[trimmedListId] ??= {});
    localPrefs.focusMarkerItemId = focusMarkerItemId;
    if (focusMarkerExpanded !== undefined) {
      localPrefs.focusMarkerExpanded = focusMarkerExpanded;
    }
    // If disabling focus view, also reset expanded state
    if (focusMarkerItemId === null) {
      delete localPrefs.focusMarkerExpanded;
    }

    const payload: ListViewPreferences = {
      focusMarkerItemId,
    };
    if (focusMarkerExpanded !== undefined) {
      payload.focusMarkerExpanded = focusMarkerExpanded;
    }
    if (focusMarkerItemId === null) {
      payload.focusMarkerExpanded = null;
    }

    const body: PreferencesResponse = {
      listViewPrefs: {
        [trimmedListId]: payload,
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }

  async updateFocusMarkerExpanded(listId: string, focusMarkerExpanded: boolean): Promise<void> {
    const trimmedListId = listId.trim();
    if (!trimmedListId) return;

    // Update local state
    const localPrefs = (this.listViewPrefs[trimmedListId] ??= {});
    localPrefs.focusMarkerExpanded = focusMarkerExpanded;

    const body: PreferencesResponse = {
      listViewPrefs: {
        [trimmedListId]: {
          focusMarkerExpanded,
        },
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }


  getViewDisplayPreferences(viewId: string): ViewDisplayPreferences | null {
    if (!viewId) return null;
    const prefs = this.viewPrefs[viewId];
    if (!prefs || Object.keys(prefs).length === 0) {
      return null;
    }
    return prefs;
  }

  async updateViewDisplayPreferences(
    viewId: string,
    patch: Partial<ViewDisplayPreferences>,
  ): Promise<void> {
    const trimmedViewId = viewId.trim();
    if (!trimmedViewId) return;

    // Update local state
    const localPrefs = (this.viewPrefs[trimmedViewId] ??= {});
    if (patch.expandedMode !== undefined) {
      localPrefs.expandedMode = patch.expandedMode;
    }
    if (patch.columns !== undefined) {
      localPrefs.columns = { ...localPrefs.columns, ...patch.columns };
    }

    const body: PreferencesResponse = {
      viewPrefs: {
        [trimmedViewId]: patch,
      },
    };

    try {
      await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore network errors while updating preferences; local optimistic state remains.
    }
  }

  private parsePreferencesResponse(input: unknown): PreferencesResponse {
    if (!isRecord(input)) {
      return {};
    }
    const result: PreferencesResponse = {};

    // Parse legacy listColumns
    const rawListColumns = input['listColumns'];
    if (isRecord(rawListColumns)) {
      const safeListColumns: Record<string, ListColumnPreferences> = {};
      for (const [listId, rawColumns] of Object.entries(rawListColumns)) {
        if (!isRecord(rawColumns)) continue;
        const listPrefs: ListColumnPreferences = {};
        for (const [columnKey, rawConfig] of Object.entries(rawColumns)) {
          if (!isRecord(rawConfig)) continue;
          const width = normalizeWidth(rawConfig['width']);
          const visibility = normalizeVisibility(rawConfig['visibility']);
          const config: ListColumnConfig = {};
          if (width !== undefined) {
            config.width = width;
          }
          if (visibility) {
            config.visibility = visibility;
          }
          if (Object.keys(config).length > 0) {
            listPrefs[columnKey] = config;
          }
        }
        if (Object.keys(listPrefs).length > 0) {
          safeListColumns[listId] = listPrefs;
        }
      }
      if (Object.keys(safeListColumns).length > 0) {
        result.listColumns = safeListColumns;
      }
    }

    // Parse new listViewPrefs
    const rawListViewPrefs = input['listViewPrefs'];
    if (isRecord(rawListViewPrefs)) {
      const safeListViewPrefs: Record<string, ListViewPreferences> = {};
      for (const [listId, rawPrefs] of Object.entries(rawListViewPrefs)) {
        if (!isRecord(rawPrefs)) continue;
        const viewPrefs: ListViewPreferences = {};

        // Parse columns
        const rawColumns = rawPrefs['columns'];
        if (isRecord(rawColumns)) {
          const columns: ListColumnPreferences = {};
          for (const [columnKey, rawConfig] of Object.entries(rawColumns)) {
            if (!isRecord(rawConfig)) continue;
            const width = normalizeWidth(rawConfig['width']);
            const visibility = normalizeVisibility(rawConfig['visibility']);
            const config: ListColumnConfig = {};
            if (width !== undefined) config.width = width;
            if (visibility) config.visibility = visibility;
            if (Object.keys(config).length > 0) {
              columns[columnKey] = config;
            }
          }
          if (Object.keys(columns).length > 0) {
            viewPrefs.columns = columns;
          }
        }

        // Parse sortState
        const sortState = normalizeSortState(rawPrefs['sortState']);
        if (sortState) {
          viewPrefs.sortState = sortState;
        }

        // Parse timelineField
        const timelineField = normalizeTimelineField(rawPrefs['timelineField']);
        if (timelineField !== undefined) {
          viewPrefs.timelineField = timelineField;
        }

        // Parse focusMarkerItemId
        const focusMarkerItemId = normalizeFocusMarkerItemId(rawPrefs['focusMarkerItemId']);
        if (focusMarkerItemId !== undefined) {
          viewPrefs.focusMarkerItemId = focusMarkerItemId;
        }

        // Parse focusMarkerExpanded
        const focusMarkerExpanded = normalizeFocusMarkerExpanded(rawPrefs['focusMarkerExpanded']);
        if (focusMarkerExpanded !== undefined) {
          viewPrefs.focusMarkerExpanded = focusMarkerExpanded;
        }


        if (Object.keys(viewPrefs).length > 0) {
          safeListViewPrefs[listId] = viewPrefs;
        }
      }
      if (Object.keys(safeListViewPrefs).length > 0) {
        result.listViewPrefs = safeListViewPrefs;
      }
    }

    // Parse viewPrefs (for saved views)
    const rawViewPrefs = input['viewPrefs'];
    if (isRecord(rawViewPrefs)) {
      const safeViewPrefs: Record<string, ViewDisplayPreferences> = {};
      for (const [viewId, rawPrefs] of Object.entries(rawViewPrefs)) {
        if (!isRecord(rawPrefs)) continue;
        const displayPrefs: ViewDisplayPreferences = {};

        if (typeof rawPrefs['expandedMode'] === 'boolean') {
          displayPrefs.expandedMode = rawPrefs['expandedMode'];
        }

        // Parse column preferences (same format as list columns)
        const rawColumns = rawPrefs['columns'];
        if (isRecord(rawColumns)) {
          const cols: ListColumnPreferences = {};
          for (const [colKey, rawConfig] of Object.entries(rawColumns)) {
            if (!isRecord(rawConfig)) continue;
            const config: ListColumnConfig = {};
            if (typeof rawConfig['width'] === 'number') {
              config.width = rawConfig['width'];
            }
            const vis = normalizeVisibility(rawConfig['visibility']);
            if (vis) {
              config.visibility = vis;
            }
            if (Object.keys(config).length > 0) {
              cols[colKey] = config;
            }
          }
          if (Object.keys(cols).length > 0) {
            displayPrefs.columns = cols;
          }
        }

        if (Object.keys(displayPrefs).length > 0) {
          safeViewPrefs[viewId] = displayPrefs;
        }
      }
      if (Object.keys(safeViewPrefs).length > 0) {
        result.viewPrefs = safeViewPrefs;
      }
    }

    return result;
  }
}
