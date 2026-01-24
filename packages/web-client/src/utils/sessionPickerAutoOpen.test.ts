import { describe, expect, it } from 'vitest';
import { shouldAutoOpenSessionPicker } from './sessionPickerAutoOpen';

describe('shouldAutoOpenSessionPicker', () => {
  it('opens only when active, unbound, and not opened before', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        isActive: true,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(true);
  });

  it('skips when a session is already bound', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: true,
        isActive: true,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when panel is not active', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        isActive: false,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when anchor is missing', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        isActive: true,
        hasAnchor: false,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when already opened once', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        isActive: true,
        hasAnchor: true,
        alreadyOpened: true,
      }),
    ).toBe(false);
  });
});
