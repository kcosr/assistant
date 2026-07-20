import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatSidebandCloseDetail,
  SIDEBAND_TCP_KEEPALIVE_INITIAL_DELAY_MS,
  SIDEBAND_WS_PING_INTERVAL_MS,
} from './openaiRealtime';

describe('sideband keepalive constants', () => {
  it('uses a one-minute WS ping interval (under multi-minute NAT idle timeouts)', () => {
    expect(SIDEBAND_WS_PING_INTERVAL_MS).toBe(60_000);
  });

  it('enables TCP keepalive with a matching one-minute initial delay', () => {
    expect(SIDEBAND_TCP_KEEPALIVE_INITIAL_DELAY_MS).toBe(60_000);
  });
});

describe('formatSidebandCloseDetail', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes code, wasClean, intentional, and optional reason', () => {
    const detail = formatSidebandCloseDetail({
      callId: 'rtc_test',
      code: 1006,
      reasonText: '',
      wasClean: false,
      intentional: false,
    });
    expect(detail).toContain('callId=rtc_test');
    expect(detail).toContain('code=1006');
    expect(detail).toContain('wasClean=false');
    expect(detail).toContain('intentional=false');
    expect(detail).not.toContain('reason=');
  });

  it('appends keepalive diagnostics when present', () => {
    const detail = formatSidebandCloseDetail({
      callId: 'rtc_test',
      code: 1006,
      reasonText: 'gone',
      wasClean: false,
      intentional: false,
      pingCount: 12,
      lastPongAtMs: 1_700_000_000_000,
    });
    expect(detail).toContain('reason="gone"');
    expect(detail).toContain('pingCount=12');
    expect(detail).toContain('lastPongAtMs=1700000000000');
  });
});
