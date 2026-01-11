/**
 * Keyboard Shortcut Registry
 *
 * Centralized handling of keyboard shortcuts with conflict detection.
 * Currently not user-configurable, but structured to enable that in the future.
 */

export type ModifierKey = 'ctrl' | 'meta' | 'shift' | 'alt';

export interface KeyboardShortcut {
  /** Unique identifier for this shortcut */
  id: string;
  /** The key to listen for (lowercase) */
  key: string;
  /** Required modifier keys */
  modifiers: ModifierKey[];
  /** Human-readable description */
  description: string;
  /** Handler function - return true if handled, false to allow propagation */
  handler: (event: KeyboardEvent) => boolean | void;
  /**
   * If true, use meta on Mac and ctrl on other platforms for the 'cmdOrCtrl' modifier.
   * When set, 'ctrl' in modifiers is treated as 'cmdOrCtrl'.
   */
  cmdOrCtrl?: boolean;
}

export interface ShortcutRegistryOptions {
  /** Called when a duplicate shortcut binding is detected */
  onConflict?: (existing: KeyboardShortcut, incoming: KeyboardShortcut) => void;
  /** Optional predicate to decide whether shortcuts should be handled */
  isEnabled?: () => boolean;
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

export class KeyboardShortcutRegistry {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private shortcutsById: Map<string, KeyboardShortcut> = new Map();
  private options: ShortcutRegistryOptions;
  private isMac: boolean;
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: ShortcutRegistryOptions = {}) {
    this.options = options;
    this.isMac = isMacPlatform();
  }

  /**
   * Register a keyboard shortcut
   */
  register(shortcut: KeyboardShortcut): void {
    const key = createShortcutKey(
      shortcut.key,
      shortcut.modifiers,
      shortcut.cmdOrCtrl ?? false,
      this.isMac,
    );

    const existing = this.shortcuts.get(key);
    if (existing) {
      if (this.options.onConflict) {
        this.options.onConflict(existing, shortcut);
      } else {
        console.warn(
          `[KeyboardShortcutRegistry] Conflict: "${shortcut.id}" overwrites "${existing.id}" for ${key}`,
        );
      }
    }

    this.shortcuts.set(key, shortcut);
    this.shortcutsById.set(shortcut.id, shortcut);
  }

  /**
   * Unregister a shortcut by ID
   */
  unregister(id: string): void {
    const shortcut = this.shortcutsById.get(id);
    if (!shortcut) return;

    const key = createShortcutKey(
      shortcut.key,
      shortcut.modifiers,
      shortcut.cmdOrCtrl ?? false,
      this.isMac,
    );
    this.shortcuts.delete(key);
    this.shortcutsById.delete(id);
  }

  /**
   * Get all registered shortcuts
   */
  getAll(): KeyboardShortcut[] {
    return Array.from(this.shortcutsById.values());
  }

  /**
   * Handle a keyboard event, returning true if it was handled
   */
  handleEvent(event: KeyboardEvent): boolean {
    if (this.options.isEnabled && !this.options.isEnabled()) {
      return false;
    }

    // Build the key for this event
    const modifiers: ModifierKey[] = [];
    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.metaKey) modifiers.push('meta');
    if (event.shiftKey) modifiers.push('shift');
    if (event.altKey) modifiers.push('alt');

    const eventKey = createShortcutKey(event.key, modifiers, false, this.isMac);

    const shortcut = this.shortcuts.get(eventKey);
    if (shortcut) {
      const result = shortcut.handler(event);
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
}

/**
 * Helper to create a shortcut definition with cmdOrCtrl modifier
 */
export function cmdShiftShortcut(
  id: string,
  key: string,
  description: string,
  handler: KeyboardShortcut['handler'],
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl', 'shift'],
    description,
    handler,
    cmdOrCtrl: true,
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
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl'],
    description,
    handler,
    cmdOrCtrl: false,
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
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: [],
    description,
    handler,
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
): KeyboardShortcut {
  return {
    id,
    key: key.toLowerCase(),
    modifiers: ['ctrl', 'shift'],
    description,
    handler,
    cmdOrCtrl: false, // Use actual Ctrl, not Cmd on Mac
  };
}
