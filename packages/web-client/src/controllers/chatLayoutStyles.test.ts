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
});
