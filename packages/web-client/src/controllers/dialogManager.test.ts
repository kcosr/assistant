// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { DialogManager } from './dialogManager';

describe('DialogManager', () => {
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
});
