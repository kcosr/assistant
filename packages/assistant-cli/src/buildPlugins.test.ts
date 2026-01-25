import { describe, expect, it } from 'vitest';

const { formatSkillsDocument, shouldExportSkills } = require('../../../scripts/build-plugins.js');

describe('build-plugins skill helpers', () => {
  it('injects skill metadata into frontmatter', () => {
    const manifest = {
      id: 'demo',
      description: 'Demo plugin',
      version: '0.1.0',
      operations: [],
    };

    const doc = formatSkillsDocument({
      manifest,
      extra: null,
      metadata: { author: 'kcosr', version: '0.10.0' },
    });

    expect(doc).toContain('metadata:');
    expect(doc).toContain('  author: "kcosr"');
    expect(doc).toContain('  version: "0.10.0"');
  });

  it('allows skills export overrides', () => {
    expect(shouldExportSkills({ skills: { autoExport: false } }, false)).toBe(false);
    expect(shouldExportSkills({ skills: { autoExport: false } }, true)).toBe(true);
    expect(shouldExportSkills({}, false)).toBe(true);
  });
});
