import { describe, expect, it } from 'vitest';

import {
  MAX_PANEL_CUSTOM_TITLE_LENGTH,
  resolvePanelDisplayTitle,
  resolvePanelFallbackTitle,
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

  it('prefers metadata title over manifest title when no customTitle exists', () => {
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
        { manifestTitle: 'Lists' },
      ),
    ).toBe('Lists (team)');
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
