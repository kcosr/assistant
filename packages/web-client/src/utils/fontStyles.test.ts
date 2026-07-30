import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('font inheritance styles', () => {
  it('propagates the selected UI family through native form controls and tab buttons', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/styles.css'),
      'utf8',
    );

    expect(css).toMatch(
      /button,\s*\ninput,\s*\nselect,\s*\ntextarea\s*\{\s*\n\s*font-family: inherit;/,
    );
  });
});
