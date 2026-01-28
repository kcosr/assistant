/**
 * Keyboard Shortcut Registry
 *
 * Centralized handling of keyboard shortcuts with conflict detection.
 * Currently not user-configurable, but structured to enable that in the future.
 */

export type ModifierKey = 'ctrl' | 'meta' | 'shift' | 'alt';
export type ShortcutScope = 'global' | 'activePanel' | 'panelType' | 'panelInstance';
export type ShortcutPlatform = 'mac' | 'win' | 'linux' | 'all';

export interface ShortcutBindingOverride {
  key: string;
  modifiers: ModifierKey[];
  cmdOrCtrl?: boolean;
  platform?: ShortcutPlatform;
}

export type ShortcutBindingOverrides = Record<string, ShortcutBindingOverride>;

export interface KeyboardShortcut {
  /** Unique identifier for this shortcut */
  id: string;
  /** The key to listen for (lowercase) */
  key: string;
  /** Required modifier keys */
  modifiers: ModifierKey[];
  /** Human-readable description */
  description: string;
  /** Handler function - return true if handled, false to allow fallback */
  handler: (event: KeyboardEvent) => boolean | void;
  /**
   * If true, use meta on Mac and ctrl on other platforms for the 'cmdOrCtrl' modifier.
   * When set, 'ctrl' in modifiers is treated as 'cmdOrCtrl'.
   */
  cmdOrCtrl?: boolean;
  /** Optional scope for resolving conflicts */
  scope?: ShortcutScope;
  /** Panel type to scope to (panelType scope only) */
  panelType?: string;
  /** Panel id to scope to (panelInstance scope only) */
  panelId?: string;
  /** Priority when conflicts exist within the same scope */
  priority?: number;
  /** Optional platform restriction */
  platform?: ShortcutPlatform;
  /** Allow matching when Shift is held even if not in modifiers */
  allowShift?: boolean;
  /** Allow handling even when shortcuts are globally disabled (e.g., modal dialogs). */
  allowWhenDisabled?: boolean;
  /** Stable id for user-configurable bindings (defaults to id if omitted). */
  bindingId?: string;
}

export interface ShortcutRegistryOptions {
  /** Called when a duplicate shortcut binding is detected in the same scope */
  onConflict?: (existing: KeyboardShortcut, incoming: KeyboardShortcut) => void;
  /** Optional predicate to decide whether shortcuts should be handled */
  isEnabled?: () => boolean;
  /** Active panel context for scope resolution */
  getActivePanel?: () => { panelId: string; panelType: string } | null;
  /** Optional per-action binding overrides */
  bindingOverrides?: ShortcutBindingOverrides;
}

interface ShortcutRegistration {
  shortcut: KeyboardShortcut;
  bindingKey: string;
  order: number;
}

export interface KeyboardShortcutService {
  register: (shortcut: KeyboardShortcut) => () => void;
  getAll: () => KeyboardShortcut[];
}

/**
 * Detects if the current platform is Mac/iOS
 */
export function isMacPlatform(): boolean {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return false;
  }
  return /Mac|iP(hone|od|ad)/.test(window.navigator.platform);
}

export function getShortcutPlatform(): ShortcutPlatform {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return 'all';
  }
  if (isMacPlatform()) {
    return 'mac';
  }
  const platform = window.navigator.platform?.toLowerCase() ?? '';
  if (platform.includes('win')) {
    return 'win';
  }
  return 'linux';
}

/**
 * Creates a human-readable label for a shortcut
 */
export function getShortcutLabel(shortcut: KeyboardShortcut): string {
  const isMac = isMacPlatform();
  const parts: string[] = [];

  for (const mod of shortcut.modifiers) {
    if (mod === 'ctrl') {
      if (shortcut.cmdOrCtrl) {
        parts.push(isMac ? '⌘' : 'Ctrl');
      } else {
        parts.push(isMac ? '⌃' : 'Ctrl');
      }
    } else if (mod === 'meta') {
      parts.push(isMac ? '⌘' : 'Win');
    } else if (mod === 'shift') {
      parts.push(isMac ? '⇧' : 'Shift');
    } else if (mod === 'alt') {
      parts.push(isMac ? '⌥' : 'Alt');
    }
  }

  // Format key nicely
  const keyLabel = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  const specialKeys: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    escape: 'Esc',
    enter: '↵',
    backspace: '⌫',
    delete: '⌦',
    tab: '⇥',
  };
  parts.push(specialKeys[shortcut.key] ?? keyLabel);

  return parts.join(isMac ? '' : '+');
}

const VALID_MODIFIERS: ModifierKey[] = ['ctrl', 'meta', 'shift', 'alt'];

function normalizeModifiers(modifiers: ModifierKey[]): ModifierKey[] {
  const normalized: ModifierKey[] = [];
  const seen = new Set<ModifierKey>();
  for (const mod of modifiers) {
    const candidate = mod.toLowerCase() as ModifierKey;
    if (!VALID_MODIFIERS.includes(candidate)) {
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeShortcut(shortcut: KeyboardShortcut): KeyboardShortcut {
  return {
    ...shortcut,
    key: shortcut.key.toLowerCase(),
    modifiers: normalizeModifiers(shortcut.modifiers),
    scope: shortcut.scope ?? 'global',
  };
}

/**
 * Creates a unique key for shortcut lookup based on modifiers and key
 */
function createShortcutKey(
  key: string,
  modifiers: ModifierKey[],
  cmdOrCtrl: boolean,
  isMac: boolean,
): string {
  const normalizedMods = [...modifiers].sort();
  // Normalize cmdOrCtrl to the actual modifier for this platform
  const effectiveMods = normalizedMods.map((m) => {
    if (m === 'ctrl' && cmdOrCtrl) {
      return isMac ? 'meta' : 'ctrl';
    }
    return m;
  });
  return `${effectiveMods.join('+')}-${key.toLowerCase()}`;
}

function getEventModifiers(event: KeyboardEvent): ModifierKey[] {
  const modifiers: ModifierKey[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey) modifiers.push('meta');
  if (event.shiftKey) modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');
  return modifiers;
}

function scopeRank(scope: ShortcutScope): number {
  switch (scope) {
    case 'panelInstance':
      return 4;
    case 'panelType':
      return 3;
    case 'activePanel':
      return 2;
    case 'global':
    default:
      return 1;
  }
}

function isSameScopeTarget(a: KeyboardShortcut, b: KeyboardShortcut): boolean {
  const scopeA = a.scope ?? 'global';
  const scopeB = b.scope ?? 'global';
  if (scopeA !== scopeB) {
    return false;
  }
  if (scopeA === 'panelInstance') {
    return a.panelId === b.panelId;
  }
  if (scopeA === 'panelType') {
    return a.panelType === b.panelType;
  }
  return true;
}

export class KeyboardShortcutRegistry {
  private shortcuts: Map<string, ShortcutRegistration[]> = new Map();
  private shortcutsById: Map<string, ShortcutRegistration> = new Map();
  private options: ShortcutRegistryOptions;
  private isMac: boolean;
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;
  private registrationOrder = 0;

  constructor(options: ShortcutRegistryOptions = {}) {
    this.options = options;
    this.isMac = isMacPlatform();
  }

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: KeyboardShortcut): void {
    const normalized = normalizeShortcut(shortcut);
    const resolved = this.applyBindingOverrides(normalized);

    const key = createShortcutKey(
      resolved.key,
      resolved.modifiers,
      resolved.cmdOrCtrl ?? false,
      this.isMac,
    );

    const existingById = this.shortcutsById.get(resolved.id);
    if (existingById) {
      this.removeRegistration(existingById);
    }

    const existing = this.shortcuts.get(key);
    if (existing) {
      const conflict = existing.find((entry) => isSameScopeTarget(entry.shortcut, resolved));
      if (conflict) {
        if (this.options.onConflict) {
          this.options.onConflict(conflict.shortcut, resolved);
        } else {
          console.warn(
            `[KeyboardShortcutRegistry] Conflict: "${resolved.id}" overlaps "${conflict.shortcut.id}" for ${key}`,
          );
        }
      }
    }

    const registration: ShortcutRegistration = {
      shortcut: resolved,
      bindingKey: key,
      order: ++this.registrationOrder,
    };

    const list = existing ?? [];
    list.push(registration);
    this.shortcuts.set(key, list);
    this.shortcutsById.set(resolved.id, registration);
  }

  /**
   * Unregister a shortcut by ID
   */
  unregister(id: string): void {
    const registration = this.shortcutsById.get(id);
    if (!registration) return;

    this.removeRegistration(registration);
  }

  /**
   * Get all registered shortcuts
   */
  getAll(): KeyboardShortcut[] {
    return Array.from(this.shortcutsById.values()).map((entry) => entry.shortcut);
  }

  /**
   * Handle a keyboard event, returning true if it was handled
   */
  handleEvent(event: KeyboardEvent): boolean {
    const modifiers = getEventModifiers(event);
    const eventKey = createShortcutKey(event.key, modifiers, false, this.isMac);

    const candidates = this.collectCandidates(event, eventKey, modifiers);
    if (candidates.length === 0) {
      return false;
    }

    const activePanel = this.options.getActivePanel?.() ?? null;
    const platform = getShortcutPlatform();

    const filtered = candidates.filter((entry) =>
      this.isCandidateEligible(entry.shortcut, activePanel, platform),
    );

    if (filtered.length === 0) {
      return false;
    }

    const allowWhenDisabled = filtered.some((entry) => entry.shortcut.allowWhenDisabled);
    if (this.options.isEnabled && !this.options.isEnabled() && !allowWhenDisabled) {
      return false;
    }

    filtered.sort((a, b) => {
      const aScope = scopeRank(a.shortcut.scope ?? 'global');
      const bScope = scopeRank(b.shortcut.scope ?? 'global');
      if (aScope !== bScope) {
        return bScope - aScope;
      }
      const aPriority = a.shortcut.priority ?? 0;
      const bPriority = b.shortcut.priority ?? 0;
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      return b.order - a.order;
    });

    for (const entry of filtered) {
      const result = entry.shortcut.handler(event);
      if (result !== false) {
        event.preventDefault();
        return true;
      }
    }

    return false;
  }

  /**
   * Attach the registry to the document's keydown event
   */
  attach(): void {
    if (this.boundHandler) return;

    this.boundHandler = (e: KeyboardEvent) => {
      if (this.handleEvent(e)) {
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', this.boundHandler, true);
  }

  /**
   * Detach from the document's keydown event
   */
  detach(): void {
    if (!this.boundHandler) return;

    document.removeEventListener('keydown', this.boundHandler, true);
    this.boundHandler = null;
  }

  private applyBindingOverrides(shortcut: KeyboardShortcut): KeyboardShortcut {
    const overrideKey = shortcut.bindingId ?? shortcut.id;
    const overrides = this.options.bindingOverrides?.[overrideKey];
    if (!overrides || typeof overrides !== 'object') {
      return shortcut;
    }

    const nextKey = typeof overrides.key === 'string' ? overrides.key.toLowerCase() : shortcut.key;
    const nextModifiers = Array.isArray(overrides.modifiers)
      ? normalizeModifiers(overrides.modifiers)
      : shortcut.modifiers;
    const nextCmdOrCtrl =
      typeof overrides.cmdOrCtrl === 'boolean' ? overrides.cmdOrCtrl : shortcut.cmdOrCtrl;
    const nextPlatform =
      overrides.platform && this.isValidPlatform(overrides.platform)
        ? overrides.platform
        : shortcut.platform;

    return {
      ...shortcut,
      key: nextKey,
      modifiers: nextModifiers,
      ...(typeof nextCmdOrCtrl === 'boolean' ? { cmdOrCtrl: nextCmdOrCtrl } : {}),
      ...(nextPlatform ? { platform: nextPlatform } : {}),
    };
  }

  private isValidPlatform(platform: ShortcutPlatform): boolean {
    return platform === 'mac' || platform === 'win' || platform === 'linux' || platform === 'all';
  }

  private collectCandidates(
    event: KeyboardEvent,
    eventKey: string,
    modifiers: ModifierKey[],
  ): ShortcutRegistration[] {
    const registry = new Map<string, ShortcutRegistration>();

    const primary = this.shortcuts.get(eventKey);
    if (primary) {
      for (const entry of primary) {
        registry.set(entry.shortcut.id, entry);
      }
    }

    if (event.shiftKey) {
      const withoutShift = modifiers.filter((mod) => mod !== 'shift');
      if (withoutShift.length !== modifiers.length) {
        const shiftlessKey = createShortcutKey(event.key, withoutShift, false, this.isMac);
        const shiftless = this.shortcuts.get(shiftlessKey) ?? [];
        for (const entry of shiftless) {
          if (entry.shortcut.allowShift) {
            registry.set(entry.shortcut.id, entry);
          }
        }
      }
    }

    return Array.from(registry.values());
  }

  private isCandidateEligible(
    shortcut: KeyboardShortcut,
    activePanel: { panelId: string; panelType: string } | null,
    platform: ShortcutPlatform,
  ): boolean {
    const shortcutPlatform = shortcut.platform ?? 'all';
    if (shortcutPlatform !== 'all' && shortcutPlatform !== platform) {
      return false;
    }

    const scope = shortcut.scope ?? 'global';
    if (scope === 'global') {
      return true;
    }

    if (!activePanel) {
      return false;
    }

    if (scope === 'activePanel') {
      return true;
    }

    if (scope === 'panelType') {
      if (!shortcut.panelType) {
        return false;
      }
      return shortcut.panelType === activePanel.panelType;
    }

    if (scope === 'panelInstance') {
      if (!shortcut.panelId) {
        return false;
      }
      return shortcut.panelId === activePanel.panelId;
    }

    return false;
  }

  private removeRegistration(registration: ShortcutRegistration): void {
    const list = this.shortcuts.get(registration.bindingKey);
    if (list) {
      const next = list.filter((entry) => entry.shortcut.id !== registration.shortcut.id);
      if (next.length === 0) {
        this.shortcuts.delete(registration.bindingKey);
      } else {
        this.shortcuts.set(registration.bindingKey, next);
      }
    }
    this.shortcutsById.delete(registration.shortcut.id);
  }
}

export function createShortcutService(
  registry: KeyboardShortcutRegistry,
): KeyboardShortcutService {
  return {
    register: (shortcut) => {
      registry.register(shortcut);
      return () => registry.unregister(shortcut.id);
    },
    getAll: () => registry.getAll(),
  };
}

/**
 * Helper to create a shortcut definition with cmdOrCtrl modifier
 */
export function cmdShiftShortcut(
  id: string,
  key: string,
  description: string,
  handler: KeyboardShortcut['handler'],
  options: Partial<Omit<KeyboardShortcut, 'id' | 'key' | 'modifiers' | 'description' | 'handler'>> = {},
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl', 'shift'],
    description,
    handler,
    cmdOrCtrl: true,
    ...options,
  };
}

/**
 * Helper to create a shortcut definition with just ctrl modifier
 */
export function ctrlShortcut(
  id: string,
  key: string,
  description: string,
  handler: KeyboardShortcut['handler'],
  options: Partial<Omit<KeyboardShortcut, 'id' | 'key' | 'modifiers' | 'description' | 'handler'>> = {},
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl'],
    description,
    handler,
    cmdOrCtrl: false,
    ...options,
  };
}

/**
 * Helper to create a shortcut definition with no modifiers
 */
export function plainShortcut(
  id: string,
  key: string,
  description: string,
  handler: KeyboardShortcut['handler'],
  options: Partial<Omit<KeyboardShortcut, 'id' | 'key' | 'modifiers' | 'description' | 'handler'>> = {},
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: [],
    description,
    handler,
    ...options,
  };
}

/**
 * Helper to create a shortcut with actual Ctrl+Shift (not cmdOrCtrl).
 * This uses the actual Ctrl key on all platforms, including Mac.
 * Useful when you want to avoid conflicts with OS shortcuts (e.g., Cmd+Shift+C on Mac).
 */
export function ctrlShiftShortcut(
  id: string,
  key: string,
  description: string,
  handler: KeyboardShortcut['handler'],
  options: Partial<Omit<KeyboardShortcut, 'id' | 'key' | 'modifiers' | 'description' | 'handler'>> = {},
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl', 'shift'],
    description,
    handler,
    cmdOrCtrl: false, // Use actual Ctrl, not Cmd on Mac
    ...options,
  };
}
