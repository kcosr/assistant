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
    manifestTitle?: string | null;
    fallbackTitle?: string;
  },
): string {
  if (!panel) {
    return options?.fallbackTitle ?? 'Panel';
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
