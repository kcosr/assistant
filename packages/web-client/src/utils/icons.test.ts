import { describe, it, expect } from 'vitest';

import { ICONS } from './icons';

describe('ICONS', () => {
  it('uses the pin emoji for pinned entries', () => {
    expect(ICONS.pin).toBe('📍');
  });
});
