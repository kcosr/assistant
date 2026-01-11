/**
 * Registry for tracking active CLI child processes.
 * Allows cleanup of all CLI processes on server shutdown.
 */

import type { ChildProcess } from 'child_process';

interface TrackedProcess {
  child: ChildProcess;
  name: string;
}

const activeProcesses = new Map<number, TrackedProcess>();

export function registerCliProcess(child: ChildProcess, name: string): void {
  const pid = child.pid;
  if (typeof pid !== 'number' || pid <= 0) {
    return;
  }
  activeProcesses.set(pid, { child, name });

  child.once('exit', () => {
    activeProcesses.delete(pid);
  });
}

export function unregisterCliProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    activeProcesses.delete(pid);
  }
}

export function killAllCliProcesses(): void {
  const isPosix = process.platform !== 'win32';

  for (const [pid, { child, name }] of activeProcesses) {
    console.log(`[shutdown] Killing CLI process: ${name} (pid=${pid})`);

    // Kill process group first (to get subprocesses)
    if (isPosix && pid > 0) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Process group may already be gone
      }
    }

    // Then kill the child directly
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may already be gone
    }
  }

  // Give processes a moment to terminate, then force kill
  if (activeProcesses.size > 0) {
    setTimeout(() => {
      for (const [pid, { child }] of activeProcesses) {
        if (isPosix && pid > 0) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // ignore
          }
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      activeProcesses.clear();
    }, 1000).unref();
  }
}

export function getActiveCliProcessCount(): number {
  return activeProcesses.size;
}
