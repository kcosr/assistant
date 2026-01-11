// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  applyTagColorToElement,
  getStoredTagColor,
  getStoredTagColors,
  normalizeTag,
  __resetTagColorsTestState,
  setStoredTagColor,
} from './tagColors';

describe('tagColors', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetTagColorsTestState();
  });

  it('normalizes tag keys', () => {
    expect(normalizeTag('  Foo ')).toBe('foo');
  });

  it('stores and retrieves token colors by normalized tag', () => {
    setStoredTagColor(' Foo ', { kind: 'token', token: 'info' });
    expect(getStoredTagColor('foo')).toEqual({ kind: 'token', token: 'info' });
    expect(Object.keys(getStoredTagColors())).toEqual(['foo']);
  });

  it('dispatches an update event when changed', () => {
    const listener = vi.fn();
    window.addEventListener('assistant:tag-colors-updated', listener);
    setStoredTagColor('foo', { kind: 'token', token: 'accent' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('applies CSS variables to elements with a stored color', () => {
    setStoredTagColor('foo', { kind: 'hex', hex: '#ff0000' });
    const el = document.createElement('span');
    applyTagColorToElement(el, 'foo');
    expect(el.style.getPropertyValue('--tag-bg')).toContain('color-mix');
    expect(el.style.getPropertyValue('--tag-fg')).not.toBe('');
  });

  it('clears CSS variables when no stored color', () => {
    const el = document.createElement('span');
    el.style.setProperty('--tag-bg', 'red');
    applyTagColorToElement(el, 'foo');
    expect(el.style.getPropertyValue('--tag-bg')).toBe('');
  });
});
