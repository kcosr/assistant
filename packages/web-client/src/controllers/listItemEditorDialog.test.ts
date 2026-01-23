// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ListItemEditorDialog } from './listItemEditorDialog';
import type { DialogManager } from './dialogManager';

describe('ListItemEditorDialog tag chips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes only the clicked tag chip', () => {
    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem: vi.fn(async () => true),
      updateListItem: vi.fn(async () => true),
    });

    dialog.open('add', 'list1', undefined, { defaultTags: ['alpha', 'beta'] });

    const entry = document.body.querySelector<HTMLInputElement>('.tag-chips-input-field');
    expect(entry).not.toBeNull();
    if (!entry) return;

    entry.value = 'newtag';
    entry.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    const chips = Array.from(document.body.querySelectorAll<HTMLElement>('.tag-chip')).map((el) =>
      (el.textContent ?? '').replace('×', '').trim(),
    );
    expect(chips.sort()).toEqual(['alpha', 'beta', 'newtag'].sort());

    const newChip = Array.from(document.body.querySelectorAll<HTMLElement>('.tag-chip')).find(
      (el) => (el.textContent ?? '').includes('newtag'),
    );
    expect(newChip).not.toBeUndefined();

    const remove = newChip?.querySelector<HTMLButtonElement>('.tag-chip-remove');
    expect(remove).not.toBeNull();
    remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const chipsAfter = Array.from(document.body.querySelectorAll<HTMLElement>('.tag-chip')).map(
      (el) => (el.textContent ?? '').replace('×', '').trim(),
    );
    expect(chipsAfter.sort()).toEqual(['alpha', 'beta'].sort());
  });

  it('does not remove tags when clicking the Tags label', () => {
    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem: vi.fn(async () => true),
      updateListItem: vi.fn(async () => true),
    });

    dialog.open('add', 'list1', undefined, { defaultTags: ['alpha', 'beta'] });

    const tagsLabel = Array.from(document.body.querySelectorAll('label')).find(
      (el) => el.textContent?.trim() === 'Tags',
    );
    expect(tagsLabel).not.toBeUndefined();
    tagsLabel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const chipsAfter = Array.from(document.body.querySelectorAll<HTMLElement>('.tag-chip')).map(
      (el) => (el.textContent ?? '').replace('×', '').trim(),
    );
    expect(chipsAfter.sort()).toEqual(['alpha', 'beta'].sort());
  });

  it('renders custom field inputs and submits values', async () => {
    const createListItem = vi.fn(async () => true);

    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem,
      updateListItem: vi.fn(async () => true),
    });

    dialog.open('add', 'list1', undefined, {
      customFields: [
        { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
        { key: 'estimate', label: 'Estimate', type: 'number' },
        { key: 'urgent', label: 'Urgent', type: 'checkbox' },
      ],
      initialCustomFieldValues: {},
    });

    const prioritySelect = document.querySelector<HTMLSelectElement>(
      '.list-item-custom-field-row .list-item-form-select',
    );
    expect(prioritySelect).not.toBeNull();
    if (!prioritySelect) return;
    prioritySelect.value = 'High';
    prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));

    const estimateInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.list-item-custom-field-row input[type="number"]',
      ),
    )[0];
    expect(estimateInput).not.toBeUndefined();
    if (!estimateInput) return;
    estimateInput.value = '3';

    const urgentCheckbox = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.list-item-custom-field-row input[type="checkbox"]',
      ),
    )[0];
    expect(urgentCheckbox).not.toBeUndefined();
    if (!urgentCheckbox) return;
    urgentCheckbox.checked = true;

    const titleInput = document.querySelector<HTMLInputElement>(
      '.list-item-form input.list-item-form-input',
    );
    expect(titleInput).not.toBeNull();
    if (!titleInput) return;
    titleInput.value = 'Item with fields';

    const form = document.querySelector<HTMLFormElement>('.list-item-form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();

    expect(createListItem).toHaveBeenCalledTimes(1);
    const calls = createListItem.mock.calls as unknown as [
      string,
      { customFields?: Record<string, unknown> },
    ][];
    const args = calls[0]?.[1];
    expect(args).toBeDefined();
    expect(args?.customFields).toEqual({
      priority: 'High',
      estimate: 3,
      urgent: true,
    });
  });

  it('uses a textarea for markdown text custom fields', async () => {
    const createListItem = vi.fn(async () => true);

    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem,
      updateListItem: vi.fn(async () => true),
    });

    dialog.open('add', 'list1', undefined, {
      customFields: [{ key: 'details', label: 'Details', type: 'text', markdown: true }],
      initialCustomFieldValues: { details: 'Initial text' },
    });

    const textarea = document.querySelector<HTMLTextAreaElement>(
      '.list-item-custom-field-row textarea.list-item-form-textarea',
    );
    expect(textarea).not.toBeNull();
    if (!textarea) return;
    expect(textarea.value).toBe('Initial text');
    textarea.value = 'Updated text';

    const titleInput = document.querySelector<HTMLInputElement>(
      '.list-item-form input.list-item-form-input',
    );
    expect(titleInput).not.toBeNull();
    if (!titleInput) return;
    titleInput.value = 'Item with markdown field';

    const form = document.querySelector<HTMLFormElement>('.list-item-form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();

    expect(createListItem).toHaveBeenCalledTimes(1);
    const calls = createListItem.mock.calls as unknown as [
      string,
      { customFields?: Record<string, unknown> },
    ][];
    const args = calls[0]?.[1];
    expect(args?.customFields).toEqual({
      details: 'Updated text',
    });
  });

  it('sends null for cleared select/text fields to remove previous values', async () => {
    const updateListItem = vi.fn(async () => true);

    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem: vi.fn(async () => true),
      updateListItem,
    });

    // Open in edit mode with existing custom field values
    dialog.open(
      'edit',
      'list1',
      { id: 'item1', title: 'Existing Item', tags: [] },
      {
        customFields: [
          { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
          { key: 'comment', label: 'Comment', type: 'text' },
        ],
        initialCustomFieldValues: { priority: 'High', comment: 'Some comment' },
      },
    );

    // Clear the select by choosing "Select..."
    const prioritySelect = document.querySelector<HTMLSelectElement>(
      '.list-item-custom-field-row .list-item-form-select',
    );
    expect(prioritySelect).not.toBeNull();
    if (!prioritySelect) return;
    prioritySelect.value = ''; // "Select..." placeholder
    prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Clear the text field
    const commentInput = document.querySelector<HTMLInputElement>(
      '.list-item-custom-field-row input[type="text"]',
    );
    expect(commentInput).not.toBeNull();
    if (!commentInput) return;
    commentInput.value = '';

    const form = document.querySelector<HTMLFormElement>('.list-item-form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();

    expect(updateListItem).toHaveBeenCalledTimes(1);
    const calls = updateListItem.mock.calls as unknown as [
      string,
      string,
      { customFields?: Record<string, unknown> },
    ][];
    const args = calls[0]?.[2];
    expect(args).toBeDefined();
    // Cleared fields should be null to signal removal
    expect(args?.customFields?.['priority']).toBeNull();
    expect(args?.customFields?.['comment']).toBeNull();
  });

  it('sends null for unchecked checkbox fields', async () => {
    const updateListItem = vi.fn(async () => true);

    const dialog = new ListItemEditorDialog({
      dialogManager: {
        hasOpenDialog: false,
        showConfirmDialog: vi.fn(),
        showTextInputDialog: vi.fn(),
      } as unknown as DialogManager,
      setStatus: vi.fn(),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      createListItem: vi.fn(async () => true),
      updateListItem,
    });

    // Open in edit mode with checkbox previously checked
    dialog.open(
      'edit',
      'list1',
      { id: 'item1', title: 'Existing Item', tags: [] },
      {
        customFields: [{ key: 'urgent', label: 'Urgent', type: 'checkbox' }],
        initialCustomFieldValues: { urgent: true },
      },
    );

    // Uncheck the checkbox
    const urgentCheckbox = document.querySelector<HTMLInputElement>(
      '.list-item-custom-field-row input[type="checkbox"]',
    );
    expect(urgentCheckbox).not.toBeNull();
    if (!urgentCheckbox) return;
    urgentCheckbox.checked = false;

    const form = document.querySelector<HTMLFormElement>('.list-item-form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();

    expect(updateListItem).toHaveBeenCalledTimes(1);
    const calls = updateListItem.mock.calls as unknown as [
      string,
      string,
      { customFields?: Record<string, unknown> },
    ][];
    const args = calls[0]?.[2];
    expect(args).toBeDefined();
    // Unchecked checkbox should be null to signal removal
    expect(args?.customFields?.['urgent']).toBeNull();
  });
});
