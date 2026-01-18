import type { SessionAttributes, SessionAttributesPatch } from '@assistant/shared';

export type ProviderAttributes = Record<string, unknown>;

export function getProviderAttributes(
  attributes: SessionAttributes | undefined,
  providerId: string | null | undefined,
  legacyKeys: string[] = [],
): ProviderAttributes | null {
  if (!attributes || typeof attributes !== 'object') {
    return null;
  }
  const providers = (attributes as Record<string, unknown>)['providers'];
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return null;
  }

  const providerRecord = providers as Record<string, unknown>;
  const keys: string[] = [];

  if (providerId && providerId.trim().length > 0) {
    keys.push(providerId.trim());
  }
  for (const legacyKey of legacyKeys) {
    if (legacyKey && legacyKey.trim().length > 0) {
      keys.push(legacyKey.trim());
    }
  }

  for (const key of keys) {
    const entry = providerRecord[key];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return entry as ProviderAttributes;
    }
  }

  return null;
}

export function buildProviderAttributesPatch(
  providerId: string,
  value: ProviderAttributes,
  legacyKeys: string[] = [],
): SessionAttributesPatch {
  const providers: Record<string, unknown> = {};
  const trimmed = providerId.trim();
  if (trimmed) {
    providers[trimmed] = value;
  }

  for (const legacyKey of legacyKeys) {
    const key = legacyKey.trim();
    if (!key || key in providers) {
      continue;
    }
    providers[key] = value;
  }

  if (Object.keys(providers).length === 0) {
    return {};
  }

  return { providers };
}
