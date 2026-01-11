import type {
  LayoutNode,
  LayoutPersistence,
  PanelInstance,
  PanelPlacement,
  PanelTypeManifest,
} from '@assistant/shared';
import { insertPanel } from './layoutTree';

export const DEFAULT_PANEL_IDS = {
  sessions: 'sessions-1',
  chat: 'chat-1',
} as const;

const REGION_ORDER: Record<PanelPlacement['region'], number> = {
  center: 0,
  left: 1,
  right: 2,
  top: 3,
  bottom: 4,
};

export function createDefaultPanelLayout(manifests: PanelTypeManifest[]): LayoutPersistence {
  const openManifests = manifests.filter((manifest) => manifest.defaultPlacement);
  const resolvedManifests = openManifests.length > 0 ? openManifests : manifests;
  if (resolvedManifests.length === 0) {
    throw new Error('No panels registered.');
  }

  const usedIds = new Set<string>();
  const panels: Record<string, PanelInstance> = {};
  const resolved = resolvedManifests.map((manifest, index) => {
    const panelId = resolvePanelId(manifest.type, usedIds);
    panels[panelId] = { panelId, panelType: manifest.type };
    return { manifest, panelId, index };
  });

  const ordered = resolved.slice().sort((a, b) => {
    const regionA: PanelPlacement['region'] = a.manifest.defaultPlacement?.region ?? 'center';
    const regionB: PanelPlacement['region'] = b.manifest.defaultPlacement?.region ?? 'center';
    const orderA = REGION_ORDER[regionA];
    const orderB = REGION_ORDER[regionB];
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.index - b.index;
  });

  let layout: LayoutNode | null = null;
  for (const entry of ordered) {
    const placement = entry.manifest.defaultPlacement ?? { region: 'center' };
    if (!layout) {
      layout = { kind: 'panel', panelId: entry.panelId };
      continue;
    }
    layout = insertPanel(layout, entry.panelId, placement);
  }

  if (!layout) {
    throw new Error('Failed to create default panel layout.');
  }

  return { layout, panels, headerPanels: [], headerPanelSizes: {} };
}

function resolvePanelId(panelType: string, usedIds: Set<string>): string {
  const defaultId = DEFAULT_PANEL_IDS[panelType as keyof typeof DEFAULT_PANEL_IDS];
  if (defaultId && !usedIds.has(defaultId)) {
    usedIds.add(defaultId);
    return defaultId;
  }

  let index = 1;
  let candidate = `${panelType}-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${panelType}-${index}`;
  }
  usedIds.add(candidate);
  return candidate;
}
