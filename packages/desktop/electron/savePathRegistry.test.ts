import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SavePathRegistry } from './savePathRegistry';

describe('SavePathRegistry', () => {
  it('allows a path returned by the save dialog once', () => {
    const registry = new SavePathRegistry();
    const approvedPath = registry.approve('/tmp/report.html');

    expect(registry.consume(approvedPath)).toBe(path.resolve('/tmp/report.html'));
    expect(() => registry.consume(approvedPath)).toThrow('Save path was not approved');
  });

  it('rejects paths that were not approved', () => {
    const registry = new SavePathRegistry();

    expect(() => registry.consume('/tmp/other.html')).toThrow('Save path was not approved');
  });
});
