// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemePreferences,
  CODE_FONT_OPTIONS,
  CODE_FONT_STORAGE_KEY,
  loadThemePreferences,
  saveThemePreferences,
  THEME_STORAGE_KEY,
  UI_FONT_OPTIONS,
  UI_FONT_STORAGE_KEY,
  watchSystemThemeChanges,
  __resetThemeManagerTestState,
} from './themeManager';

const getOption = (
  options: { value: string }[],
  index: number,
  label: string,
): { value: string } => {
  const option = options[index] ?? options[0];
  if (!option) {
    throw new Error(`Missing ${label} options`);
  }
  return option;
};

describe('themeManager', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetThemeManagerTestState();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-scheme');
    document.documentElement.style.removeProperty('--font-sans');
    document.documentElement.style.removeProperty('--font-mono');
  });

  it('loads defaults when storage is empty', () => {
    const defaultUIFont = getOption(UI_FONT_OPTIONS, 0, 'UI font');
    const defaultCodeFont = getOption(CODE_FONT_OPTIONS, 0, 'code font');
    const prefs = loadThemePreferences();
    expect(prefs.themeId).toBe('auto');
    expect(prefs.uiFont).toBe(defaultUIFont.value);
    expect(prefs.codeFont).toBe(defaultCodeFont.value);
  });

  it('persists and reloads theme preferences', () => {
    const defaultUIFont = getOption(UI_FONT_OPTIONS, 1, 'UI font');
    const defaultCodeFont = getOption(CODE_FONT_OPTIONS, 2, 'code font');
    saveThemePreferences({
      themeId: 'dark',
      uiFont: defaultUIFont.value,
      codeFont: defaultCodeFont.value,
    });
    const prefs = loadThemePreferences();
    expect(prefs).toEqual({
      themeId: 'dark',
      uiFont: defaultUIFont.value,
      codeFont: defaultCodeFont.value,
    });
  });

  it('normalizes invalid stored values', () => {
    const defaultUIFont = getOption(UI_FONT_OPTIONS, 0, 'UI font');
    const defaultCodeFont = getOption(CODE_FONT_OPTIONS, 0, 'code font');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'not-a-theme');
    window.localStorage.setItem(UI_FONT_STORAGE_KEY, 'Invalid Font');
    window.localStorage.setItem(CODE_FONT_STORAGE_KEY, 'Bad Font');
    const prefs = loadThemePreferences();
    expect(prefs.themeId).toBe('auto');
    expect(prefs.uiFont).toBe(defaultUIFont.value);
    expect(prefs.codeFont).toBe(defaultCodeFont.value);
  });

  it('applies theme attributes and emits updates', () => {
    const defaultUIFont = getOption(UI_FONT_OPTIONS, 1, 'UI font');
    const defaultCodeFont = getOption(CODE_FONT_OPTIONS, 1, 'code font');
    const listener = vi.fn();
    window.addEventListener('assistant:theme-updated', listener);
    applyThemePreferences({
      themeId: 'dark',
      uiFont: defaultUIFont.value,
      codeFont: defaultCodeFont.value,
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(
      defaultUIFont.value,
    );
    expect(document.documentElement.style.getPropertyValue('--font-mono')).toBe(
      defaultCodeFont.value,
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('watches system theme changes', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const media = {
      matches: true,
      addEventListener: vi.fn((_event: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue(media);

    const onChange = vi.fn();
    const unsubscribe = watchSystemThemeChanges(onChange);
    listeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(onChange).toHaveBeenCalledWith('light');

    unsubscribe();
    expect(media.removeEventListener).toHaveBeenCalled();
    window.matchMedia = originalMatchMedia;
  });
});
