import type { DialogManager } from './dialogManager';
import type { ListCustomFieldDefinition } from './listCustomFields';
import type { ListPanelItem } from './listPanelController';
import { applyTagColorToElement, normalizeTag } from '../utils/tagColors';
import { MarkdownViewerController } from './markdownViewerController';
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
  /** Override initial editor mode for this dialog */
  initialMode?: ListItemEditorMode;
}

type ListItemEditorMode = 'quick' | 'review';

const LIST_ITEM_EDITOR_DEFAULT_MODE_STORAGE_KEY = 'aiAssistantListItemEditorDefaultMode';

const loadDefaultEditMode = (): ListItemEditorMode => {
  try {
    const stored = window.localStorage?.getItem(LIST_ITEM_EDITOR_DEFAULT_MODE_STORAGE_KEY);
    if (stored === 'review') {
      return 'review';
    }
  } catch {
    // Ignore localStorage errors.
  }
  return 'quick';
};

export class ListItemEditorDialog {
  constructor(private readonly options: ListItemEditorDialogOptions) {}

  private createCustomFieldsSection(
    definitions: ListCustomFieldDefinition[],
    initialValues: Record<string, unknown>,
  ): {
    container: HTMLElement | null;
    getValues: () => Record<string, unknown>;
    fields: Array<{
      definition: ListCustomFieldDefinition;
      input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      row: HTMLElement;
    }>;
  } {
    const normalized = Array.isArray(definitions) ? definitions : [];
    if (normalized.length === 0) {
      return {
        container: null,
        getValues: () => ({}),
        fields: [],
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
      input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      row: HTMLElement;
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

      const row = document.createElement('label');
      row.className = 'list-item-form-label list-item-custom-field-row';

      const labelText = document.createElement('span');
      labelText.className = 'list-item-custom-field-label-text';
      labelText.textContent = label;

      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
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
      } else if (type === 'text' && def.markdown === true) {
        const textarea = document.createElement('textarea');
        textarea.className = 'list-item-form-textarea';
        textarea.rows = 3;
        input = textarea;
        row.classList.add('list-item-custom-field-row--wide');
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'list-item-form-input';
      }

      const id = `list-item-custom-field-${key}-${Math.random().toString(36).slice(2)}`;
      input.id = id;
      if (type === 'checkbox') {
        row.classList.add('list-item-custom-field-row--checkbox');
        row.appendChild(input);
        row.appendChild(labelText);
      } else {
        row.appendChild(labelText);
        row.appendChild(input);
      }

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

      container.appendChild(row);

      fieldInputs.push({ definition: def, input, row });
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
      fields: fieldInputs,
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

    let editMode: ListItemEditorMode = openOptions?.initialMode ?? loadDefaultEditMode();

    const modeToggle = document.createElement('div');
    modeToggle.className = 'list-item-mode-toggle';

    const modeToggleLabel = document.createElement('span');
    modeToggleLabel.className = 'list-item-mode-toggle-label';
    modeToggleLabel.textContent = 'Mode';
    modeToggle.appendChild(modeToggleLabel);

    const modeToggleButtons = document.createElement('div');
    modeToggleButtons.className = 'list-item-mode-toggle-buttons';

    const quickModeButton = document.createElement('button');
    quickModeButton.type = 'button';
    quickModeButton.className = 'list-item-mode-toggle-button';
    quickModeButton.textContent = 'Edit';

    const reviewModeButton = document.createElement('button');
    reviewModeButton.type = 'button';
    reviewModeButton.className = 'list-item-mode-toggle-button';
    reviewModeButton.textContent = 'Review';

    modeToggleButtons.appendChild(quickModeButton);
    modeToggleButtons.appendChild(reviewModeButton);
    modeToggle.appendChild(modeToggleButtons);
    dialog.appendChild(modeToggle);

    const form = document.createElement('form');
    form.className = 'list-item-form';

    const quickEditContainer = document.createElement('div');
    quickEditContainer.className = 'list-item-form-fields';

    const reviewContainer = document.createElement('div');
    reviewContainer.className = 'list-item-review';

    const titleLabel = document.createElement('label');
    titleLabel.className = 'list-item-form-label';
    const titleLabelText = document.createElement('span');
    titleLabelText.className = 'list-item-form-label-text';
    titleLabelText.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'list-item-form-input';
    titleInput.value = item?.title ?? '';
    titleInput.required = true;
    titleLabel.appendChild(titleLabelText);
    titleLabel.appendChild(titleInput);
    quickEditContainer.appendChild(titleLabel);

    const urlLabel = document.createElement('label');
    urlLabel.className = 'list-item-form-label';
    const urlLabelText = document.createElement('span');
    urlLabelText.className = 'list-item-form-label-text';
    urlLabelText.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'list-item-form-input';
    urlInput.value = item?.url ?? '';
    urlLabel.appendChild(urlLabelText);
    urlLabel.appendChild(urlInput);
    quickEditContainer.appendChild(urlLabel);

    const notesLabel = document.createElement('label');
    notesLabel.className = 'list-item-form-label';
    const notesLabelText = document.createElement('span');
    notesLabelText.className = 'list-item-form-label-text';
    notesLabelText.textContent = 'Notes';
    const notesInput = document.createElement('textarea');
    notesInput.className = 'list-item-form-textarea';
    notesInput.value = item?.notes ?? '';
    notesLabel.appendChild(notesLabelText);
    notesLabel.appendChild(notesInput);
    quickEditContainer.appendChild(notesLabel);

    const tagsRow = document.createElement('div');
    tagsRow.className = 'list-item-form-label';

    const tagsLabel = document.createElement('label');
    tagsLabel.className = 'list-item-form-label-text list-item-tags-label';
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
    quickEditContainer.appendChild(tagsRow);

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
    pinnedLabel.className = 'list-item-form-checkbox-label';
    pinnedLabel.textContent = 'Pinned';

    pinnedRow.appendChild(pinnedCheckbox);
    pinnedRow.appendChild(pinnedLabel);
    quickEditContainer.appendChild(pinnedRow);

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
      insertAtTopLabel.className = 'list-item-form-checkbox-label';
      insertAtTopLabel.textContent = 'Insert at top';

      insertAtTopRow.appendChild(insertAtTopCheckbox);
      insertAtTopRow.appendChild(insertAtTopLabel);
      quickEditContainer.appendChild(insertAtTopRow);
    }

    const customFieldsSection = this.createCustomFieldsSection(
      openOptions?.customFields ?? [],
      openOptions?.initialCustomFieldValues ?? {},
    );
    if (customFieldsSection.container) {
      quickEditContainer.appendChild(customFieldsSection.container);
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
    let renderReviewTags = () => {};
    let renderReviewDisplays = () => {};

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
      renderReviewTags();
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

    type ReviewFieldState = {
      field: HTMLElement;
      editButton: HTMLButtonElement;
      editorRow: HTMLElement;
      editorSlot: HTMLElement;
      placeholder: HTMLElement;
      display: HTMLElement;
      renderValue: () => void;
      focusTarget?: HTMLElement;
      replaceDisplay?: boolean;
      cancelButton?: HTMLButtonElement;
      snapshotValue?: string;
    };

    const reviewFields: ReviewFieldState[] = [];

    const createEditorPlaceholder = (editorRow: HTMLElement): HTMLElement => {
      const placeholder = document.createElement('div');
      placeholder.className = 'list-item-review-placeholder';
      placeholder.hidden = true;
      const parent = editorRow.parentElement;
      if (parent) {
        parent.insertBefore(placeholder, editorRow);
      }
      return placeholder;
    };

    const restoreEditorRow = (field: ReviewFieldState): void => {
      const parent = field.placeholder.parentElement;
      if (parent) {
        parent.insertBefore(field.editorRow, field.placeholder);
      }
      if (field.replaceDisplay) {
        field.display.hidden = false;
      }
      if (field.cancelButton) {
        field.cancelButton.hidden = true;
      }
      delete field.snapshotValue;
      field.editorRow.classList.remove('list-item-review-inline-editor');
      field.field.classList.remove('list-item-review-field--editing');
      field.editButton.textContent = 'Edit';
    };

    const toggleReviewField = (field: ReviewFieldState): void => {
      const isEditing = field.field.classList.contains('list-item-review-field--editing');
      if (isEditing) {
        restoreEditorRow(field);
        field.renderValue();
        return;
      }
      const displayHeight = field.display.offsetHeight;
      field.editorRow.classList.add('list-item-review-inline-editor');
      field.editorSlot.appendChild(field.editorRow);
      if (field.replaceDisplay) {
        field.display.hidden = true;
      }
      if (field.cancelButton) {
        field.cancelButton.hidden = false;
      }
      if (
        field.replaceDisplay &&
        (field.focusTarget instanceof HTMLInputElement ||
          field.focusTarget instanceof HTMLTextAreaElement)
      ) {
        field.snapshotValue = field.focusTarget.value;
        if (field.focusTarget instanceof HTMLTextAreaElement && displayHeight > 0) {
          const targetHeight = Math.max(displayHeight, field.focusTarget.scrollHeight, 60);
          field.focusTarget.style.minHeight = `${targetHeight}px`;
        }
      }
      field.field.classList.add('list-item-review-field--editing');
      field.editButton.textContent = 'Done';
      field.focusTarget?.focus();
    };

    const closeAllReviewEditors = (): void => {
      for (const field of reviewFields) {
        if (field.field.classList.contains('list-item-review-field--editing')) {
          restoreEditorRow(field);
        }
      }
    };

    const setReviewValue = (container: HTMLElement, value: string): void => {
      const trimmed = value.trim();
      container.classList.toggle('list-item-review-empty', trimmed.length === 0);
      container.textContent = trimmed.length === 0 ? 'Not set' : trimmed;
    };

    const markdownViewers = new WeakMap<HTMLElement, MarkdownViewerController>();

    const setReviewMarkdown = (container: HTMLElement, value: string): void => {
      const trimmed = value.trim();
      if (!trimmed) {
        const existingViewer = markdownViewers.get(container);
        if (existingViewer) {
          existingViewer.clear();
        }
        container.classList.add('list-item-review-empty');
        container.textContent = 'Not set';
        return;
      }

      container.classList.remove('list-item-review-empty');
      let viewer = markdownViewers.get(container);
      if (!viewer) {
        viewer = new MarkdownViewerController({
          container,
          contentClass: 'list-item-review-markdown',
        });
        markdownViewers.set(container, viewer);
      }
      viewer.render(trimmed);
    };

    const createReviewField = (
      label: string,
      editorRow: HTMLElement,
      renderValue: (container: HTMLElement) => void,
      section: HTMLElement,
      focusTarget?: HTMLElement,
      replaceDisplay?: boolean,
    ): ReviewFieldState => {
      const field = document.createElement('div');
      field.className = 'list-item-review-field';

      const header = document.createElement('div');
      header.className = 'list-item-review-field-header';

      const labelEl = document.createElement('div');
      labelEl.className = 'list-item-review-field-label';
      labelEl.textContent = label;

      const actions = document.createElement('div');
      actions.className = 'list-item-review-field-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'list-item-review-edit';
      editButton.textContent = 'Edit';
      editButton.setAttribute('aria-label', `Edit ${label}`);
      actions.appendChild(editButton);

      let cancelButton: HTMLButtonElement | undefined;
      if (replaceDisplay) {
        cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'list-item-review-cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.hidden = true;
        cancelButton.setAttribute('aria-label', `Cancel ${label} edits`);
        actions.appendChild(cancelButton);
      }

      header.appendChild(labelEl);
      header.appendChild(actions);

      const display = document.createElement('div');
      display.className = 'list-item-review-value';

      const editorSlot = document.createElement('div');
      editorSlot.className = 'list-item-review-editor';

      field.appendChild(header);
      field.appendChild(display);
      field.appendChild(editorSlot);
      section.appendChild(field);

      const placeholder = createEditorPlaceholder(editorRow);
      const fieldState: ReviewFieldState = {
        field,
        editButton,
        editorRow,
        editorSlot,
        placeholder,
        display,
        renderValue: () => renderValue(display),
      };
      if (focusTarget) {
        fieldState.focusTarget = focusTarget;
      }
      if (replaceDisplay) {
        fieldState.replaceDisplay = replaceDisplay;
      }
      if (cancelButton) {
        fieldState.cancelButton = cancelButton;
        cancelButton.addEventListener('click', (event) => {
          event.preventDefault();
          if (
            fieldState.replaceDisplay &&
            (fieldState.focusTarget instanceof HTMLInputElement ||
              fieldState.focusTarget instanceof HTMLTextAreaElement)
          ) {
            fieldState.focusTarget.value = fieldState.snapshotValue ?? '';
          }
          restoreEditorRow(fieldState);
          fieldState.renderValue();
        });
      }
      editButton.addEventListener('click', () => {
        toggleReviewField(fieldState);
      });
      reviewFields.push(fieldState);
      return fieldState;
    };

    const reviewHeader = document.createElement('div');
    reviewHeader.className = 'list-item-review-section list-item-review-header';

    const reviewMain = document.createElement('div');
    reviewMain.className = 'list-item-review-section';

    const reviewCustomFields = document.createElement('div');
    reviewCustomFields.className = 'list-item-review-section list-item-review-custom-fields';

    reviewContainer.appendChild(reviewHeader);
    reviewContainer.appendChild(reviewMain);

    createReviewField(
      'Title',
      titleLabel,
      (container) => {
        setReviewValue(container, titleInput.value);
      },
      reviewHeader,
      titleInput,
      true,
    );

    createReviewField(
      'URL',
      urlLabel,
      (container) => {
        const raw = urlInput.value.trim();
        container.innerHTML = '';
        if (!raw) {
          container.classList.add('list-item-review-empty');
          container.textContent = 'Not set';
          return;
        }
        container.classList.remove('list-item-review-empty');
        const link = document.createElement('a');
        link.href = raw;
        link.textContent = raw;
        link.target = '_blank';
        link.rel = 'noreferrer';
        container.appendChild(link);
      },
      reviewHeader,
      urlInput,
      true,
    );

    const tagsField = createReviewField(
      'Tags',
      tagInputWrap,
      (container) => {
        container.innerHTML = '';
        if (selectedTags.length === 0) {
          container.classList.add('list-item-review-empty');
          container.textContent = 'Not set';
          return;
        }
        container.classList.remove('list-item-review-empty');
        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'list-item-review-tags';
        for (const tag of selectedTags) {
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.textContent = tag;
          chip.dataset['tag'] = normalizeTag(tag);
          applyTagColorToElement(chip, tag);
          tagsWrap.appendChild(chip);
        }
        container.appendChild(tagsWrap);
      },
      reviewHeader,
      tagEntryInput,
    );

    createReviewField(
      'Pinned',
      pinnedRow,
      (container) => {
        container.classList.remove('list-item-review-empty');
        container.textContent = pinnedCheckbox.checked ? 'Pinned' : 'Not pinned';
      },
      reviewHeader,
      pinnedCheckbox,
    );

    if (insertAtTopCheckbox) {
      createReviewField(
        'Insert at top',
        insertAtTopCheckbox.parentElement ?? insertAtTopCheckbox,
        (container) => {
          container.classList.remove('list-item-review-empty');
          container.textContent = insertAtTopCheckbox.checked ? 'Yes' : 'No';
        },
        reviewHeader,
        insertAtTopCheckbox,
      );
    }

    createReviewField(
      'Notes',
      notesLabel,
      (container) => {
        setReviewMarkdown(container, notesInput.value);
      },
      reviewMain,
      notesInput,
      true,
    );

    if (customFieldsSection.fields.length > 0) {
      const customTitle = document.createElement('h4');
      customTitle.className = 'list-item-review-section-title';
      customTitle.textContent = 'Custom fields';
      reviewCustomFields.appendChild(customTitle);

      const customFieldsGrid = document.createElement('div');
      customFieldsGrid.className = 'list-item-review-custom-fields-grid';
      reviewCustomFields.appendChild(customFieldsGrid);
      reviewContainer.appendChild(reviewCustomFields);

      for (const field of customFieldsSection.fields) {
        const { definition, input, row } = field;
        const label = definition.label;
        const isMarkdownField = definition.markdown === true && definition.type === 'text';
        const replaceDisplay =
          input instanceof HTMLTextAreaElement ||
          (input instanceof HTMLInputElement && definition.type === 'text') ||
          isMarkdownField;
        const fieldState = createReviewField(
          label,
          row,
          (container) => {
            const value = (input instanceof HTMLInputElement ||
            input instanceof HTMLTextAreaElement ||
            input instanceof HTMLSelectElement)
              ? input.value
              : '';
            if (definition.type === 'checkbox') {
              const checked =
                input instanceof HTMLInputElement ? input.checked === true : false;
              container.classList.remove('list-item-review-empty');
              container.textContent = checked ? 'Yes' : 'Not set';
              return;
            }
            if (definition.markdown === true && definition.type === 'text') {
              setReviewMarkdown(container, value);
              return;
            }
            setReviewValue(container, value);
          },
          customFieldsGrid,
          input,
          replaceDisplay,
        );
        if (isMarkdownField) {
          fieldState.field.classList.add('list-item-review-field--wide');
        }
      }
    }

    const metadataEntries: Array<{ label: string; value: string }> = [];
    const addMetadata = (label: string, raw?: string | null) => {
      if (!raw) return;
      const parsed = new Date(raw);
      const formatted = Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
      metadataEntries.push({ label, value: formatted });
    };
    addMetadata('Added', item?.addedAt ?? null);
    addMetadata('Updated', item?.updatedAt ?? null);
    addMetadata('Touched', item?.touchedAt ?? null);
    if (item?.completedAt) {
      addMetadata('Completed', item.completedAt);
    } else if (item?.completed) {
      metadataEntries.push({ label: 'Completed', value: 'Yes' });
    }

    if (metadataEntries.length > 0) {
      const metadataSection = document.createElement('div');
      metadataSection.className = 'list-item-review-section list-item-review-metadata';
      const metadataTitle = document.createElement('h4');
      metadataTitle.className = 'list-item-review-section-title';
      metadataTitle.textContent = 'Metadata';
      metadataSection.appendChild(metadataTitle);

      const metadataGrid = document.createElement('div');
      metadataGrid.className = 'list-item-review-metadata-grid';
      for (const entry of metadataEntries) {
        const row = document.createElement('div');
        row.className = 'list-item-review-metadata-row';
        const label = document.createElement('span');
        label.className = 'list-item-review-metadata-label';
        label.textContent = entry.label;
        const value = document.createElement('span');
        value.className = 'list-item-review-metadata-value';
        value.textContent = entry.value;
        row.appendChild(label);
        row.appendChild(value);
        metadataGrid.appendChild(row);
      }
      metadataSection.appendChild(metadataGrid);
      reviewContainer.appendChild(metadataSection);
    }

    renderReviewTags = () => {
      tagsField.renderValue();
    };

    renderReviewDisplays = () => {
      for (const field of reviewFields) {
        field.renderValue();
      }
    };

    renderReviewDisplays();

    const attachReviewListeners = (
      input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    ): void => {
      input.addEventListener('input', () => {
        renderReviewDisplays();
      });
      input.addEventListener('change', () => {
        renderReviewDisplays();
      });
    };

    attachReviewListeners(titleInput);
    attachReviewListeners(urlInput);
    attachReviewListeners(notesInput);
    attachReviewListeners(pinnedCheckbox);
    if (insertAtTopCheckbox) {
      attachReviewListeners(insertAtTopCheckbox);
    }
    for (const field of customFieldsSection.fields) {
      attachReviewListeners(field.input);
    }

    const updateModeToggle = (): void => {
      const isQuick = editMode === 'quick';
      quickModeButton.classList.toggle('active', isQuick);
      reviewModeButton.classList.toggle('active', !isQuick);
      quickModeButton.setAttribute('aria-pressed', isQuick ? 'true' : 'false');
      reviewModeButton.setAttribute('aria-pressed', isQuick ? 'false' : 'true');
    };

    const applyMode = (modeValue: ListItemEditorMode): void => {
      editMode = modeValue;
      dialog.classList.toggle('list-item-dialog--review', editMode === 'review');
      overlay.classList.toggle('list-item-dialog-overlay--review', editMode === 'review');
      quickEditContainer.hidden = editMode === 'review';
      reviewContainer.hidden = editMode !== 'review';
      if (editMode === 'quick') {
        closeAllReviewEditors();
        titleInput.focus();
      } else {
        renderReviewDisplays();
        const firstEditButton = reviewContainer.querySelector<HTMLButtonElement>(
          '.list-item-review-edit',
        );
        firstEditButton?.focus();
      }
      updateModeToggle();
    };

    quickModeButton.addEventListener('click', () => {
      applyMode('quick');
    });

    reviewModeButton.addEventListener('click', () => {
      applyMode('review');
    });

    applyMode(editMode);

    form.appendChild(quickEditContainer);
    form.appendChild(reviewContainer);

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
    const getFocusableElements = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelectors)).filter((el) => {
        if (el.hasAttribute('disabled')) {
          return false;
        }
        if (el.closest('[hidden]')) {
          return false;
        }
        return el.getClientRects().length > 0;
      });

    if (editMode === 'review') {
      const firstEditButton = reviewContainer.querySelector<HTMLButtonElement>(
        '.list-item-review-edit',
      );
      firstEditButton?.focus();
    } else {
      titleInput.focus();
    }

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
        const focusableElements = getFocusableElements();
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
