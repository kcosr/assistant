// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatScrollManager } from './chatScroll';

describe('ChatScrollManager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('settles to the bottom across follow-up animation frames', async () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    document.body.append(container, button);

    let currentScrollHeight = 400;
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => currentScrollHeight,
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });

    const manager = new ChatScrollManager(container, button);
    manager.scrollToBottomAfterLayout(2);
    expect(container.scrollTop).toBe(400);

    currentScrollHeight = 650;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.scrollTop).toBe(650);

    currentScrollHeight = 900;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.scrollTop).toBe(900);
  });

  it('cancels an older settle run when a newer one starts', async () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    document.body.append(container, button);

    let currentScrollHeight = 300;
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => currentScrollHeight,
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });

    const manager = new ChatScrollManager(container, button);
    manager.scrollToBottomAfterLayout(2);
    currentScrollHeight = 500;
    manager.scrollToBottomAfterLayout(1);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.scrollTop).toBe(500);
  });
});
