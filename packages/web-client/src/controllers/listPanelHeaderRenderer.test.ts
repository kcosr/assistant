// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ListPanelData } from './listPanelController';
import { renderListPanelHeader } from './listPanelHeaderRenderer';

describe('renderListPanelHeader', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an edit button and calls onEditMetadata when clicked', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };

    const onEditMetadata = vi.fn();

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 0,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop: vi.fn(),
      onMoveSelectionToBottom: vi.fn(),
      onAddSelectionToFocus: vi.fn(),
      onRemoveSelectionFromFocus: vi.fn(),
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata,
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList: vi.fn(),
      onCopySelectedToList: vi.fn(),
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    const editBtn = document.body.querySelector<HTMLButtonElement>('.collection-list-edit-button');
    expect(editBtn).not.toBeNull();

    editBtn?.click();

    expect(onEditMetadata).toHaveBeenCalledTimes(1);

    const deleteBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="delete-selection-button"]',
    );
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn?.innerHTML).toContain('trash');
  });

  it('shows selection actions and hides select commands when items are already selected', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 2,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop: vi.fn(),
      onMoveSelectionToBottom: vi.fn(),
      onAddSelectionToFocus: vi.fn(),
      onRemoveSelectionFromFocus: vi.fn(),
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata: vi.fn(),
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList: vi.fn(),
      onCopySelectedToList: vi.fn(),
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    const selectVisibleBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="select-visible-button"]',
    );
    const selectAllBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="select-all-button"]',
    );
    const selectionStatus = document.body.querySelector<HTMLButtonElement>(
      '[data-role="selection-status"]',
    );
    const clearBtn = document.body.querySelector<HTMLButtonElement>('[data-role="clear-selection-button"]');
    const moveTopBtn = document.body.querySelector<HTMLButtonElement>('[data-role="move-selection-top-button"]');
    const moveBottomBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="move-selection-bottom-button"]',
    );
    const moveBtn = document.body.querySelector<HTMLButtonElement>('[data-role="move-selected-button"]');
    const copyBtn = document.body.querySelector<HTMLButtonElement>('[data-role="copy-selected-button"]');
    const deleteBtn = document.body.querySelector<HTMLButtonElement>('[data-role="delete-selection-button"]');

    expect(selectVisibleBtn?.hidden).toBe(true);
    expect(selectAllBtn?.hidden).toBe(true);
    expect(selectionStatus?.classList.contains('visible')).toBe(true);
    expect(clearBtn?.classList.contains('visible')).toBe(true);
    expect(moveTopBtn?.classList.contains('visible')).toBe(true);
    expect(moveBottomBtn?.classList.contains('visible')).toBe(true);
    expect(moveBtn?.classList.contains('visible')).toBe(true);
    expect(copyBtn?.classList.contains('visible')).toBe(true);
    expect(deleteBtn?.classList.contains('visible')).toBe(true);
  });

  it('orders selection-menu commands with move actions first', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 2,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop: vi.fn(),
      onMoveSelectionToBottom: vi.fn(),
      onAddSelectionToFocus: vi.fn(),
      onRemoveSelectionFromFocus: vi.fn(),
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata: vi.fn(),
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList: vi.fn(),
      onCopySelectedToList: vi.fn(),
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();

    const labels = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '.collection-list-selection-menu > .collection-list-actions-menu-item.visible',
      ),
    ).map((el) => el.textContent?.trim());

    expect(labels).toEqual([
      'Move to Top',
      'Move to Bottom',
      'Move to List',
      'Copy',
      'Add to Focus',
      'Remove from Focus',
      'Clear',
      'Delete',
    ]);
  });

  it('invokes focus-selection callback from the selection menu', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };
    const onAddSelectionToFocus = vi.fn();
    const onRemoveSelectionFromFocus = vi.fn();

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 2,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop: vi.fn(),
      onMoveSelectionToBottom: vi.fn(),
      onAddSelectionToFocus,
      onRemoveSelectionFromFocus,
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata: vi.fn(),
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList: vi.fn(),
      onCopySelectedToList: vi.fn(),
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    const addFocusBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="add-focus-selection-button"]',
    );
    const removeFocusBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-role="remove-focus-selection-button"]',
    );
    expect(addFocusBtn?.textContent).toBe('Add to Focus');
    expect(removeFocusBtn?.textContent).toBe('Remove from Focus');

    addFocusBtn?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    removeFocusBtn?.click();

    expect(onAddSelectionToFocus).toHaveBeenCalledTimes(1);
    expect(onRemoveSelectionFromFocus).toHaveBeenCalledTimes(1);
  });

  it('invokes target-list callbacks from the selection menu', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };
    const onMoveSelectedToList = vi.fn();
    const onCopySelectedToList = vi.fn();

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 1,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop: vi.fn(),
      onMoveSelectionToBottom: vi.fn(),
      onAddSelectionToFocus: vi.fn(),
      onRemoveSelectionFromFocus: vi.fn(),
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata: vi.fn(),
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList,
      onCopySelectedToList,
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body
      .querySelector<HTMLButtonElement>('[data-role="move-selected-button"]')
      ?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body
      .querySelector<HTMLButtonElement>('[data-role="copy-selected-button"]')
      ?.click();

    expect(onMoveSelectedToList).toHaveBeenCalledTimes(1);
    expect(onCopySelectedToList).toHaveBeenCalledTimes(1);
  });

  it('invokes move-selection callbacks from the actions menu', () => {
    const data: ListPanelData = {
      id: 'list1',
      name: 'My List',
    };
    const onMoveSelectionToTop = vi.fn();
    const onMoveSelectionToBottom = vi.fn();

    const { header, controls } = renderListPanelHeader({
      listId: 'list1',
      data,
      selectedCount: 2,
      icons: {
        plus: '',
        trash: '<svg class="trash"></svg>',
        edit: '<svg></svg>',
      },
      showAllColumns: false,
      timelineField: null,
      focusMarkerItemId: null,
      isSortedByPosition: true,
      customFields: [],
      onSelectVisible: vi.fn(),
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteSelection: vi.fn(),
      onMoveSelectionToTop,
      onMoveSelectionToBottom,
      onAddSelectionToFocus: vi.fn(),
      onRemoveSelectionFromFocus: vi.fn(),
      onAddItem: vi.fn(),
      onToggleView: vi.fn(),
      onEditMetadata: vi.fn(),
      onTimelineFieldChange: vi.fn(),
      onFocusViewToggle: vi.fn(),
      getMoveTargetLists: () => [],
      onMoveSelectedToList: vi.fn(),
      onCopySelectedToList: vi.fn(),
      renderTags: () => null,
    });

    document.body.appendChild(header);
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="move-selection-top-button"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="move-selection-bottom-button"]')?.click();

    expect(onMoveSelectionToTop).toHaveBeenCalledTimes(1);
    expect(onMoveSelectionToBottom).toHaveBeenCalledTimes(1);
  });
});
