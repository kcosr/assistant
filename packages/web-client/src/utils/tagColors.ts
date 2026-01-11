import { apiFetch } from './api';

export type TagColorToken = 'accent' | 'info' | 'success' | 'warning' | 'error';

export type TagColorSpec = { kind: 'token'; token: TagColorToken } | { kind: 'hex'; hex: string };

interface TagColorStoragePayloadV1 {
  version: 1;
  colors: Record<string, TagColorSpec>;
}

const STORAGE_KEY = 'assistant:tag-colors';

export function normalizeTag(rawTag: string): string {
  return rawTag.trim().toLowerCase();
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return { r, g, b };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((v) => v / 255);
  const linear = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const [rl, gl, bl] = linear;
  return 0.2126 * (rl ?? 0) + 0.7152 * (gl ?? 0) + 0.0722 * (bl ?? 0);
}

export function resolveTagColorTokenCssVar(token: TagColorToken): string {
  switch (token) {
    case 'accent':
      return 'var(--color-accent-primary)';
    case 'info':
      return 'var(--color-info)';
    case 'success':
      return 'var(--color-success)';
    case 'warning':
      return 'var(--color-warning)';
    case 'error':
      return 'var(--color-error)';
  }
}

/**
 * Resolve a tag color token to an actual hex color by reading computed CSS.
 * Returns null if the color cannot be resolved.
 */
export function resolveTagColorTokenToHex(token: TagColorToken): string | null {
  const cssVarName = resolveTagColorTokenCssVar(token).replace(/^var\((.+)\)$/, '$1');
  if (!cssVarName) return null;

  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
  if (!value) return null;

  // If it's already a hex color, return it
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  // Try to convert rgb/rgba to hex
  const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  return null;
}

export function getTagColorCss(spec: TagColorSpec): {
  bg: string;
  fg: string | null;
} {
  if (spec.kind === 'token') {
    const tokenVar = resolveTagColorTokenCssVar(spec.token);
    return {
      bg: `color-mix(in srgb, ${tokenVar} 35%, var(--color-bg-elevated))`,
      fg: 'var(--color-text-primary)',
    };
  }

  const rgb = parseHexColor(spec.hex);
  const luminance = rgb ? relativeLuminance(rgb) : 0;
  const fg = luminance > 0.6 ? 'var(--color-text-inverse)' : 'var(--color-text-primary)';
  return {
    bg: `color-mix(in srgb, ${spec.hex} 35%, var(--color-bg-elevated))`,
    fg,
  };
}

export function applyTagColorToElement(el: HTMLElement, tag: string): void {
  const normalizedTag = normalizeTag(tag);
  if (!normalizedTag) {
    el.style.removeProperty('--tag-bg');
    el.style.removeProperty('--tag-fg');
    return;
  }

  const spec = getStoredTagColor(normalizedTag);
  if (!spec) {
    el.style.removeProperty('--tag-bg');
    el.style.removeProperty('--tag-fg');
    return;
  }

  const css = getTagColorCss(spec);
  el.style.setProperty('--tag-bg', css.bg);
  if (css.fg) {
    el.style.setProperty('--tag-fg', css.fg);
  } else {
    el.style.removeProperty('--tag-fg');
  }
}

export function applyTagColorsToRoot(root: ParentNode): void {
  const elements = root.querySelectorAll<HTMLElement>('[data-tag]');
  for (const el of Array.from(elements)) {
    const tag = el.dataset['tag'];
    if (!tag) continue;
    applyTagColorToElement(el, tag);
  }

  const legacyPills = root.querySelectorAll<HTMLElement>('.artifact-tag:not([data-tag])');
  for (const el of Array.from(legacyPills)) {
    const tag = el.textContent ?? '';
    const normalized = normalizeTag(tag);
    if (!normalized) continue;
    el.dataset['tag'] = normalized;
    applyTagColorToElement(el, normalized);
  }
}

// ---------------------------------------------------------------------------
// Storage: local cache + server-side preferences
// ---------------------------------------------------------------------------

let tagColorCache: Record<string, TagColorSpec> | null = null;
let hasSyncedFromPreferences = false;
let syncFromPreferencesPromise: Promise<void> | null = null;
let useLocalStorageFallback = true;
let hasLocalMutations = false;

function isPreferencesApiAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const w = window as unknown as { fetch?: typeof fetch };
  return typeof w.fetch === 'function';
}

function readLocalStorageTagColors(): Record<string, TagColorSpec> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Partial<TagColorStoragePayloadV1>;
    if (obj.version !== 1) return {};
    if (!obj.colors || typeof obj.colors !== 'object') return {};
    const colors = obj.colors as Record<string, TagColorSpec>;

    const safe: Record<string, TagColorSpec> = {};
    for (const [key, value] of Object.entries(colors)) {
      const tag = normalizeTag(key);
      if (!tag) continue;
      if (!value || typeof value !== 'object') continue;
      const candidate = value as { kind?: unknown; token?: unknown; hex?: unknown };
      if (candidate.kind === 'token') {
        const token = candidate.token;
        if (
          token === 'accent' ||
          token === 'info' ||
          token === 'success' ||
          token === 'warning' ||
          token === 'error'
        ) {
          safe[tag] = { kind: 'token', token };
        }
        continue;
      }
      if (candidate.kind === 'hex') {
        const hex = candidate.hex;
        if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
          safe[tag] = { kind: 'hex', hex: hex.trim() };
        }
      }
    }
    return safe;
  } catch {
    return {};
  }
}

function writeLocalStorageTagColors(colors: Record<string, TagColorSpec>): void {
  if (typeof window === 'undefined') {
    return;
  }
  const payload: TagColorStoragePayloadV1 = { version: 1, colors };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

function clearLocalStorageTagColors(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function notifyTagColorsUpdated(tag?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const detail = tag ? { tag } : undefined;
  window.dispatchEvent(
    new CustomEvent('assistant:tag-colors-updated', detail ? { detail } : undefined),
  );
}

function ensureCacheInitialized(): void {
  if (tagColorCache === null) {
    tagColorCache = readLocalStorageTagColors();
  }
  scheduleSyncFromPreferences();
}

interface RawPreferences {
  tagColors?: Record<string, unknown>;
  [key: string]: unknown;
}

async function fetchPreferences(): Promise<RawPreferences | null> {
  if (!isPreferencesApiAvailable()) {
    return null;
  }

  try {
    const response = await apiFetch('/preferences', { method: 'GET' });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {};
    }
    return data as RawPreferences;
  } catch {
    return null;
  }
}

function parsePreferencesTagColorObject(raw: unknown): TagColorSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as { kind?: unknown; token?: unknown; hex?: unknown; custom?: unknown };

  if (obj.kind === 'token') {
    const token = obj.token;
    if (typeof token === 'string') {
      const lowered = token.toLowerCase();
      if (
        lowered === 'accent' ||
        lowered === 'info' ||
        lowered === 'success' ||
        lowered === 'warning' ||
        lowered === 'error'
      ) {
        return { kind: 'token', token: lowered as TagColorToken };
      }
    }
  }

  if (obj.kind === 'hex') {
    const hex = obj.hex;
    if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim())) {
      return { kind: 'hex', hex: hex.trim() };
    }
  }

  const token = obj.token;
  if (typeof token === 'string') {
    const lowered = token.toLowerCase();
    if (
      lowered === 'accent' ||
      lowered === 'info' ||
      lowered === 'success' ||
      lowered === 'warning' ||
      lowered === 'error'
    ) {
      return { kind: 'token', token: lowered as TagColorToken };
    }
  }

  const custom = obj.custom;
  if (typeof custom === 'string' && /^#[0-9a-fA-F]{6}$/.test(custom.trim())) {
    return { kind: 'hex', hex: custom.trim() };
  }

  return null;
}

function parsePreferencesTagColors(
  rawTagColors: Record<string, unknown> | undefined,
): Record<string, TagColorSpec> {
  if (!rawTagColors) {
    return {};
  }

  const result: Record<string, TagColorSpec> = {};
  for (const [key, value] of Object.entries(rawTagColors)) {
    const tag = normalizeTag(key);
    if (!tag) continue;
    if (typeof value !== 'string') {
      const specFromObject = parsePreferencesTagColorObject(value);
      if (specFromObject) {
        result[tag] = specFromObject;
      }
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      result[tag] = { kind: 'hex', hex: trimmed };
      continue;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const specFromObject = parsePreferencesTagColorObject(parsed);
        if (specFromObject) {
          result[tag] = specFromObject;
        }
      } catch {
        // Ignore invalid JSON values.
      }
    }
  }
  return result;
}

function encodeTagColorSpecForPreferences(spec: TagColorSpec): string | null {
  try {
    return JSON.stringify(spec);
  } catch {
    return null;
  }
}

function encodeTagColorsForPreferences(
  colors: Record<string, TagColorSpec>,
): Record<string, string> {
  const encoded: Record<string, string> = {};
  for (const [tag, spec] of Object.entries(colors)) {
    const value = encodeTagColorSpecForPreferences(spec);
    if (value !== null) {
      encoded[tag] = value;
    }
  }
  return encoded;
}

function scheduleSyncFromPreferences(): void {
  if (hasSyncedFromPreferences || syncFromPreferencesPromise || !isPreferencesApiAvailable()) {
    return;
  }
  syncFromPreferencesPromise = syncFromPreferences().finally(() => {
    hasSyncedFromPreferences = true;
    syncFromPreferencesPromise = null;
  });
}

async function syncFromPreferences(): Promise<void> {
  const prefs = await fetchPreferences();
  if (!prefs) {
    return;
  }

  const rawTagColors =
    prefs.tagColors && typeof prefs.tagColors === 'object' && !Array.isArray(prefs.tagColors)
      ? (prefs.tagColors as Record<string, unknown>)
      : undefined;
  const serverColors = parsePreferencesTagColors(rawTagColors);
  const serverHasColors = Object.keys(serverColors).length > 0;

  if (serverHasColors && !hasLocalMutations) {
    const currentLocal = tagColorCache ?? {};
    const currentLocalHasColors = Object.keys(currentLocal).length > 0;

    const merged: Record<string, TagColorSpec> = currentLocalHasColors
      ? { ...serverColors, ...currentLocal }
      : serverColors;

    tagColorCache = merged;
    useLocalStorageFallback = false;
    clearLocalStorageTagColors();

    if (currentLocalHasColors) {
      const encodedMerged = encodeTagColorsForPreferences(merged);
      try {
        await apiFetch('/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagColors: encodedMerged }),
        });
      } catch {
        // Ignore network errors; cache remains authoritative locally.
      }
    }

    notifyTagColorsUpdated();
    return;
  }

  if (!serverHasColors) {
    const latestLocal = tagColorCache ?? {};
    const latestLocalHasColors = Object.keys(latestLocal).length > 0;
    if (!latestLocalHasColors) {
      return;
    }

    const encoded = encodeTagColorsForPreferences(latestLocal);
    try {
      const response = await apiFetch('/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagColors: encoded }),
      });
      if (response.ok) {
        useLocalStorageFallback = false;
        clearLocalStorageTagColors();
      }
    } catch {
      // Ignore network errors; keep local fallback.
    }
  }
}

async function saveSingleTagColorToPreferences(
  tag: string,
  spec: TagColorSpec | null,
): Promise<void> {
  if (!isPreferencesApiAvailable()) {
    return;
  }

  let value: string;
  if (spec) {
    const encodedSpec = encodeTagColorSpecForPreferences(spec);
    if (encodedSpec === null) {
      return;
    }
    value = encodedSpec;
  } else {
    // Sentinel empty string indicates "no color" for this tag.
    value = '';
  }

  try {
    const response = await apiFetch('/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagColors: { [tag]: value } }),
    });
    if (response.ok) {
      useLocalStorageFallback = false;
    }
  } catch {
    // Ignore network errors; local cache + fallback will continue to work.
  }
}

export function getStoredTagColors(): Record<string, TagColorSpec> {
  ensureCacheInitialized();
  return tagColorCache ? { ...tagColorCache } : {};
}

export function setStoredTagColor(tag: string, spec: TagColorSpec | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalizedTag = normalizeTag(tag);
  if (!normalizedTag) {
    return;
  }

  ensureCacheInitialized();

  const next: Record<string, TagColorSpec> = { ...(tagColorCache ?? {}) };
  if (spec) {
    next[normalizedTag] = spec;
  } else {
    delete next[normalizedTag];
  }

  tagColorCache = next;
  hasLocalMutations = true;

  if (useLocalStorageFallback) {
    writeLocalStorageTagColors(next);
  }

  void saveSingleTagColorToPreferences(normalizedTag, spec);

  notifyTagColorsUpdated(normalizedTag);
}

export function getStoredTagColor(tag: string): TagColorSpec | null {
  const normalizedTag = normalizeTag(tag);
  if (!normalizedTag) return null;
  ensureCacheInitialized();
  return tagColorCache?.[normalizedTag] ?? null;
}

// Test-only helper to reset module state.
export function __resetTagColorsTestState(): void {
  tagColorCache = null;
  hasSyncedFromPreferences = false;
  syncFromPreferencesPromise = null;
  useLocalStorageFallback = true;
  hasLocalMutations = false;
}
