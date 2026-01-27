#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stampPath = path.join(repoRoot, '.build-service', 'npm-installed');
const buildCli = process.platform === 'win32' ? 'build-cli.exe' : 'build-cli';

const run = (args, label) =>
  new Promise((resolve, reject) => {
    const child = spawn(buildCli, args, {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });

const main = async () => {
  let hasStamp = false;
  try {
    await fs.access(stampPath);
    hasStamp = true;
  } catch {
    hasStamp = false;
  }

  if (!hasStamp) {
    await run(['npm', 'install'], 'build-cli npm install');
    await fs.mkdir(path.dirname(stampPath), { recursive: true });
    await fs.writeFile(stampPath, new Date().toISOString(), 'utf8');
  }

  await run(['node', 'scripts/build-parallel.mjs'], 'build-cli build-parallel');
};

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
