import type { ListPanelData, ListMoveTarget } from './listPanelController';
import type { ListCustomFieldDefinition } from './listCustomFields';
import { getTimelineFields } from '../utils/listSorting';

export interface TimelineFieldOption {
  key: string;
  label: string;
}

export interface ListPanelHeaderRendererOptions {
  listId: string;
  data: ListPanelData;
  icons: {
    plus: string;
    trash: string;
    edit: string;
  };
  showAllColumns: boolean;
  timelineField: string | null;
  focusMarkerItemId: string | null;
  isSortedByPosition: boolean;
  customFields: ListCustomFieldDefinition[];
  onSelectVisible: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelection: () => void;
  onAddItem: (listId: string) => void;
  onToggleView: () => void;
  onEditMetadata: () => void;
  onTimelineFieldChange: (fieldKey: string | null) => void;
  onFocusViewToggle: () => void;
  getMoveTargetLists: () => ListMoveTarget[];
  onMoveSelectedToList: (targetListId: string) => void;
  onCopySelectedToList: (targetListId: string) => void;
  renderTags: (tags: string[] | undefined) => HTMLElement | null;
}

export interface ListPanelHeaderControls {
  rightControls: HTMLElement[];
}

export interface ListPanelHeaderRenderResult {
  header: HTMLElement;
  controls: ListPanelHeaderControls;
}

export function renderListPanelHeader(
  options: ListPanelHeaderRendererOptions,
): ListPanelHeaderRenderResult {
  const header = document.createElement('div');
  header.className = 'collection-list-header';

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'collection-list-button-group';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'collection-list-edit-button';
  editBtn.setAttribute('aria-label', `Edit list ${options.data.name}`);
  editBtn.title = 'Edit list';
  editBtn.innerHTML = options.icons.edit;
  editBtn.addEventListener('click', (event) => {
    event.preventDefault();
    options.onEditMetadata();
  });
  buttonGroup.appendChild(editBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'collection-list-add-button';
  addBtn.setAttribute('aria-label', 'Add item');
  addBtn.innerHTML = options.icons.plus;
  addBtn.addEventListener('click', () => {
    options.onAddItem(options.listId);
  });
  buttonGroup.appendChild(addBtn);

  const actionsWrapper = document.createElement('div');
  actionsWrapper.className = 'collection-list-actions-wrapper';

  const actionsButton = document.createElement('button');
  actionsButton.type = 'button';
  actionsButton.className = 'collection-list-actions-button';
  actionsButton.textContent = 'Actions';
  actionsButton.setAttribute('aria-haspopup', 'menu');
  actionsButton.setAttribute('aria-expanded', 'false');
  actionsWrapper.appendChild(actionsButton);

  const actionsMenu = document.createElement('div');
  actionsMenu.className = 'collection-list-actions-menu';
  actionsWrapper.appendChild(actionsMenu);

  let isMenuOpen = false;
  let moveSubmenu: HTMLDivElement | null = null;
  let copySubmenu: HTMLDivElement | null = null;

  const handleDocumentClick = (event: MouseEvent): void => {
    if (!actionsWrapper.contains(event.target as Node)) {
      setMenuOpen(false);
    }
  };

  const setMenuOpen = (open: boolean): void => {
    if (isMenuOpen === open) {
      return;
    }
    isMenuOpen = open;
    actionsMenu.classList.toggle('open', isMenuOpen);
    actionsButton.setAttribute('aria-expanded', isMenuOpen ? 'true' : 'false');
    if (isMenuOpen) {
      document.addEventListener('click', handleDocumentClick);
    } else {
      document.removeEventListener('click', handleDocumentClick);
    }

    if (!isMenuOpen && moveSubmenu) {
      moveSubmenu.classList.remove('open');
    }
    if (!isMenuOpen && copySubmenu) {
      copySubmenu.classList.remove('open');
    }
  };

  const addMenuItem = (
    label: string,
    onClick: () => void,
    optionsOverrides?: { id?: string; className?: string; iconHtml?: string },
  ): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (optionsOverrides?.iconHtml) {
      btn.innerHTML = `<span class="collection-list-actions-menu-item-icon">${optionsOverrides.iconHtml}</span><span class="collection-list-actions-menu-item-label">${label}</span>`;
    } else {
      btn.textContent = label;
    }
    btn.className = optionsOverrides?.className ?? 'collection-list-actions-menu-item';
    if (optionsOverrides?.id) {
      btn.id = optionsOverrides.id;
    }
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      onClick();
    });
    actionsMenu.appendChild(btn);
    return btn;
  };

  addMenuItem('Select visible', options.onSelectVisible, {
    className: 'collection-list-actions-menu-item',
  });

  addMenuItem('Select all', options.onSelectAll, {
    className: 'collection-list-actions-menu-item',
  });

  const moveSelectedBtn = document.createElement('button');
  moveSelectedBtn.type = 'button';
  moveSelectedBtn.id = 'move-selected-button';
  moveSelectedBtn.className = 'collection-list-actions-menu-item move-selected-button';
  moveSelectedBtn.textContent = 'Move Selected';
  moveSelectedBtn.setAttribute('aria-haspopup', 'menu');
  moveSelectedBtn.setAttribute('aria-expanded', 'false');
  actionsMenu.appendChild(moveSelectedBtn);

  moveSubmenu = document.createElement('div');
  moveSubmenu.className = 'collection-list-actions-submenu';
  actionsMenu.appendChild(moveSubmenu);

  const rebuildMoveSubmenu = (): void => {
    if (!moveSubmenu) {
      return;
    }
    moveSubmenu.innerHTML = '';

    const targets = options
      .getMoveTargetLists()
      .filter((target) => target.id !== options.listId)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (targets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collection-list-actions-submenu-empty';
      empty.textContent = 'No other lists';
      moveSubmenu.appendChild(empty);
      return;
    }

    for (const target of targets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collection-list-actions-submenu-item';
      btn.textContent = target.name;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        options.onMoveSelectedToList(target.id);
      });
      moveSubmenu.appendChild(btn);
    }
  };

  const openMoveSubmenu = (): void => {
    if (!moveSubmenu) {
      return;
    }
    if (copySubmenu) {
      copySubmenu.classList.remove('open');
      copySelectedBtn.setAttribute('aria-expanded', 'false');
    }
    rebuildMoveSubmenu();
    const offsetTop = moveSelectedBtn.offsetTop;
    moveSubmenu.style.top = `${offsetTop}px`;
    moveSubmenu.classList.add('open');
    moveSelectedBtn.setAttribute('aria-expanded', 'true');
  };

  const closeMoveSubmenu = (event?: MouseEvent): void => {
    if (!moveSubmenu) {
      return;
    }
    if (event) {
      const related = event.relatedTarget as Node | null;
      if (related && (related === moveSelectedBtn || moveSubmenu.contains(related))) {
        return;
      }
    }
    moveSubmenu.classList.remove('open');
    moveSelectedBtn.setAttribute('aria-expanded', 'false');
  };

  moveSelectedBtn.addEventListener('mouseenter', () => {
    if (!moveSelectedBtn.classList.contains('visible')) {
      return;
    }
    openMoveSubmenu();
  });

  moveSelectedBtn.addEventListener('focus', () => {
    if (!moveSelectedBtn.classList.contains('visible')) {
      return;
    }
    openMoveSubmenu();
  });

  moveSelectedBtn.addEventListener('mouseleave', (event) => {
    closeMoveSubmenu(event);
  });

  if (moveSubmenu) {
    moveSubmenu.addEventListener('mouseleave', (event) => {
      closeMoveSubmenu(event as MouseEvent);
    });
  }

  const copySelectedBtn = document.createElement('button');
  copySelectedBtn.type = 'button';
  copySelectedBtn.id = 'copy-selected-button';
  copySelectedBtn.className = 'collection-list-actions-menu-item copy-selected-button';
  copySelectedBtn.textContent = 'Copy Selected';
  copySelectedBtn.setAttribute('aria-haspopup', 'menu');
  copySelectedBtn.setAttribute('aria-expanded', 'false');
  actionsMenu.appendChild(copySelectedBtn);

  copySubmenu = document.createElement('div');
  copySubmenu.className = 'collection-list-actions-submenu';
  actionsMenu.appendChild(copySubmenu);

  const rebuildCopySubmenu = (): void => {
    if (!copySubmenu) {
      return;
    }
    copySubmenu.innerHTML = '';

    const targets = options
      .getMoveTargetLists()
      .filter((target) => target.id !== options.listId)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (targets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collection-list-actions-submenu-empty';
      empty.textContent = 'No other lists';
      copySubmenu.appendChild(empty);
      return;
    }

    for (const target of targets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collection-list-actions-submenu-item';
      btn.textContent = target.name;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        options.onCopySelectedToList(target.id);
      });
      copySubmenu.appendChild(btn);
    }
  };

  const openCopySubmenu = (): void => {
    if (!copySubmenu) {
      return;
    }
    if (moveSubmenu) {
      moveSubmenu.classList.remove('open');
      moveSelectedBtn.setAttribute('aria-expanded', 'false');
    }
    rebuildCopySubmenu();
    const offsetTop = copySelectedBtn.offsetTop;
    copySubmenu.style.top = `${offsetTop}px`;
    copySubmenu.classList.add('open');
    copySelectedBtn.setAttribute('aria-expanded', 'true');
  };

  const closeCopySubmenu = (event?: MouseEvent): void => {
    if (!copySubmenu) {
      return;
    }
    if (event) {
      const related = event.relatedTarget as Node | null;
      if (related && (related === copySelectedBtn || copySubmenu.contains(related))) {
        return;
      }
    }
    copySubmenu.classList.remove('open');
    copySelectedBtn.setAttribute('aria-expanded', 'false');
  };

  copySelectedBtn.addEventListener('mouseenter', () => {
    if (!copySelectedBtn.classList.contains('visible')) {
      return;
    }
    openCopySubmenu();
  });

  copySelectedBtn.addEventListener('focus', () => {
    if (!copySelectedBtn.classList.contains('visible')) {
      return;
    }
    openCopySubmenu();
  });

  copySelectedBtn.addEventListener('mouseleave', (event) => {
    closeCopySubmenu(event);
  });

  if (copySubmenu) {
    copySubmenu.addEventListener('mouseleave', (event) => {
      closeCopySubmenu(event as MouseEvent);
    });
  }

  const clearBtn = addMenuItem('Clear Selected', options.onClearSelection, {
    id: 'clear-selection-button',
    className: 'collection-list-actions-menu-item clear-selection-button',
  });
  clearBtn.title = 'Clear selection';

  const deleteBtn = addMenuItem('Delete Selected', options.onDeleteSelection, {
    id: 'delete-selection-button',
    className:
      'collection-list-actions-menu-item delete-selection-button collection-list-actions-menu-item-danger',
    iconHtml: options.icons.trash,
  });
  deleteBtn.setAttribute('aria-label', 'Delete selected items');
  deleteBtn.title = 'Delete selected items';

  const toggleLabel = options.showAllColumns ? 'Compact view' : 'Expand view';
  addMenuItem(toggleLabel, options.onToggleView, {
    className: 'collection-list-actions-menu-item',
  });

  // Focus View toggle - only available when sorted by position and no timeline view active
  const focusViewEnabled = options.isSortedByPosition && !options.timelineField;
  const isFocusViewActive = !!options.focusMarkerItemId;
  const focusViewLabel = isFocusViewActive ? '✓ Focus View' : 'Focus View';
  const focusViewBtn = addMenuItem(focusViewLabel, options.onFocusViewToggle, {
    className:
      'collection-list-actions-menu-item' +
      (isFocusViewActive ? ' collection-list-actions-menu-item-selected' : '') +
      (!focusViewEnabled ? ' collection-list-actions-menu-item-disabled' : ''),
  });
  if (!focusViewEnabled) {
    focusViewBtn.disabled = true;
    focusViewBtn.title = options.timelineField
      ? 'Disable Timeline View first'
      : 'Only available when sorted by position';
  }

  // Timeline field selection
  const timelineFields = getTimelineFields(options.customFields);
  if (timelineFields.length > 0) {
    const timelineSeparator = document.createElement('div');
    timelineSeparator.className = 'collection-list-actions-menu-separator';
    actionsMenu.appendChild(timelineSeparator);

    const timelineLabel = document.createElement('div');
    timelineLabel.className = 'collection-list-actions-menu-label';
    timelineLabel.textContent = 'Timeline View';
    actionsMenu.appendChild(timelineLabel);

    // Option to disable timeline view
    const isNoneSelected = !options.timelineField;
    const noneOption = addMenuItem(
      isNoneSelected ? '✓ None' : 'None',
      () => options.onTimelineFieldChange(null),
      {
        className:
          'collection-list-actions-menu-item' +
          (isNoneSelected ? ' collection-list-actions-menu-item-selected' : ''),
      },
    );
    noneOption.dataset['timelineOption'] = '';

    // Options for each date/time field
    for (const field of timelineFields) {
      const isSelected = options.timelineField === field.key;
      const fieldOption = addMenuItem(
        isSelected ? `✓ ${field.label}` : field.label,
        () => options.onTimelineFieldChange(field.key),
        {
          className:
            'collection-list-actions-menu-item' +
            (isSelected ? ' collection-list-actions-menu-item-selected' : ''),
        },
      );
      fieldOption.dataset['timelineOption'] = field.key;
    }
  }

  actionsButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(!isMenuOpen);
  });

  buttonGroup.appendChild(actionsWrapper);

  if (typeof options.data.description === 'string' && options.data.description.trim().length > 0) {
    const descriptionEl = document.createElement('p');
    descriptionEl.className = 'collection-section-subtitle';
    descriptionEl.textContent = options.data.description;
    header.appendChild(descriptionEl);
  }

  const tagsEl = options.renderTags(options.data.tags);
  if (tagsEl) {
    header.appendChild(tagsEl);
  }

  return {
    header,
    controls: {
      rightControls: [buttonGroup],
    },
  };
}
