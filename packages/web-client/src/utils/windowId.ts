import { isCapacitor } from './capacitor';

const WINDOW_ID_STORAGE_KEY = 'aiAssistantWindowId';
const WINDOW_SLOT_LIST_STORAGE_KEY = 'aiAssistantWindowSlots';
const WINDOW_SLOT_ACTIVE_KEY = 'aiAssistantWindowActive';
const WINDOW_OWNER_ID_STORAGE_KEY = 'aiAssistantWindowOwnerId';
const WINDOW_SLOT_NAMES_KEY = 'aiAssistantWindowSlotNames';
const DEFAULT_WINDOW_SLOT_ID = '0';
const PANEL_LAYOUT_STORAGE_KEY = 'aiAssistantPanelLayout';
const PANEL_LAYOUT_VERSION_KEY = 'aiAssistantPanelLayoutVersion';
const FOCUS_HISTORY_STORAGE_KEY = 'aiAssistantPanelFocusHistory';
const GLOBAL_QUERY_STORAGE_KEY = 'assistant:global-query';
const WINDOW_ACTIVE_TTL_MS = 15000;
const WINDOW_HEARTBEAT_INTERVAL_MS = 5000;

const WINDOW_SLOT_RE = /^\d+$/;

function generateWindowId(): string {
  if (typeof window !== 'undefined') {
    const crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  }
  return `window-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeSlotId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!WINDOW_SLOT_RE.test(trimmed)) {
    return null;
  }
  return String(Number(trimmed));
}

function readWindowSlots(storage: Storage): string[] {
  try {
    const raw = storage.getItem(WINDOW_SLOT_LIST_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const unique = new Set<string>();
    for (const entry of parsed) {
      const normalized = normalizeSlotId(typeof entry === 'string' ? entry : '');
      if (normalized) {
        unique.add(normalized);
      }
    }
    return Array.from(unique).sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

function writeWindowSlots(storage: Storage, slots: string[]): void {
  try {
    storage.setItem(WINDOW_SLOT_LIST_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Ignore storage errors.
  }
}

function ensureWindowSlots(storage: Storage): string[] {
  const slots = readWindowSlots(storage);
  if (slots.length > 0) {
    return slots;
  }
  const defaultSlots = [DEFAULT_WINDOW_SLOT_ID];
  writeWindowSlots(storage, defaultSlots);
  return defaultSlots;
}

function readWindowSlotNames(storage: Storage): Record<string, string> {
  try {
    const raw = storage.getItem(WINDOW_SLOT_NAMES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const slotId = normalizeSlotId(key);
      if (!slotId || typeof value !== 'string') {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        result[slotId] = trimmed;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeWindowSlotNames(storage: Storage, names: Record<string, string>): void {
  try {
    storage.setItem(WINDOW_SLOT_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Ignore storage errors.
  }
}

function ensureSlotExists(storage: Storage, slotId: string): void {
  const slots = readWindowSlots(storage);
  if (slots.includes(slotId)) {
    return;
  }
  const updated = [...slots, slotId].sort((a, b) => Number(a) - Number(b));
  writeWindowSlots(storage, updated);
}

function setGlobalWindowId(windowId: string): void {
  (globalThis as { __ASSISTANT_WINDOW_ID__?: string }).__ASSISTANT_WINDOW_ID__ = windowId;
}

function getWindowOwnerId(): string {
  const localStorage = getLocalStorage();
  const sessionStorage = getSessionStorage();

  const singleInstance = isCapacitor();
  if (!singleInstance) {
    try {
      const existing = sessionStorage?.getItem(WINDOW_OWNER_ID_STORAGE_KEY);
      if (existing) {
        return existing;
      }
    } catch {
      // Ignore sessionStorage errors.
    }
    const ownerId = generateWindowId();
    try {
      sessionStorage?.setItem(WINDOW_OWNER_ID_STORAGE_KEY, ownerId);
    } catch {
      // Ignore sessionStorage errors.
    }
    return ownerId;
  }

  // Capacitor builds are effectively single-instance; persist owner id across restarts so we
  // don't temporarily mark the last slot as "in use" (and allocate a new one) on fast relaunch.
  try {
    const existing = localStorage?.getItem(WINDOW_OWNER_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }
  } catch {
    // Ignore localStorage errors.
  }

  try {
    const existing = sessionStorage?.getItem(WINDOW_OWNER_ID_STORAGE_KEY);
    if (existing) {
      try {
        localStorage?.setItem(WINDOW_OWNER_ID_STORAGE_KEY, existing);
      } catch {
        // Ignore storage errors.
      }
      return existing;
    }
  } catch {
    // Ignore sessionStorage errors.
  }

  // Adopt the most recent active-slot owner id so upgrades/restarts don't change ownership.
  if (localStorage) {
    const rawActive = readActiveSlots(localStorage);
    let recentOwnerId: string | null = null;
    let recentSeen = -Infinity;
    for (const entry of Object.values(rawActive)) {
      if (entry.lastSeen > recentSeen) {
        recentSeen = entry.lastSeen;
        recentOwnerId = entry.ownerId;
      }
    }
    if (recentOwnerId) {
      try {
        localStorage.setItem(WINDOW_OWNER_ID_STORAGE_KEY, recentOwnerId);
      } catch {
        // Ignore storage errors.
      }
      return recentOwnerId;
    }
  }

  const ownerId = generateWindowId();
  try {
    localStorage?.setItem(WINDOW_OWNER_ID_STORAGE_KEY, ownerId);
  } catch {
    // Ignore storage errors.
  }
  return ownerId;
}

type ActiveWindowSlot = { ownerId: string; lastSeen: number };

function readActiveSlots(storage: Storage): Record<string, ActiveWindowSlot> {
  try {
    const raw = storage.getItem(WINDOW_SLOT_ACTIVE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, ActiveWindowSlot> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const slotId = normalizeSlotId(key);
      if (!slotId || !value || typeof value !== 'object') {
        continue;
      }
      const entry = value as { ownerId?: unknown; lastSeen?: unknown };
      if (typeof entry.ownerId !== 'string') {
        continue;
      }
      const lastSeen = Number(entry.lastSeen);
      if (!Number.isFinite(lastSeen)) {
        continue;
      }
      result[slotId] = { ownerId: entry.ownerId, lastSeen };
    }
    return result;
  } catch {
    return {};
  }
}

function writeActiveSlots(storage: Storage, slots: Record<string, ActiveWindowSlot>): void {
  try {
    storage.setItem(WINDOW_SLOT_ACTIVE_KEY, JSON.stringify(slots));
  } catch {
    // Ignore storage errors.
  }
}

function pruneActiveSlots(
  slots: Record<string, ActiveWindowSlot>,
  now: number,
): Record<string, ActiveWindowSlot> {
  const pruned: Record<string, ActiveWindowSlot> = {};
  for (const [slotId, entry] of Object.entries(slots)) {
    if (now - entry.lastSeen <= WINDOW_ACTIVE_TTL_MS) {
      pruned[slotId] = entry;
    }
  }
  return pruned;
}

function setActiveSlot(
  storage: Storage,
  slotId: string,
  ownerId: string,
  now: number,
): Record<string, ActiveWindowSlot> {
  const current = pruneActiveSlots(readActiveSlots(storage), now);
  current[slotId] = { ownerId, lastSeen: now };
  writeActiveSlots(storage, current);
  return current;
}

function releaseActiveSlot(storage: Storage, slotId: string, ownerId: string): void {
  const current = pruneActiveSlots(readActiveSlots(storage), Date.now());
  const entry = current[slotId];
  if (entry && entry.ownerId === ownerId) {
    delete current[slotId];
    writeActiveSlots(storage, current);
  }
}

function resolveWindowSlot(
  storage: Storage,
  ownerId: string,
  preferredSlot?: string | null,
): string {
  const now = Date.now();
  const slots = ensureWindowSlots(storage);
  const rawActive = readActiveSlots(storage);
  const active = pruneActiveSlots(rawActive, now);
  const normalizedPreferred = normalizeSlotId(preferredSlot ?? null);
  if (
    normalizedPreferred &&
    (!active[normalizedPreferred] || active[normalizedPreferred].ownerId === ownerId)
  ) {
    setActiveSlot(storage, normalizedPreferred, ownerId, now);
    return normalizedPreferred;
  }
  if (Object.keys(active).length === 0) {
    let recentSlot: string | null = null;
    let recentSeen = -Infinity;
    for (const [slotId, entry] of Object.entries(rawActive)) {
      if (!slots.includes(slotId)) {
        continue;
      }
      if (entry.lastSeen > recentSeen) {
        recentSeen = entry.lastSeen;
        recentSlot = slotId;
      }
    }
    if (recentSlot) {
      setActiveSlot(storage, recentSlot, ownerId, now);
      return recentSlot;
    }
  }
  for (let i = 0; ; i += 1) {
    const slotId = String(i);
    const entry = active[slotId];
    if (!entry || entry.ownerId === ownerId) {
      ensureSlotExists(storage, slotId);
      setActiveSlot(storage, slotId, ownerId, now);
      return slotId;
    }
  }
}

function resolveSingleInstanceWindowSlot(
  storage: Storage,
  ownerId: string,
  preferredSlot?: string | null,
): string {
  const now = Date.now();
  const slots = ensureWindowSlots(storage);
  const normalizedPreferred = normalizeSlotId(preferredSlot ?? null);
  if (normalizedPreferred && slots.includes(normalizedPreferred)) {
    setActiveSlot(storage, normalizedPreferred, ownerId, now);
    return normalizedPreferred;
  }

  const rawActive = readActiveSlots(storage);
  let recentSlot: string | null = null;
  let recentSeen = -Infinity;
  for (const [slotId, entry] of Object.entries(rawActive)) {
    if (!slots.includes(slotId)) {
      continue;
    }
    if (entry.lastSeen > recentSeen) {
      recentSeen = entry.lastSeen;
      recentSlot = slotId;
    }
  }
  if (recentSlot) {
    setActiveSlot(storage, recentSlot, ownerId, now);
    return recentSlot;
  }

  setActiveSlot(storage, DEFAULT_WINDOW_SLOT_ID, ownerId, now);
  return DEFAULT_WINDOW_SLOT_ID;
}

function migrateStorageKey(storage: Storage, fromKey: string, toKey: string): void {
  if (fromKey === toKey) {
    return;
  }
  try {
    if (storage.getItem(toKey) !== null) {
      return;
    }
    const existing = storage.getItem(fromKey);
    if (existing === null) {
      return;
    }
    storage.setItem(toKey, existing);
    storage.removeItem(fromKey);
  } catch {
    // Ignore storage errors.
  }
}

function migrateWindowState(storage: Storage, fromId: string, toId: string): void {
  migrateStorageKey(
    storage,
    `${PANEL_LAYOUT_STORAGE_KEY}:${fromId}`,
    `${PANEL_LAYOUT_STORAGE_KEY}:${toId}`,
  );
  migrateStorageKey(
    storage,
    `${PANEL_LAYOUT_VERSION_KEY}:${fromId}`,
    `${PANEL_LAYOUT_VERSION_KEY}:${toId}`,
  );
  migrateStorageKey(
    storage,
    `${FOCUS_HISTORY_STORAGE_KEY}:${fromId}`,
    `${FOCUS_HISTORY_STORAGE_KEY}:${toId}`,
  );
  migrateStorageKey(
    storage,
    `${GLOBAL_QUERY_STORAGE_KEY}:${fromId}`,
    `${GLOBAL_QUERY_STORAGE_KEY}:${toId}`,
  );
}

function migrateLegacyWindowState(storage: Storage, legacyId: string, targetId: string): void {
  if (!legacyId || legacyId === targetId) {
    return;
  }
  migrateWindowState(storage, legacyId, targetId);
}

function migrateUnsuffixedState(storage: Storage, targetId: string): void {
  migrateStorageKey(storage, PANEL_LAYOUT_STORAGE_KEY, `${PANEL_LAYOUT_STORAGE_KEY}:${targetId}`);
  migrateStorageKey(
    storage,
    PANEL_LAYOUT_VERSION_KEY,
    `${PANEL_LAYOUT_VERSION_KEY}:${targetId}`,
  );
  migrateStorageKey(
    storage,
    FOCUS_HISTORY_STORAGE_KEY,
    `${FOCUS_HISTORY_STORAGE_KEY}:${targetId}`,
  );
  migrateStorageKey(
    storage,
    GLOBAL_QUERY_STORAGE_KEY,
    `${GLOBAL_QUERY_STORAGE_KEY}:${targetId}`,
  );
}

export function getClientWindowId(): string {
  if (typeof window === 'undefined') {
    return 'server';
  }

  try {
    const sessionStorage = getSessionStorage();
    const localStorage = getLocalStorage();
    const existing = sessionStorage?.getItem(WINDOW_ID_STORAGE_KEY) ?? null;
    const normalized = normalizeSlotId(existing);
    const ownerId = getWindowOwnerId();
    if (localStorage) {
      const resolved = isCapacitor()
        ? resolveSingleInstanceWindowSlot(localStorage, ownerId, normalized)
        : resolveWindowSlot(localStorage, ownerId, normalized);
      if (existing && !normalized) {
        migrateLegacyWindowState(localStorage, existing, resolved);
      }
      migrateUnsuffixedState(localStorage, resolved);
      if (sessionStorage) {
        sessionStorage.setItem(WINDOW_ID_STORAGE_KEY, resolved);
      }
      setGlobalWindowId(resolved);
      return resolved;
    }
    if (normalized) {
      setGlobalWindowId(normalized);
      return normalized;
    }
    setGlobalWindowId(DEFAULT_WINDOW_SLOT_ID);
    return DEFAULT_WINDOW_SLOT_ID;
  } catch {
    // Ignore sessionStorage errors.
  }

  const generated = generateWindowId();
  const sessionStorage = getSessionStorage();
  try {
    sessionStorage?.setItem(WINDOW_ID_STORAGE_KEY, generated);
  } catch {
    // Ignore sessionStorage errors.
  }
  setGlobalWindowId(generated);
  return generated;
}

export function listWindowSlots(): string[] {
  const storage = getLocalStorage();
  if (!storage) {
    return [DEFAULT_WINDOW_SLOT_ID];
  }
  return ensureWindowSlots(storage);
}

export function createWindowSlot(): string {
  const storage = getLocalStorage();
  if (!storage) {
    return DEFAULT_WINDOW_SLOT_ID;
  }
  const slots = ensureWindowSlots(storage);
  for (let i = 0; ; i += 1) {
    const slotId = String(i);
    if (!slots.includes(slotId)) {
      ensureSlotExists(storage, slotId);
      return slotId;
    }
  }
}

export function setClientWindowId(windowId: string): string {
  const normalized = normalizeSlotId(windowId) ?? DEFAULT_WINDOW_SLOT_ID;
  const ownerId = getWindowOwnerId();
  const localStorage = getLocalStorage();
  if (localStorage) {
    const previous = normalizeSlotId(getSessionStorage()?.getItem(WINDOW_ID_STORAGE_KEY) ?? null);
    if (previous && previous !== normalized) {
      releaseActiveSlot(localStorage, previous, ownerId);
    }
    ensureSlotExists(localStorage, normalized);
    setActiveSlot(localStorage, normalized, ownerId, Date.now());
  }
  const sessionStorage = getSessionStorage();
  if (sessionStorage) {
    try {
      sessionStorage.setItem(WINDOW_ID_STORAGE_KEY, normalized);
    } catch {
      // Ignore sessionStorage errors.
    }
  }
  setGlobalWindowId(normalized);
  return normalized;
}

export function resetWindowSlotState(windowId: string): void {
  const normalized = normalizeSlotId(windowId);
  if (!normalized) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(`${PANEL_LAYOUT_STORAGE_KEY}:${normalized}`);
    storage.removeItem(`${PANEL_LAYOUT_VERSION_KEY}:${normalized}`);
    storage.removeItem(`${FOCUS_HISTORY_STORAGE_KEY}:${normalized}`);
    storage.removeItem(`${GLOBAL_QUERY_STORAGE_KEY}:${normalized}`);
  } catch {
    // Ignore storage errors.
  }
}

export function removeWindowSlot(windowId: string): boolean {
  const normalized = normalizeSlotId(windowId) ?? DEFAULT_WINDOW_SLOT_ID;
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }
  const ownerId = getWindowOwnerId();
  if (normalized === DEFAULT_WINDOW_SLOT_ID) {
    return false;
  }
  const active = pruneActiveSlots(readActiveSlots(storage), Date.now());
  const currentSlot = normalizeSlotId(getSessionStorage()?.getItem(WINDOW_ID_STORAGE_KEY) ?? null);
  if (currentSlot === normalized) {
    return false;
  }
  if (active[normalized] && active[normalized].ownerId !== ownerId) {
    return false;
  }
  releaseActiveSlot(storage, normalized, ownerId);
  resetWindowSlotState(normalized);
  const slots = ensureWindowSlots(storage).filter((slot) => slot !== normalized);
  const nextSlots = slots.length > 0 ? slots : [DEFAULT_WINDOW_SLOT_ID];
  writeWindowSlots(storage, nextSlots);
  const names = readWindowSlotNames(storage);
  if (names[normalized]) {
    delete names[normalized];
    writeWindowSlotNames(storage, names);
  }
  return true;
}

export function listWindowSlotStatuses(): Array<{
  slotId: string;
  status: 'current' | 'busy' | 'available';
  name?: string;
}> {
  const storage = getLocalStorage();
  const ownerId = getWindowOwnerId();
  const currentSlot = normalizeSlotId(getSessionStorage()?.getItem(WINDOW_ID_STORAGE_KEY) ?? null);
  const slots = storage ? ensureWindowSlots(storage) : [DEFAULT_WINDOW_SLOT_ID];
  const active = storage ? pruneActiveSlots(readActiveSlots(storage), Date.now()) : {};
  const names = storage ? readWindowSlotNames(storage) : {};
  return slots.map((slotId) => {
    const name = names[slotId];
    const base = { slotId };
    if (slotId === currentSlot) {
      return name ? { ...base, status: 'current', name } : { ...base, status: 'current' };
    }
    const entry = active[slotId];
    if (entry && entry.ownerId !== ownerId) {
      return name ? { ...base, status: 'busy', name } : { ...base, status: 'busy' };
    }
    return name ? { ...base, status: 'available', name } : { ...base, status: 'available' };
  });
}

export function touchWindowSlot(windowId: string): void {
  const normalized = normalizeSlotId(windowId);
  if (!normalized) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  const ownerId = getWindowOwnerId();
  setActiveSlot(storage, normalized, ownerId, Date.now());
}

export function deactivateWindowSlot(windowId: string): void {
  const normalized = normalizeSlotId(windowId);
  if (!normalized) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  const ownerId = getWindowOwnerId();
  releaseActiveSlot(storage, normalized, ownerId);
}

export function startWindowSlotHeartbeat(
  windowId: string,
  intervalMs: number = WINDOW_HEARTBEAT_INTERVAL_MS,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  touchWindowSlot(windowId);
  const handle = window.setInterval(() => {
    touchWindowSlot(windowId);
  }, intervalMs);
  return () => {
    window.clearInterval(handle);
  };
}

export function setWindowSlotName(windowId: string, name: string): void {
  const normalized = normalizeSlotId(windowId);
  if (!normalized) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  const trimmed = name.trim();
  const names = readWindowSlotNames(storage);
  if (!trimmed) {
    if (names[normalized]) {
      delete names[normalized];
      writeWindowSlotNames(storage, names);
    }
    return;
  }
  names[normalized] = trimmed;
  writeWindowSlotNames(storage, names);
}
