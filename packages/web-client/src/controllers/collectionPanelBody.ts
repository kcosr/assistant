import type { CollectionReference } from './collectionTypes';

export class CollectionPanelBodyManager {
  constructor(private readonly body: HTMLElement | null) {}

  getBodyEl(): HTMLElement | null {
    return this.body;
  }

  clear(): void {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
  }

  renderLoading(item: CollectionReference): void {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'collection-panel-loading';
    loading.textContent = `Loading ${item.type}…`;
    this.body.appendChild(loading);
  }

  renderError(message: string): void {
    if (!this.body) {
      return;
    }
    this.body.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'collection-panel-error';
    error.textContent = message;
    this.body.appendChild(error);
  }

  getSelectedItemIds(): string[] {
    if (!this.body) {
      return [];
    }
    const selectedIds: string[] = [];
    const selectedRows = this.body.querySelectorAll('.list-item-row.list-item-selected');
    selectedRows.forEach((row) => {
      const itemId = (row as HTMLElement).dataset['itemId'];
      if (itemId) {
        selectedIds.push(itemId);
      }
    });
    return selectedIds;
  }

  getSelectedItemCount(): number {
    if (!this.body) {
      return 0;
    }
    return this.body.querySelectorAll('.list-item-row.list-item-selected').length;
  }
}
