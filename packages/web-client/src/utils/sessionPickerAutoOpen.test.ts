import { describe, expect, it } from 'vitest';
import { shouldAutoOpenSessionPicker } from './sessionPickerAutoOpen';

describe('shouldAutoOpenSessionPicker', () => {
  it('opens only when requested, unbound, and not opened before', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        shouldOpen: true,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(true);
  });

  it('skips when a session is already bound', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: true,
        shouldOpen: true,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when open was not requested', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        shouldOpen: false,
        hasAnchor: true,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when anchor is missing', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        shouldOpen: true,
        hasAnchor: false,
        alreadyOpened: false,
      }),
    ).toBe(false);
  });

  it('skips when already opened once', () => {
    expect(
      shouldAutoOpenSessionPicker({
        hasSession: false,
        shouldOpen: true,
        hasAnchor: true,
        alreadyOpened: true,
      }),
    ).toBe(false);
  });
});
