import type { DialogManager } from './dialogManager';
import type { GlobalTagScope } from '../utils/globalTagScope';
import { applyTagColorToElement, normalizeTag } from '../utils/tagColors';

export interface GlobalTagScopeDialogOptions {
  dialogManager: DialogManager;
  getCurrentScope: () => GlobalTagScope;
  setScope: (scope: GlobalTagScope) => void;
  fetchAllTags?: () => Promise<string[]>;
}

type TagInputController = {
  container: HTMLElement;
  getTags: () => string[];
  setAvailableTags: (tags: string[]) => void;
  clear: () => void;
};

export class GlobalTagScopeDialog {
  private isOpen = false;
  private cachedTags: string[] | null = null;
  private tagFetchInFlight: Promise<string[]> | null = null;

  constructor(private readonly options: GlobalTagScopeDialogOptions) {}

  open(): void {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;

    const current = this.options.getCurrentScope();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay global-tag-scope-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog global-tag-scope-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = 'Global Tag Scope';
    dialog.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'global-tag-scope-body';

    const helper = document.createElement('p');
    helper.className = 'global-tag-scope-help';
    helper.textContent =
      'Applies to panels and search in this window. Included tags are added to new notes, lists, and list items.';
    body.appendChild(helper);

    const includeInput = this.createTagInput('Include tags', 'global-tag-scope-include', current.include);
    const excludeInput = this.createTagInput('Exclude tags', 'global-tag-scope-exclude', current.exclude);
    body.appendChild(includeInput.container);
    body.appendChild(excludeInput.container);

    const toggleRow = document.createElement('label');
    toggleRow.className = 'global-tag-scope-toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = current.includeListsWithMatchingItems;
    const toggleLabel = document.createElement('span');
    toggleLabel.textContent = 'Include lists with matching items';
    toggleRow.appendChild(toggleInput);
    toggleRow.appendChild(toggleLabel);
    body.appendChild(toggleRow);

    const untaggedRow = document.createElement('label');
    untaggedRow.className = 'global-tag-scope-toggle';
    const untaggedInput = document.createElement('input');
    untaggedInput.type = 'checkbox';
    untaggedInput.checked = current.includeUntagged;
    const untaggedLabel = document.createElement('span');
    untaggedLabel.textContent = 'Include untagged items';
    untaggedRow.appendChild(untaggedInput);
    untaggedRow.appendChild(untaggedLabel);
    body.appendChild(untaggedRow);

    const statusRow = document.createElement('div');
    statusRow.className = 'global-tag-scope-status';
    statusRow.textContent = 'Loading tags…';
    statusRow.style.display = 'none';
    body.appendChild(statusRow);

    dialog.appendChild(body);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'confirm-dialog-button cancel';
    clearButton.textContent = 'Clear';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'confirm-dialog-button primary';
    saveButton.textContent = 'Apply';

    buttons.appendChild(clearButton);
    buttons.appendChild(cancelButton);
    buttons.appendChild(saveButton);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.options.dialogManager.hasOpenDialog = true;

    const closeDialog = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', handleKeyDown);
      this.options.dialogManager.hasOpenDialog = false;
      this.isOpen = false;
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeDialog();
      }
    });

    clearButton.addEventListener('click', () => {
      includeInput.clear();
      excludeInput.clear();
      this.options.setScope({
        include: [],
        exclude: [],
        includeListsWithMatchingItems: toggleInput.checked,
        includeUntagged: untaggedInput.checked,
      });
      closeDialog();
    });

    cancelButton.addEventListener('click', closeDialog);

    saveButton.addEventListener('click', () => {
      this.options.setScope({
        include: includeInput.getTags(),
        exclude: excludeInput.getTags(),
        includeListsWithMatchingItems: toggleInput.checked,
        includeUntagged: untaggedInput.checked,
      });
      closeDialog();
    });

    const updateAvailableTags = (tags: string[]): void => {
      includeInput.setAvailableTags(tags);
      excludeInput.setAvailableTags(tags);
    };

    if (this.cachedTags) {
      updateAvailableTags(this.cachedTags);
    } else if (this.options.fetchAllTags) {
      statusRow.style.display = '';
      const fetchPromise = this.tagFetchInFlight ?? this.options.fetchAllTags();
      this.tagFetchInFlight = fetchPromise;
      fetchPromise
        .then((tags) => {
          this.cachedTags = tags;
          updateAvailableTags(tags);
        })
        .catch(() => {
          statusRow.textContent = 'Failed to load tags.';
        })
        .finally(() => {
          statusRow.style.display = 'none';
          this.tagFetchInFlight = null;
        });
    }

    const firstInput = dialog.querySelector<HTMLInputElement>('.tag-chips-input-field');
    firstInput?.focus();
  }

  private createTagInput(
    labelText: string,
    inputIdPrefix: string,
    initialTags: string[],
  ): TagInputController {
    const container = document.createElement('div');
    container.className = 'global-tag-scope-section';

    const label = document.createElement('label');
    label.className = 'global-tag-scope-label';
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
    container.appendChild(label);
    container.appendChild(wrapper);

    let availableTags: string[] = [];
    const selectedTagsLower = new Set<string>();
    const selectedTags: string[] = [];

    const renderSelectedTags = (): void => {
      chipsContainer.querySelectorAll('.tag-chip').forEach((el) => el.remove());
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
        removeBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          removeTag(tag);
        });
        chip.appendChild(removeBtn);
        chipsContainer.insertBefore(chip, entryInput);
      }
    };

    const removeTag = (tag: string): void => {
      const lower = tag.toLowerCase();
      if (!selectedTagsLower.has(lower)) {
        return;
      }
      selectedTagsLower.delete(lower);
      const idx = selectedTags.findIndex((value) => value.toLowerCase() === lower);
      if (idx >= 0) {
        selectedTags.splice(idx, 1);
      }
      renderSelectedTags();
      renderTagSuggestions();
    };

    const addTag = (raw: string): void => {
      const trimmed = raw.trim().replace(/^@+/, '');
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (selectedTagsLower.has(lower)) return;
      const canonical =
        availableTags.find((t) => t.toLowerCase() === lower) ?? trimmed;
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
      for (const tag of availableTags) {
        const lower = tag.toLowerCase();
        if (selectedTagsLower.has(lower)) continue;
        if (lower.startsWith(query)) {
          matches.push(tag);
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
        applyTagColorToElement(btn, tag);
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

    entryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        if (entryInput.value.trim().length > 0) {
          addTagsFromText(entryInput.value);
          entryInput.value = '';
          renderTagSuggestions();
        }
        return;
      }
      if (event.key === 'Backspace' && entryInput.value.length === 0) {
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
      container,
      getTags: () => [...selectedTags],
      setAvailableTags: (tags: string[]) => {
        availableTags = tags.slice();
        renderTagSuggestions();
      },
      clear: () => {
        selectedTagsLower.clear();
        selectedTags.length = 0;
        renderSelectedTags();
        renderTagSuggestions();
      },
    };
  }
}
