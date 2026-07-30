// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { ensureTerminalFontLoaded, resolveTerminalFontFamilyChange } from './terminalFontLoader';

describe('ensureTerminalFontLoaded', () => {
  it('waits for the selected family before a canvas terminal remeasures it', async () => {
    const load = vi.fn().mockResolvedValue([]);

    await ensureTerminalFontLoaded("'Assistant JetBrains Mono', ui-monospace, monospace", { load });

    expect(load).toHaveBeenCalledWith(
      "400 13px 'Assistant JetBrains Mono', ui-monospace, monospace",
      'Assistant',
    );
  });

  it('allows the terminal to fall back when the selected font cannot load', async () => {
    const load = vi.fn().mockRejectedValue(new Error('font unavailable'));

    await expect(
      ensureTerminalFontLoaded("'Assistant Fira Code'", { load }),
    ).resolves.toBeUndefined();
  });
});

describe('resolveTerminalFontFamilyChange', () => {
  it('normalizes changed families and rejects empty or unchanged values', () => {
    expect(resolveTerminalFontFamilyChange('', "  'Assistant Fira Code'  ")).toBe(
      "'Assistant Fira Code'",
    );
    expect(
      resolveTerminalFontFamilyChange("'Assistant Fira Code'", " 'Assistant Fira Code' "),
    ).toBeNull();
    expect(resolveTerminalFontFamilyChange("'Assistant Fira Code'", '   ')).toBeNull();
  });
});
