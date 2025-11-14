import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { SidflowConfig } from '@sidflow/common';
import { getSidflowConfig } from '@/lib/server-env';
import { PLAYBACK_ENGINES } from '@/lib/preferences/schema';

const execFileAsync = promisify(execFile);

export interface AdapterRecord {
  available: boolean;
  reasons?: string[];
  latencyMs?: number;
}

export type AdapterAvailability = Record<(typeof PLAYBACK_ENGINES)[number], AdapterRecord>;

export async function detectPlaybackAdapters(): Promise<AdapterAvailability> {
  const adapters: AdapterAvailability = {
    wasm: await detectWasm(),
    'sidplayfp-cli': await detectSidplayfpCli(),
    'stream-wav': await detectStreamingCache('wav'),
    'stream-m4a': await detectStreamingCache('m4a'),
    ultimate64: await detectUltimate64(),
  };
  return adapters;
}

async function detectWasm(): Promise<AdapterRecord> {
  return { available: true };
}

async function detectSidplayfpCli(): Promise<AdapterRecord> {
  try {
    const start = performance.now();
    await execFileAsync('sidplayfp', ['--version'], { timeout: 2000 });
    const latencyMs = Math.round(performance.now() - start);
    return { available: true, latencyMs };
  } catch (error) {
    const reasons: string[] = [];
    if (error instanceof Error) {
      reasons.push(error.message);
    } else {
      reasons.push('sidplayfp CLI not detected');
    }
    return { available: false, reasons };
  }
}

async function detectStreamingCache(kind: 'wav' | 'm4a'): Promise<AdapterRecord> {
  let config: SidflowConfig;
  try {
    config = await getSidflowConfig();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SIDFlow config unavailable';
    return { available: false, reasons: [reason] };
  }

  const cacheRoot = config.wavCachePath;
  const exists = await pathExists(cacheRoot);
  if (!exists) {
    return {
      available: false,
      reasons: [`${cacheRoot} missing`],
    };
  }

  const extension = kind === 'wav' ? '.wav' : '.m4a';
  const hasFile = await directoryContainsExtension(cacheRoot, extension);
  if (!hasFile) {
    return {
      available: false,
  reasons: [`No ${extension} files found under ${cacheRoot}`],
    };
  }

  return { available: true };
}

async function directoryContainsExtension(root: string, extension: string): Promise<boolean> {
  const maxDepth = 3;
  const maxEntries = 2048;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (visited >= maxEntries) {
      return true;
    }
    visited += 1;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch (error) {
      console.warn('[playback-detect] Failed to read directory during scan', current.dir, error);
      continue;
    }

    for (const entry of entries) {
      const entryName = entry.name.toString();
      const entryPath = path.join(current.dir, entryName);
      if (entry.isFile()) {
        if (entryName.toLowerCase().endsWith(extension)) {
          return true;
        }
      } else if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

async function detectUltimate64(): Promise<AdapterRecord> {
  const host = process.env.SIDFLOW_ULTIMATE64_HOST;
  if (!host) {
    return {
      available: false,
      reasons: ['SIDFLOW_ULTIMATE64_HOST environment variable not set'],
    };
  }

  const protocol = process.env.SIDFLOW_ULTIMATE64_HTTPS === '1' ? 'https' : 'http';
  const url = `${protocol}://${host}/api/status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const start = performance.now();
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!response.ok) {
      return {
        available: false,
        reasons: [`Ultimate64 responded with HTTP ${response.status}`],
        latencyMs,
      };
    }
    return { available: true, latencyMs };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Ultimate64 probe failed';
    return { available: false, reasons: [reason] };
  } finally {
    clearTimeout(timeout);
  }
}