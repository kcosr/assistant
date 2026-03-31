import { describe, expect, it } from 'vitest';

import {
  MAX_PANEL_CUSTOM_TITLE_LENGTH,
  resolvePanelDisplayTitle,
  resolvePanelFallbackTitle,
  synthesizePanelEntityTitle,
  validatePanelCustomTitle,
} from './panelTitle';

describe('resolvePanelDisplayTitle', () => {
  it('prefers customTitle over metadata title', () => {
    expect(
      resolvePanelDisplayTitle(
        {
          panelType: 'lists',
          customTitle: 'Work Tasks',
          meta: { title: 'Lists (default)' },
        },
        { manifestTitle: 'Lists' },
      ),
    ).toBe('Work Tasks');
  });

  it('prefers synthesized title over metadata title when no customTitle exists', () => {
    expect(
      resolvePanelDisplayTitle(
        {
          panelType: 'lists',
          meta: { title: 'Lists (team)' },
        },
        { synthesizedTitle: 'Work Tasks (Scratch)', manifestTitle: 'Lists' },
      ),
    ).toBe('Work Tasks (Scratch)');
  });

  it('prefers metadata title over manifest title when no customTitle or synthesized title exists', () => {
    expect(
      resolvePanelDisplayTitle(
        {
          panelType: 'lists',
          meta: { title: 'Lists (team)' },
        },
        { manifestTitle: 'Lists' },
      ),
    ).toBe('Lists (team)');
  });

  it('falls back to manifest title and then panel type', () => {
    expect(resolvePanelDisplayTitle({ panelType: 'lists' }, { manifestTitle: 'Lists' })).toBe(
      'Lists',
    );
    expect(resolvePanelDisplayTitle({ panelType: 'lists' })).toBe('lists');
  });
});

describe('resolvePanelFallbackTitle', () => {
  it('ignores customTitle when computing placeholders and fallback labels', () => {
    expect(
      resolvePanelFallbackTitle(
        {
          panelType: 'lists',
          meta: { title: 'Lists (team)' },
        },
        { synthesizedTitle: 'Work Tasks (Scratch)', manifestTitle: 'Lists' },
      ),
    ).toBe('Work Tasks (Scratch)');

    expect(
      resolvePanelFallbackTitle(
        {
          panelType: 'lists',
          meta: { title: 'Lists (team)' },
        },
        { manifestTitle: 'Lists' },
      ),
    ).toBe('Lists (team)');
  });
});

describe('synthesizePanelEntityTitle', () => {
  it('uses the entity title and preserves non-default instance labels', () => {
    expect(synthesizePanelEntityTitle({ entityTitle: 'Test' })).toBe('Test');
    expect(
      synthesizePanelEntityTitle({
        entityTitle: 'Todo',
        instanceLabel: 'Scratch',
      }),
    ).toBe('Todo (Scratch)');
    expect(
      synthesizePanelEntityTitle({
        entityTitle: 'Ideas',
        instanceLabel: 'Default',
      }),
    ).toBe('Ideas');
  });
});

describe('validatePanelCustomTitle', () => {
  it('allows empty values and rejects titles longer than the maximum length', () => {
    expect(validatePanelCustomTitle('   ')).toBeNull();
    expect(validatePanelCustomTitle('a'.repeat(MAX_PANEL_CUSTOM_TITLE_LENGTH))).toBeNull();
    expect(validatePanelCustomTitle('a'.repeat(MAX_PANEL_CUSTOM_TITLE_LENGTH + 1))).toBe(
      `Panel name must be ${MAX_PANEL_CUSTOM_TITLE_LENGTH} characters or fewer.`,
    );
  });
});
