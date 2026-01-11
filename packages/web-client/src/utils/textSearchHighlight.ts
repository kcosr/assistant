export interface TextSearchHighlightOptions {
  highlightClass?: string;
  ignoreSelectors?: string[];
}

const DEFAULT_HIGHLIGHT_CLASS = 'text-search-highlight';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearHighlights(container: HTMLElement, highlightClass: string): void {
  const highlights = container.querySelectorAll<HTMLElement>(`.${highlightClass}`);
  for (const highlight of Array.from(highlights)) {
    const parent = highlight.parentNode;
    if (!parent) {
      continue;
    }
    const textNode = document.createTextNode(highlight.textContent ?? '');
    parent.replaceChild(textNode, highlight);
    parent.normalize();
  }
}

function shouldIgnoreNode(
  node: Text,
  ignoreSelector: string | null,
  highlightClass: string,
): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  if (parent.closest(`.${highlightClass}`)) {
    return true;
  }
  if (ignoreSelector && parent.closest(ignoreSelector)) {
    return true;
  }
  const tagName = parent.tagName;
  return tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT';
}

export function applyTextSearchHighlights(
  container: HTMLElement,
  query: string,
  options?: TextSearchHighlightOptions,
): HTMLElement[] {
  const highlightClass = options?.highlightClass ?? DEFAULT_HIGHLIGHT_CLASS;
  const ignoreSelector =
    options?.ignoreSelectors && options.ignoreSelectors.length > 0
      ? options.ignoreSelectors.join(',')
      : null;
  clearHighlights(container, highlightClass);

  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const lowerQuery = trimmed.toLowerCase();
  const regex = new RegExp(escapeRegExp(trimmed), 'gi');
  const matches: HTMLElement[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue || shouldIgnoreNode(node, ignoreSelector, highlightClass)) {
      continue;
    }
    if (!node.nodeValue.toLowerCase().includes(lowerQuery)) {
      continue;
    }
    textNodes.push(node);
  }

  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    let lastIndex = 0;
    let hasMatch = false;
    const fragment = document.createDocumentFragment();
    regex.lastIndex = 0;

    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const mark = document.createElement('mark');
      mark.className = highlightClass;
      mark.textContent = text.slice(start, end);
      fragment.appendChild(mark);
      matches.push(mark);
      hasMatch = true;
      lastIndex = end;
    }

    if (!hasMatch) {
      continue;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  }

  return matches;
}
