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

    const deleteBtn = document.body.querySelector<HTMLButtonElement>('#delete-selection-button');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn?.innerHTML).toContain('trash');
  });
});
