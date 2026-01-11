import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export type ToolId = 'fd' | 'rg';

// Common installation paths to check if PATH lookup fails
const COMMON_PATHS = ['/usr/bin', '/usr/local/bin', '/bin', '/opt/homebrew/bin'];

function findInPath(cmd: string): string | null {
  try {
    const result = spawnSync('which', [cmd], { encoding: 'utf-8', timeout: 5000 });
    if (result.error || result.status !== 0) {
      return null;
    }
    const path = result.stdout?.trim();
    return path && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

function commandWorks(binaryPath: string): boolean {
  try {
    const result = spawnSync(binaryPath, ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
      env: process.env,
    });
    if (result.error) return false;
    if (typeof result.status !== 'number') return false;
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getToolPath(tool: ToolId): string | null {
  const binaryName = tool;

  // First try to find via which (respects PATH)
  const whichPath = findInPath(binaryName);
  if (whichPath && commandWorks(whichPath)) {
    return whichPath;
  }

  // Fall back to checking common paths directly
  for (const dir of COMMON_PATHS) {
    const fullPath = `${dir}/${binaryName}`;
    if (existsSync(fullPath) && commandWorks(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

export async function ensureTool(tool: ToolId, silent: boolean = false): Promise<string | null> {
  const path = getToolPath(tool);
  if (path) {
    return path;
  }

  if (!silent) {
    console.log(`[toolsManager] Tool '${tool}' not found on PATH`);
  }

  return null;
}
