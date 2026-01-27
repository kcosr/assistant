#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (args, label) =>
  new Promise((resolve, reject) => {
    const child = spawn(npmCmd, args, {
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
  const started = Date.now();
  const logTime = () => ((Date.now() - started) / 1000).toFixed(1);

  try {
    console.log(`[build] ${logTime()}s: build @assistant/shared`);
    await run(['run', 'build', '-w', '@assistant/shared'], 'shared');

    console.log(`[build] ${logTime()}s: build @assistant/coding-executor`);
    await run(['run', 'build', '-w', '@assistant/coding-executor'], 'coding-executor');

    console.log(`[build] ${logTime()}s: build remaining workspaces in parallel`);
    await Promise.all([
      run(['run', 'build', '-w', '@assistant/agent-server'], 'agent-server'),
      run(['run', 'build', '-w', '@assistant/web-client'], 'web-client'),
      run(['run', 'build:plugins'], 'build:plugins'),
      run(['run', 'build', '-w', '@assistant/assistant-cli'], 'assistant-cli'),
      run(['run', 'build', '-w', '@assistant/coding-sidecar'], 'coding-sidecar'),
      run(['run', 'build', '-w', '@assistant/notify-proxy'], 'notify-proxy'),
    ]);

    console.log(`[build] ${logTime()}s: done`);
  } catch (err) {
    console.error(`[build] ${logTime()}s: ${err?.message ?? err}`);
    process.exit(1);
  }
};

main();
