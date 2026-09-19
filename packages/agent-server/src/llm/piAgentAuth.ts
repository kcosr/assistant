import os from 'node:os';
import path from 'node:path';

function expandHomeDir(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function getPiAgentDir(): string {
  const envDir = process.env['PI_CODING_AGENT_DIR'];
  if (envDir) {
    return expandHomeDir(envDir);
  }
  return path.join(os.homedir(), '.pi', 'agent');
}
