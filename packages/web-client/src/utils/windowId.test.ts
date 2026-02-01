import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWindowSlot,
  getClientWindowId,
  listWindowSlots,
  removeWindowSlot,
  resetWindowSlotState,
  setClientWindowId,
} from './windowId';

class StorageMock implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const createWindow = (
  localStorage: Storage = new StorageMock(),
  sessionStorage: Storage = new StorageMock(),
): Window & typeof globalThis => {
  return {
    localStorage,
    sessionStorage,
    crypto: {
      randomUUID: () => 'uuid-1234',
      getRandomValues: ((arr: Uint8Array) => arr) as Crypto['getRandomValues'],
      subtle: {} as Crypto['subtle'],
    },
  } as unknown as Window & typeof globalThis;
};

describe('windowId', () => {
  beforeEach(() => {
    (globalThis as { window?: Window & typeof globalThis }).window = createWindow();
    delete (globalThis as { __ASSISTANT_WINDOW_ID__?: string }).__ASSISTANT_WINDOW_ID__;
  });

  it('defaults to slot 0 and persists it', () => {
    const windowId = getClientWindowId();

    expect(windowId).toBe('0');
    expect(window.sessionStorage.getItem('aiAssistantWindowId')).toBe('0');
    expect(JSON.parse(window.localStorage.getItem('aiAssistantWindowSlots') ?? '[]')).toEqual([
      '0',
    ]);
  });

  it('migrates legacy layout keys into slot 0', () => {
    window.localStorage.setItem('aiAssistantPanelLayout', '{"root":"legacy"}');
    window.localStorage.setItem('aiAssistantPanelLayoutVersion', '3');

    const windowId = getClientWindowId();

    expect(windowId).toBe('0');
    expect(window.localStorage.getItem('aiAssistantPanelLayout:0')).toBe('{"root":"legacy"}');
    expect(window.localStorage.getItem('aiAssistantPanelLayout')).toBeNull();
  });

  it('creates new slots and resets slot state', () => {
    expect(getClientWindowId()).toBe('0');

    const newSlot = createWindowSlot();
    expect(newSlot).toBe('1');
    expect(listWindowSlots()).toEqual(['0', '1']);

    window.localStorage.setItem('aiAssistantPanelLayout:1', '{"root":"slot1"}');
    resetWindowSlotState('1');
    expect(window.localStorage.getItem('aiAssistantPanelLayout:1')).toBeNull();
  });

  it('allocates the lowest unused slot when another window is active', () => {
    window.localStorage.setItem(
      'aiAssistantWindowActive',
      JSON.stringify({
        '0': { ownerId: 'other-window', lastSeen: Date.now() },
      }),
    );

    const windowId = getClientWindowId();

    expect(windowId).toBe('1');
    expect(listWindowSlots()).toEqual(['0', '1']);
  });

  it('reuses the most recent slot when no windows are active', () => {
    vi.spyOn(Date, 'now').mockReturnValue(30000);
    window.localStorage.setItem('aiAssistantWindowSlots', JSON.stringify(['0', '1', '2']));
    window.localStorage.setItem(
      'aiAssistantWindowActive',
      JSON.stringify({
        '0': { ownerId: 'other-window', lastSeen: 1000 },
        '2': { ownerId: 'other-window', lastSeen: 2000 },
      }),
    );

    const windowId = getClientWindowId();

    expect(windowId).toBe('2');
    vi.restoreAllMocks();
  });

  it('fills gaps when creating new slots', () => {
    expect(getClientWindowId()).toBe('0');
    window.localStorage.setItem('aiAssistantWindowSlots', JSON.stringify(['0', '2']));

    const newSlot = createWindowSlot();

    expect(newSlot).toBe('1');
    expect(listWindowSlots()).toEqual(['0', '1', '2']);
  });

  it('removes slots and falls back to slot 0', () => {
    expect(getClientWindowId()).toBe('0');
    const slot = createWindowSlot();
    expect(slot).toBe('1');
    setClientWindowId('1');

    const removed = removeWindowSlot('1');
    expect(removed).toBe(false);

    setClientWindowId('0');
    const removedInactive = removeWindowSlot('1');
    expect(removedInactive).toBe(true);
    expect(listWindowSlots()).toEqual(['0']);
  });
});
