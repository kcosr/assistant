// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { applyTextSearchHighlights } from './textSearchHighlight';

describe('applyTextSearchHighlights', () => {
  it('highlights case-insensitive matches', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Hello hello</p>';

    const hits = applyTextSearchHighlights(container, 'hello', { highlightClass: 'hit' });

    expect(hits).toHaveLength(2);
    expect(container.querySelectorAll('mark.hit')).toHaveLength(2);
  });

  it('respects ignore selectors', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span>copy</span><button>copy</button>';

    const hits = applyTextSearchHighlights(container, 'copy', {
      highlightClass: 'hit',
      ignoreSelectors: ['button'],
    });

    expect(hits).toHaveLength(1);
    expect(container.querySelectorAll('button mark.hit')).toHaveLength(0);
  });

  it('clears previous highlights when query is empty', () => {
    const container = document.createElement('div');
    container.textContent = 'hello';

    applyTextSearchHighlights(container, 'hell', { highlightClass: 'hit' });
    expect(container.querySelectorAll('mark.hit')).toHaveLength(1);

    const cleared = applyTextSearchHighlights(container, '', { highlightClass: 'hit' });

    expect(cleared).toHaveLength(0);
    expect(container.querySelectorAll('mark.hit')).toHaveLength(0);
    expect(container.textContent).toBe('hello');
  });
});
