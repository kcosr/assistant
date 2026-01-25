import { marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';

// Import commonly used languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

interface MarkdownCodeRange {
  start: number;
  end: number;
}

function findCodeRanges(text: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];

  let inFencedBlock = false;
  let fencedBlockStart = -1;
  let inInlineCode = false;
  let inlineCodeStart = -1;

  for (let i = 0; i < text.length; ) {
    const char = text[i];
    const atLineStart = i === 0 || text[i - 1] === '\n';

    if (char === '`') {
      const isFenced = atLineStart && text.startsWith('```', i);
      if (isFenced) {
        if (!inFencedBlock) {
          inFencedBlock = true;
          fencedBlockStart = i;
        } else {
          ranges.push({ start: fencedBlockStart, end: i + 3 });
          inFencedBlock = false;
          fencedBlockStart = -1;
        }
        i += 3;
        continue;
      }

      if (!inFencedBlock) {
        if (!inInlineCode) {
          inInlineCode = true;
          inlineCodeStart = i;
        } else {
          ranges.push({ start: inlineCodeStart, end: i + 1 });
          inInlineCode = false;
          inlineCodeStart = -1;
        }
      }
    }

    i += 1;
  }

  if (inFencedBlock && fencedBlockStart >= 0) {
    ranges.push({ start: fencedBlockStart, end: text.length });
  }

  if (inInlineCode && inlineCodeStart >= 0) {
    ranges.push({ start: inlineCodeStart, end: text.length });
  }

  return ranges;
}

function isIndexInsideCode(index: number, ranges: MarkdownCodeRange[]): boolean {
  for (const range of ranges) {
    if (index >= range.start && index < range.end) {
      return true;
    }
  }
  return false;
}

function countMatchesOutsideCode(
  text: string,
  pattern: RegExp,
  ranges: MarkdownCodeRange[],
): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  let count = 0;

  for (;;) {
    const match = globalPattern.exec(text);
    if (!match) {
      break;
    }
    const index = match.index;
    if (!isIndexInsideCode(index, ranges)) {
      count += 1;
    }
  }

  return count;
}

/**
 * Prepares incomplete streaming markdown for parsing by closing unclosed blocks.
 * This allows markdown parsers to render partial content correctly during streaming.
 */
export function prepareForMarkdown(text: string): string {
  let result = text;

  // Count backtick fences (``` at start of line)
  const fenceMatches = result.match(/^```/gm) || [];

  // If odd number of fences, we have an unclosed code block
  if (fenceMatches.length % 2 === 1) {
    result = result + '\n```';
  }

  // Handle unclosed inline code backticks
  // Count single backticks that aren't part of code fences
  const inlineCodePattern = /(?<!`)`(?!`)/g;
  const inlineMatches = result.match(inlineCodePattern) || [];
  if (inlineMatches.length % 2 === 1) {
    result = result + '`';
  }

  const codeRanges = findCodeRanges(result);

  // Handle unclosed bold/italic markers (simplified approach)
  // Count unescaped ** markers
  const boldPattern = /(?<![\\*])\*\*(?!\*)/g;
  const boldMatches = countMatchesOutsideCode(result, boldPattern, codeRanges);
  if (boldMatches % 2 === 1) {
    result = result + '**';
  }

  // Count unescaped __ markers
  const boldUnderscorePattern = /(?<![_\\])__(?!_)/g;
  const boldUnderscoreMatches = countMatchesOutsideCode(result, boldUnderscorePattern, codeRanges);
  if (boldUnderscoreMatches % 2 === 1) {
    result = result + '__';
  }

  // Handle single * for italic (must be careful not to interfere with bold)
  // Only match single * not adjacent to another *
  const italicPattern = /(?<![\\*])\*(?!\*)/g;
  const italicMatches = countMatchesOutsideCode(result, italicPattern, codeRanges);
  if (italicMatches % 2 === 1) {
    result = result + '*';
  }

  // Handle single _ for italic
  const italicUnderscorePattern = /(?<![_\\])_(?!_)/g;
  const italicUnderscoreMatches = countMatchesOutsideCode(
    result,
    italicUnderscorePattern,
    codeRanges,
  );
  if (italicUnderscoreMatches % 2 === 1) {
    result = result + '_';
  }

  // Handle unclosed strikethrough ~~
  const strikePattern = /(?<![\\~])~~(?!~)/g;
  const strikeMatches = countMatchesOutsideCode(result, strikePattern, codeRanges);
  if (strikeMatches % 2 === 1) {
    result = result + '~~';
  }

  return result;
}

// Configure marked for GFM with custom renderer for code highlighting
const renderer = new marked.Renderer();

renderer.code = function (token: Tokens.Code): string {
  const { text, lang } = token;
  const language = lang && hljs.getLanguage(lang) ? lang : null;

  let highlighted: string;
  if (language) {
    try {
      highlighted = hljs.highlight(text, { language }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    // Try auto-detection for unknown languages
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  }

  const langClass = language ? ` language-${language}` : '';
  return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>`;
};

// Wrap tables in a scrollable container
renderer.table = function (token: Tokens.Table): string {
  const headerCells = token.header.map((cell) => this.tablecell(cell)).join('');
  const headerRow = `<tr>${headerCells}</tr>`;

  const bodyRows = token.rows
    .map((row) => {
      const cells = row.map((cell) => this.tablecell(cell)).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="table-wrapper"><table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Custom extension to handle code blocks with info strings better
const codeBlockExtension: TokenizerAndRendererExtension = {
  name: 'fencedCode',
  level: 'block',
  start(src: string) {
    return src.match(/^```/)?.index;
  },
  tokenizer(src: string): Tokens.Code | undefined {
    const rule = /^```(\w*)\n([\s\S]*?)(?:```|$)/;
    const match = rule.exec(src);
    if (match) {
      const token: Tokens.Code = {
        type: 'code',
        raw: match[0],
        text: match[2] ?? '',
      };
      if (match[1]) {
        token.lang = match[1];
      }
      return token;
    }
    return undefined;
  },
};

marked.use({
  extensions: [codeBlockExtension],
  renderer,
  gfm: true,
  breaks: false,
});

// Configure DOMPurify
const purifyConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'strike',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
    'div',
    'hr',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'title'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'object', 'embed'],
  FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur'],
  // Prevent javascript: URLs
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

// Add hook to ensure external links open in new tabs and have security attributes
DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

/**
 * Renders markdown text to sanitized HTML.
 * Handles incomplete/streaming markdown gracefully.
 */
export function renderMarkdown(text: string): string {
  // Prepare text for streaming (close incomplete blocks)
  const prepared = prepareForMarkdown(text);
  const normalized = prepared.replace(/\r\n?/g, '\n');

  // Parse markdown to HTML
  const rawHtml = marked.parse(normalized, { async: false, breaks: true }) as string;

  // Sanitize the HTML to prevent XSS
  const sanitized = DOMPurify.sanitize(rawHtml, purifyConfig) as string;

  return sanitized;
}

/**
 * Renders markdown and applies it to an element.
 * Uses innerHTML for markdown content (after sanitization).
 */
export function applyMarkdownToElement(element: HTMLElement, text: string): void {
  const html = renderMarkdown(text);
  element.innerHTML = html;
  element.classList.add('markdown-content');

  enhanceCodeBlocksWithCopyButtons(element);
}

export function enhanceCodeBlocksWithCopyButtons(container: HTMLElement): void {
  const preElements = container.querySelectorAll<HTMLPreElement>('pre');
  for (const pre of Array.from(preElements)) {
    const code = pre.querySelector('code');
    if (!code) {
      continue;
    }

    // Remove existing wrapper (may have been cloned without event listeners)
    const existingWrapper = pre.querySelector('.markdown-code-copy-wrapper');
    if (existingWrapper) {
      existingWrapper.remove();
    }

    pre.classList.add('markdown-code-block');

    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-code-copy-wrapper';

    const mainButton = document.createElement('button');
    mainButton.type = 'button';
    mainButton.className = 'markdown-code-copy-button markdown-code-copy-main';
    mainButton.textContent = 'Copy';
    mainButton.setAttribute('aria-label', 'Copy code as text');

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'markdown-code-copy-button markdown-code-copy-toggle';
    toggleButton.setAttribute('aria-label', 'Copy options');

    const menu = document.createElement('div');
    menu.className = 'markdown-code-copy-menu';

    const copyMarkdownItem = document.createElement('button');
    copyMarkdownItem.type = 'button';
    copyMarkdownItem.className = 'markdown-code-copy-menu-item';
    copyMarkdownItem.textContent = 'Copy Markdown';

    const copyOneLineItem = document.createElement('button');
    copyOneLineItem.type = 'button';
    copyOneLineItem.className = 'markdown-code-copy-menu-item';
    copyOneLineItem.textContent = 'Copy Line';

    menu.appendChild(copyMarkdownItem);
    menu.appendChild(copyOneLineItem);

    wrapper.appendChild(mainButton);
    wrapper.appendChild(toggleButton);
    wrapper.appendChild(menu);
    pre.appendChild(wrapper);

    const getCodeText = (): string => (code.textContent ?? '').trimEnd();

    const copyTextToClipboard = async (value: string): Promise<boolean> => {
      const navClipboard = (
        navigator as Navigator & {
          clipboard?: {
            writeText?: (val: string) => Promise<void>;
          };
        }
      ).clipboard;

      if (navClipboard?.writeText) {
        try {
          await navClipboard.writeText(value);
          return true;
        } catch {
          // Fall through to execCommand fallback.
        }
      }

      try {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        if (!selection) {
          return false;
        }
        selection.removeAllRanges();
        selection.addRange(range);
        const ok = document.execCommand('copy');
        selection.removeAllRanges();
        return ok;
      } catch {
        return false;
      }
    };

    const showCopySuccess = (): void => {
      const originalText = mainButton.textContent ?? 'Copy';
      mainButton.textContent = 'Copied';
      mainButton.disabled = true;
      window.setTimeout(() => {
        mainButton.textContent = originalText;
        mainButton.disabled = false;
      }, 1500);
    };

    let menuOpen = false;

    const setMenuOpen = (open: boolean): void => {
      if (menuOpen === open) {
        return;
      }
      menuOpen = open;
      menu.classList.toggle('open', menuOpen);

      const handleDocumentClick = (event: MouseEvent): void => {
        const target = event.target as Node | null;
        if (target && (wrapper.contains(target) || target === toggleButton)) {
          return;
        }
        setMenuOpen(false);
        document.removeEventListener('click', handleDocumentClick);
        document.removeEventListener('keydown', handleKeyDown);
      };

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMenuOpen(false);
          document.removeEventListener('click', handleDocumentClick);
          document.removeEventListener('keydown', handleKeyDown);
        }
      };

      if (menuOpen) {
        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('keydown', handleKeyDown);
      }
    };

    toggleButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(!menuOpen);
    });

    mainButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);

      const codeText = getCodeText();
      if (!codeText) {
        return;
      }

      void copyTextToClipboard(codeText).then((ok) => {
        if (ok) {
          showCopySuccess();
        }
      });
    });

    copyMarkdownItem.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);

      const rawCode = getCodeText();
      if (!rawCode) {
        return;
      }

      const className = code.className || '';
      const langClass = className.split(/\s+/).find((part) => part.startsWith('language-'));
      const lang = langClass ? langClass.replace(/^language-/, '') : '';
      const fenced = `\`\`\`${lang}\n${rawCode}\n\`\`\``;

      void copyTextToClipboard(fenced).then((ok) => {
        if (ok) {
          showCopySuccess();
        }
      });
    });

    copyOneLineItem.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);

      const rawCode = getCodeText();
      if (!rawCode) {
        return;
      }

      const flattened = flattenCodeToSingleLine(rawCode);
      if (!flattened) {
        return;
      }

      void copyTextToClipboard(flattened).then((ok) => {
        if (ok) {
          showCopySuccess();
        }
      });
    });
  }
}

function flattenCodeToSingleLine(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const segments: string[] = [];

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const endsWithBackslash = trimmed.endsWith('\\');
    if (endsWithBackslash) {
      trimmed = trimmed.slice(0, -1).trimEnd();
    }

    if (!trimmed) {
      continue;
    }

    segments.push(trimmed);
  }

  return segments.join(' ');
}
