// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { KeyboardShortcutRegistry } from './keyboardShortcuts';

describe('KeyboardShortcutRegistry', () => {
  it('prefers panel instance shortcuts over global ones', () => {
    let panelCalled = false;
    let globalCalled = false;

    const registry = new KeyboardShortcutRegistry({
      getActivePanel: () => ({ panelId: 'panel-1', panelType: 'lists' }),
    });

    registry.register({
      id: 'global-x',
      key: 'x',
      modifiers: [],
      description: 'Global X',
      handler: () => {
        globalCalled = true;
      },
    });

    registry.register({
      id: 'panel-x',
      key: 'x',
      modifiers: [],
      description: 'Panel X',
      scope: 'panelInstance',
      panelId: 'panel-1',
      handler: () => {
        panelCalled = true;
      },
    });

    const event = new KeyboardEvent('keydown', {
      key: 'x',
      bubbles: true,
      cancelable: true,
    });

    const handled = registry.handleEvent(event);

    expect(handled).toBe(true);
    expect(panelCalled).toBe(true);
    expect(globalCalled).toBe(false);
  });

  it('matches shift variants when allowShift is enabled', () => {
    let called = false;

    const registry = new KeyboardShortcutRegistry();
    registry.register({
      id: 'arrow-up',
      key: 'arrowup',
      modifiers: [],
      description: 'Arrow up',
      allowShift: true,
      handler: () => {
        called = true;
      },
    });

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = registry.handleEvent(event);

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  it('allows shortcuts with allowWhenDisabled to run even when disabled', () => {
    let called = false;
    const registry = new KeyboardShortcutRegistry({
      isEnabled: () => false,
    });

    registry.register({
      id: 'dialog-escape',
      key: 'escape',
      modifiers: [],
      description: 'Dialog escape',
      allowWhenDisabled: true,
      handler: () => {
        called = true;
      },
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    const handled = registry.handleEvent(event);

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  it('applies binding overrides using bindingId when provided', () => {
    let called = false;
    const registry = new KeyboardShortcutRegistry({
      bindingOverrides: {
        'lists.toggle-aql': {
          key: 'z',
          modifiers: [],
        },
      },
    });

    registry.register({
      id: 'lists-panel-1-toggle-aql',
      bindingId: 'lists.toggle-aql',
      key: 'a',
      modifiers: [],
      description: 'Toggle AQL',
      handler: () => {
        called = true;
      },
    });

    const overridden = new KeyboardEvent('keydown', {
      key: 'z',
      bubbles: true,
      cancelable: true,
    });

    const handled = registry.handleEvent(overridden);

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });
});
