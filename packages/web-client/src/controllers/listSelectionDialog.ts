import type { DialogManager } from './dialogManager';

import { ListSelectionPicker, type ListSelectionItem } from './listSelectionPicker';

export type { ListSelectionItem } from './listSelectionPicker';

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

    let closed = false;
    const picker = new ListSelectionPicker({
      ...options,
      onHighlightChange: (item) => {
        confirmButton.disabled = !item;
      },
      onChoose: (item) => close(item),
      onCancel: () => close(null),
    });
    dialog.insertBefore(picker.element, buttons);

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
      picker.handleKeyDown(event);
    }

    cancelButton.addEventListener('click', () => close(null));
    confirmButton.addEventListener('click', () => close(picker.getSelectedItem()));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });

    options.dialogManager.registerExternalDialog(overlay, () => close(null));
    document.addEventListener('keydown', handleKeyDown);
    picker.focus();
  });
}
