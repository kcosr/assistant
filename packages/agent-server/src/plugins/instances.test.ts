import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { PluginConfig } from '../config';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstanceConfigs,
  resolvePluginInstanceDataDir,
  resolvePluginInstances,
} from './instances';

describe('plugin instances', () => {
  it('normalizes instance ids', () => {
    expect(normalizePluginInstanceId(' Work ')).toBe('work');
    expect(normalizePluginInstanceId('PERSONAL')).toBe('personal');
    expect(normalizePluginInstanceId('invalid id')).toBeNull();
    expect(normalizePluginInstanceId('')).toBeNull();
    expect(normalizePluginInstanceId(123)).toBeNull();
  });

  it('resolves configured instances with a default', () => {
    const pluginConfig: PluginConfig = {
      enabled: true,
      instances: ['Work', 'personal', 'default', 'invalid id'],
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = resolvePluginInstances('time-tracker', pluginConfig);
    warn.mockRestore();

    expect(resolved).toEqual([
      { id: DEFAULT_PLUGIN_INSTANCE_ID, label: 'Default' },
      { id: 'work', label: 'Work' },
      { id: 'personal', label: 'Personal' },
    ]);
  });

  it('resolves custom labels', () => {
    const pluginConfig: PluginConfig = {
      enabled: true,
      instances: [{ id: 'client-x', label: 'Client X' }],
    };

    const resolved = resolvePluginInstances('time-tracker', pluginConfig);

    expect(resolved).toEqual([
      { id: DEFAULT_PLUGIN_INSTANCE_ID, label: 'Default' },
      { id: 'client-x', label: 'Client X' },
    ]);
  });

  it('resolves instance data directories', () => {
    const baseDir = '/data/plugins/time-tracker';

    expect(resolvePluginInstanceDataDir(baseDir, DEFAULT_PLUGIN_INSTANCE_ID)).toBe(
      path.join(baseDir, DEFAULT_PLUGIN_INSTANCE_ID),
    );
    expect(resolvePluginInstanceDataDir(baseDir, 'work')).toBe(path.join(baseDir, 'work'));
  });

  it('resolves instance config overrides', () => {
    const pluginConfig: PluginConfig = {
      enabled: true,
      workspaceRoot: '/base',
      local: { workspaceRoot: '/base/local' },
      instances: [
        'work',
        { id: 'client', label: 'Client', workspaceRoot: '/client' },
        { id: 'override', config: { workspaceRoot: '/override' } },
        { id: 'default', label: 'Primary', workspaceRoot: '/primary' },
      ],
    };

    const resolved = resolvePluginInstanceConfigs('diff', pluginConfig);

    expect(resolved).toEqual([
      {
        id: DEFAULT_PLUGIN_INSTANCE_ID,
        label: 'Primary',
        config: {
          enabled: true,
          workspaceRoot: '/primary',
          local: { workspaceRoot: '/base/local' },
        },
      },
      {
        id: 'work',
        label: 'Work',
        config: {
          enabled: true,
          workspaceRoot: '/base',
          local: { workspaceRoot: '/base/local' },
        },
      },
      {
        id: 'client',
        label: 'Client',
        config: {
          enabled: true,
          workspaceRoot: '/client',
          local: { workspaceRoot: '/base/local' },
        },
      },
      {
        id: 'override',
        label: 'Override',
        config: {
          enabled: true,
          workspaceRoot: '/override',
          local: { workspaceRoot: '/base/local' },
        },
      },
    ]);
  });
});
