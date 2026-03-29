import type { SessionContextUsage } from '@assistant/shared';

export type ContextUsageTone = 'normal' | 'warning' | 'error';

export function formatContextUsagePercent(
  contextUsage: SessionContextUsage | null | undefined,
): string | null {
  if (!contextUsage) {
    return null;
  }
  const value = contextUsage.availablePercent;
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.max(0, Math.min(100, Math.round(value)));
  return `${rounded}%`;
}

export function getContextUsageTone(
  contextUsage: SessionContextUsage | null | undefined,
): ContextUsageTone | null {
  if (!contextUsage) {
    return null;
  }
  const value = contextUsage.availablePercent;
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return 'error';
  }
  if (value < 30) {
    return 'warning';
  }
  return 'normal';
}

const CONTEXT_USAGE_TONE_CLASSES = [
  'context-usage-normal',
  'context-usage-warning',
  'context-usage-error',
] as const;

export function applyContextUsageBadge(
  element: HTMLElement,
  contextUsage: SessionContextUsage | null | undefined,
): void {
  const label = formatContextUsagePercent(contextUsage);
  element.classList.remove(...CONTEXT_USAGE_TONE_CLASSES);
  if (!label) {
    element.textContent = '';
    element.classList.add('hidden');
    return;
  }
  element.textContent = label;
  const tone = getContextUsageTone(contextUsage);
  if (tone) {
    element.classList.add(`context-usage-${tone}`);
  }
  element.classList.remove('hidden');
}

export function createContextUsageBadge(
  className: string,
  contextUsage: SessionContextUsage | null | undefined,
): HTMLSpanElement | null {
  const label = formatContextUsagePercent(contextUsage);
  if (!label) {
    return null;
  }
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = label;
  const tone = getContextUsageTone(contextUsage);
  if (tone) {
    badge.classList.add(`context-usage-${tone}`);
  }
  return badge;
}
