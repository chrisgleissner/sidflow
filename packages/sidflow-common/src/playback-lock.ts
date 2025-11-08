import process from "node:process";
import path from "node:path";
import { unlink, readFile, writeFile } from "node:fs/promises";
import { ensureDir } from "./fs.js";
import type { SidflowConfig } from "./config.js";

export interface PlaybackLockMetadata {
  pid: number;
  command: string;
  sidPath?: string;
  source?: string;
  startedAt: string;
  offsetSeconds?: number;
  durationSeconds?: number;
  isPaused?: boolean;
}

const LOCK_FILENAME = ".sidflow-playback.lock";

function getLockPath(config: SidflowConfig): string {
  const hvscDir = path.resolve(config.hvscPath);
  const parentDir = path.dirname(hvscDir);
  return path.join(parentDir, LOCK_FILENAME);
}

async function waitForProcessExit(pid: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return;
      }
      throw error;
    }
  }
}

async function readLock(lockPath: string): Promise<PlaybackLockMetadata | null> {
  try {
    const data = await readFile(lockPath, "utf8");
    return JSON.parse(data) as PlaybackLockMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeLock(lockPath: string, metadata: PlaybackLockMetadata): Promise<void> {
  await ensureDir(path.dirname(lockPath));
  await writeFile(lockPath, JSON.stringify(metadata, null, 2), "utf8");
}

async function clearLock(lockPath: string): Promise<void> {
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export class PlaybackLock {
  private lockPath: string;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  async stopExistingPlayback(reason: string): Promise<void> {
    const existing = await readLock(this.lockPath);
    if (!existing) {
      return;
    }

    if (existing.pid && existing.pid !== process.pid) {
      try {
        process.kill(existing.pid, "SIGTERM");
        await waitForProcessExit(existing.pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          console.warn(
            `[playback-lock] Failed to stop existing playback (pid=${existing.pid}, command=${existing.command}) for ${reason}:`,
            error
          );
        }
      }
    }

    await clearLock(this.lockPath);
  }

  async registerProcess(metadata: PlaybackLockMetadata): Promise<void> {
    await writeLock(this.lockPath, metadata);
  }

  async releaseIfMatches(pid?: number): Promise<void> {
    if (!pid) {
      return;
    }
    const existing = await readLock(this.lockPath);
    if (!existing) {
      return;
    }
    if (existing.pid === pid) {
      await clearLock(this.lockPath);
    }
  }

  async forceRelease(): Promise<void> {
    await clearLock(this.lockPath);
  }

  async getMetadata(): Promise<PlaybackLockMetadata | null> {
    return await readLock(this.lockPath);
  }

  async updateMetadata(metadata: PlaybackLockMetadata): Promise<void> {
    await writeLock(this.lockPath, metadata);
  }

  get path(): string {
    return this.lockPath;
  }
}

export async function createPlaybackLock(
  config: SidflowConfig
): Promise<PlaybackLock> {
  const lockPath = getLockPath(config);
  return new PlaybackLock(lockPath);
}
