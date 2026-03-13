import os from "node:os";

export function getLogicalCpuCount(): number {
  try {
    const cores = os.cpus().length;
    if (Number.isInteger(cores) && cores > 0) {
      return cores;
    }
  } catch {
    // Bun can route node:os CPU discovery through browser-like globals in some test runs.
    // Falling back to one worker preserves correct behavior without crashing classification.
  }

  return 1;
}