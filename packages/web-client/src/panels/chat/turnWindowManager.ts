const TURN_WINDOWING_THRESHOLD = 24;
const TURN_WINDOW_OVERSCAN_PX = 600;
const TURN_WINDOW_TAIL_COUNT = 4;
const TURN_HEIGHT_ESTIMATE_PX = 220;

export interface TurnWindowManager {
  refresh: () => void;
  scheduleRefresh: () => void;
  dispose: () => void;
}

interface TurnRange {
  start: number;
  end: number;
}

function createSpacer(className: string): HTMLDivElement {
  const spacer = document.createElement('div');
  spacer.className = className;
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

function sumHeights(
  turns: HTMLDivElement[],
  heightCache: WeakMap<HTMLDivElement, number>,
  start: number,
  end: number,
): number {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += heightCache.get(turns[index]!) ?? TURN_HEIGHT_ESTIMATE_PX;
  }
  return total;
}

function findVisibleRange(
  turns: HTMLDivElement[],
  heightCache: WeakMap<HTMLDivElement, number>,
  scrollTop: number,
  viewportHeight: number,
): TurnRange {
  const minY = Math.max(0, scrollTop - TURN_WINDOW_OVERSCAN_PX);
  const maxY = scrollTop + viewportHeight + TURN_WINDOW_OVERSCAN_PX;

  let start = 0;
  let end = Math.max(0, turns.length - 1);
  let offset = 0;

  for (let index = 0; index < turns.length; index += 1) {
    const height = heightCache.get(turns[index]!) ?? TURN_HEIGHT_ESTIMATE_PX;
    const nextOffset = offset + height;
    if (nextOffset >= minY) {
      start = index;
      break;
    }
    offset = nextOffset;
  }

  offset = 0;
  for (let index = 0; index < turns.length; index += 1) {
    const height = heightCache.get(turns[index]!) ?? TURN_HEIGHT_ESTIMATE_PX;
    const nextOffset = offset + height;
    if (offset <= maxY) {
      end = index;
    } else {
      break;
    }
    offset = nextOffset;
  }

  return { start, end };
}

export function createTurnWindowManager(
  scrollContainer: HTMLElement,
  contentHost: HTMLElement,
): TurnWindowManager {
  const turns: HTMLDivElement[] = [];
  const heightCache = new WeakMap<HTMLDivElement, number>();
  const observedTurns = new Set<HTMLDivElement>();
  const topSpacer = createSpacer('turn-window-spacer turn-window-spacer-top');
  const middleSpacer = createSpacer('turn-window-spacer turn-window-spacer-middle');
  let isApplyingLayout = false;
  let refreshScheduled = false;

  const observeTurn = (turn: HTMLDivElement): void => {
    if (observedTurns.has(turn)) {
      return;
    }
    observedTurns.add(turn);
    if (!heightCache.has(turn)) {
      const measuredHeight = turn.getBoundingClientRect().height;
      heightCache.set(turn, measuredHeight > 0 ? measuredHeight : TURN_HEIGHT_ESTIMATE_PX);
    }
    resizeObserver?.observe(turn);
  };

  const unobserveTurn = (turn: HTMLDivElement): void => {
    if (!observedTurns.delete(turn)) {
      return;
    }
    resizeObserver?.unobserve(turn);
  };

  const getFocusedTurnIndex = (): number | null => {
    if (typeof document === 'undefined') {
      return null;
    }
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return null;
    }
    const turn = activeElement.closest<HTMLDivElement>('.turn');
    if (!turn) {
      return null;
    }
    const index = turns.indexOf(turn);
    return index === -1 ? null : index;
  };

  const getAnchorNode = (): ChildNode | null => {
    let node = contentHost.firstChild;
    while (node) {
      if (
        node instanceof HTMLDivElement &&
        (node.classList.contains('turn') || node.classList.contains('turn-window-spacer'))
      ) {
        node = node.nextSibling;
        continue;
      }
      return node;
    }
    return null;
  };

  const scheduleRefresh = (): void => {
    if (refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      refresh();
    });
  };

  const insertTurnInDomOrder = (turn: HTMLDivElement): void => {
    let previousTurn: HTMLDivElement | null = null;
    let sibling: Element | null = turn.previousElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLDivElement && sibling.classList.contains('turn')) {
        previousTurn = sibling;
        break;
      }
      sibling = sibling.previousElementSibling;
    }

    if (previousTurn) {
      const previousIndex = turns.indexOf(previousTurn);
      if (previousIndex !== -1) {
        turns.splice(previousIndex + 1, 0, turn);
        return;
      }
    }

    let nextTurn: HTMLDivElement | null = null;
    sibling = turn.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLDivElement && sibling.classList.contains('turn')) {
        nextTurn = sibling;
        break;
      }
      sibling = sibling.nextElementSibling;
    }

    if (nextTurn) {
      const nextIndex = turns.indexOf(nextTurn);
      if (nextIndex !== -1) {
        turns.splice(nextIndex, 0, turn);
        return;
      }
    }

    turns.push(turn);
  };

  const mutationObserver =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          if (isApplyingLayout) {
            return;
          }

          let didChange = false;
          for (const record of records) {
            record.addedNodes.forEach((node) => {
              if (!(node instanceof HTMLDivElement) || !node.classList.contains('turn')) {
                return;
              }
              if (turns.includes(node)) {
                return;
              }
              insertTurnInDomOrder(node);
              observeTurn(node);
              didChange = true;
            });

            record.removedNodes.forEach((node) => {
              if (!(node instanceof HTMLDivElement) || !node.classList.contains('turn')) {
                return;
              }
              const index = turns.indexOf(node);
              if (index === -1) {
                return;
              }
              turns.splice(index, 1);
              unobserveTurn(node);
              didChange = true;
            });
          }

          if (didChange) {
            scheduleRefresh();
          }
        });

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          let didChange = false;
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLDivElement) || !entry.target.classList.contains('turn')) {
              continue;
            }
            const nextHeight =
              entry.contentRect.height > 0 ? entry.contentRect.height : TURN_HEIGHT_ESTIMATE_PX;
            if (heightCache.get(entry.target) === nextHeight) {
              continue;
            }
            heightCache.set(entry.target, nextHeight);
            didChange = true;
          }
          if (didChange) {
            scheduleRefresh();
          }
        });

  const appendTurnRangeToFragment = (
    fragment: DocumentFragment,
    start: number,
    end: number,
  ): void => {
    for (let index = start; index <= end; index += 1) {
      const turn = turns[index];
      if (!turn) {
        continue;
      }
      observeTurn(turn);
      fragment.appendChild(turn);
    }
  };

  const areAllTurnsMounted = (): boolean =>
    turns.every((turn) => turn.parentElement === contentHost) &&
    topSpacer.parentElement !== contentHost &&
    middleSpacer.parentElement !== contentHost;

  const mountAllTurns = (): void => {
    if (areAllTurnsMounted()) {
      return;
    }

    isApplyingLayout = true;
    try {
      topSpacer.remove();
      middleSpacer.remove();

      const anchor = getAnchorNode();
      const fragment = document.createDocumentFragment();
      appendTurnRangeToFragment(fragment, 0, turns.length - 1);
      contentHost.insertBefore(fragment, anchor);
    } finally {
      isApplyingLayout = false;
    }
  };

  const refresh = (): void => {
    if (turns.length === 0) {
      topSpacer.remove();
      middleSpacer.remove();
      return;
    }

    if (turns.length <= TURN_WINDOWING_THRESHOLD) {
      mountAllTurns();
      return;
    }

    const visibleRange = findVisibleRange(
      turns,
      heightCache,
      scrollContainer.scrollTop,
      scrollContainer.clientHeight,
    );
    const focusedTurnIndex = getFocusedTurnIndex();
    const rangeStart =
      focusedTurnIndex === null ? visibleRange.start : Math.min(visibleRange.start, focusedTurnIndex);
    const rangeEnd =
      focusedTurnIndex === null ? visibleRange.end : Math.max(visibleRange.end, focusedTurnIndex);
    const tailStart = Math.max(0, turns.length - TURN_WINDOW_TAIL_COUNT);
    const ranges: TurnRange[] =
      rangeEnd >= tailStart - 1
        ? [{ start: Math.min(rangeStart, tailStart), end: turns.length - 1 }]
        : [
            { start: rangeStart, end: rangeEnd },
            { start: tailStart, end: turns.length - 1 },
          ];

    const mountedTurns = new Set<HTMLDivElement>();
    for (const range of ranges) {
      for (let index = range.start; index <= range.end; index += 1) {
        const turn = turns[index];
        if (turn) {
          mountedTurns.add(turn);
        }
      }
    }

    const topHeight = sumHeights(turns, heightCache, 0, ranges[0]!.start);
    const middleHeight =
      ranges.length === 2
        ? sumHeights(turns, heightCache, ranges[0]!.end + 1, ranges[1]!.start)
        : 0;

    isApplyingLayout = true;
    try {
      for (const turn of turns) {
        if (mountedTurns.has(turn)) {
          continue;
        }
        unobserveTurn(turn);
        if (turn.parentElement === contentHost) {
          contentHost.removeChild(turn);
        }
      }

      topSpacer.style.height = `${topHeight}px`;
      middleSpacer.style.height = `${middleHeight}px`;

      const anchor = getAnchorNode();
      const fragment = document.createDocumentFragment();
      fragment.appendChild(topSpacer);
      appendTurnRangeToFragment(fragment, ranges[0]!.start, ranges[0]!.end);
      if (ranges.length === 2) {
        fragment.appendChild(middleSpacer);
        appendTurnRangeToFragment(fragment, ranges[1]!.start, ranges[1]!.end);
      } else {
        middleSpacer.remove();
      }

      contentHost.insertBefore(fragment, anchor);
    } finally {
      isApplyingLayout = false;
    }
  };

  mutationObserver?.observe(contentHost, {
    childList: true,
  });

  for (const turn of contentHost.querySelectorAll<HTMLDivElement>(':scope > .turn')) {
    turns.push(turn);
    observeTurn(turn);
  }

  return {
    refresh,
    scheduleRefresh,
    dispose: () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      topSpacer.remove();
      middleSpacer.remove();
      observedTurns.clear();
      turns.splice(0, turns.length);
    },
  };
}
