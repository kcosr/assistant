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
  list: HTMLElement;
};

export type InstanceDropdownControllerOptions = {
  root: HTMLElement;
  onSelect: (instanceId: string) => void;
  emptyLabel?: string;
};

const DEFAULT_EMPTY_LABEL = 'No matches';

function resolveElements(root: HTMLElement): InstanceDropdownElements {
  const trigger = root.querySelector<HTMLButtonElement>('[data-role="instance-trigger"]');
  const triggerText = root.querySelector<HTMLElement>('[data-role="instance-trigger-text"]');
  const menu = root.querySelector<HTMLElement>('[data-role="instance-menu"]');
  const searchInput = root.querySelector<HTMLInputElement>('[data-role="instance-search"]');
  const list = root.querySelector<HTMLElement>('[data-role="instance-list"]');

  if (!trigger || !triggerText || !menu || !list) {
    throw new Error('Instance dropdown elements missing.');
  }

  return { root, trigger, triggerText, menu, searchInput, list };
}

export class InstanceDropdownController {
  private readonly elements: InstanceDropdownElements;
  private readonly onSelect: (instanceId: string) => void;
  private readonly emptyLabel: string;
  private readonly idPrefix: string;
  private instances: InstanceOption[] = [];
  private filteredInstances: InstanceOption[] = [];
  private selectedId: string | null = null;
  private filterQuery = '';
  private highlightIndex = 0;
  private isOpenValue = false;
  private cleanupFns: Array<() => void> = [];

  constructor(options: InstanceDropdownControllerOptions) {
    this.elements = resolveElements(options.root);
    this.onSelect = options.onSelect;
    this.emptyLabel = options.emptyLabel ?? DEFAULT_EMPTY_LABEL;
    this.idPrefix = `instance-option-${Math.random().toString(36).slice(2)}`;

    const { trigger, searchInput } = this.elements;

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

  setInstances(instances: InstanceOption[], selectedId: string | null): void {
    this.instances = instances;
    this.selectedId = selectedId;
    this.updateTriggerText();
    if (this.isOpenValue) {
      this.renderList();
    }
  }

  setSelectedId(selectedId: string | null): void {
    this.selectedId = selectedId;
    this.updateTriggerText();
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
    const selectedIndex = this.instances.findIndex((instance) => instance.id === this.selectedId);
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

  private updateTriggerText(): void {
    const selected = this.instances.find((instance) => instance.id === this.selectedId);
    this.elements.triggerText.textContent = selected?.label ?? 'Select...';
  }

  private selectHighlightedInstance(): void {
    const instance = this.filteredInstances[this.highlightIndex];
    if (!instance) {
      return;
    }
    this.onSelect(instance.id);
    this.close();
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
      const isSelected = instance.id === this.selectedId;
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) {
        item.classList.add('selected');
      }
      if (index === this.highlightIndex) {
        item.classList.add('highlighted');
      }
      item.textContent = instance.label;
      item.dataset['instanceId'] = instance.id;
      item.addEventListener('click', () => {
        this.onSelect(instance.id);
        this.close();
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
