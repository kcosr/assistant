import type { PanelTypeManifest } from '@assistant/shared';

export type PanelAvailability =
  | { state: 'available' }
  | { state: 'loading' }
  | { state: 'unavailable'; reason: string; missingCapabilities?: string[] };

export type PanelAvailabilityContext = {
  allowedPanelTypes?: Set<string> | null;
  availableCapabilities?: Set<string> | null;
};

export function resolvePanelAvailability(
  panelType: string,
  manifest: PanelTypeManifest | null,
  context: PanelAvailabilityContext,
): PanelAvailability {
  const allowed = context.allowedPanelTypes ?? null;
  const available = context.availableCapabilities ?? null;

  if (!allowed || !available) {
    return { state: 'loading' };
  }

  if (!allowed.has(panelType)) {
    return {
      state: 'unavailable',
      reason: 'Panel type is not enabled on the server.',
    };
  }

  if (!manifest) {
    return {
      state: 'unavailable',
      reason: 'Panel manifest is not registered in the client.',
    };
  }

  const required = manifest.capabilities ?? [];
  if (required.length === 0) {
    return { state: 'available' };
  }

  const missing = required.filter((capability) => !available.has(capability));
  if (missing.length > 0) {
    return {
      state: 'unavailable',
      reason: 'Required capabilities are not available.',
      missingCapabilities: missing,
    };
  }

  return { state: 'available' };
}
