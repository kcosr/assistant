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
});
