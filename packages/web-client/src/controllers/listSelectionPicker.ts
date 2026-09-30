export interface ListSelectionItem {
  id: string;
  name: string;
  instanceLabel?: string;
}

interface ListSelectionPickerOptions {
  items: ListSelectionItem[];
  initialId?: string | null;
  emptyText?: string;
  searchPlaceholder?: string;
  showIds?: boolean;
  onHighlightChange?: (item: ListSelectionItem | null) => void;
  onItemClick?: (item: ListSelectionItem) => void;
  onChoose: (item: ListSelectionItem) => void;
  onCancel: () => void;
}

/** Shared searchable list rows for standalone dialogs and editor dropdowns. */
export class ListSelectionPicker {
  readonly element = document.createElement('div');
  private readonly searchInput = document.createElement('input');
  private readonly list = document.createElement('div');
  private readonly items: ListSelectionItem[];
  private visibleItems: ListSelectionItem[] = [];
  private selectedItem: ListSelectionItem | null = null;

  constructor(private readonly options: ListSelectionPickerOptions) {
    this.items = options.items.filter((item) => item.id && item.name);
    this.element.className = 'list-selection-picker';
    this.searchInput.type = 'search';
    this.searchInput.className = 'list-selection-search-input';
    this.searchInput.placeholder = options.searchPlaceholder ?? 'Search lists';
    this.searchInput.setAttribute('aria-label', this.searchInput.placeholder);
    this.searchInput.autocomplete = 'off';
    this.list.className = 'list-selection-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Lists');
    this.element.append(this.searchInput, this.list);
    this.searchInput.addEventListener('input', () => this.render());
    this.reset(options.initialId);
  }

  getSelectedItem(): ListSelectionItem | null {
    return this.selectedItem;
  }

  reset(initialId?: string | null): void {
    this.searchInput.value = '';
    this.selectedItem = this.items.find((item) => item.id === initialId) ?? this.items[0] ?? null;
    this.render();
  }

  focus(): void {
    this.searchInput.focus();
    this.list.querySelector<HTMLElement>('.selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (!['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.options.onCancel();
    } else if (event.key === 'Enter') {
      const focusedId =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>('.list-selection-item')?.dataset['listId']
          : undefined;
      const selected = this.visibleItems.find((item) => item.id === focusedId) ?? this.selectedItem;
      if (selected) {
        this.options.onChoose(selected);
      }
    } else if (this.visibleItems.length > 0) {
      const index = this.visibleItems.findIndex((item) => item.id === this.selectedItem?.id);
      const nextIndex =
        event.key === 'ArrowDown'
          ? (index + 1) % this.visibleItems.length
          : (index - 1 + this.visibleItems.length) % this.visibleItems.length;
      this.selectedItem = this.visibleItems[nextIndex] ?? null;
      this.render();
    }
  }

  private render(): void {
    const query = this.searchInput.value.trim().toLowerCase();
    this.visibleItems = this.items.filter((item) =>
      [item.name, item.id, item.instanceLabel ?? ''].join(' ').toLowerCase().includes(query),
    );
    if (!this.visibleItems.some((item) => item.id === this.selectedItem?.id)) {
      this.selectedItem = this.visibleItems[0] ?? null;
    }
    this.options.onHighlightChange?.(this.selectedItem);
    this.list.replaceChildren();
    if (this.visibleItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-selection-empty';
      empty.textContent = this.options.emptyText ?? 'No matching lists';
      this.list.appendChild(empty);
      return;
    }
    for (const item of this.visibleItems) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'list-selection-item';
      button.dataset['listId'] = item.id;
      button.setAttribute('role', 'option');
      const selected = item.id === this.selectedItem?.id;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('selected', selected);
      const label = document.createElement('span');
      label.className = 'list-selection-item-label';
      label.textContent = item.instanceLabel ? `${item.name} (${item.instanceLabel})` : item.name;
      button.appendChild(label);
      if (this.options.showIds) {
        const id = document.createElement('span');
        id.className = 'list-selection-item-id';
        id.textContent = item.id;
        button.appendChild(id);
      }
      button.addEventListener('click', () => {
        this.selectedItem = item;
        this.render();
        this.options.onItemClick?.(item);
      });
      button.addEventListener('dblclick', () => this.options.onChoose(item));
      this.list.appendChild(button);
      if (selected) {
        button.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }
}
