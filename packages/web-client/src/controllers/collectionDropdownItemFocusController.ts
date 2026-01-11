export interface CollectionDropdownItemFocusControllerOptions {
  getList: () => HTMLElement | null;
}

export class CollectionDropdownItemFocusController {
  constructor(private readonly options: CollectionDropdownItemFocusControllerOptions) {}

  getVisibleItems(): HTMLElement[] {
    const list = this.options.getList();
    if (!list) return [];
    const items = Array.from(
      list.querySelectorAll('.collection-search-dropdown-item'),
    ) as HTMLElement[];
    return items.filter((el) => el.style.display !== 'none');
  }

  getFocusedItem(): HTMLElement | null {
    const list = this.options.getList();
    if (!list) return null;
    return list.querySelector('.collection-search-dropdown-item.focused') as HTMLElement | null;
  }

  setFocusedItem(item: HTMLElement | null): void {
    const list = this.options.getList();
    list
      ?.querySelectorAll('.collection-search-dropdown-item.focused')
      .forEach((el) => el.classList.remove('focused'));
    if (item) {
      item.classList.add('focused');
      item.scrollIntoView({ block: 'nearest' });
    }
  }
}
