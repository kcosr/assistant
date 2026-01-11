import type { CollectionDropdownGroupMeta } from './collectionDropdownListRenderer';
import type { CollectionDropdownItemFocusController } from './collectionDropdownItemFocusController';
import type { CollectionTagFilterController } from './collectionTagFilterController';

export interface CollectionDropdownFilterControllerOptions {
  getGroupsMeta: () => CollectionDropdownGroupMeta[];
  getListEl: () => HTMLElement | null;
  getTotalAvailableItemCount: () => number;
  tagController: CollectionTagFilterController;
  itemFocusController: CollectionDropdownItemFocusController;
}

export class CollectionDropdownFilterController {
  constructor(private readonly options: CollectionDropdownFilterControllerOptions) {}

  filter(query: string): void {
    const { tagController, itemFocusController } = this.options;

    const {
      includeTags: queryIncludeTags,
      excludeTags: queryExcludeTags,
      text,
      partialTag,
      partialTagIsExcluded,
    } = tagController.parseSearchQuery(query);

    const allIncludeTagFilters = [...tagController.getActiveTagFilters(), ...queryIncludeTags];
    const allExcludeTagFilters = [
      ...tagController.getActiveExcludedTagFilters(),
      ...queryExcludeTags,
    ];

    const lowerText = text.trim().toLowerCase();
    const hasTextQuery = lowerText.length > 0;
    const hasIncludeTagFilters = allIncludeTagFilters.length > 0;
    const hasExcludeTagFilters = allExcludeTagFilters.length > 0;
    const hasPartialTag = partialTag !== null && partialTag.length > 0;

    tagController.updateTagSuggestions(partialTag, partialTagIsExcluded);

    const counts: number[] = [];
    const groups = this.options.getGroupsMeta();

    groups.forEach((gm, gi) => {
      let visibleInGroup = 0;

      gm.items.forEach((item) => {
        const datasetText = item.dataset['searchText'];
        const name = datasetText ? datasetText : (item.textContent || '').toLowerCase();
        const itemTags = (item.dataset['tags'] || '').split(',').filter((t) => t.length > 0);
        const collectionTags = (item.dataset['collectionTags'] ?? item.dataset['tags'] ?? '')
          .split(',')
          .filter((t) => t.length > 0);

        let excludedByItem = false;
        if (hasExcludeTagFilters) {
          excludedByItem = allExcludeTagFilters.some((t) => collectionTags.includes(t));
        }

        let tagMatch = true;
        if (hasIncludeTagFilters) {
          for (const filterTag of allIncludeTagFilters) {
            if (!itemTags.includes(filterTag)) {
              tagMatch = false;
              break;
            }
          }
        }

        let partialTagMatch = true;
        if (hasPartialTag && partialTag) {
          const tagsToCheck = partialTagIsExcluded ? collectionTags : itemTags;
          partialTagMatch = tagsToCheck.some((t) => t.startsWith(partialTag));
        }

        const textMatch = !hasTextQuery || name.includes(lowerText);

        const hit = !excludedByItem && tagMatch && partialTagMatch && textMatch;
        item.style.display = hit ? '' : 'none';
        if (hit) visibleInGroup++;
      });

      gm.header.style.display = visibleInGroup > 0 ? '' : 'none';
      counts[gi] = visibleInGroup;
    });

    groups.forEach((gm, gi) => {
      if (!gm.divider) return;
      const anyAfter = counts.slice(gi + 1).some((c) => c > 0);
      const currentCount = counts[gi] ?? 0;
      gm.divider.style.display = currentCount > 0 && anyAfter ? '' : 'none';
    });

    const list = this.options.getListEl();
    if (list) {
      let emptyEl = list.querySelector('.collection-search-dropdown-empty');
      const totalVisible = counts.reduce((sum, c) => sum + c, 0);
      if (totalVisible === 0) {
        if (!emptyEl) {
          emptyEl = document.createElement('div');
          emptyEl.className = 'collection-search-dropdown-empty';
          emptyEl.textContent =
            this.options.getTotalAvailableItemCount() === 0
              ? 'No items available'
              : 'No matching items';
          list.appendChild(emptyEl);
        } else {
          (emptyEl as HTMLElement).style.display = '';
        }
      } else if (emptyEl) {
        (emptyEl as HTMLElement).style.display = 'none';
      }
    }

    if (!tagController.isSuggestionsMode && list) {
      list
        .querySelectorAll('.collection-search-dropdown-item.focused')
        .forEach((el) => el.classList.remove('focused'));

      const totalVisible = counts.reduce((sum, c) => sum + c, 0);
      if (totalVisible === 1) {
        const singleItem = itemFocusController.getVisibleItems()[0];
        if (singleItem) {
          singleItem.classList.add('focused');
        }
      }
    }
  }
}
