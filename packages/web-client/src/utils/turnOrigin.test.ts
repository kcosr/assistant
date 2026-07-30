// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebTurnOriginId } from './turnOrigin';

describe('createWebTurnOriginId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a fresh browser UUID when available', () => {
    vi.spyOn(window.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');

    expect(createWebTurnOriginId()).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(window.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to a bounded ephemeral identifier without randomUUID', () => {
    const originalCrypto = window.crypto;
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: {},
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const turnOriginId = createWebTurnOriginId();

    expect(turnOriginId).toMatch(/^web-[a-z0-9]+-[a-f0-9]+$/);
    expect(turnOriginId.length).toBeLessThanOrEqual(128);

    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });
});
