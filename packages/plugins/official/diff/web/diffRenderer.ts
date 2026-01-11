/**
 * Enhanced diff renderer with split view and word-level diff highlighting.
 */

import { diffWordsWithSpace } from 'diff';

// ============================================================================
// Types
// ============================================================================

export type DiffStyle = 'unified' | 'split';

export interface DiffHunkHeaderInfo {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface DiffHunkLine {
  type: 'add' | 'del' | 'context' | 'meta';
  prefix?: string;
  text: string;
  oldNumber?: number | null;
  newNumber?: number | null;
}

export interface DiffHunk {
  header: string;
  headerInfo: DiffHunkHeaderInfo | null;
  rawLines: string[];
  lines: DiffHunkLine[];
}

export interface DiffFile {
  id: string;
  path: string;
  pathA?: string;
  pathB?: string;
  displayPath?: string;
  renameFrom?: string | null;
  renameTo?: string | null;
  headerLines: string[];
  hunks: DiffHunk[];
  binary: boolean;
}

export interface DiffPatch {
  files: DiffFile[];
}

export interface WordDiffSegment {
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

export interface RenderOptions {
  diffStyle: DiffStyle;
  showWordDiff: boolean;
}

// ============================================================================
// Word-level diff computation
// ============================================================================

export function computeWordDiff(
  oldText: string,
  newText: string,
): {
  oldSegments: WordDiffSegment[];
  newSegments: WordDiffSegment[];
} {
  const changes = diffWordsWithSpace(oldText, newText);
  const oldSegments: WordDiffSegment[] = [];
  const newSegments: WordDiffSegment[] = [];

  for (const change of changes) {
    if (change.added) {
      newSegments.push({ text: change.value, type: 'added' });
    } else if (change.removed) {
      oldSegments.push({ text: change.value, type: 'removed' });
    } else {
      oldSegments.push({ text: change.value, type: 'unchanged' });
      newSegments.push({ text: change.value, type: 'unchanged' });
    }
  }

  return { oldSegments, newSegments };
}

/**
 * Pairs up consecutive del/add lines for word-level diffing in split view.
 */
export function pairChanges(
  lines: DiffHunkLine[],
): Array<{ old: DiffHunkLine | null; new: DiffHunkLine | null }> {
  const result: Array<{ old: DiffHunkLine | null; new: DiffHunkLine | null }> = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'context' || line.type === 'meta') {
      result.push({ old: line, new: line });
      i++;
      continue;
    }

    const deletions: DiffHunkLine[] = [];
    while (i < lines.length && lines[i].type === 'del') {
      deletions.push(lines[i]);
      i++;
    }

    const additions: DiffHunkLine[] = [];
    while (i < lines.length && lines[i].type === 'add') {
      additions.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(deletions.length, additions.length);
    for (let j = 0; j < maxLen; j++) {
      result.push({
        old: deletions[j] ?? null,
        new: additions[j] ?? null,
      });
    }
  }

  return result;
}

// ============================================================================
// DOM Rendering
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWordDiffSegments(segments: WordDiffSegment[], highlightClass: string): string {
  return segments
    .map((seg) => {
      const escaped = escapeHtml(seg.text);
      if (seg.type === 'added' || seg.type === 'removed') {
        return `<span class="${highlightClass}">${escaped}</span>`;
      }
      return escaped;
    })
    .join('');
}

function renderLineNumber(num: number | null | undefined): string {
  return num != null ? String(num) : '';
}

export function renderUnifiedView(
  _file: DiffFile,
  hunk: DiffHunk,
  options: RenderOptions,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'diff-hunk-lines diff-hunk-lines-unified';

  // For word diff in unified view, we need to pair consecutive del/add lines
  const pairs = options.showWordDiff ? pairChanges(hunk.lines) : null;

  if (pairs && options.showWordDiff) {
    // Word diff mode: render paired lines with highlighting
    for (const pair of pairs) {
      if (pair.old && pair.new && pair.old.type === 'del' && pair.new.type === 'add') {
        // Paired change - show both with word diff
        const { oldSegments, newSegments } = computeWordDiff(pair.old.text, pair.new.text);

        // Deletion row
        const delRow = document.createElement('div');
        delRow.className = 'diff-line diff-line-del';
        delRow.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-number"></span>
          <span class="diff-line-text">${renderWordDiffSegments(oldSegments, 'diff-word-del')}</span>
        `;
        container.appendChild(delRow);

        // Addition row
        const addRow = document.createElement('div');
        addRow.className = 'diff-line diff-line-add';
        addRow.innerHTML = `
          <span class="diff-line-number"></span>
          <span class="diff-line-number">${renderLineNumber(pair.new.newNumber)}</span>
          <span class="diff-line-text">${renderWordDiffSegments(newSegments, 'diff-word-add')}</span>
        `;
        container.appendChild(addRow);
      } else if (pair.old && pair.old.type === 'context') {
        // Context line
        const row = document.createElement('div');
        row.className = 'diff-line';
        row.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-number">${renderLineNumber(pair.old.newNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
        `;
        container.appendChild(row);
      } else if (pair.old && pair.old.type === 'meta') {
        // Meta line
        const row = document.createElement('div');
        row.className = 'diff-line diff-line-meta';
        row.innerHTML = `
          <span class="diff-line-number"></span>
          <span class="diff-line-number"></span>
          <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
        `;
        container.appendChild(row);
      } else if (pair.old && pair.old.type === 'del') {
        // Unpaired deletion
        const row = document.createElement('div');
        row.className = 'diff-line diff-line-del';
        row.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-number"></span>
          <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
        `;
        container.appendChild(row);
      } else if (pair.new && pair.new.type === 'add') {
        // Unpaired addition
        const row = document.createElement('div');
        row.className = 'diff-line diff-line-add';
        row.innerHTML = `
          <span class="diff-line-number"></span>
          <span class="diff-line-number">${renderLineNumber(pair.new.newNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.new.text)}</span>
        `;
        container.appendChild(row);
      }
    }
  } else {
    // No word diff: simple line-by-line rendering
    for (const line of hunk.lines) {
      const row = document.createElement('div');
      row.className = 'diff-line';

      if (line.type === 'add') {
        row.classList.add('diff-line-add');
      } else if (line.type === 'del') {
        row.classList.add('diff-line-del');
      } else if (line.type === 'meta') {
        row.classList.add('diff-line-meta');
      }

      const oldNum = document.createElement('span');
      oldNum.className = 'diff-line-number';
      oldNum.textContent = renderLineNumber(line.oldNumber);

      const newNum = document.createElement('span');
      newNum.className = 'diff-line-number';
      newNum.textContent = renderLineNumber(line.newNumber);

      const text = document.createElement('span');
      text.className = 'diff-line-text';
      text.textContent = line.text || '';

      row.appendChild(oldNum);
      row.appendChild(newNum);
      row.appendChild(text);
      container.appendChild(row);
    }
  }

  return container;
}

export function renderSplitView(
  _file: DiffFile,
  hunk: DiffHunk,
  options: RenderOptions,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'diff-hunk-lines diff-hunk-lines-split';

  const pairs = pairChanges(hunk.lines);

  for (const pair of pairs) {
    const row = document.createElement('div');
    row.className = 'diff-split-row';

    const leftSide = document.createElement('div');
    leftSide.className = 'diff-split-side diff-split-left';

    const rightSide = document.createElement('div');
    rightSide.className = 'diff-split-side diff-split-right';

    if (pair.old && pair.new && pair.old.type === 'del' && pair.new.type === 'add') {
      // This is a change - compute word diff
      if (options.showWordDiff) {
        const { oldSegments, newSegments } = computeWordDiff(pair.old.text, pair.new.text);

        leftSide.classList.add('diff-line-del');
        leftSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-text">${renderWordDiffSegments(oldSegments, 'diff-word-del')}</span>
        `;

        rightSide.classList.add('diff-line-add');
        rightSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.new.newNumber)}</span>
          <span class="diff-line-text">${renderWordDiffSegments(newSegments, 'diff-word-add')}</span>
        `;
      } else {
        leftSide.classList.add('diff-line-del');
        leftSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
        `;

        rightSide.classList.add('diff-line-add');
        rightSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.new.newNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.new.text)}</span>
        `;
      }
    } else if (pair.old && pair.old.type === 'context') {
      leftSide.innerHTML = `
        <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
        <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
      `;
      rightSide.innerHTML = `
        <span class="diff-line-number">${renderLineNumber(pair.old.newNumber)}</span>
        <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
      `;
    } else if (pair.old && pair.old.type === 'meta') {
      leftSide.classList.add('diff-line-meta');
      leftSide.innerHTML = `
        <span class="diff-line-number"></span>
        <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
      `;
      rightSide.classList.add('diff-line-meta');
      rightSide.innerHTML = `
        <span class="diff-line-number"></span>
        <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
      `;
    } else {
      if (pair.old && pair.old.type === 'del') {
        leftSide.classList.add('diff-line-del');
        leftSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.old.oldNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.old.text)}</span>
        `;
        rightSide.classList.add('diff-line-empty');
        rightSide.innerHTML = `
          <span class="diff-line-number"></span>
          <span class="diff-line-text"></span>
        `;
      } else if (pair.new && pair.new.type === 'add') {
        leftSide.classList.add('diff-line-empty');
        leftSide.innerHTML = `
          <span class="diff-line-number"></span>
          <span class="diff-line-text"></span>
        `;
        rightSide.classList.add('diff-line-add');
        rightSide.innerHTML = `
          <span class="diff-line-number">${renderLineNumber(pair.new.newNumber)}</span>
          <span class="diff-line-text">${escapeHtml(pair.new.text)}</span>
        `;
      }
    }

    row.appendChild(leftSide);
    row.appendChild(rightSide);
    container.appendChild(row);
  }

  return container;
}

export function renderHunkLines(
  file: DiffFile,
  hunk: DiffHunk,
  options: RenderOptions,
): HTMLElement {
  if (options.diffStyle === 'split') {
    return renderSplitView(file, hunk, options);
  }
  return renderUnifiedView(file, hunk, options);
}
