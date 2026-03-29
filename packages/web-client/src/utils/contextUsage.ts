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
