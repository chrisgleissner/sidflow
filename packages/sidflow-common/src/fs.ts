import { mkdir, stat } from "node:fs/promises";
import * as os from "node:os";

/**
 * Get the temporary directory path, respecting SIDFLOW_TMPDIR environment variable.
 * Falls back to system tmpdir() if not set.
 * 
 * Set SIDFLOW_TMPDIR to use a custom location (e.g., /opt/sidflow/tmp instead of /tmp).
 * This is useful for systems where /tmp has limited space.
 */
export function getTmpDir(): string {
  return process.env.SIDFLOW_TMPDIR || os.tmpdir();
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
