import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureTool, getToolPath, type ToolId } from './toolsManager';

// Check if tools are installed in common system paths (used to skip certain tests)
const rgInstalledGlobally = existsSync('/usr/bin/rg') || existsSync('/usr/local/bin/rg');
const fdInstalledGlobally = existsSync('/usr/bin/fd') || existsSync('/usr/local/bin/fd');

describe('toolsManager', () => {
  it('getToolPath returns path when tool is available on PATH', () => {
    const originalPath = process.env['PATH'];
    const tempDir = mkdtempSync(path.join(tmpdir(), 'tools-manager-positive-path-'));
    const rgPath = path.join(tempDir, 'rg');

    writeFileSync(rgPath, '#!/bin/sh\necho "ripgrep 1.0.0"\nexit 0\n', { encoding: 'utf-8' });
    chmodSync(rgPath, 0o755);

    process.env['PATH'] = `${tempDir}${path.delimiter}${originalPath ?? ''}`;

    try {
      const result = getToolPath('rg');
      expect(result).not.toBeNull();
      expect(result).toContain('rg');
    } finally {
      process.env['PATH'] = originalPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('getToolPath finds tools in common system paths', () => {
    // This test verifies the fallback to common paths works
    // Skip assertions for tools not installed on this system
    if (rgInstalledGlobally) {
      const result = getToolPath('rg');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\/rg$/);
    }
    if (fdInstalledGlobally) {
      const result = getToolPath('fd');
      expect(result).not.toBeNull();
      expect(result).toMatch(/\/fd$/);
    }
    if (!rgInstalledGlobally && !fdInstalledGlobally) {
      // At least verify the function runs without error
      expect(getToolPath('rg')).toBeDefined();
    }
  });

  it('getToolPath returns null for non-existent tools', () => {
    // Use a tool name that definitely doesn't exist
    const result = getToolPath('nonexistent-tool-xyz-123' as ToolId);
    expect(result).toBeNull();
  });

  it('ensureTool returns path for available tools', async () => {
    if (rgInstalledGlobally) {
      const result = await ensureTool('rg', true);
      expect(result).not.toBeNull();
    }
    if (fdInstalledGlobally) {
      const result = await ensureTool('fd', true);
      expect(result).not.toBeNull();
    }
  });
});
