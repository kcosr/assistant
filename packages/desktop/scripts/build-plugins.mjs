/**
 * Cross-platform wrapper to run the root build-plugins.js script.
 * Avoids Windows path issues with forward slashes in npm scripts.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const scriptPath = resolve(repoRoot, 'scripts', 'build-plugins.js');

const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
