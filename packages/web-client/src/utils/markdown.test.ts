import { describe, it, expect } from 'vitest';
import { prepareForMarkdown, renderMarkdown } from './markdown';

describe('prepareForMarkdown', () => {
  it('should close unclosed code fences', () => {
    const input = '```javascript\nconst x = 1;';
    const result = prepareForMarkdown(input);
    expect(result).toBe('```javascript\nconst x = 1;\n```');
  });

  it('should not modify completed code fences', () => {
    const input = '```javascript\nconst x = 1;\n```';
    const result = prepareForMarkdown(input);
    expect(result).toBe(input);
  });

  it('should close unclosed inline code', () => {
    const input = 'Use `console.log';
    const result = prepareForMarkdown(input);
    expect(result).toBe('Use `console.log`');
  });

  it('should not modify completed inline code', () => {
    const input = 'Use `console.log`';
    const result = prepareForMarkdown(input);
    expect(result).toBe(input);
  });

  it('should close unclosed bold markers', () => {
    const input = 'This is **bold';
    const result = prepareForMarkdown(input);
    expect(result).toBe('This is **bold**');
  });

  it('should close unclosed italic markers', () => {
    const input = 'This is *italic';
    const result = prepareForMarkdown(input);
    expect(result).toBe('This is *italic*');
  });

  it('should close unclosed strikethrough markers', () => {
    const input = 'This is ~~deleted';
    const result = prepareForMarkdown(input);
    expect(result).toBe('This is ~~deleted~~');
  });

  it('should handle mixed unclosed blocks', () => {
    const input = '```\ncode\n```\n\nSome **bold text';
    const result = prepareForMarkdown(input);
    expect(result).toBe('```\ncode\n```\n\nSome **bold text**');
  });

  it('should not treat underscores in code blocks as italic markers', () => {
    const input = 'Here is code:\n```python\nprint("my_var")\n```\nDone';
    const result = prepareForMarkdown(input);
    expect(result).toBe(input);
  });

  it('should not treat underscores in inline code as italic markers', () => {
    const input = 'Use `my_var` in code';
    const result = prepareForMarkdown(input);
    expect(result).toBe(input);
  });

  it('should close unclosed italic underscore markers outside code', () => {
    const input = 'This is _italic';
    const result = prepareForMarkdown(input);
    expect(result).toBe('This is _italic_');
  });

  it('should handle empty code blocks', () => {
    const input = '```';
    const result = prepareForMarkdown(input);
    expect(result).toBe('```\n```');
  });
});

describe('renderMarkdown', () => {
  it('should render headings', () => {
    const result = renderMarkdown('# Heading 1');
    expect(result).toContain('<h1');
    expect(result).toContain('Heading 1');
  });

  it('should render bold text', () => {
    const result = renderMarkdown('**bold**');
    expect(result).toContain('<strong');
    expect(result).toContain('bold');
  });

  it('should render italic text', () => {
    const result = renderMarkdown('*italic*');
    expect(result).toContain('<em');
    expect(result).toContain('italic');
  });

  it('should render inline code', () => {
    const result = renderMarkdown('`code`');
    expect(result).toContain('<code');
    expect(result).toContain('code');
  });

  it('should render code blocks with syntax highlighting', () => {
    const result = renderMarkdown('```javascript\nconst x = 1;\n```');
    expect(result).toContain('<pre');
    expect(result).toContain('<code');
    expect(result).toContain('hljs');
  });

  it('should render links', () => {
    const result = renderMarkdown('[link](https://example.com)');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('should render unordered lists', () => {
    const result = renderMarkdown('- item 1\n- item 2');
    expect(result).toContain('<ul');
    expect(result).toContain('<li');
    expect(result).toContain('item 1');
  });

  it('should render ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second');
    expect(result).toContain('<ol');
    expect(result).toContain('<li');
    expect(result).toContain('first');
  });

  it('should render blockquotes', () => {
    const result = renderMarkdown('> quote');
    expect(result).toContain('<blockquote');
    expect(result).toContain('quote');
  });

  it('should render line breaks in plain text', () => {
    const result = renderMarkdown('line 1\nline 2');
    expect(result).toContain('<br');
    expect(result).toContain('line 2');
  });

  it('should render tables (GFM)', () => {
    const result = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(result).toContain('<table');
    expect(result).toContain('<th');
    expect(result).toContain('<td');
  });

  it('should render strikethrough (GFM)', () => {
    const result = renderMarkdown('~~deleted~~');
    expect(result).toContain('<del');
    expect(result).toContain('deleted');
  });

  it('should sanitize script tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
  });

  it('should sanitize javascript: links', () => {
    const result = renderMarkdown('[click](javascript:alert("xss"))');
    // DOMPurify removes or sanitizes javascript: URLs
    expect(result).not.toContain('javascript:');
  });

  it('should sanitize event handlers', () => {
    const result = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('should handle incomplete code blocks during streaming', () => {
    // Simulating streaming: code block not yet closed
    const result = renderMarkdown('```python\nprint("hello")');
    expect(result).toContain('<pre');
    expect(result).toContain('<code');
  });

  it('should handle incomplete bold during streaming', () => {
    const result = renderMarkdown('This is **bold');
    expect(result).toContain('<strong');
    expect(result).toContain('bold');
  });
});
