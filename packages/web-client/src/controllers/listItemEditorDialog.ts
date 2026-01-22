import type { DialogManager } from './dialogManager';
import type { ListCustomFieldDefinition } from './listCustomFields';
import type { ListPanelItem } from './listPanelController';
import { applyTagColorToElement, normalizeTag } from '../utils/tagColors';
import {
  applyPinnedTag,
  hasPinnedTag,
  isPinnedTag,
  withoutPinnedTag,
} from '../utils/pinnedTag';

export interface ListItemEditorDialogOptions {
  dialogManager: DialogManager;
  setStatus: (text: string) => void;
  recentUserItemUpdates: Set<string>;
  userUpdateTimeoutMs: number;
  createListItem: (listId: string, item: Record<string, unknown>) => Promise<boolean>;
  updateListItem: (
    listId: string,
    itemId: string,
    updates: Record<string, unknown>,
  ) => Promise<boolean>;
}

export interface ListItemEditorDialogOpenOptions {
  availableTags?: string[];
  defaultTags?: string[];
  customFields?: ListCustomFieldDefinition[];
  initialCustomFieldValues?: Record<string, unknown>;
  /** Default value for "Insert at top" checkbox (only shown in add mode) */
  insertAtTop?: boolean;
}

export class ListItemEditorDialog {
  constructor(private readonly options: ListItemEditorDialogOptions) {}

  private createCustomFieldsSection(
    definitions: ListCustomFieldDefinition[],
    initialValues: Record<string, unknown>,
  ): {
    container: HTMLElement | null;
    getValues: () => Record<string, unknown>;
  } {
    const normalized = Array.isArray(definitions) ? definitions : [];
    if (normalized.length === 0) {
      return {
        container: null,
        getValues: () => ({}),
      };
    }

    const section = document.createElement('div');
    section.className = 'list-item-custom-fields-section';

    const title = document.createElement('h4');
    title.className = 'list-item-custom-fields-title';
    title.textContent = 'Custom fields';
    section.appendChild(title);

    const container = document.createElement('div');
    container.className = 'list-item-custom-fields';
    section.appendChild(container);

    const fieldInputs: Array<{
      definition: ListCustomFieldDefinition;
      input: HTMLInputElement | HTMLSelectElement;
    }> = [];

    for (const def of normalized) {
      if (!def || typeof def !== 'object') {
        continue;
      }
      const key = typeof def.key === 'string' ? def.key.trim() : '';
      const label = typeof def.label === 'string' ? def.label.trim() : '';
      if (!key || !label) {
        continue;
      }

      const row = document.createElement('div');
      row.className = 'list-item-form-label list-item-custom-field-row';

      const fieldLabel = document.createElement('label');
      fieldLabel.textContent = label;

      let input: HTMLInputElement | HTMLSelectElement;
      const type = def.type;

      if (type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'list-item-form-checkbox';
      } else if (type === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        input.className = 'list-item-form-input';
      } else if (type === 'date') {
        input = document.createElement('input');
        input.type = 'date';
        input.className = 'list-item-form-input';
      } else if (type === 'time') {
        input = document.createElement('input');
        input.type = 'time';
        input.className = 'list-item-form-input';
      } else if (type === 'datetime') {
        input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'list-item-form-input';
      } else if (type === 'select') {
        const select = document.createElement('select');
        select.className = 'list-item-form-select';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select…';
        select.appendChild(placeholder);

        if (Array.isArray(def.options)) {
          for (const raw of def.options) {
            if (typeof raw !== 'string') continue;
            const trimmed = raw.trim();
            if (!trimmed) continue;
            const option = document.createElement('option');
            option.value = trimmed;
            option.textContent = trimmed;
            select.appendChild(option);
          }
        }
        input = select;
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'list-item-form-input';
      }

      const id = `list-item-custom-field-${key}-${Math.random().toString(36).slice(2)}`;
      input.id = id;
      fieldLabel.htmlFor = id;

      const rawValue = initialValues[key];
      if (type === 'checkbox') {
        if (input instanceof HTMLInputElement) {
          input.checked = rawValue === true;
        }
      } else if (type === 'number') {
        if (typeof rawValue === 'number') {
          input.value = String(rawValue);
        } else if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          input.value = rawValue.trim();
        }
      } else if (type === 'select') {
        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          input.value = rawValue.trim();
        }
      } else if (type === 'date') {
        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          input.value = rawValue.trim();
        }
      } else if (type === 'time') {
        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          input.value = rawValue.trim();
        }
      } else if (type === 'datetime') {
        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          // datetime-local expects format YYYY-MM-DDTHH:MM
          input.value = rawValue.trim();
        }
      } else {
        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
          input.value = rawValue.trim();
        }
      }

      fieldLabel.appendChild(input);
      row.appendChild(fieldLabel);
      container.appendChild(row);

      fieldInputs.push({ definition: def, input });
    }

    const getValues = (): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const { definition, input } of fieldInputs) {
        const key = definition.key;
        if (!key) continue;
        const type = definition.type;

        if (type === 'checkbox') {
          if (input instanceof HTMLInputElement && input.checked) {
            result[key] = true;
          } else {
            // Unchecked checkbox: send null to remove any previous value
            result[key] = null;
          }
          continue;
        }

        const raw = input.value.trim();
        if (!raw) {
          // Empty value: send null to remove any previous value
          result[key] = null;
          continue;
        }

        if (type === 'number') {
          const numberInput = input as HTMLInputElement;
          const numeric = numberInput.valueAsNumber;
          if (!Number.isNaN(numeric)) {
            result[key] = numeric;
          }
        } else if (type === 'select') {
          result[key] = raw;
        } else if (type === 'date') {
          result[key] = raw;
        } else if (type === 'time') {
          result[key] = raw;
        } else if (type === 'datetime') {
          result[key] = raw;
        } else {
          result[key] = raw;
        }
      }
      return result;
    };

    return {
      container: section,
      getValues,
    };
  }

  open(
    mode: 'add' | 'edit',
    listId: string,
    item?: ListPanelItem,
    openOptions?: ListItemEditorDialogOpenOptions,
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay list-item-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog list-item-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = mode === 'add' ? 'Add Item' : 'Edit Item';
    dialog.appendChild(titleEl);

    const form = document.createElement('form');
    form.className = 'list-item-form';

    const titleLabel = document.createElement('label');
    titleLabel.className = 'list-item-form-label';
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'list-item-form-input';
    titleInput.value = item?.title ?? '';
    titleInput.required = true;
    titleLabel.appendChild(titleInput);
    form.appendChild(titleLabel);

    const urlLabel = document.createElement('label');
    urlLabel.className = 'list-item-form-label';
    urlLabel.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'list-item-form-input';
    urlInput.value = item?.url ?? '';
    urlLabel.appendChild(urlInput);
    form.appendChild(urlLabel);

    const notesLabel = document.createElement('label');
    notesLabel.className = 'list-item-form-label';
    notesLabel.textContent = 'Notes';
    const notesInput = document.createElement('textarea');
    notesInput.className = 'list-item-form-textarea';
    notesInput.value = item?.notes ?? '';
    notesLabel.appendChild(notesInput);
    form.appendChild(notesLabel);

    const tagsRow = document.createElement('div');
    tagsRow.className = 'list-item-form-label';

    const tagsLabel = document.createElement('label');
    tagsLabel.textContent = 'Tags';

    const tagInputWrap = document.createElement('div');
    tagInputWrap.className = 'tag-chips-input';

    const tagChipsContainer = document.createElement('div');
    tagChipsContainer.className = 'tag-chips-input-chips';

    const tagEntryInput = document.createElement('input');
    tagEntryInput.type = 'text';
    tagEntryInput.className = 'tag-chips-input-field';
    tagEntryInput.placeholder = 'Add tag…';
    tagEntryInput.autocomplete = 'off';
    tagEntryInput.id = `list-item-tags-input-${Math.random().toString(36).slice(2)}`;
    tagsLabel.htmlFor = tagEntryInput.id;

    const tagSuggestions = document.createElement('div');
    tagSuggestions.className = 'tag-chips-input-suggestions';

    tagChipsContainer.appendChild(tagEntryInput);
    tagInputWrap.appendChild(tagChipsContainer);
    tagInputWrap.appendChild(tagSuggestions);
    tagsRow.appendChild(tagsLabel);
    tagsRow.appendChild(tagInputWrap);
    form.appendChild(tagsRow);

    const initialTagsSource =
      mode === 'edit'
        ? Array.isArray(item?.tags)
          ? item.tags
          : []
        : Array.isArray(openOptions?.defaultTags)
          ? openOptions.defaultTags
          : [];
    const initialPinned = hasPinnedTag(initialTagsSource);
    const initialTags = withoutPinnedTag(initialTagsSource);

    const pinnedRow = document.createElement('div');
    pinnedRow.className = 'list-item-form-checkbox-row';

    const pinnedCheckbox = document.createElement('input');
    pinnedCheckbox.type = 'checkbox';
    pinnedCheckbox.id = `list-item-pinned-${Math.random().toString(36).slice(2)}`;
    pinnedCheckbox.className = 'list-item-form-checkbox';
    pinnedCheckbox.checked = initialPinned;

    const pinnedLabel = document.createElement('label');
    pinnedLabel.htmlFor = pinnedCheckbox.id;
    pinnedLabel.textContent = 'Pinned';

    pinnedRow.appendChild(pinnedCheckbox);
    pinnedRow.appendChild(pinnedLabel);
    form.appendChild(pinnedRow);

    // Insert at top checkbox (only shown in add mode)
    let insertAtTopCheckbox: HTMLInputElement | null = null;
    if (mode === 'add') {
      const insertAtTopRow = document.createElement('div');
      insertAtTopRow.className = 'list-item-form-checkbox-row';

      insertAtTopCheckbox = document.createElement('input');
      insertAtTopCheckbox.type = 'checkbox';
      insertAtTopCheckbox.id = `insert-at-top-${Math.random().toString(36).slice(2)}`;
      insertAtTopCheckbox.className = 'list-item-form-checkbox';
      insertAtTopCheckbox.checked = openOptions?.insertAtTop ?? false;

      const insertAtTopLabel = document.createElement('label');
      insertAtTopLabel.htmlFor = insertAtTopCheckbox.id;
      insertAtTopLabel.textContent = 'Insert at top';

      insertAtTopRow.appendChild(insertAtTopCheckbox);
      insertAtTopRow.appendChild(insertAtTopLabel);
      form.appendChild(insertAtTopRow);
    }

    const customFieldsSection = this.createCustomFieldsSection(
      openOptions?.customFields ?? [],
      openOptions?.initialCustomFieldValues ?? {},
    );
    if (customFieldsSection.container) {
      form.appendChild(customFieldsSection.container);
    }

    const canonicalTagByLower = new Map<string, string>();
    for (const t of openOptions?.availableTags ?? []) {
      if (typeof t !== 'string') continue;
      const trimmed = t.trim();
      if (!trimmed || isPinnedTag(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (!canonicalTagByLower.has(lower)) {
        canonicalTagByLower.set(lower, trimmed);
      }
    }

    const selectedTagsLower = new Set<string>();
    const selectedTags: string[] = [];

    const removeTagByLower = (lower: string): void => {
      if (!selectedTagsLower.has(lower)) {
        return;
      }
      selectedTagsLower.delete(lower);
      const idx = selectedTags.findIndex((t) => t.toLowerCase() === lower);
      if (idx >= 0) {
        selectedTags.splice(idx, 1);
      }
      renderSelectedTags();
      renderTagSuggestions();
    };

    const renderSelectedTags = (): void => {
      tagChipsContainer.querySelectorAll('.tag-chip').forEach((el) => el.remove());
      for (const tag of selectedTags) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        chip.dataset['tag'] = normalizeTag(tag);
        applyTagColorToElement(chip, tag);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'tag-chip-remove';
        removeBtn.tabIndex = -1;
        removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeTagByLower(tag.toLowerCase());
        });
        chip.appendChild(removeBtn);
        tagChipsContainer.insertBefore(chip, tagEntryInput);
      }
    };

    const addTag = (raw: string): void => {
      const trimmed = raw.trim().replace(/^@+/, '');
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (selectedTagsLower.has(lower)) return;

      const canonical = canonicalTagByLower.get(lower) ?? trimmed;
      selectedTagsLower.add(lower);
      selectedTags.push(canonical);
      renderSelectedTags();
      renderTagSuggestions();
    };

    const addTagsFromText = (raw: string): void => {
      const parts = raw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      for (const part of parts) {
        addTag(part);
      }
    };

    const removeLastTag = (): void => {
      const tag = selectedTags.pop();
      if (!tag) return;
      selectedTagsLower.delete(tag.toLowerCase());
      renderSelectedTags();
      renderTagSuggestions();
    };

    let currentMatches: string[] = [];
    let isClickingSuggestion = false;

    const renderTagSuggestions = (): void => {
      const query = tagEntryInput.value.trim().toLowerCase();
      tagSuggestions.innerHTML = '';
      currentMatches = [];
      if (!query) {
        tagSuggestions.classList.remove('visible');
        return;
      }

      const matches: string[] = [];
      for (const [lower, canonical] of canonicalTagByLower.entries()) {
        if (selectedTagsLower.has(lower)) continue;
        if (lower.startsWith(query)) {
          matches.push(canonical);
        }
      }

      matches.sort((a, b) => a.localeCompare(b));
      currentMatches = matches.slice(0, 12);
      if (currentMatches.length === 0) {
        tagSuggestions.classList.remove('visible');
        return;
      }

      tagSuggestions.classList.add('visible');
      for (const tag of currentMatches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag-chip-suggestion';
        btn.tabIndex = -1;
        btn.textContent = tag;
        btn.dataset['tag'] = normalizeTag(tag);
        applyTagColorToElement(btn, tag);
        // Use mousedown to fire before blur
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent blur from firing
          isClickingSuggestion = true;
          tagEntryInput.value = '';
          addTag(tag);
          renderTagSuggestions();
          tagEntryInput.focus();
          isClickingSuggestion = false;
        });
        tagSuggestions.appendChild(btn);
      }
    };

    tagEntryInput.addEventListener('input', () => {
      renderTagSuggestions();
    });

    tagEntryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (tagEntryInput.value.trim().length > 0) {
          // If there's exactly one matching suggestion, use it
          const singleMatch = currentMatches.length === 1 ? currentMatches[0] : null;
          if (singleMatch) {
            tagEntryInput.value = '';
            addTag(singleMatch);
          } else {
            addTagsFromText(tagEntryInput.value);
            tagEntryInput.value = '';
          }
          renderTagSuggestions();
        }
        return;
      }
      if (e.key === 'Backspace' && tagEntryInput.value.length === 0) {
        removeLastTag();
      }
    });

    tagEntryInput.addEventListener('blur', () => {
      // Don't process blur if we're clicking a suggestion (mousedown handles it)
      if (isClickingSuggestion) {
        return;
      }
      if (tagEntryInput.value.trim().length > 0) {
        addTagsFromText(tagEntryInput.value);
        tagEntryInput.value = '';
        renderTagSuggestions();
      }
    });

    for (const tag of initialTags) {
      if (typeof tag === 'string') {
        addTag(tag);
      }
    }

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
    });
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

    titleInput.focus();

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

      // Shift+Enter to submit from any field
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
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

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }

      const url = urlInput.value.trim();
      const notes = notesInput.value.trim();
      const tags = applyPinnedTag(selectedTags, pinnedCheckbox.checked);

      const customFieldValues = customFieldsSection.getValues();

      const payload: {
        title: string;
        url?: string;
        notes?: string;
        tags?: string[];
        customFields?: Record<string, unknown>;
        position?: number;
      } = {
        title,
        url,
        notes,
        tags,
      };

      if (!url) {
        payload.url = '';
      }
      if (!notes) {
        payload.notes = '';
      }
      if (tags.length === 0) {
        payload.tags = [];
      }

      payload.customFields = customFieldValues;
      if (Object.keys(customFieldValues).length === 0) {
        payload.customFields = {};
      }

      // Add position:0 when "Insert at top" is checked
      if (insertAtTopCheckbox?.checked) {
        payload.position = 0;
      }

      if (mode === 'add') {
        void (async () => {
          const ok = await this.options.createListItem(listId, payload);
          if (!ok) {
            this.options.setStatus('Failed to add list item');
            return;
          }
          closeDialog();
        })();
      } else if (mode === 'edit' && item?.id) {
        void (async () => {
          const itemId = item.id as string;

          this.options.recentUserItemUpdates.add(itemId);
          window.setTimeout(() => {
            this.options.recentUserItemUpdates.delete(itemId);
          }, this.options.userUpdateTimeoutMs);

          const ok = await this.options.updateListItem(listId, itemId, payload);
          if (!ok) {
            this.options.setStatus('Failed to update list item');
            return;
          }
          closeDialog();
        })();
      }
    });
  }
}
