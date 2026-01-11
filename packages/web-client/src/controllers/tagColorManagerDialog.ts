import type { DialogManager } from './dialogManager';
import type { CollectionItemSummary } from './collectionTypes';
import {
  applyTagColorToElement,
  getStoredTagColor,
  normalizeTag,
  resolveTagColorTokenCssVar,
  resolveTagColorTokenToHex,
  setStoredTagColor,
  type TagColorToken,
} from '../utils/tagColors';

export interface TagColorManagerDialogOptions {
  dialogManager: DialogManager;
  getAvailableItems: () => CollectionItemSummary[];
  fetchListItemTags?: (listId: string) => Promise<string[]>;
  fetchAllTags?: () => Promise<string[]>;
}

const THEME_TOKENS: Array<{ token: TagColorToken; label: string }> = [
  { token: 'accent', label: 'Accent' },
  { token: 'info', label: 'Info' },
  { token: 'success', label: 'Success' },
  { token: 'warning', label: 'Warning' },
  { token: 'error', label: 'Error' },
];

async function fetchWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  const queue = tasks.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) return;
      results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

function updateRowSelectionState(rowEl: HTMLElement, tag: string): void {
  const stored = getStoredTagColor(tag);
  const swatches = rowEl.querySelectorAll<HTMLButtonElement>('.tag-color-swatch');
  for (const swatch of Array.from(swatches)) {
    const token = swatch.dataset['token'] as TagColorToken | undefined;
    const isSelected = stored?.kind === 'token' && token ? stored.token === token : false;
    swatch.classList.toggle('selected', isSelected);
  }

  const customInput = rowEl.querySelector<HTMLInputElement>('.tag-color-custom-input');
  if (customInput) {
    if (stored?.kind === 'hex') {
      customInput.value = stored.hex;
    }
  }
}

function createTagRow(tag: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tag-color-row';
  row.dataset['tag'] = tag;

  const preview = document.createElement('span');
  preview.className = 'tag-color-preview';
  preview.dataset['tag'] = tag;
  preview.textContent = tag;
  applyTagColorToElement(preview, tag);
  row.appendChild(preview);

  const label = document.createElement('div');
  label.className = 'tag-color-label';
  label.textContent = tag;
  row.appendChild(label);

  const controls = document.createElement('div');
  controls.className = 'tag-color-controls';

  const swatches = document.createElement('div');
  swatches.className = 'tag-color-swatches';

  for (const def of THEME_TOKENS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-color-swatch';
    button.dataset['token'] = def.token;
    button.title = def.label;
    button.style.backgroundColor = resolveTagColorTokenCssVar(def.token);
    button.addEventListener('click', () => {
      setStoredTagColor(tag, { kind: 'token', token: def.token });
      applyTagColorToElement(preview, tag);
      updateRowSelectionState(row, tag);
    });
    swatches.appendChild(button);
  }

  const custom = document.createElement('div');
  custom.className = 'tag-color-custom';

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.className = 'tag-color-custom-input';
  customInput.title = 'Custom color';
  const existing = getStoredTagColor(tag);
  // Show the current color in the picker: hex if custom, resolved token color, or default
  let initialColor = '#3b82f6';
  if (existing?.kind === 'hex') {
    initialColor = existing.hex;
  } else if (existing?.kind === 'token') {
    initialColor = resolveTagColorTokenToHex(existing.token) ?? '#3b82f6';
  }
  customInput.value = initialColor;
  customInput.addEventListener('input', () => {
    const hex = customInput.value;
    if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      setStoredTagColor(tag, { kind: 'hex', hex });
      applyTagColorToElement(preview, tag);
      updateRowSelectionState(row, tag);
    }
  });
  custom.appendChild(customInput);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'tag-color-clear';
  clearButton.textContent = 'Clear';
  clearButton.addEventListener('click', () => {
    setStoredTagColor(tag, null);
    preview.style.removeProperty('--tag-bg');
    preview.style.removeProperty('--tag-fg');
    updateRowSelectionState(row, tag);
  });
  custom.appendChild(clearButton);

  controls.appendChild(swatches);
  controls.appendChild(custom);
  row.appendChild(controls);

  updateRowSelectionState(row, tag);
  return row;
}

export class TagColorManagerDialog {
  private overlayEl: HTMLElement | null = null;

  constructor(private readonly options: TagColorManagerDialogOptions) {}

  open(): void {
    if (this.overlayEl) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay tag-color-manager-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog tag-color-manager-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = 'Tag colors';
    dialog.appendChild(titleEl);

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'confirm-dialog-message';
    subtitleEl.textContent = 'Customize tag colors across notes and lists.';
    dialog.appendChild(subtitleEl);

    const controlsRow = document.createElement('div');
    controlsRow.className = 'tag-color-manager-controls';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'tag-color-manager-search';
    searchInput.placeholder = 'Filter tags…';
    searchInput.autocomplete = 'off';
    controlsRow.appendChild(searchInput);

    dialog.appendChild(controlsRow);

    const list = document.createElement('div');
    list.className = 'tag-color-list';
    dialog.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'confirm-dialog-buttons';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'confirm-dialog-button cancel';
    closeButton.textContent = 'Done';
    footer.appendChild(closeButton);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    this.overlayEl = overlay;
    this.options.dialogManager.hasOpenDialog = true;

    const close = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('assistant:tag-colors-updated', onColorsUpdated);
      this.options.dialogManager.hasOpenDialog = false;
      this.overlayEl = null;
    };

    closeButton.addEventListener('click', () => close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    const renderTags = (tags: string[]) => {
      list.innerHTML = '';
      const filtered = tags.filter((t) => t.includes(normalizeTag(searchInput.value)));
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tag-color-empty';
        empty.textContent = 'No tags found';
        list.appendChild(empty);
        return;
      }
      for (const t of filtered) {
        list.appendChild(createTagRow(t));
      }
    };

    const tagSet = new Set<string>();
    for (const item of this.options.getAvailableItems()) {
      for (const tag of item.tags ?? []) {
        const normalized = normalizeTag(tag);
        if (normalized) tagSet.add(normalized);
      }
    }
    renderTags(Array.from(tagSet).sort());

    const onColorsUpdated = () => {
      const rows = list.querySelectorAll<HTMLElement>('.tag-color-row[data-tag]');
      for (const row of Array.from(rows)) {
        const tag = row.dataset['tag'];
        if (!tag) continue;
        const preview = row.querySelector<HTMLElement>('.tag-color-preview');
        if (preview) {
          applyTagColorToElement(preview, tag);
        }
        updateRowSelectionState(row, tag);
      }
    };
    window.addEventListener('assistant:tag-colors-updated', onColorsUpdated);

    searchInput.addEventListener('input', () => {
      renderTags(Array.from(tagSet).sort());
    });

    // If fetchAllTags is provided, use it to load all tags from the system
    if (this.options.fetchAllTags) {
      const loading = document.createElement('div');
      loading.className = 'tag-color-loading';
      loading.textContent = 'Loading all tags…';
      dialog.insertBefore(loading, list);

      void this.options.fetchAllTags().then((tags) => {
        for (const t of tags) {
          const normalized = normalizeTag(t);
          if (normalized) tagSet.add(normalized);
        }
        loading.remove();
        renderTags(Array.from(tagSet).sort());
      });
    } else {
      // Legacy path: fetch list item tags for lists from getAvailableItems
      const listIds = this.options
        .getAvailableItems()
        .filter((a) => a.type === 'list')
        .map((a) => a.id)
        .filter((id) => id.trim().length > 0);

      if (listIds.length > 0 && this.options.fetchListItemTags) {
        const loading = document.createElement('div');
        loading.className = 'tag-color-loading';
        loading.textContent = 'Scanning list item tags…';
        dialog.insertBefore(loading, list);

        const fetchTags = this.options.fetchListItemTags;
        const tasks = listIds.map((id) => () => fetchTags(id));
        void fetchWithConcurrency(tasks, 4).then((results) => {
          for (const tags of results) {
            for (const t of tags) {
              tagSet.add(t);
            }
          }
          loading.remove();
          renderTags(Array.from(tagSet).sort());
        });
      }
    }

    searchInput.focus();
    searchInput.select();
  }
}
