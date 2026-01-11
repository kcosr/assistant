import path from 'node:path';

import type { SessionAttributes, SessionAttributesPatch } from '@assistant/shared';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete result[key];
      continue;
    }

    const existing = base[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeObjects(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function mergeSessionAttributes(
  base: SessionAttributes | undefined,
  patch: SessionAttributesPatch,
): SessionAttributes {
  if (!base) {
    return mergeObjects({}, patch);
  }
  return mergeObjects(base, patch);
}

export function validateSessionAttributesPatch(patch: Record<string, unknown>): void {
  const core = patch['core'];
  if (core === undefined || core === null) {
    return;
  }
  if (!isPlainObject(core)) {
    throw new Error('Session core attributes must be an object');
  }
  const corePatch = core as Record<string, unknown>;
  const workingDir = corePatch['workingDir'];
  if (workingDir !== undefined && workingDir !== null) {
    if (typeof workingDir !== 'string' || !workingDir.trim()) {
      throw new Error('core.workingDir must be a non-empty string');
    }
    if (!path.isAbsolute(workingDir)) {
      throw new Error('core.workingDir must be an absolute path');
    }
  }
  const activeBranch = corePatch['activeBranch'];
  if (activeBranch !== undefined && activeBranch !== null && typeof activeBranch !== 'string') {
    throw new Error('core.activeBranch must be a string');
  }
  const lastActiveAt = corePatch['lastActiveAt'];
  if (lastActiveAt !== undefined && lastActiveAt !== null && typeof lastActiveAt !== 'string') {
    throw new Error('core.lastActiveAt must be a string');
  }
}
