// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { INPUT_PANEL_MANIFEST } from '../panels/input/manifest';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: () => undefined,
  }),
});

let pointerCaptures = new WeakMap<HTMLElement, number>();
const originalPointerEvent = globalThis.PointerEvent;
const originalSetPointerCapture = (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
const originalReleasePointerCapture = (HTMLElement.prototype as Partial<HTMLElement>)
  .releasePointerCapture;
const originalHasPointerCapture = (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;

class MockPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

describe('PanelWorkspaceController split resize', () => {
  beforeEach(() => {
    window.localStorage.clear();

    if (!globalThis.PointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
        MockPointerEvent as unknown as typeof PointerEvent;
    }

    if (!originalSetPointerCapture) {
      HTMLElement.prototype.setPointerCapture = function (pointerId: number) {
        pointerCaptures.set(this, pointerId);
      };
    }
    if (!originalReleasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = function (pointerId: number) {
        if (pointerCaptures.get(this) === pointerId) {
          pointerCaptures.delete(this);
        }
      };
    }
    if (!originalHasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = function (pointerId: number) {
        return pointerCaptures.get(this) === pointerId;
      };
    }
  });

  afterEach(() => {
    pointerCaptures = new WeakMap<HTMLElement, number>();
    document.body.innerHTML = '';

    if (originalPointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent = originalPointerEvent;
    } else {
      delete (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
    }

    if (originalSetPointerCapture) {
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    }
    if (originalReleasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
    }
    if (originalHasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
    }
  });

  it('stops resizing when the pointer is canceled', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({ root, registry, host });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const handle = root.querySelector<HTMLElement>('.panel-split-handle');
    expect(handle).not.toBeNull();
    if (!handle) {
      throw new Error('Missing split handle');
    }

    const wrappers = root.querySelectorAll<HTMLElement>('.panel-split-child');
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
    const first = wrappers[0];
    const second = wrappers[1];
    if (!first || !second) {
      throw new Error('Missing split wrappers');
    }

    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 100, 100));

    const initialFlex = first.style.flex;

    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 0,
        clientY: 50,
      }),
    );

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 0,
        clientY: 150,
      }),
    );

    const flexAfterMove = first.style.flex;
    expect(flexAfterMove).not.toEqual(initialFlex);

    window.dispatchEvent(
      new PointerEvent('pointercancel', {
        pointerId: 1,
        clientX: 0,
        clientY: 150,
      }),
    );

    const flexAfterCancel = first.style.flex;
    expect(handle.classList.contains('dragging')).toBe(false);

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 0,
        clientY: 180,
      }),
    );

    expect(first.style.flex).toEqual(flexAfterCancel);
  });
});
