// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DialogManager } from './dialogManager';
import { openListSelectionDialog } from './listSelectionDialog';

const createDialogManager = (): DialogManager =>
  ({
    hasOpenDialog: false,
    showConfirmDialog: vi.fn(),
    showTextInputDialog: vi.fn(),
    registerExternalDialog: vi.fn(),
    releaseExternalDialog: vi.fn(),
    closeOpenDialog: vi.fn(),
  }) as unknown as DialogManager;

describe('openListSelectionDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('filters lists and resolves the confirmed selection', async () => {
    const dialogManager = createDialogManager();
    const promise = openListSelectionDialog({
      dialogManager,
      title: 'Choose List',
      items: [
        { id: 'today', name: 'Today' },
        { id: 'work', name: 'Work' },
      ],
      confirmText: 'Move',
    });

    const searchInput = document.querySelector<HTMLInputElement>(
      '.list-selection-search-input',
    );
    expect(searchInput).not.toBeNull();
    if (!searchInput) return;

    searchInput.value = 'wor';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.list-selection-item'));
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Work');

    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary')?.click();

    await expect(promise).resolves.toEqual({ id: 'work', name: 'Work' });
    expect(dialogManager.releaseExternalDialog).toHaveBeenCalledTimes(1);
  });

  it('resolves null when cancelled', async () => {
    const promise = openListSelectionDialog({
      dialogManager: createDialogManager(),
      title: 'Choose List',
      items: [{ id: 'today', name: 'Today' }],
    });

    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.cancel')?.click();

    await expect(promise).resolves.toBeNull();
  });
});
