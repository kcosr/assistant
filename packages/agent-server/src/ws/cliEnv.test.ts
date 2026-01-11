import { describe, expect, it } from 'vitest';

import { buildCliEnv } from './cliEnv';

describe('buildCliEnv', () => {
  it('drops npm environment variables', () => {
    const env = buildCliEnv({
      PATH: '/bin',
      npm_config_cache: '/tmp/npm-cache',
      npm_package_name: 'assistant',
      NPM_CONFIG_USERCONFIG: '/tmp/.npmrc',
      HOME: '/home/test',
    });

    expect(env['PATH']).toBe('/bin');
    expect(env['HOME']).toBe('/home/test');
    expect(env['npm_config_cache']).toBeUndefined();
    expect(env['npm_package_name']).toBeUndefined();
    expect(env['NPM_CONFIG_USERCONFIG']).toBeUndefined();
  });

  it('drops INIT_CWD injected by npm', () => {
    const env = buildCliEnv({
      PATH: '/bin',
      INIT_CWD: '/home/kevin/git/assistant',
      HOME: '/home/test',
    });

    expect(env['PATH']).toBe('/bin');
    expect(env['HOME']).toBe('/home/test');
    expect(env['INIT_CWD']).toBeUndefined();
  });

  it('removes node_modules/.bin paths from PATH', () => {
    const env = buildCliEnv({
      PATH: '/project/node_modules/.bin:/usr/local/bin:/usr/bin:/home/user/.local/bin:/other/node_modules/.bin',
      HOME: '/home/test',
    });

    expect(env['PATH']).toBe('/usr/local/bin:/usr/bin:/home/user/.local/bin');
    expect(env['HOME']).toBe('/home/test');
  });
});
