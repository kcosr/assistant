import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('theme styles', () => {
  it('uses nearly black Dark surfaces with readable text in explicit and automatic dark mode', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/styles.css'),
      'utf8',
    );
    const base = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const autoDark =
      css
        .slice(css.indexOf('@media (prefers-color-scheme: dark)'))
        .match(/:root\[data-theme='auto'\] \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    const tokens = [
      'bg-primary',
      'bg-secondary',
      'bg-tertiary',
      'bg-hover',
      'border-color',
      'text-primary',
      'text-secondary',
      'text-dim',
    ];
    const readColor = (block: string, token: string) => {
      const hex = block.match(new RegExp(`--theme-${token}: #([0-9a-f]{6});`))?.[1];
      expect(hex, token).toBeDefined();
      return [0, 2, 4].map((offset) => parseInt(hex!.slice(offset, offset + 2), 16));
    };
    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    for (const token of tokens) {
      expect(readColor(autoDark, token)).toEqual(readColor(base, token));
    }
    const background = readColor(base, 'bg-primary');
    expect(Math.max(...background)).toBeLessThan(18);
    const surfaceTokens = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover'];
    const surfaces = surfaceTokens.map((token) => luminance(readColor(base, token)));
    for (let index = 1; index < surfaces.length; index += 1) {
      expect(surfaces[index]).toBeGreaterThan(surfaces[index - 1]!);
    }
    for (const token of ['text-primary', 'text-secondary', 'text-dim']) {
      const text = luminance(readColor(base, token));
      for (const surface of surfaces) {
        expect((text + 0.05) / (surface + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('defines the Herdr palette and compact geometry', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/styles.css'),
      'utf8',
    );
    const block = css.match(/:root\[data-theme='herdr'\] \{([\s\S]*?)\n\}/)?.[1];

    expect(block).toBeDefined();
    expect(block).toContain('--theme-bg-primary: #11111b;');
    expect(block).toContain('--theme-bg-secondary: #181825;');
    expect(block).toContain('--theme-bg-active: #202036;');
    expect(block).toContain('--theme-border-color: #262636;');
    expect(block).toContain('--theme-accent: #b4befe;');
    expect(block).toContain('--color-accent-soft: rgba(180, 190, 254, 0.14);');
    expect(block).toContain('--color-prominent-action-bg: #313244;');
    expect(block).toContain('--color-prominent-action-bg-hover: #45475a;');
    expect(block).toContain('--color-prominent-action-fg: #b4befe;');
    expect(block).toContain('--radius-md: 9px;');
    expect(block).toContain('--radius-lg: 13px;');
  });

  it('keeps global microphone styles out of plugin stylesheets', () => {
    const pluginStyles = [
      'packages/plugins/official/lists/web/styles.css',
      'packages/plugins/official/notes/web/styles.css',
    ];

    for (const relativePath of pluginStyles) {
      const css = fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
      expect(css).not.toMatch(/\.(?:input-mic-button|mic-icon)(?:\b|:)/);
    }
  });

  it('uses shared prominent-action tokens for the Lists add button', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/plugins/official/lists/web/styles.css'),
      'utf8',
    );
    const block = css.match(/\.lists-fab-add \{([\s\S]*?)\n\}/)?.[1];

    expect(block).toContain('background-color: var(--color-prominent-action-bg);');
    expect(block).toContain('color: var(--color-prominent-action-fg);');
    expect(css).toMatch(
      /\.lists-fab-add:hover \{\s*background-color: var\(--color-prominent-action-bg-hover\);/,
    );
  });

  it('gates active chat and non-chat panel outlines behind the root preference', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/styles.css'),
      'utf8',
    );

    expect(css).toContain(
      ":root:not([data-panel-outlines='hidden']) .panel-frame.is-active::after",
    );
    expect(css).toContain(
      ":root:not([data-panel-outlines='hidden']) .panel-frame.is-chat-active::after",
    );
    expect(css).toContain(":root:not([data-panel-outlines='hidden']) .panel-instance.chat-active");
  });
});
