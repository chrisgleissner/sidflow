import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-worker mutex for tests that trigger /api/classify.
 *
 * Playwright runs spec files in parallel across workers, but the classification backend is singleton.
 * Without an explicit lock, "wait for idle" logic can flake when two workers attempt to classify.
 */

const STALE_LOCK_AGE_MS = 120_000; // Consider lock stale after 2 minutes

async function cleanupStaleLock(lockPath: string): Promise<void> {
  try {
    const content = await fs.readFile(lockPath, 'utf8');
    const [, timestamp] = content.split('-');
    if (timestamp) {
      const lockTime = parseInt(timestamp, 10);
      if (!isNaN(lockTime) && Date.now() - lockTime > STALE_LOCK_AGE_MS) {
        console.log(`[classification-lock] Removing stale lock (age: ${Math.round((Date.now() - lockTime) / 1000)}s)`);
        await fs.rm(lockPath, { force: true });
      }
    }
  } catch {
    // Lock file doesn't exist or can't be read - that's fine
  }
}

export async function withClassificationLock<T>(
  fn: () => Promise<T>,
  options: {
    lockPath?: string;
    timeoutMs?: number;
    pollMs?: number;
  } = {}
): Promise<T> {
  const lockPath = options.lockPath ?? path.resolve(process.cwd(), '..', '..', 'test-workspace', '.classify.lock');
  const timeoutMs = options.timeoutMs ?? 90_000; // Increased from 60s to 90s
  const pollMs = options.pollMs ?? 250;
  const start = Date.now();

  // Ensure parent directory exists (test-workspace is created by setup-test-workspace.mjs).
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  
  // Clean up stale locks from crashed test runs
  await cleanupStaleLock(lockPath);

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let acquired = false;

  while (Date.now() - start < timeoutMs) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(token, { encoding: 'utf8' });
      } finally {
        await handle.close();
      }
      acquired = true;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (!acquired) {
    let details = '';
    try {
      details = await fs.readFile(lockPath, 'utf8');
    } catch {
      // ignore
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for classification lock at ${lockPath}` +
        (details ? ` (held by ${details.trim()})` : '')
    );
  }

  try {
    return await fn();
  } finally {
    // Best-effort cleanup; avoid failing the test on unlock issues.
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

