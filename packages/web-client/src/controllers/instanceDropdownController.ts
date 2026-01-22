export type InstanceOption = {
  id: string;
  label: string;
};

type InstanceDropdownElements = {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  triggerText: HTMLElement;
  menu: HTMLElement;
  searchInput: HTMLInputElement | null;
  clearButton: HTMLButtonElement | null;
  list: HTMLElement;
};

export type InstanceDropdownControllerOptions = {
  root: HTMLElement;
  onSelect: (instanceIds: string[]) => void;
  emptyLabel?: string;
  selectionMode?: 'single' | 'multi';
};

const DEFAULT_EMPTY_LABEL = 'No matches';

function resolveElements(root: HTMLElement): InstanceDropdownElements {
  const trigger = root.querySelector<HTMLButtonElement>('[data-role="instance-trigger"]');
  const triggerText = root.querySelector<HTMLElement>('[data-role="instance-trigger-text"]');
  const menu = root.querySelector<HTMLElement>('[data-role="instance-menu"]');
  const searchInput = root.querySelector<HTMLInputElement>('[data-role="instance-search"]');
  const clearButton = root.querySelector<HTMLButtonElement>('[data-role="instance-clear"]');
  const list = root.querySelector<HTMLElement>('[data-role="instance-list"]');

  if (!trigger || !triggerText || !menu || !list) {
    throw new Error('Instance dropdown elements missing.');
  }

  return { root, trigger, triggerText, menu, searchInput, clearButton, list };
}

export class InstanceDropdownController {
  private readonly elements: InstanceDropdownElements;
  private readonly onSelect: (instanceIds: string[]) => void;
  private readonly emptyLabel: string;
  private readonly idPrefix: string;
  private readonly selectionMode: 'single' | 'multi';
  private instances: InstanceOption[] = [];
  private filteredInstances: InstanceOption[] = [];
  private selectedIds: string[] = [];
  private filterQuery = '';
  private highlightIndex = 0;
  private isOpenValue = false;
  private cleanupFns: Array<() => void> = [];

  constructor(options: InstanceDropdownControllerOptions) {
    this.elements = resolveElements(options.root);
    this.onSelect = options.onSelect;
    this.emptyLabel = options.emptyLabel ?? DEFAULT_EMPTY_LABEL;
    this.selectionMode = options.selectionMode ?? 'single';
    this.idPrefix = `instance-option-${Math.random().toString(36).slice(2)}`;

    const { trigger, searchInput, clearButton } = this.elements;

    const handleTriggerClick = (event: MouseEvent) => {
      event.stopPropagation();
      this.toggle();
    };
    trigger.addEventListener('click', handleTriggerClick);
    this.cleanupFns.push(() => trigger.removeEventListener('click', handleTriggerClick));

    if (searchInput) {
      const handleSearchInput = () => {
        this.filterQuery = searchInput.value;
        this.highlightIndex = 0;
        this.renderList();
      };
      const handleSearchKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.close();
          this.elements.trigger.focus();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.highlightIndex = Math.min(
            this.highlightIndex + 1,
            Math.max(0, this.filteredInstances.length - 1),
          );
          this.updateHighlight();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
          this.updateHighlight();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          this.selectHighlightedInstance();
        }
      };
      searchInput.addEventListener('input', handleSearchInput);
      searchInput.addEventListener('keydown', handleSearchKeydown);
      this.cleanupFns.push(() => {
        searchInput.removeEventListener('input', handleSearchInput);
        searchInput.removeEventListener('keydown', handleSearchKeydown);
      });
    }

    if (clearButton) {
      const handleClearClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.resetSelection();
      };
      clearButton.addEventListener('click', handleClearClick);
      this.cleanupFns.push(() => clearButton.removeEventListener('click', handleClearClick));
    }
  }

  isOpen(): boolean {
    return this.isOpenValue;
  }

  contains(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Node)) {
      return false;
    }
    return this.elements.root.contains(target);
  }

  setVisible(visible: boolean): void {
    this.elements.root.style.display = visible ? '' : 'none';
    if (!visible) {
      this.close();
    }
  }

  setInstances(instances: InstanceOption[], selectedIds: string[] = []): void {
    this.instances = instances;
    this.selectedIds = this.normalizeSelection(selectedIds);
    this.updateTriggerText();
    this.updateClearButtonState();
    if (this.isOpenValue) {
      this.renderList();
    }
  }

  setSelectedIds(selectedIds: string[]): void {
    this.selectedIds = this.normalizeSelection(selectedIds);
    this.updateTriggerText();
    this.updateClearButtonState();
    if (this.isOpenValue) {
      this.renderList();
    }
  }

  open(): void {
    if (this.isOpenValue) {
      return;
    }
    this.isOpenValue = true;
    this.elements.menu.classList.add('open');
    this.elements.trigger.setAttribute('aria-expanded', 'true');
    if (this.selectionMode === 'multi') {
      this.elements.menu.setAttribute('aria-multiselectable', 'true');
    } else {
      this.elements.menu.removeAttribute('aria-multiselectable');
    }
    const primaryId = this.selectedIds[0] ?? null;
    const selectedIndex = this.instances.findIndex((instance) => instance.id === primaryId);
    this.highlightIndex = selectedIndex >= 0 ? selectedIndex : 0;
    this.renderList();
    if (this.elements.searchInput) {
      this.elements.searchInput.focus();
    }
  }

  close(): void {
    if (!this.isOpenValue) {
      return;
    }
    this.isOpenValue = false;
    this.elements.menu.classList.remove('open');
    this.elements.trigger.setAttribute('aria-expanded', 'false');
    this.filterQuery = '';
    this.highlightIndex = 0;
    if (this.elements.searchInput) {
      this.elements.searchInput.value = '';
    }
  }

  toggle(): void {
    if (this.isOpenValue) {
      this.close();
    } else {
      this.open();
    }
  }

  destroy(): void {
    this.close();
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
  }

  private normalizeSelection(selectedIds: string[]): string[] {
    const cleaned: string[] = [];
    for (const entry of selectedIds) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed || cleaned.includes(trimmed)) {
        continue;
      }
      cleaned.push(trimmed);
    }

    const available = new Set(this.instances.map((instance) => instance.id));
    const filtered = cleaned.filter((id) => available.size === 0 || available.has(id));
    if (filtered.length > 0) {
      const first = filtered[0];
      if (!first) {
        return [];
      }
      return this.selectionMode === 'single' ? [first] : filtered;
    }
    if (this.instances.length > 0) {
      const firstInstance = this.instances[0];
      return firstInstance ? [firstInstance.id] : [];
    }
    return [];
  }

  private applySelection(instanceId: string, options: { closeOnSelect: boolean }): void {
    if (this.selectionMode === 'single') {
      this.selectedIds = [instanceId];
      this.updateTriggerText();
      this.onSelect([...this.selectedIds]);
      this.updateClearButtonState();
      if (options.closeOnSelect) {
        this.close();
      }
      return;
    }
  }

  private applyMultiSelection(
    instanceId: string,
    mode: 'add' | 'remove' | 'exclusive',
    options: { closeOnSelect: boolean },
  ): void {
    const alreadySelected = this.selectedIds.includes(instanceId);
    let next = [...this.selectedIds];

    if (mode === 'exclusive') {
      next = [instanceId];
    } else if (mode === 'remove') {
      if (!alreadySelected) {
        return;
      }
      next = next.filter((id) => id !== instanceId);
      if (next.length === 0) {
        return;
      }
    } else {
      if (alreadySelected) {
        return;
      }
      next = [instanceId, ...next.filter((id) => id !== instanceId)];
    }

    this.selectedIds = next;
    this.updateTriggerText();
    this.updateClearButtonState();
    if (this.isOpenValue) {
      this.renderList();
    }
    this.onSelect([...this.selectedIds]);
    if (options.closeOnSelect) {
      this.close();
    }
  }

  private updateTriggerText(): void {
    const selected = this.selectedIds
      .map((id) => this.instances.find((instance) => instance.id === id))
      .filter((instance): instance is InstanceOption => !!instance);

    if (selected.length === 0) {
      this.elements.triggerText.textContent = 'Select...';
      return;
    }
    if (selected.length === 1) {
      const first = selected[0];
      this.elements.triggerText.textContent = first ? first.label : 'Select...';
      return;
    }
    if (selected.length === 2) {
      const first = selected[0];
      const second = selected[1];
      if (!first || !second) {
        this.elements.triggerText.textContent = first?.label ?? 'Select...';
        return;
      }
      this.elements.triggerText.textContent = `${first.label} + ${second.label}`;
      return;
    }
    const first = selected[0];
    this.elements.triggerText.textContent = first
      ? `${first.label} + ${selected.length - 1}`
      : 'Select...';
  }

  private resetSelection(): void {
    const defaultId =
      this.instances.find((instance) => instance.id === 'default')?.id ??
      this.instances[0]?.id ??
      null;
    if (!defaultId) {
      return;
    }
    if (this.selectedIds.length === 1 && this.selectedIds[0] === defaultId) {
      return;
    }
    this.selectedIds = [defaultId];
    this.updateTriggerText();
    this.updateClearButtonState();
    if (this.isOpenValue) {
      this.renderList();
    }
    this.onSelect([...this.selectedIds]);
  }

  private updateClearButtonState(): void {
    const clearButton = this.elements.clearButton;
    if (!clearButton) {
      return;
    }
    const defaultId =
      this.instances.find((instance) => instance.id === 'default')?.id ??
      this.instances[0]?.id ??
      null;
    if (!defaultId || this.selectedIds.length === 0) {
      clearButton.disabled = true;
      return;
    }
    clearButton.disabled =
      this.selectedIds.length === 1 && this.selectedIds[0] === defaultId;
  }

  private selectHighlightedInstance(): void {
    const instance = this.filteredInstances[this.highlightIndex];
    if (!instance) {
      return;
    }
    if (this.selectionMode === 'single') {
      this.applySelection(instance.id, { closeOnSelect: true });
      return;
    }
    const isSelected = this.selectedIds.includes(instance.id);
    const mode = isSelected ? 'exclusive' : 'add';
    this.applyMultiSelection(instance.id, mode, { closeOnSelect: isSelected });
  }

  private updateHighlight(): void {
    const items = this.elements.list.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    items.forEach((item, index) => {
      item.classList.toggle('highlighted', index === this.highlightIndex);
    });
    const highlighted = items[this.highlightIndex];
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
      this.elements.menu.setAttribute('aria-activedescendant', highlighted.id);
    } else {
      this.elements.menu.removeAttribute('aria-activedescendant');
    }
  }

  private renderList(): void {
    const { list, menu } = this.elements;
    list.innerHTML = '';

    const query = this.filterQuery.toLowerCase();
    this.filteredInstances = query
      ? this.instances.filter((instance) => instance.label.toLowerCase().includes(query))
      : [...this.instances];

    if (this.highlightIndex >= this.filteredInstances.length) {
      this.highlightIndex = Math.max(0, this.filteredInstances.length - 1);
    }

    if (this.filteredInstances.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-chrome-instance-empty';
      empty.textContent = this.emptyLabel;
      empty.setAttribute('role', 'presentation');
      list.appendChild(empty);
      menu.removeAttribute('aria-activedescendant');
      return;
    }

    this.filteredInstances.forEach((instance, index) => {
      const item = document.createElement('div');
      item.className = 'panel-chrome-instance-item';
      item.id = `${this.idPrefix}-${index}`;
      item.setAttribute('role', 'option');
      const isSelected = this.selectedIds.includes(instance.id);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) {
        item.classList.add('selected');
      }
      if (index === this.highlightIndex) {
        item.classList.add('highlighted');
      }
      const label = document.createElement('span');
      label.className = 'panel-chrome-instance-item-label';
      label.textContent = instance.label;
      item.appendChild(label);

      if (this.selectionMode === 'multi' && isSelected) {
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'panel-chrome-instance-item-clear';
        clearButton.setAttribute('aria-label', `Deselect ${instance.label}`);
        clearButton.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6l-12 12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        `;
        clearButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.applyMultiSelection(instance.id, 'remove', { closeOnSelect: false });
        });
        item.appendChild(clearButton);
      }
      item.dataset['instanceId'] = instance.id;
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.selectionMode === 'single') {
          this.applySelection(instance.id, { closeOnSelect: true });
          return;
        }
        const mode = isSelected ? 'exclusive' : 'add';
        this.applyMultiSelection(instance.id, mode, { closeOnSelect: isSelected });
      });
      item.addEventListener('mouseenter', () => {
        this.highlightIndex = index;
        this.updateHighlight();
      });
      list.appendChild(item);
    });

    this.updateHighlight();
  }
}
