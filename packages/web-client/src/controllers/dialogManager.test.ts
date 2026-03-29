// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DialogManager } from './dialogManager';

describe('DialogManager', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves text input dialog value on confirm', async () => {
    const dialogManager = new DialogManager();

    const promise = dialogManager.showTextInputDialog({
      title: 'Title',
      message: 'Message',
      confirmText: 'OK',
      validate: (value) => (value.trim() ? null : 'Required'),
    });

    const input = document.querySelector<HTMLInputElement>('.list-item-form-input');
    expect(input).toBeTruthy();
    input!.value = '  hello  ';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const confirm = document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary');
    expect(confirm).toBeTruthy();
    confirm!.click();

    await expect(promise).resolves.toBe('hello');
    expect(dialogManager.hasOpenDialog).toBe(false);
  });

  it('disables confirm when validation fails', async () => {
    const dialogManager = new DialogManager();
    void dialogManager.showTextInputDialog({
      title: 'Title',
      message: 'Message',
      confirmText: 'OK',
      validate: (value) => (value.trim() ? null : 'Required'),
    });

    const confirm = document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary');
    expect(confirm).toBeTruthy();
    expect(confirm!.disabled).toBe(true);

    const error = document.querySelector<HTMLElement>('.list-metadata-error');
    expect(error).toBeTruthy();
    expect(error!.textContent).toBe('');
    expect(error!.style.display).toBe('none');
  });

  it('clears dialog state when confirm dialog closes via default button behavior', () => {
    const dialogManager = new DialogManager();
    const onCancel = vi.fn();

    dialogManager.showConfirmDialog({
      title: 'Delete',
      message: 'Confirm delete?',
      confirmText: 'Delete',
      onConfirm: vi.fn(),
      onCancel,
    });

    expect(dialogManager.hasOpenDialog).toBe(true);

    const overlays = document.querySelectorAll<HTMLElement>('.confirm-dialog-overlay');
    const overlay = overlays[overlays.length - 1] ?? null;
    const cancel = overlay?.querySelector<HTMLButtonElement>('.confirm-dialog-button.cancel') ?? null;
    expect(cancel).toBeTruthy();
    cancel!.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.confirm-dialog-overlay')).toBeNull();
    expect(dialogManager.hasOpenDialog).toBe(false);
  });
});
