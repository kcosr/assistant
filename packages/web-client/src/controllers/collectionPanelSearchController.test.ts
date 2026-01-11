// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionPanelSearchController } from './collectionPanelSearchController';

describe('CollectionPanelSearchController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  function createController(): CollectionPanelSearchController {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new CollectionPanelSearchController({
      containerEl: host,
      icons: { x: 'x' },
    });
  }

  it('does not persist search state to localStorage', () => {
    const controller = createController();
    const tagController = controller.getTagController();
    expect(tagController).not.toBeNull();

    tagController?.addTagFilter('Work');
    tagController?.addTagFilter('ideas', 'exclude');
    controller.getSearchInputEl()!.value = 'hello';
    // Trigger a persist with current state
    tagController?.addTagFilter('later');
    tagController?.removeTagFilter('later');

    expect(window.localStorage.length).toBe(0);
  });
});
