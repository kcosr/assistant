import type { SavedView, ViewQuery } from '@assistant/shared';
import type { DialogManager } from './dialogManager';

export interface ViewEditDialogOptions {
  dialogManager: DialogManager;
  updateView: (viewId: string, name: string, query: ViewQuery) => Promise<boolean>;
  deleteView: (viewId: string) => Promise<boolean>;
}

export class ViewEditDialog {
  constructor(private readonly options: ViewEditDialogOptions) {}

  open(view: SavedView): void {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay view-edit-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog view-edit-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = 'Edit View';
    dialog.appendChild(titleEl);

    const form = document.createElement('form');
    form.className = 'list-item-form view-edit-form';

    const errorEl = document.createElement('p');
    errorEl.className = 'list-metadata-error';
    errorEl.style.display = 'none';
    form.appendChild(errorEl);

    const setError = (msg: string | null): void => {
      if (!msg) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
        return;
      }
      errorEl.textContent = msg;
      errorEl.style.display = '';
    };

    // Name input
    const nameLabel = document.createElement('label');
    nameLabel.className = 'list-item-form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'list-item-form-input';
    nameInput.required = true;
    nameInput.value = view.name ?? '';
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    // Query textarea
    const queryLabel = document.createElement('label');
    queryLabel.className = 'list-item-form-label';
    queryLabel.textContent = 'Query (JSON)';
    const queryTextarea = document.createElement('textarea');
    queryTextarea.className = 'list-item-form-textarea view-edit-query-textarea';
    queryTextarea.rows = 10;
    queryTextarea.spellcheck = false;
    queryTextarea.value = JSON.stringify(view.query, null, 2);
    queryLabel.appendChild(queryTextarea);
    form.appendChild(queryLabel);

    // Help text
    const helpText = document.createElement('p');
    helpText.className = 'view-edit-help-text';
    helpText.innerHTML =
      'Supports: <code>sources</code>, <code>query</code>, <code>tags</code>, <code>where</code>, <code>union</code>, <code>sort</code>. ' +
      'Date macros: <code>today</code>, <code>yesterday</code>, <code>tomorrow</code>, <code>+Nd</code>, <code>-Nd</code>, <code>now</code>. ' +
      'Day-of-week: <code>dow</code>, <code>dow+N</code>, <code>dow-N</code>.';
    form.appendChild(helpText);

    // Buttons
    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'confirm-dialog-button danger';
    deleteButton.textContent = 'Delete';
    buttons.appendChild(deleteButton);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';
    buttons.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'confirm-dialog-button primary';
    saveButton.textContent = 'Save';
    buttons.appendChild(saveButton);

    form.appendChild(buttons);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.options.dialogManager.hasOpenDialog = true;

    const focusableSelectors =
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelectors),
    ).filter((el) => !el.hasAttribute('disabled'));

    nameInput.focus();
    nameInput.select();

    const closeDialog = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
      this.options.dialogManager.hasOpenDialog = false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }

      if (e.key === 'Tab') {
        if (focusableElements.length === 0) {
          return;
        }
        const current = document.activeElement as HTMLElement | null;
        const currentIndex = current ? focusableElements.indexOf(current) : -1;
        let nextIndex = currentIndex;

        if (e.shiftKey) {
          nextIndex = currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1;
        } else {
          nextIndex =
            currentIndex === -1 || currentIndex === focusableElements.length - 1
              ? 0
              : currentIndex + 1;
        }

        e.preventDefault();
        const nextEl = focusableElements[nextIndex];
        if (nextEl) {
          nextEl.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    cancelButton.addEventListener('click', () => {
      closeDialog();
    });

    deleteButton.addEventListener('click', () => {
      const currentName = nameInput.value.trim() || view.name || 'this view';
      this.options.dialogManager.showConfirmDialog({
        title: 'Delete View',
        message: `Delete "${currentName}"? This cannot be undone.`,
        confirmText: 'Delete',
        confirmClassName: 'danger',
        keydownStopsPropagation: true,
        removeKeydownOnButtonClick: true,
        onConfirm: () => {
          void (async () => {
            setError(null);
            const ok = await this.options.deleteView(view.id);
            if (!ok) {
              setError('Failed to delete view.');
              return;
            }
            closeDialog();
          })();
        },
        cancelCloseBehavior: 'remove-only',
        confirmCloseBehavior: 'remove-only',
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      setError(null);

      const name = nameInput.value.trim();
      if (!name) {
        setError('Name is required.');
        nameInput.focus();
        return;
      }

      const queryText = queryTextarea.value.trim();
      if (!queryText) {
        setError('Query is required.');
        queryTextarea.focus();
        return;
      }

      let query: ViewQuery;
      try {
        query = JSON.parse(queryText) as ViewQuery;
      } catch {
        setError('Invalid JSON. Please check the query syntax.');
        queryTextarea.focus();
        return;
      }

      if (!query || typeof query !== 'object') {
        setError('Query must be a JSON object.');
        queryTextarea.focus();
        return;
      }

      void (async () => {
        const ok = await this.options.updateView(view.id, name, query);
        if (!ok) {
          setError('Failed to update view.');
          return;
        }
        closeDialog();
      })();
    });
  }
}
