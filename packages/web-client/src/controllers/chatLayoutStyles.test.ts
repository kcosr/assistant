import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('chat layout styles', () => {
  it('applies content-visibility directly to chat turns', () => {
    const cssPath = join(process.cwd(), 'packages/web-client/public/styles.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('.chat-log > .turn');
    expect(css).not.toContain('.chat-log-content > .turn');
  });

  it('uses a 13px shared base font size', () => {
    const cssPath = join(process.cwd(), 'packages/web-client/public/styles.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('--font-size-base: 13px;');
    expect(css).toContain('.message {');
    expect(css).toContain('.input-field {');
    expect(css).toContain('font-size: var(--font-size-base);');
    expect(css).toContain('.tool-call-group-header {');
    expect(css).toContain('.tool-output-header {');
    expect(css).toContain('padding: 2px 8px 1px;');
    expect(css).toContain('line-height: 1.2;');
    expect(css).toContain('.capacitor-android .tool-call-group-header,');
    expect(css).toContain('.capacitor-android .tool-output-header {');
    expect(css).toContain('padding: 3px 8px 2px;');
  });

  it('keeps the interrupted indicator below message content without negative overlap', () => {
    const cssPath = join(process.cwd(), 'packages/web-client/public/styles.css');
    const css = readFileSync(cssPath, 'utf8');
    const blockStart = css.indexOf('.message-interrupted {');
    const nextBlockStart = css.indexOf('\n\n.', blockStart);
    const interruptedBlock =
      blockStart >= 0 ? css.slice(blockStart, nextBlockStart >= 0 ? nextBlockStart : undefined) : '';

    expect(interruptedBlock).toContain('.message-interrupted {');
    expect(interruptedBlock).toContain('display: block;');
    expect(interruptedBlock).toContain('line-height: 1.3;');
    expect(interruptedBlock).toContain('margin-top: var(--spacing-sm);');
    expect(interruptedBlock).not.toContain('padding-left: var(--spacing-xl);');
    expect(interruptedBlock).not.toContain('margin-top: calc(-1 * var(--spacing-md));');
  });

  it('lets markdown code blocks shrink to fit their content up to full width', () => {
    const cssPath = join(process.cwd(), 'packages/web-client/public/styles.css');
    const css = readFileSync(cssPath, 'utf8');
    const blockStart = css.lastIndexOf('.markdown-content pre {');
    const nextBlockStart = css.indexOf('\n\n.', blockStart);
    const preBlock = blockStart >= 0 ? css.slice(blockStart, nextBlockStart >= 0 ? nextBlockStart : undefined) : '';

    expect(preBlock).toContain('.markdown-content pre {');
    expect(preBlock).toContain('display: inline-block;');
    expect(preBlock).toContain('width: fit-content;');
    expect(preBlock).toContain('max-width: 100%;');
  });
});
