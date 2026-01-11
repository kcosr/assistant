/**
 * Keys injected by npm that should be excluded when spawning CLI processes.
 * These can interfere with module resolution and authentication in child processes.
 */
const NPM_INJECTED_KEYS = new Set(['INIT_CWD']);

/**
 * Build a clean environment for spawning CLI processes.
 * Filters out npm-injected variables that can interfere with child process behavior.
 */
export function buildCliEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!key || /^npm_/i.test(key) || NPM_INJECTED_KEYS.has(key)) {
      continue;
    }
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Clean npm-injected paths from PATH
  if (env['PATH']) {
    env['PATH'] = env['PATH']
      .split(':')
      .filter((p) => !p.includes('/node_modules/.bin'))
      .join(':');
  }

  return env;
}
