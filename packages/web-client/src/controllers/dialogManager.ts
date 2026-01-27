export type DialogButtonCloseBehavior = 'close' | 'remove-only';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText: string;
  confirmClassName?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  keydownStopsPropagation?: boolean;
  confirmCloseBehavior?: DialogButtonCloseBehavior;
  cancelCloseBehavior?: DialogButtonCloseBehavior;
  removeKeydownOnButtonClick?: boolean;
  focusConfirmButton?: boolean;
}

export interface TextInputDialogOptions {
  title: string;
  message: string;
  confirmText: string;
  confirmClassName?: string;
  cancelText?: string;
  labelText?: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | null;
}

export class DialogManager {
  hasOpenDialog = false;
  private activeDialogCleanup: (() => void) | null = null;
  private activeDialogOverlay: HTMLElement | null = null;

  registerExternalDialog(overlay: HTMLElement, close: () => void): void {
    this.activeDialogOverlay = overlay;
    this.activeDialogCleanup = close;
    this.hasOpenDialog = true;
  }

  releaseExternalDialog(overlay: HTMLElement): void {
    if (this.activeDialogOverlay !== overlay) {
      return;
    }
    this.activeDialogOverlay = null;
    this.activeDialogCleanup = null;
    this.hasOpenDialog = false;
  }

  showConfirmDialog(options: ConfirmDialogOptions): void {
    const {
      title,
      message,
      confirmText,
      confirmClassName = 'primary',
      cancelText = 'Cancel',
      onConfirm,
      onCancel,
      keydownStopsPropagation = false,
      confirmCloseBehavior = 'remove-only',
      cancelCloseBehavior = 'remove-only',
      removeKeydownOnButtonClick = false,
      focusConfirmButton = true,
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = title;
    dialog.appendChild(titleEl);

    const messageEl = document.createElement('p');
    messageEl.className = 'confirm-dialog-message';
    messageEl.textContent = message;
    dialog.appendChild(messageEl);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = cancelText;
    buttons.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.className = `confirm-dialog-button ${confirmClassName}`;
    confirmButton.textContent = confirmText;
    buttons.appendChild(confirmButton);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.hasOpenDialog = true;
    this.activeDialogOverlay = overlay;

    if (focusConfirmButton) {
      confirmButton.focus();
    }

    const closeDialog = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
      if (this.activeDialogOverlay === overlay) {
        this.activeDialogOverlay = null;
        this.activeDialogCleanup = null;
        this.hasOpenDialog = false;
      }
    };
    this.activeDialogCleanup = closeDialog;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (keydownStopsPropagation) {
        e.stopPropagation();
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }

      if (e.key === 'Enter' && document.activeElement === confirmButton) {
        e.preventDefault();
        closeDialog();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });

    const handleButtonClick = (
      behavior: DialogButtonCloseBehavior,
      callback: (() => void) | undefined,
    ): void => {
      if (behavior === 'close') {
        closeDialog();
        callback?.();
        return;
      }

      overlay.remove();
      if (removeKeydownOnButtonClick) {
        document.removeEventListener('keydown', handleKeyDown);
      }
      callback?.();
    };

    cancelButton.addEventListener('click', () => {
      handleButtonClick(cancelCloseBehavior, onCancel);
    });

    confirmButton.addEventListener('click', () => {
      handleButtonClick(confirmCloseBehavior, onConfirm);
    });
  }

  showTextInputDialog(options: TextInputDialogOptions): Promise<string | null> {
    const {
      title,
      message,
      confirmText,
      confirmClassName = 'primary',
      cancelText = 'Cancel',
      labelText = 'Session ID',
      initialValue = '',
      placeholder = '',
      validate,
    } = options;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-dialog-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const titleEl = document.createElement('h3');
      titleEl.className = 'confirm-dialog-title';
      titleEl.textContent = title;
      dialog.appendChild(titleEl);

      if (message.trim()) {
        const messageEl = document.createElement('p');
        messageEl.className = 'confirm-dialog-message';
        messageEl.textContent = message;
        dialog.appendChild(messageEl);
      }

      const form = document.createElement('div');
      form.className = 'list-item-form';

      const label = document.createElement('label');
      label.className = 'list-item-form-label';
      label.textContent = labelText;

      const input = document.createElement('input');
      input.className = 'list-item-form-input';
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = initialValue;
      if (placeholder) {
        input.placeholder = placeholder;
      }
      label.appendChild(input);
      form.appendChild(label);

      const errorEl = document.createElement('p');
      errorEl.className = 'list-metadata-error';
      errorEl.style.display = 'none';
      form.appendChild(errorEl);

      dialog.appendChild(form);

      const buttons = document.createElement('div');
      buttons.className = 'confirm-dialog-buttons';

      const cancelButton = document.createElement('button');
      cancelButton.className = 'confirm-dialog-button cancel';
      cancelButton.textContent = cancelText;
      buttons.appendChild(cancelButton);

      const confirmButton = document.createElement('button');
      confirmButton.className = `confirm-dialog-button ${confirmClassName}`;
      confirmButton.textContent = confirmText;
      buttons.appendChild(confirmButton);

      dialog.appendChild(buttons);
      overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.hasOpenDialog = true;
    this.activeDialogOverlay = overlay;

      const updateValidity = (options?: { showErrors?: boolean }): boolean => {
        const showErrors = options?.showErrors === true;
        const value = input.value;
        const error = validate ? validate(value) : null;
        if (error) {
          if (showErrors) {
            errorEl.textContent = error;
            errorEl.style.display = 'block';
          } else {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
          }
          confirmButton.disabled = true;
          return false;
        }
        errorEl.textContent = '';
        errorEl.style.display = 'none';
        confirmButton.disabled = false;
        return true;
      };

      const closeDialog = (value: string | null): void => {
        overlay.remove();
        document.removeEventListener('keydown', handleKeyDown);
        if (this.activeDialogOverlay === overlay) {
          this.activeDialogOverlay = null;
          this.activeDialogCleanup = null;
          this.hasOpenDialog = false;
        }
        resolve(value);
      };
      this.activeDialogCleanup = () => {
        closeDialog(null);
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDialog(null);
          return;
        }
        if (e.key === 'Enter') {
          if (document.activeElement === confirmButton || document.activeElement === input) {
            e.preventDefault();
            if (updateValidity({ showErrors: true })) {
              closeDialog(input.value.trim());
            }
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeDialog(null);
        }
      });

      input.addEventListener('input', () => {
        updateValidity({ showErrors: true });
      });

      cancelButton.addEventListener('click', () => {
        closeDialog(null);
      });

      confirmButton.addEventListener('click', () => {
        if (!updateValidity({ showErrors: true })) {
          return;
        }
        closeDialog(input.value.trim());
      });

      // Initial state
      updateValidity({ showErrors: false });
      input.focus();
      input.select();
    });
  }

  closeOpenDialog(): void {
    if (!this.hasOpenDialog) {
      return;
    }
    this.activeDialogCleanup?.();
  }
}
