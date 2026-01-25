// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ListItemEditorDialog } from './listItemEditorDialog';
import type { DialogManager } from './dialogManager';

describe('ListItemEditorDialog tag chips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
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

    const chipsContainer = document.body.querySelector('.tag-chips-input-chips');
    const chips = Array.from(
      chipsContainer?.querySelectorAll<HTMLElement>('.tag-chip') ?? [],
    ).map((el) => (el.textContent ?? '').replace('×', '').trim());
    expect(chips.sort()).toEqual(['alpha', 'beta', 'newtag'].sort());

    const newChip = Array.from(
      chipsContainer?.querySelectorAll<HTMLElement>('.tag-chip') ?? [],
    ).find((el) => (el.textContent ?? '').includes('newtag'));
    expect(newChip).not.toBeUndefined();

    const remove = newChip?.querySelector<HTMLButtonElement>('.tag-chip-remove');
    expect(remove).not.toBeNull();
    remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const chipsAfter = Array.from(
      chipsContainer?.querySelectorAll<HTMLElement>('.tag-chip') ?? [],
    ).map((el) => (el.textContent ?? '').replace('×', '').trim());
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

    const chipsContainer = document.body.querySelector('.tag-chips-input-chips');
    const chipsAfter = Array.from(
      chipsContainer?.querySelectorAll<HTMLElement>('.tag-chip') ?? [],
    ).map((el) => (el.textContent ?? '').replace('×', '').trim());
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
    const urgentRow = urgentCheckbox.closest('.list-item-custom-field-row');
    expect(urgentRow?.classList.contains('list-item-custom-field-row--checkbox')).toBe(true);

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
    const row = textarea.closest('.list-item-custom-field-row');
    expect(row?.classList.contains('list-item-custom-field-row--wide')).toBe(true);
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

  it('cancels review-mode edits for text areas', () => {
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

    dialog.open(
      'edit',
      'list1',
      { id: 'item1', title: 'Sample', notes: 'Original notes', tags: [] },
      { initialMode: 'review' },
    );

    const notesField = Array.from(
      document.querySelectorAll<HTMLElement>('.list-item-review-field'),
    ).find(
      (field) =>
        field
          .querySelector('.list-item-review-field-label')
          ?.textContent?.trim() === 'Notes',
    );
    expect(notesField).not.toBeUndefined();
    if (!notesField) return;

    const editButton = notesField.querySelector<HTMLButtonElement>('.list-item-review-edit');
    expect(editButton).not.toBeNull();
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const textarea = notesField.querySelector<HTMLTextAreaElement>(
      'textarea.list-item-form-textarea',
    );
    expect(textarea).not.toBeNull();
    if (!textarea) return;
    textarea.value = 'Changed notes';

    const cancelButton = notesField.querySelector<HTMLButtonElement>('.list-item-review-cancel');
    expect(cancelButton).not.toBeNull();
    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(textarea.value).toBe('Original notes');
    const display = notesField.querySelector<HTMLElement>('.list-item-review-value');
    expect(display?.textContent ?? '').toContain('Original notes');
  });

  it('renders review markdown with collapsible sections', () => {
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

    dialog.open(
      'edit',
      'list1',
      { id: 'item1', title: 'Item', notes: '# Heading\n\nBody', tags: [] },
      { initialMode: 'review' },
    );

    const notesField = Array.from(
      document.querySelectorAll<HTMLElement>('.list-item-review-field'),
    ).find(
      (field) =>
        field
          .querySelector('.list-item-review-field-label')
          ?.textContent?.trim() === 'Notes',
    );
    expect(notesField).not.toBeUndefined();
    if (!notesField) return;

    const collapsible = notesField.querySelector('.collapsible-section');
    expect(collapsible).not.toBeNull();
  });

  it('renders markdown custom fields as full-width review fields', () => {
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

    dialog.open(
      'edit',
      'list1',
      { id: 'item1', title: 'Item', tags: [] },
      {
        customFields: [{ key: 'details', label: 'Details', type: 'text', markdown: true }],
        initialCustomFieldValues: { details: '### Details' },
        initialMode: 'review',
      },
    );

    const detailsField = Array.from(
      document.querySelectorAll<HTMLElement>('.list-item-review-field'),
    ).find(
      (field) =>
        field
          .querySelector('.list-item-review-field-label')
          ?.textContent?.trim() === 'Details',
    );
    expect(detailsField).not.toBeUndefined();
    if (!detailsField) return;

    expect(detailsField.classList.contains('list-item-review-field--wide')).toBe(true);
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

  it('defaults to review mode when preference stored', () => {
    window.localStorage.setItem('aiAssistantListItemEditorDefaultMode', 'review');

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

    dialog.open('edit', 'list1', { id: 'item1', title: 'Review item', tags: [] });

    const dialogEl = document.querySelector<HTMLElement>('.list-item-dialog');
    expect(dialogEl?.classList.contains('list-item-dialog--review')).toBe(true);
    const reviewContainer = document.querySelector<HTMLElement>('.list-item-review');
    const quickContainer = document.querySelector<HTMLElement>('.list-item-form-fields');
    expect(reviewContainer?.hidden).toBe(false);
    expect(quickContainer?.hidden).toBe(true);
  });

  it('honors initialMode override when opening', () => {
    window.localStorage.setItem('aiAssistantListItemEditorDefaultMode', 'quick');

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

    dialog.open('edit', 'list1', { id: 'item1', title: 'Review item', tags: [] }, {
      initialMode: 'review',
    });

    const dialogEl = document.querySelector<HTMLElement>('.list-item-dialog');
    expect(dialogEl?.classList.contains('list-item-dialog--review')).toBe(true);
    const reviewContainer = document.querySelector<HTMLElement>('.list-item-review');
    const quickContainer = document.querySelector<HTMLElement>('.list-item-form-fields');
    expect(reviewContainer?.hidden).toBe(false);
    expect(quickContainer?.hidden).toBe(true);
  });

  it('toggles inline editing in review mode', () => {
    window.localStorage.setItem('aiAssistantListItemEditorDefaultMode', 'review');

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

    dialog.open('edit', 'list1', { id: 'item1', title: 'Review item', tags: [] });

    const editNotesButton = document.querySelector<HTMLButtonElement>(
      '.list-item-review-edit[aria-label="Edit Notes"]',
    );
    expect(editNotesButton).not.toBeNull();
    editNotesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const editingField = editNotesButton?.closest('.list-item-review-field');
    expect(editingField?.classList.contains('list-item-review-field--editing')).toBe(true);
    const notesTextarea = document.querySelector<HTMLTextAreaElement>(
      '.list-item-review-editor textarea.list-item-form-textarea',
    );
    expect(notesTextarea).not.toBeNull();

    editNotesButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editingField?.classList.contains('list-item-review-field--editing')).toBe(false);
  });
});
