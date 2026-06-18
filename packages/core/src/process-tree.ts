import type { ChildProcess } from "node:child_process";

/**
 * Signal a detached child process group so shells and their descendants stop
 * together. Falls back to signalling the child directly when the process group
 * is already gone or unavailable.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  try {
    if (pid) {
      process.kill(-pid, signal);
      return;
    }
  } catch {
    // Process group may already be gone; fall back to direct signalling.
  }
  try {
    child.kill(signal);
  } catch {
    // best effort
  }
}
