// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createTurnWindowManager } from './turnWindowManager';

afterEach(() => {
  document.body.innerHTML = '';
});

function createTurn(turnId: string): HTMLDivElement {
  const turn = document.createElement('div');
  turn.className = 'turn';
  turn.dataset['turnId'] = turnId;
  turn.textContent = `Turn ${turnId}`;
  return turn;
}

describe('createTurnWindowManager', () => {
  it('mounts only the visible range plus the newest tail for large transcripts', () => {
    const scrollContainer = document.createElement('div');
    const contentHost = document.createElement('div');
    scrollContainer.appendChild(contentHost);
    document.body.appendChild(scrollContainer);

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    scrollContainer.scrollTop = 0;

    for (let index = 0; index < 30; index += 1) {
      contentHost.appendChild(createTurn(String(index)));
    }

    const manager = createTurnWindowManager(scrollContainer, contentHost);
    manager.refresh();

    const mountedTurns = contentHost.querySelectorAll(':scope > .turn');
    expect(mountedTurns.length).toBeLessThan(30);
    expect(contentHost.querySelector('[data-turn-id="0"]')).not.toBeNull();
    expect(contentHost.querySelector('[data-turn-id="10"]')).toBeNull();
    expect(contentHost.querySelector('[data-turn-id="29"]')).not.toBeNull();
    expect(contentHost.querySelector('.turn-window-spacer-top')).not.toBeNull();
    expect(contentHost.querySelector('.turn-window-spacer-middle')).not.toBeNull();

    manager.dispose();
  });
});
