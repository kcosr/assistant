// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DialogManager } from './dialogManager';
import { ListMetadataDialog } from './listMetadataDialog';
import type { ListMetadataDialogPayload } from './listMetadataDialog';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ListMetadataDialog tag chips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses tag chips inputs for create mode and submits tags', async () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => ['alpha', 'beta', 'Gamma']);
    const createList = vi.fn(async () => true);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList,
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
    });

    controller.open('create');

    const form = document.querySelector<HTMLFormElement>('.list-metadata-dialog form');
    expect(form).not.toBeNull();

    const nameInput = document.querySelector<HTMLInputElement>(
      '.list-metadata-dialog input[type="text"]',
    );
    expect(nameInput).not.toBeNull();

    const chipInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('.list-metadata-dialog .tag-chips-input-field'),
    );
    expect(chipInputs.length).toBe(2);

    const tagsInput = chipInputs[0];
    const defaultTagsInput = chipInputs[1];
    if (!tagsInput || !defaultTagsInput) {
      throw new Error('Missing tag chip inputs');
    }

    nameInput!.value = 'My List';

    tagsInput.value = 'alpha';
    tagsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    defaultTagsInput.value = 'beta,delta';
    defaultTagsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(createList).toHaveBeenCalledTimes(1);
    const calls = createList.mock.calls as ListMetadataDialogPayload[][];
    const payload = calls[0]?.[0];
    if (!payload) {
      throw new Error('Missing createList payload');
    }

    expect(payload.name).toBe('My List');
    expect(payload.tags).toEqual(['alpha']);
    expect(payload.defaultTags.sort()).toEqual(['beta', 'delta'].sort());
    expect(payload.customFields).toEqual([]);
  });

  it('shows autocomplete suggestions and adds tag when suggestion is clicked', () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => ['alpha', 'beta', 'gamma']);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList: vi.fn(async () => true),
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
    });

    controller.open('create');

    const tagRows = Array.from(
      document.querySelectorAll<HTMLElement>('.list-metadata-dialog .list-item-form-label'),
    );
    const tagsRow = tagRows.find((row) =>
      Array.from(row.querySelectorAll('label')).some(
        (label) => label.textContent?.trim() === 'Tags',
      ),
    );
    expect(tagsRow).toBeDefined();

    const entryInput = tagsRow!.querySelector<HTMLInputElement>('.tag-chips-input-field');
    expect(entryInput).not.toBeNull();

    entryInput!.value = 'a';
    entryInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const suggestions = tagsRow!.querySelector<HTMLDivElement>('.tag-chips-input-suggestions');
    expect(suggestions).not.toBeNull();
    expect(suggestions!.classList.contains('visible')).toBe(true);

    const suggestionButtons = Array.from(
      suggestions!.querySelectorAll<HTMLButtonElement>('.tag-chip-suggestion'),
    );
    expect(suggestionButtons.length).toBeGreaterThan(0);

    const alphaSuggestion = suggestionButtons.find(
      (btn) => btn.textContent?.trim().toLowerCase() === 'alpha',
    );
    expect(alphaSuggestion).toBeDefined();

    alphaSuggestion!.click();

    const chips = Array.from(tagsRow!.querySelectorAll<HTMLElement>('.tag-chip')).map((chip) =>
      (chip.textContent ?? '').replace('×', '').trim(),
    );
    expect(chips).toContain('alpha');
  });

  it('submits custom field definitions from the schema editor', async () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => []);
    const createList = vi.fn(async () => true);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList,
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
    });

    controller.open('create');

    const nameInput = document.querySelector<HTMLInputElement>(
      '.list-metadata-dialog input.list-item-form-input',
    );
    expect(nameInput).not.toBeNull();
    if (!nameInput) return;
    nameInput.value = 'With Custom Fields';

    const addButton = document.querySelector<HTMLButtonElement>(
      '.list-metadata-custom-field-add-button',
    );
    expect(addButton).not.toBeNull();
    addButton?.click();

    const row = document.querySelector<HTMLElement>('.list-metadata-custom-field-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const labelInput = row.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-label-input',
    );
    const keyInput = row.querySelector<HTMLInputElement>('.list-metadata-custom-field-key-input');
    const typeSelect = row.querySelector<HTMLSelectElement>(
      '.list-metadata-custom-field-type-select',
    );
    const optionsInput = row.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-options-input',
    );

    expect(labelInput).not.toBeNull();
    expect(keyInput).not.toBeNull();
    expect(typeSelect).not.toBeNull();
    expect(optionsInput).not.toBeNull();
    if (!labelInput || !keyInput || !typeSelect || !optionsInput) return;

    labelInput.value = 'Priority';
    keyInput.value = 'priority';
    typeSelect.value = 'select';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    optionsInput.value = 'High, Medium, Low';

    const form = document.querySelector<HTMLFormElement>('.list-metadata-dialog form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(createList).toHaveBeenCalledTimes(1);
    const calls = createList.mock.calls as ListMetadataDialogPayload[][];
    const payload = calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) return;

    expect(payload.customFields).toEqual([
      {
        key: 'priority',
        label: 'Priority',
        type: 'select',
        options: ['High', 'Medium', 'Low'],
      },
    ]);
  });

  it('includes markdown flag for text custom fields', async () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => []);
    const createList = vi.fn(async () => true);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList,
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
    });

    controller.open('create');

    const nameInput = document.querySelector<HTMLInputElement>(
      '.list-metadata-dialog input.list-item-form-input',
    );
    expect(nameInput).not.toBeNull();
    if (!nameInput) return;
    nameInput.value = 'Markdown Fields';

    const addButton = document.querySelector<HTMLButtonElement>(
      '.list-metadata-custom-field-add-button',
    );
    expect(addButton).not.toBeNull();
    addButton?.click();

    const row = document.querySelector<HTMLElement>('.list-metadata-custom-field-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const labelInput = row.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-label-input',
    );
    const keyInput = row.querySelector<HTMLInputElement>('.list-metadata-custom-field-key-input');
    const markdownInput = row.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-markdown-input',
    );

    expect(labelInput).not.toBeNull();
    expect(keyInput).not.toBeNull();
    expect(markdownInput).not.toBeNull();
    if (!labelInput || !keyInput || !markdownInput) return;

    labelInput.value = 'Details';
    keyInput.value = 'details';
    markdownInput.checked = true;

    const form = document.querySelector<HTMLFormElement>('.list-metadata-dialog form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(createList).toHaveBeenCalledTimes(1);
    const calls = createList.mock.calls as ListMetadataDialogPayload[][];
    const payload = calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) return;

    expect(payload.customFields).toEqual([
      {
        key: 'details',
        label: 'Details',
        type: 'text',
        markdown: true,
      },
    ]);
  });

  it('submits custom fields in the reordered order', async () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => []);
    const createList = vi.fn(async () => true);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList,
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
    });

    controller.open('create');

    const nameInput = document.querySelector<HTMLInputElement>(
      '.list-metadata-dialog input.list-item-form-input',
    );
    expect(nameInput).not.toBeNull();
    if (!nameInput) return;
    nameInput.value = 'Reordered Fields';

    const addButton = document.querySelector<HTMLButtonElement>(
      '.list-metadata-custom-field-add-button',
    );
    expect(addButton).not.toBeNull();
    addButton?.click();
    addButton?.click();

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('.list-metadata-custom-field-row'),
    );
    expect(rows).toHaveLength(2);
    if (rows.length < 2) return;

    const firstRow = rows[0];
    const secondRow = rows[1];
    const firstLabel = firstRow?.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-label-input',
    );
    const firstKey = firstRow?.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-key-input',
    );
    const secondLabel = secondRow?.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-label-input',
    );
    const secondKey = secondRow?.querySelector<HTMLInputElement>(
      '.list-metadata-custom-field-key-input',
    );
    expect(firstLabel).not.toBeNull();
    expect(firstKey).not.toBeNull();
    expect(secondLabel).not.toBeNull();
    expect(secondKey).not.toBeNull();
    if (!firstLabel || !firstKey || !secondLabel || !secondKey) return;

    firstLabel.value = 'Priority';
    firstKey.value = 'priority';
    secondLabel.value = 'Status';
    secondKey.value = 'status';

    const moveUpButton = secondRow?.querySelector<HTMLButtonElement>(
      '.list-metadata-custom-field-move-up',
    );
    expect(moveUpButton).not.toBeNull();
    moveUpButton?.click();

    const form = document.querySelector<HTMLFormElement>('.list-metadata-dialog form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(createList).toHaveBeenCalledTimes(1);
    const calls = createList.mock.calls as ListMetadataDialogPayload[][];
    const payload = calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) return;

    expect(payload.customFields.map((field) => field.key)).toEqual(['status', 'priority']);
  });

  it('includes the selected instance when instance options are provided', async () => {
    const dialogManager = new DialogManager();
    const getAllKnownTags = vi.fn(() => []);
    const createList = vi.fn(async () => true);

    const controller = new ListMetadataDialog({
      dialogManager,
      getAllKnownTags,
      createList,
      updateList: vi.fn(async () => true),
      deleteList: vi.fn(async () => true),
      getInstanceSelection: () => ({
        options: [
          { id: 'default', label: 'Default' },
          { id: 'work', label: 'Work' },
        ],
        preferredInstanceId: 'default',
      }),
    });

    controller.open('create');

    const nameInput = document.querySelector<HTMLInputElement>(
      '.list-metadata-dialog input.list-item-form-input',
    );
    expect(nameInput).not.toBeNull();
    if (!nameInput) return;
    nameInput.value = 'Instance List';

    const instanceSelect = document.querySelector<HTMLSelectElement>(
      '.list-metadata-dialog select.list-item-form-select',
    );
    expect(instanceSelect).not.toBeNull();
    if (instanceSelect) {
      instanceSelect.value = 'work';
      instanceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const form = document.querySelector<HTMLFormElement>('.list-metadata-dialog form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(createList).toHaveBeenCalledTimes(1);
    const calls = createList.mock.calls as ListMetadataDialogPayload[][];
    const payload = calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) return;
    expect(payload.instanceId).toBe('work');
  });
});
