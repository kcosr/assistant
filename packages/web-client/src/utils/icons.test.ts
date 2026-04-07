import { describe, it, expect } from 'vitest';

import { ICONS } from './icons';

describe('ICONS', () => {
  it('uses the pin emoji for pinned entries', () => {
    expect(ICONS.pin).toBe('📍');
  });

  it('includes an inbox svg for notifications panels', () => {
    expect(ICONS.inbox).toContain('<svg');
    expect(ICONS.inbox).toContain('viewBox="0 0 24 24"');
  });
});
