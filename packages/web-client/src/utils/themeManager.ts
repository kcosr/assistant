export type ThemeScheme = 'light' | 'dark';

export type ThemeOption = {
  id: string;
  label: string;
  scheme: ThemeScheme | 'auto';
};

export type FontOption = {
  label: string;
  value: string;
};

export type ThemePreferences = {
  themeId: string;
  uiFont: string;
  codeFont: string;
};

export type ThemeUpdateDetail = ThemePreferences & {
  scheme: ThemeScheme;
  source?: 'init' | 'user' | 'system';
};

export const THEME_STORAGE_KEY = 'aiAssistantTheme';
export const UI_FONT_STORAGE_KEY = 'aiAssistantUIFont';
export const CODE_FONT_STORAGE_KEY = 'aiAssistantCodeFont';

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'auto', label: 'Auto (System)', scheme: 'auto' },
  { id: 'dark', label: 'Dark', scheme: 'dark' },
  { id: 'light', label: 'Light', scheme: 'light' },
  { id: 'dracula', label: 'Dracula', scheme: 'dark' },
  { id: 'nord', label: 'Nord', scheme: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', scheme: 'dark' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', scheme: 'light' },
  { id: 'monokai', label: 'Monokai', scheme: 'dark' },
  { id: 'one-dark', label: 'One Dark', scheme: 'dark' },
  { id: 'night-owl', label: 'Night Owl', scheme: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', scheme: 'dark' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', scheme: 'light' },
  { id: 'forest-dark', label: 'Forest Dark', scheme: 'dark' },
  { id: 'forest-light', label: 'Forest Light', scheme: 'light' },
  { id: 'everforest-dark', label: 'Everforest Dark', scheme: 'dark' },
  { id: 'everforest-light', label: 'Everforest Light', scheme: 'light' },
  { id: 'matrix', label: 'Matrix', scheme: 'dark' },
  { id: 'autumn-morning', label: 'Autumn Morning', scheme: 'light' },
  { id: 'autumn-afternoon', label: 'Autumn Afternoon', scheme: 'light' },
  { id: 'autumn-night', label: 'Autumn Night', scheme: 'dark' },
  { id: 'winter-morning', label: 'Winter Morning', scheme: 'light' },
  { id: 'winter-afternoon', label: 'Winter Afternoon', scheme: 'light' },
  { id: 'winter-night', label: 'Winter Night', scheme: 'dark' },
];

export const UI_FONT_OPTIONS: FontOption[] = [
  {
    label: 'System UI',
    value:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  {
    label: 'SF Pro',
    value:
      "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    label: 'Inter',
    value: "'Inter', 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    label: 'IBM Plex Sans',
    value: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
  },
  {
    label: 'Source Sans 3',
    value: "'Source Sans 3', 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif",
  },
  {
    label: 'Space Grotesk',
    value: "'Space Grotesk', 'SF Pro Text', system-ui, 'Segoe UI', sans-serif",
  },
  {
    label: 'Atkinson Hyperlegible',
    value: "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif",
  },
];

export const CODE_FONT_OPTIONS: FontOption[] = [
  {
    label: 'System Mono',
    value: "'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  },
  {
    label: 'Menlo',
    value: "Menlo, 'SF Mono', Monaco, Consolas, 'Liberation Mono', monospace",
  },
  {
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: 'Fira Code',
    value: "'Fira Code', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: 'Source Code Pro',
    value: "'Source Code Pro', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: 'Cascadia Code',
    value: "'Cascadia Code', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: 'Inconsolata',
    value: "'Inconsolata', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  {
    label: 'IBM Plex Mono',
    value: "'IBM Plex Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
];

const DEFAULT_THEME_ID = 'auto';
const DEFAULT_UI_FONT = UI_FONT_OPTIONS[0]?.value ?? 'system-ui, sans-serif';
const DEFAULT_CODE_FONT = CODE_FONT_OPTIONS[0]?.value ?? 'monospace';

let lastApplied: ThemeUpdateDetail | null = null;

function normalizeThemeId(value: string | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return DEFAULT_THEME_ID;
  }
  return THEME_OPTIONS.some((option) => option.id === trimmed) ? trimmed : DEFAULT_THEME_ID;
}

function normalizeFontValue(value: string | null, options: FontOption[], fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return fallback;
  }
  return options.some((option) => option.value === trimmed) ? trimmed : fallback;
}

export function resolveThemeScheme(themeId: string): ThemeScheme {
  const option = THEME_OPTIONS.find((candidate) => candidate.id === themeId);
  if (option?.scheme === 'light' || option?.scheme === 'dark') {
    return option.scheme;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function loadThemePreferences(storage: Storage = window.localStorage): ThemePreferences {
  let themeId = DEFAULT_THEME_ID;
  let uiFont = DEFAULT_UI_FONT;
  let codeFont = DEFAULT_CODE_FONT;

  try {
    themeId = normalizeThemeId(storage.getItem(THEME_STORAGE_KEY));
    uiFont = normalizeFontValue(
      storage.getItem(UI_FONT_STORAGE_KEY),
      UI_FONT_OPTIONS,
      DEFAULT_UI_FONT,
    );
    codeFont = normalizeFontValue(
      storage.getItem(CODE_FONT_STORAGE_KEY),
      CODE_FONT_OPTIONS,
      DEFAULT_CODE_FONT,
    );
  } catch {
    // Ignore storage errors and fall back to defaults.
  }

  return {
    themeId,
    uiFont,
    codeFont,
  };
}

export function saveThemePreferences(
  preferences: ThemePreferences,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preferences.themeId);
    storage.setItem(UI_FONT_STORAGE_KEY, preferences.uiFont);
    storage.setItem(CODE_FONT_STORAGE_KEY, preferences.codeFont);
  } catch {
    // Ignore storage errors.
  }
}

export function applyThemePreferences(
  preferences: ThemePreferences,
  options?: {
    emit?: boolean;
    force?: boolean;
    source?: ThemeUpdateDetail['source'];
    root?: HTMLElement;
  },
): ThemeUpdateDetail {
  const themeId = normalizeThemeId(preferences.themeId);
  const uiFont = normalizeFontValue(preferences.uiFont, UI_FONT_OPTIONS, DEFAULT_UI_FONT);
  const codeFont = normalizeFontValue(preferences.codeFont, CODE_FONT_OPTIONS, DEFAULT_CODE_FONT);
  const scheme = resolveThemeScheme(themeId);

  const root = options?.root ?? document.documentElement;
  root.setAttribute('data-theme', themeId);
  root.setAttribute('data-theme-scheme', scheme);
  root.style.setProperty('--font-sans', uiFont);
  root.style.setProperty('--font-mono', codeFont);

  const detail: ThemeUpdateDetail = {
    themeId,
    uiFont,
    codeFont,
    scheme,
    source: options?.source ?? 'init',
  };

  const changed =
    options?.force ||
    !lastApplied ||
    lastApplied.themeId !== detail.themeId ||
    lastApplied.uiFont !== detail.uiFont ||
    lastApplied.codeFont !== detail.codeFont ||
    lastApplied.scheme !== detail.scheme;

  lastApplied = detail;

  if (options?.emit !== false && changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('assistant:theme-updated', { detail }));
  }

  return detail;
}

export function watchSystemThemeChanges(onChange: (scheme: ThemeScheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent | MediaQueryList) => {
    onChange(event.matches ? 'dark' : 'light');
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }
  media.addListener(handler);
  return () => media.removeListener(handler);
}

export function __resetThemeManagerTestState(): void {
  lastApplied = null;
}
