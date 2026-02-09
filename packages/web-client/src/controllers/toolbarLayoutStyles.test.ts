import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('toolbar layout styles', () => {
  it('pins toolbar sections to explicit grid columns', () => {
    const cssPath = join(process.cwd(), 'packages/web-client/public/styles.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('.toolbar > .toolbar-group:first-of-type');
    expect(css).toContain('grid-column: 1;');

    expect(css).toContain('.toolbar > .toolbar-center');
    expect(css).toContain('grid-column: 2;');

    expect(css).toContain('.toolbar > .toolbar-group:last-of-type');
    expect(css).toContain('grid-column: 3;');
    expect(css).toContain('justify-self: end;');
  });
});
