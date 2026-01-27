import type { DialogManager } from './dialogManager';
import type { ListCustomFieldDefinition, ListCustomFieldType } from './listCustomFields';
import {
  applyPinnedTag,
  hasPinnedTag,
  isPinnedTag,
  withoutPinnedTag,
} from '../utils/pinnedTag';

export interface ListMetadataDialogPayload {
  name: string;
  description: string;
  tags: string[];
  favorite?: boolean;
  defaultTags: string[];
  customFields: ListCustomFieldDefinition[];
  instanceId?: string;
  sourceInstanceId?: string;
}

export interface ListMetadataDialogInitialData {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  favorite?: boolean;
  defaultTags?: string[];
  customFields?: ListCustomFieldDefinition[];
  instanceId?: string;
}

export interface ListMetadataDialogInstanceOption {
  id: string;
  label?: string;
}

export interface ListMetadataDialogInstanceSelection {
  options: ListMetadataDialogInstanceOption[];
  preferredInstanceId?: string;
}

export interface ListMetadataDialogOptions {
  dialogManager: DialogManager;
  getAllKnownTags: () => string[];
  createList: (payload: ListMetadataDialogPayload) => Promise<boolean>;
  updateList: (listId: string, payload: ListMetadataDialogPayload) => Promise<boolean>;
  deleteList: (listId: string) => Promise<boolean>;
  getInstanceSelection?: () => ListMetadataDialogInstanceSelection | null;
}

export class ListMetadataDialog {
  constructor(private readonly options: ListMetadataDialogOptions) {}

  private createCustomFieldsSection(
    initialFields: ListCustomFieldDefinition[],
    setError: (message: string | null) => void,
  ): {
    container: HTMLElement;
    getCustomFields: () => ListCustomFieldDefinition[] | null;
  } {
    const section = document.createElement('div');
    section.className = 'list-metadata-custom-fields-section';

    const heading = document.createElement('h4');
    heading.className = 'list-metadata-custom-fields-title';
    heading.textContent = 'Custom fields';
    section.appendChild(heading);

    const description = document.createElement('p');
    description.className = 'list-metadata-custom-fields-description';
    description.textContent =
      'Define per-item fields for this list (for example, priority, due date, or flags).';
    section.appendChild(description);

    const list = document.createElement('div');
    list.className = 'list-metadata-custom-fields-list';
    section.appendChild(list);

    const fieldRows: HTMLElement[] = [];
    const updateMoveButtons = (): void => {
      fieldRows.forEach((row, index) => {
        const moveUpButton = row.querySelector<HTMLButtonElement>(
          '.list-metadata-custom-field-move-up',
        );
        const moveDownButton = row.querySelector<HTMLButtonElement>(
          '.list-metadata-custom-field-move-down',
        );
        if (moveUpButton) {
          moveUpButton.disabled = index === 0;
        }
        if (moveDownButton) {
          moveDownButton.disabled = index === fieldRows.length - 1;
        }
      });
    };
    const moveRow = (row: HTMLElement, offset: number): void => {
      const index = fieldRows.indexOf(row);
      if (index === -1) return;
      const targetIndex = index + offset;
      if (targetIndex < 0 || targetIndex >= fieldRows.length) return;
      const targetRow = fieldRows[targetIndex];
      if (!targetRow) return;

      fieldRows.splice(index, 1);
      fieldRows.splice(targetIndex, 0, row);

      if (offset > 0) {
        list.insertBefore(row, targetRow.nextSibling);
      } else {
        list.insertBefore(row, targetRow);
      }

      updateMoveButtons();
    };

    const ensureOptionsVisibility = (row: HTMLElement, type: ListCustomFieldType): void => {
      const optionsWrapper = row.querySelector<HTMLElement>(
        '.list-metadata-custom-field-options-wrapper',
      );
      if (!optionsWrapper) return;
      const isSelect = type === 'select';
      optionsWrapper.style.display = isSelect ? '' : 'none';
    };

    const ensureMarkdownVisibility = (row: HTMLElement, type: ListCustomFieldType): void => {
      const markdownWrapper = row.querySelector<HTMLElement>(
        '.list-metadata-custom-field-markdown',
      );
      if (!markdownWrapper) return;
      const markdownInput = markdownWrapper.querySelector<HTMLInputElement>(
        '.list-metadata-custom-field-markdown-input',
      );
      const isText = type === 'text';
      markdownWrapper.style.display = isText ? '' : 'none';
      if (!isText && markdownInput) {
        markdownInput.checked = false;
      }
    };

    const addFieldRow = (field?: ListCustomFieldDefinition): void => {
      const row = document.createElement('div');
      row.className = 'list-metadata-custom-field-row';

      const labelWrapper = document.createElement('div');
      labelWrapper.className = 'list-metadata-custom-field-main';

      const labelLabel = document.createElement('label');
      labelLabel.className = 'list-metadata-custom-field-label';
      labelLabel.textContent = 'Label';
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'list-item-form-input list-metadata-custom-field-label-input';
      labelInput.value = field?.label ?? '';
      labelLabel.appendChild(labelInput);
      labelWrapper.appendChild(labelLabel);

      const keyLabel = document.createElement('label');
      keyLabel.className = 'list-metadata-custom-field-key-label';
      keyLabel.textContent = 'Key';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'list-item-form-input list-metadata-custom-field-key-input';
      keyInput.placeholder = 'e.g. priority, due_date';
      keyInput.value = field?.key ?? '';
      keyLabel.appendChild(keyInput);
      labelWrapper.appendChild(keyLabel);

      const typeLabel = document.createElement('label');
      typeLabel.className = 'list-metadata-custom-field-type-label';
      typeLabel.textContent = 'Type';
      const typeSelect = document.createElement('select');
      typeSelect.className = 'list-item-form-select list-metadata-custom-field-type-select';
      const types: { value: ListCustomFieldType; label: string }[] = [
        { value: 'text', label: 'Text' },
        { value: 'number', label: 'Number' },
        { value: 'date', label: 'Date' },
        { value: 'time', label: 'Time' },
        { value: 'datetime', label: 'Date & Time' },
        { value: 'select', label: 'Select' },
        { value: 'checkbox', label: 'Checkbox' },
        { value: 'ref', label: 'Reference' },
      ];
      for (const t of types) {
        const option = document.createElement('option');
        option.value = t.value;
        option.textContent = t.label;
        typeSelect.appendChild(option);
      }
      typeSelect.value = field?.type ?? 'text';
      typeLabel.appendChild(typeSelect);
      labelWrapper.appendChild(typeLabel);

      row.appendChild(labelWrapper);

      const optionsWrapper = document.createElement('div');
      optionsWrapper.className = 'list-metadata-custom-field-options-wrapper';
      const optionsLabel = document.createElement('label');
      optionsLabel.textContent = 'Options (comma-separated)';
      const optionsInput = document.createElement('input');
      optionsInput.type = 'text';
      optionsInput.className = 'list-item-form-input list-metadata-custom-field-options-input';
      if (Array.isArray(field?.options)) {
        optionsInput.value = field.options.join(', ');
      }
      optionsLabel.appendChild(optionsInput);
      optionsWrapper.appendChild(optionsLabel);
      row.appendChild(optionsWrapper);

      const markdownWrapper = document.createElement('div');
      markdownWrapper.className = 'list-metadata-custom-field-markdown';
      const markdownLabel = document.createElement('label');
      markdownLabel.className = 'list-metadata-custom-field-markdown-label';
      const markdownInput = document.createElement('input');
      markdownInput.type = 'checkbox';
      markdownInput.className = 'list-item-form-checkbox list-metadata-custom-field-markdown-input';
      markdownInput.checked = field?.markdown === true;
      markdownLabel.appendChild(markdownInput);
      markdownLabel.appendChild(document.createTextNode('Render as markdown'));
      markdownWrapper.appendChild(markdownLabel);
      row.appendChild(markdownWrapper);

      const actions = document.createElement('div');
      actions.className = 'list-metadata-custom-field-actions';
      const moveUpButton = document.createElement('button');
      moveUpButton.type = 'button';
      moveUpButton.className =
        'list-metadata-custom-field-move-button list-metadata-custom-field-move-up';
      moveUpButton.textContent = 'Up';
      moveUpButton.setAttribute('aria-label', 'Move custom field up');
      moveUpButton.addEventListener('click', (event) => {
        event.preventDefault();
        moveRow(row, -1);
      });
      actions.appendChild(moveUpButton);

      const moveDownButton = document.createElement('button');
      moveDownButton.type = 'button';
      moveDownButton.className =
        'list-metadata-custom-field-move-button list-metadata-custom-field-move-down';
      moveDownButton.textContent = 'Down';
      moveDownButton.setAttribute('aria-label', 'Move custom field down');
      moveDownButton.addEventListener('click', (event) => {
        event.preventDefault();
        moveRow(row, 1);
      });
      actions.appendChild(moveDownButton);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'list-metadata-custom-field-remove-button';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        list.removeChild(row);
        const index = fieldRows.indexOf(row);
        if (index >= 0) {
          fieldRows.splice(index, 1);
        }
        updateMoveButtons();
      });
      actions.appendChild(removeButton);
      row.appendChild(actions);

      typeSelect.addEventListener('change', () => {
        ensureOptionsVisibility(row, typeSelect.value as ListCustomFieldType);
        ensureMarkdownVisibility(row, typeSelect.value as ListCustomFieldType);
      });

      ensureOptionsVisibility(row, typeSelect.value as ListCustomFieldType);
      ensureMarkdownVisibility(row, typeSelect.value as ListCustomFieldType);

      list.appendChild(row);
      fieldRows.push(row);
      updateMoveButtons();
    };

    for (const field of initialFields) {
      if (field && typeof field === 'object') {
        addFieldRow(field);
      }
    }

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'list-metadata-custom-field-add-button';
    addButton.textContent = 'Add field';
    addButton.addEventListener('click', (event) => {
      event.preventDefault();
      addFieldRow();
    });
    section.appendChild(addButton);

    const getCustomFields = (): ListCustomFieldDefinition[] | null => {
      const result: ListCustomFieldDefinition[] = [];
      const seenKeys = new Set<string>();

      for (const row of fieldRows) {
        const labelInput = row.querySelector<HTMLInputElement>(
          '.list-metadata-custom-field-label-input',
        );
        const keyInput = row.querySelector<HTMLInputElement>(
          '.list-metadata-custom-field-key-input',
        );
        const typeSelect = row.querySelector<HTMLSelectElement>(
          '.list-metadata-custom-field-type-select',
        );
        const optionsInput = row.querySelector<HTMLInputElement>(
          '.list-metadata-custom-field-options-input',
        );
        const markdownInput = row.querySelector<HTMLInputElement>(
          '.list-metadata-custom-field-markdown-input',
        );

        if (!labelInput || !keyInput || !typeSelect || !optionsInput) {
          continue;
        }

        const rawLabel = labelInput.value.trim();
        const rawKey = keyInput.value.trim();
        const rawType = typeSelect.value as ListCustomFieldType;
        const rawOptions = optionsInput.value;

        if (!rawLabel && !rawKey && !rawOptions) {
          continue;
        }

        if (!rawLabel) {
          setError('Custom fields must have a label.');
          labelInput.focus();
          return null;
        }

        let key = rawKey;
        if (!key) {
          key = rawLabel
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        }

        if (!key) {
          setError('Custom field keys must not be empty.');
          keyInput.focus();
          return null;
        }

        const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
        if (!keyPattern.test(key)) {
          setError(
            'Custom field keys must start with a letter and contain only letters, numbers, hyphens, or underscores.',
          );
          keyInput.focus();
          return null;
        }

        const lowerKey = key.toLowerCase();
        if (seenKeys.has(lowerKey)) {
          setError('Custom field keys must be unique.');
          keyInput.focus();
          return null;
        }
        seenKeys.add(lowerKey);

        const type: ListCustomFieldType =
          rawType === 'number' ||
          rawType === 'date' ||
          rawType === 'time' ||
          rawType === 'datetime' ||
          rawType === 'select' ||
          rawType === 'checkbox' ||
          rawType === 'ref'
            ? rawType
            : 'text';

        let options: string[] | undefined;
        if (type === 'select') {
          options = rawOptions
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
          if (!options.length) {
            setError('Select fields must define at least one option.');
            optionsInput.focus();
            return null;
          }
        }

        const markdown = type === 'text' && markdownInput?.checked === true;

        result.push({
          key,
          label: rawLabel,
          type,
          ...(options ? { options } : {}),
          ...(markdown ? { markdown: true } : {}),
        });
      }

      return result;
    };

    return {
      container: section,
      getCustomFields,
    };
  }

  open(mode: 'create' | 'edit', data?: ListMetadataDialogInitialData): void {
    const listId = data?.id ?? null;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay list-metadata-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog list-metadata-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = mode === 'create' ? 'New List' : 'Edit List';
    dialog.appendChild(titleEl);

    const form = document.createElement('form');
    form.className = 'list-item-form list-metadata-form';

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

    const nameLabel = document.createElement('label');
    nameLabel.className = 'list-item-form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'list-item-form-input';
    nameInput.required = true;
    nameInput.value = data?.name ?? '';
    nameLabel.appendChild(nameInput);
    form.appendChild(nameLabel);

    const instanceSelection = this.options.getInstanceSelection?.() ?? null;
    const instanceOptions = instanceSelection?.options ?? [];
    const shouldShowInstanceSelect = instanceOptions.length > 1;
    const sourceInstanceId = data?.instanceId;
    let selectedInstanceId = data?.instanceId;

    if (shouldShowInstanceSelect) {
      const optionIds = new Set(instanceOptions.map((option) => option.id));
      if (!selectedInstanceId || !optionIds.has(selectedInstanceId)) {
        selectedInstanceId =
          instanceSelection?.preferredInstanceId ?? instanceOptions[0]?.id ?? selectedInstanceId;
      }

      const instanceRow = document.createElement('label');
      instanceRow.className = 'list-item-form-label';
      instanceRow.textContent = 'Profile';

      const instanceSelect = document.createElement('select');
      instanceSelect.className = 'list-item-form-select';
      for (const option of instanceOptions) {
        const optionEl = document.createElement('option');
        optionEl.value = option.id;
        optionEl.textContent = option.label ?? option.id;
        instanceSelect.appendChild(optionEl);
      }
      if (selectedInstanceId) {
        instanceSelect.value = selectedInstanceId;
      }
      instanceSelect.addEventListener('change', () => {
        selectedInstanceId = instanceSelect.value;
      });

      instanceRow.appendChild(instanceSelect);
      form.appendChild(instanceRow);
    }
    const descriptionLabel = document.createElement('label');
    descriptionLabel.className = 'list-item-form-label';
    descriptionLabel.textContent = 'Description';
    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'list-item-form-textarea';
    descriptionInput.value = data?.description ?? '';
    descriptionLabel.appendChild(descriptionInput);
    form.appendChild(descriptionLabel);

    const canonicalTagByLower = new Map<string, string>();
    for (const t of this.options.getAllKnownTags()) {
      const trimmed = t.trim();
      if (!trimmed || isPinnedTag(trimmed)) continue;
      const lower = trimmed.toLowerCase();
      if (!canonicalTagByLower.has(lower)) {
        canonicalTagByLower.set(lower, trimmed);
      }
    }

    const createTagChipsInput = (
      labelText: string,
      inputIdPrefix: string,
      initialTags: string[],
    ): { container: HTMLElement; getTags: () => string[] } => {
      const row = document.createElement('div');
      row.className = 'list-item-form-label';

      const label = document.createElement('label');
      label.textContent = labelText;

      const wrapper = document.createElement('div');
      wrapper.className = 'tag-chips-input';

      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'tag-chips-input-chips';

      const entryInput = document.createElement('input');
      entryInput.type = 'text';
      entryInput.className = 'tag-chips-input-field';
      entryInput.placeholder = 'Add tag…';
      entryInput.autocomplete = 'off';
      entryInput.id = `${inputIdPrefix}-${Math.random().toString(36).slice(2)}`;
      label.htmlFor = entryInput.id;

      const suggestions = document.createElement('div');
      suggestions.className = 'tag-chips-input-suggestions';

      chipsContainer.appendChild(entryInput);
      wrapper.appendChild(chipsContainer);
      wrapper.appendChild(suggestions);
      row.appendChild(label);
      row.appendChild(wrapper);

      const selectedTagsLower = new Set<string>();
      const selectedTags: string[] = [];

      const renderSelectedTags = (): void => {
        chipsContainer.querySelectorAll('.tag-chip').forEach((el) => el.remove());
        for (const tag of selectedTags) {
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.textContent = tag;
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'tag-chip-remove';
          removeBtn.tabIndex = -1;
          removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
          removeBtn.textContent = '×';
          removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const lower = tag.toLowerCase();
            if (!selectedTagsLower.has(lower)) return;
            selectedTagsLower.delete(lower);
            const idx = selectedTags.findIndex((t) => t.toLowerCase() === lower);
            if (idx >= 0) {
              selectedTags.splice(idx, 1);
            }
            renderSelectedTags();
            renderTagSuggestions();
          });
          chip.appendChild(removeBtn);
          chipsContainer.insertBefore(chip, entryInput);
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

      const renderTagSuggestions = (): void => {
        const query = entryInput.value.trim().toLowerCase();
        suggestions.innerHTML = '';
        if (!query) {
          suggestions.classList.remove('visible');
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
        const visibleMatches = matches.slice(0, 12);
        if (visibleMatches.length === 0) {
          suggestions.classList.remove('visible');
          return;
        }

        suggestions.classList.add('visible');
        for (const tag of visibleMatches) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-chip-suggestion';
          btn.tabIndex = -1;
          btn.textContent = tag;
          btn.addEventListener('click', () => {
            addTag(tag);
            entryInput.value = '';
            renderTagSuggestions();
            entryInput.focus();
          });
          suggestions.appendChild(btn);
        }
      };

      entryInput.addEventListener('input', () => {
        renderTagSuggestions();
      });

      entryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          if (entryInput.value.trim().length > 0) {
            addTagsFromText(entryInput.value);
            entryInput.value = '';
            renderTagSuggestions();
          }
          return;
        }
        if (e.key === 'Backspace' && entryInput.value.length === 0) {
          removeLastTag();
        }
      });

      entryInput.addEventListener('blur', () => {
        if (entryInput.value.trim().length > 0) {
          addTagsFromText(entryInput.value);
          entryInput.value = '';
          renderTagSuggestions();
        }
      });

      for (const tag of initialTags) {
        if (typeof tag === 'string') {
          addTag(tag);
        }
      }

      return {
        container: row,
        getTags: () => [...selectedTags],
      };
    };

    const initialTagsSource = Array.isArray(data?.tags) ? data.tags : [];
    const initialPinned = hasPinnedTag(initialTagsSource);
    const initialFavorite = data?.favorite === true;
    const initialTags = withoutPinnedTag(initialTagsSource);
    const tagsInput = createTagChipsInput('Tags', 'list-tags', initialTags);
    form.appendChild(tagsInput.container);

    const pinnedRow = document.createElement('div');
    pinnedRow.className = 'list-item-form-checkbox-row';

    const pinnedCheckbox = document.createElement('input');
    pinnedCheckbox.type = 'checkbox';
    pinnedCheckbox.id = `list-pinned-${Math.random().toString(36).slice(2)}`;
    pinnedCheckbox.className = 'list-item-form-checkbox';
    pinnedCheckbox.checked = initialPinned;

    const pinnedLabel = document.createElement('label');
    pinnedLabel.htmlFor = pinnedCheckbox.id;
    pinnedLabel.textContent = 'Pinned';

    pinnedRow.appendChild(pinnedCheckbox);
    pinnedRow.appendChild(pinnedLabel);
    form.appendChild(pinnedRow);

    const favoriteRow = document.createElement('div');
    favoriteRow.className = 'list-item-form-checkbox-row';

    const favoriteCheckbox = document.createElement('input');
    favoriteCheckbox.type = 'checkbox';
    favoriteCheckbox.id = `list-favorite-${Math.random().toString(36).slice(2)}`;
    favoriteCheckbox.className = 'list-item-form-checkbox';
    favoriteCheckbox.checked = initialFavorite;

    const favoriteLabel = document.createElement('label');
    favoriteLabel.htmlFor = favoriteCheckbox.id;
    favoriteLabel.textContent = 'Favorite';

    favoriteRow.appendChild(favoriteCheckbox);
    favoriteRow.appendChild(favoriteLabel);
    form.appendChild(favoriteRow);

    const initialDefaultTags = Array.isArray(data?.defaultTags)
      ? withoutPinnedTag(data.defaultTags)
      : [];
    const defaultTagsInput = createTagChipsInput(
      'Default tags for new items',
      'list-default-tags',
      initialDefaultTags,
    );
    form.appendChild(defaultTagsInput.container);

    const initialCustomFields = Array.isArray(data?.customFields) ? data.customFields : [];
    const customFieldsSection = this.createCustomFieldsSection(initialCustomFields, setError);
    form.appendChild(customFieldsSection.container);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    let deleteButton: HTMLButtonElement | null = null;
    if (mode === 'edit') {
      deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'confirm-dialog-button danger';
      deleteButton.textContent = 'Delete';
      buttons.appendChild(deleteButton);
    }

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';
    buttons.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'confirm-dialog-button primary';
    saveButton.textContent = mode === 'create' ? 'Create' : 'Save';
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

    if (deleteButton) {
      deleteButton.addEventListener('click', () => {
        if (!listId) {
          setError('Missing list ID.');
          return;
        }
        const currentName = nameInput.value.trim() || data?.name || 'this list';
        this.options.dialogManager.showConfirmDialog({
          title: 'Delete List',
          message: `Delete "${currentName}"? This cannot be undone.`,
          confirmText: 'Delete',
          confirmClassName: 'danger',
          keydownStopsPropagation: true,
          removeKeydownOnButtonClick: true,
          onConfirm: () => {
            void (async () => {
              setError(null);
              const ok = await this.options.deleteList(listId);
              if (!ok) {
                setError('Failed to delete list.');
                return;
              }
              closeDialog();
            })();
          },
          cancelCloseBehavior: 'remove-only',
          confirmCloseBehavior: 'remove-only',
        });
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      setError(null);

      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }

      const description = descriptionInput.value.trim();
      const tags = applyPinnedTag(tagsInput.getTags(), pinnedCheckbox.checked);
      const defaultTags = defaultTagsInput.getTags();

      const customFields = customFieldsSection.getCustomFields();
      if (!customFields) {
        return;
      }

      const payload: ListMetadataDialogPayload = {
        name,
        description,
        tags,
        favorite: favoriteCheckbox.checked,
        defaultTags,
        customFields,
        ...(selectedInstanceId ? { instanceId: selectedInstanceId } : {}),
        ...(sourceInstanceId ? { sourceInstanceId } : {}),
      };

      if (mode === 'create') {
        void (async () => {
          const ok = await this.options.createList(payload);
          if (!ok) {
            setError('Failed to create list.');
            return;
          }
          closeDialog();
        })();
        return;
      }

      if (mode === 'edit' && listId) {
        void (async () => {
          const ok = await this.options.updateList(listId, payload);
          if (!ok) {
            setError('Failed to update list.');
            return;
          }
          closeDialog();
        })();
        return;
      }

      setError('Missing list ID.');
    });
  }
}
