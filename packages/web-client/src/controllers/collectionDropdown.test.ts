// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CollectionDropdownController } from './collectionDropdown';

function makeController(
  overrides?: Partial<ConstructorParameters<typeof CollectionDropdownController>[0]>,
) {
  const container = document.createElement('div');
  const dropdown = document.createElement('div');
  const trigger = document.createElement('button');
  const triggerText = document.createElement('span');
  const searchInput = document.createElement('input');
  const list = document.createElement('div');
  const tagsContainer = document.createElement('div');
  const activeTagsContainer = document.createElement('div');
  document.body.append(container, dropdown, trigger, triggerText, searchInput, list);

  const options: ConstructorParameters<typeof CollectionDropdownController>[0] = {
    container,
    dropdown,
    trigger,
    triggerText,
    searchInput,
    list,
    tagsContainer,
    activeTagsContainer,
    focusInput: vi.fn(),
    isDialogOpen: () => false,
    isPanelOpen: () => true,
    isMobileViewport: () => false,
    setPanelOpen: vi.fn(),
    getAllTags: () => [],
    getGroupLabel: (type) => (type === 'list' ? 'Lists' : 'Other'),
    getSupportedTypes: () => ['list'],
    getSortMode: () => 'alpha',
    getActiveItemReference: () => null,
    updateSelection: vi.fn(),
    selectItem: vi.fn(),
    ...overrides,
  };

  const controller = new CollectionDropdownController(options);
  return { controller, list };
}

describe('CollectionDropdownController', () => {
  it('keeps virtual Focus and Pinned lists at the top of list dropdown results', () => {
    const { controller, list } = makeController();

    controller.populate([
      { type: 'list', id: 'agent-pack', name: 'Agent Pack' },
      { type: 'list', id: '__focus__', name: 'Focus', specialKind: 'focus' },
      { type: 'list', id: '__pinned__', name: 'Pinned', specialKind: 'pinned' },
      { type: 'list', id: 'today', name: 'Today' },
    ]);

    const ids = Array.from(
      list.querySelectorAll<HTMLElement>('.collection-search-dropdown-item'),
    ).map((el) => el.dataset['collectionId']);

    expect(ids).toEqual(['__focus__', '__pinned__', 'agent-pack', 'today']);
  });
});
