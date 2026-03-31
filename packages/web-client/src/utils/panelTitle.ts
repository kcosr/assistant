import type { PanelInstance } from '@assistant/shared';

export const MAX_PANEL_CUSTOM_TITLE_LENGTH = 60;

function normalizeTitlePart(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePanelCustomTitle(value: string | null | undefined): string | null {
  return normalizeTitlePart(value);
}

export function validatePanelCustomTitle(value: string): string | null {
  const normalized = normalizePanelCustomTitle(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > MAX_PANEL_CUSTOM_TITLE_LENGTH) {
    return `Panel name must be ${MAX_PANEL_CUSTOM_TITLE_LENGTH} characters or fewer.`;
  }
  return null;
}

export function resolvePanelDisplayTitle(
  panel: Pick<PanelInstance, 'panelType' | 'meta' | 'customTitle'> | null | undefined,
  options?: {
    synthesizedTitle?: string | null;
    manifestTitle?: string | null;
    fallbackTitle?: string;
  },
): string {
  if (!panel) {
    return options?.fallbackTitle ?? 'Panel';
  }

  const customTitle = normalizeTitlePart(panel.customTitle);
  if (customTitle) {
    return customTitle;
  }

  const synthesizedTitle = normalizeTitlePart(options?.synthesizedTitle);
  if (synthesizedTitle) {
    return synthesizedTitle;
  }

  const metaTitle = normalizeTitlePart(panel.meta?.title);
  if (metaTitle) {
    return metaTitle;
  }

  const manifestTitle = normalizeTitlePart(options?.manifestTitle);
  if (manifestTitle) {
    return manifestTitle;
  }

  return panel.panelType;
}

export function resolvePanelFallbackTitle(
  panel: Pick<PanelInstance, 'panelType' | 'meta'> | null | undefined,
  options?: {
    synthesizedTitle?: string | null;
    manifestTitle?: string | null;
    fallbackTitle?: string;
  },
): string {
  if (!panel) {
    return options?.fallbackTitle ?? 'Panel';
  }

  const synthesizedTitle = normalizeTitlePart(options?.synthesizedTitle);
  if (synthesizedTitle) {
    return synthesizedTitle;
  }

  const metaTitle = normalizeTitlePart(panel.meta?.title);
  if (metaTitle) {
    return metaTitle;
  }

  const manifestTitle = normalizeTitlePart(options?.manifestTitle);
  if (manifestTitle) {
    return manifestTitle;
  }

  return panel.panelType;
}

function formatSynthesizedInstanceSuffix(instanceLabel: string | null | undefined): string {
  const normalized = normalizeTitlePart(instanceLabel);
  if (!normalized || normalized.toLowerCase() === 'default') {
    return '';
  }
  return ` (${normalized})`;
}

export function synthesizePanelEntityTitle(options: {
  entityTitle: string | null | undefined;
  instanceLabel?: string | null;
}): string | null {
  const entityTitle = normalizeTitlePart(options.entityTitle);
  if (!entityTitle) {
    return null;
  }
  return `${entityTitle}${formatSynthesizedInstanceSuffix(options.instanceLabel)}`;
}
