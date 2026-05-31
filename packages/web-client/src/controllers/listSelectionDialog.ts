import type { DialogManager } from './dialogManager';

export interface ListSelectionItem {
  id: string;
  name: string;
  instanceLabel?: string;
}

export interface ListSelectionDialogOptions {
  dialogManager: DialogManager;
  title: string;
  message?: string;
  items: ListSelectionItem[];
  initialId?: string | null;
  confirmText?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  showIds?: boolean;
}

function getListSelectionSearchText(item: ListSelectionItem): string {
  return [item.name, item.id, item.instanceLabel ?? ''].join(' ').toLowerCase();
}

function getListSelectionLabel(item: ListSelectionItem): string {
  return item.instanceLabel ? `${item.name} (${item.instanceLabel})` : item.name;
}

export function openListSelectionDialog(
  options: ListSelectionDialogOptions,
): Promise<ListSelectionItem | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay list-selection-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog list-selection-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.id = `list-selection-title-${Math.random().toString(36).slice(2)}`;
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = options.title;
    dialog.appendChild(titleEl);
    dialog.setAttribute('aria-labelledby', titleEl.id);

    if (options.message) {
      const messageEl = document.createElement('p');
      messageEl.className = 'confirm-dialog-message';
      messageEl.textContent = options.message;
      dialog.appendChild(messageEl);
    }

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'list-selection-search-input';
    searchInput.placeholder = options.searchPlaceholder ?? 'Search lists';
    searchInput.setAttribute('aria-label', options.searchPlaceholder ?? 'Search lists');
    searchInput.autocomplete = 'off';
    dialog.appendChild(searchInput);

    const listEl = document.createElement('div');
    listEl.className = 'list-selection-list';
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Lists');
    dialog.appendChild(listEl);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';
    buttons.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'confirm-dialog-button primary';
    confirmButton.textContent = options.confirmText ?? 'Choose';
    buttons.appendChild(confirmButton);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const items = options.items.filter((item) => item.id && item.name);
    let selectedItem =
      items.find((item) => item.id === options.initialId) ??
      items[0] ??
      null;
    let visibleItems: ListSelectionItem[] = [];
    let closed = false;

    const setSelectedItem = (item: ListSelectionItem | null): void => {
      selectedItem = item;
      confirmButton.disabled = !selectedItem;
    };

    function close(value: ListSelectionItem | null): void {
      if (closed) {
        return;
      }
      closed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.remove();
      options.dialogManager.releaseExternalDialog(overlay);
      resolve(value);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        close(selectedItem);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      if (visibleItems.length === 0) {
        return;
      }
      event.preventDefault();
      const currentIndex = selectedItem
        ? visibleItems.findIndex((item) => item.id === selectedItem?.id)
        : -1;
      const nextIndex =
        event.key === 'ArrowDown'
          ? currentIndex < visibleItems.length - 1
            ? currentIndex + 1
            : 0
          : currentIndex > 0
            ? currentIndex - 1
            : visibleItems.length - 1;
      setSelectedItem(visibleItems[nextIndex] ?? null);
      render();
    }

    const render = (): void => {
      const query = searchInput.value.trim().toLowerCase();
      visibleItems = query
        ? items.filter((item) => getListSelectionSearchText(item).includes(query))
        : items;

      listEl.innerHTML = '';
      if (visibleItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'list-selection-empty';
        empty.textContent = options.emptyText ?? 'No matching lists';
        listEl.appendChild(empty);
        setSelectedItem(null);
        return;
      }

      if (!selectedItem || !visibleItems.some((item) => item.id === selectedItem?.id)) {
        setSelectedItem(visibleItems[0] ?? null);
      }

      for (const item of visibleItems) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'list-selection-item';
        button.dataset['listId'] = item.id;
        button.setAttribute('role', 'option');
        const selected = selectedItem?.id === item.id;
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (selected) {
          button.classList.add('selected');
          button.scrollIntoView?.({ block: 'nearest' });
        }

        const label = document.createElement('span');
        label.className = 'list-selection-item-label';
        label.textContent = getListSelectionLabel(item);
        button.appendChild(label);

        if (options.showIds) {
          const id = document.createElement('span');
          id.className = 'list-selection-item-id';
          id.textContent = item.id;
          button.appendChild(id);
        }

        button.addEventListener('click', () => {
          setSelectedItem(item);
          render();
        });
        button.addEventListener('dblclick', () => {
          close(item);
        });
        listEl.appendChild(button);
      }
    };

    searchInput.addEventListener('input', render);
    cancelButton.addEventListener('click', () => close(null));
    confirmButton.addEventListener('click', () => close(selectedItem));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });

    options.dialogManager.registerExternalDialog(overlay, () => close(null));
    document.addEventListener('keydown', handleKeyDown);
    render();
    searchInput.focus();
  });
}
