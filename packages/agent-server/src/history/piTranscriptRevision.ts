import type { SessionAttributes, SessionAttributesPatch } from '@assistant/shared';

import { buildProviderAttributesPatch, getProviderAttributes } from './providerAttributes';

export const DEFAULT_PI_TRANSCRIPT_REVISION = 1;

function normalizePiTranscriptRevision(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : null;
}

export function getPiTranscriptRevision(attributes: SessionAttributes | undefined): number {
  const providerInfo = getProviderAttributes(attributes, 'pi', ['pi-cli']);
  const revision = normalizePiTranscriptRevision(providerInfo?.['transcriptRevision']);
  return revision ?? DEFAULT_PI_TRANSCRIPT_REVISION;
}

export function getNextPiTranscriptRevision(attributes: SessionAttributes | undefined): number {
  return getPiTranscriptRevision(attributes) + 1;
}

export function buildPiTranscriptRevisionPatch(options: {
  revision: number;
  clearSessionReference?: boolean;
}): SessionAttributesPatch {
  const normalizedRevision = Math.max(1, Math.trunc(options.revision));
  const value: Record<string, unknown> = {
    transcriptRevision: normalizedRevision,
  };
  if (options.clearSessionReference) {
    value['sessionId'] = null;
    value['cwd'] = null;
  }
  return buildProviderAttributesPatch('pi', value, ['pi-cli']);
}
