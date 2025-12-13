/**
 * E2E Test: Classification Heartbeat - No Stale Threads
 *
 * Validates that the heartbeat emitted by the classification process prevents
 * threads from appearing stale during long-running work (rendering + tagging).
 *
 * Regression coverage for the "(STALE)" indicator shown during "Extracting features".
 */

import { test, expect } from './test-hooks';
import type { APIRequestContext } from '@playwright/test';
import { withClassificationLock } from './utils/classification-lock';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

interface ThreadStatus {
  id: number;
  status: 'idle' | 'working';
  phase?: string;
  stale?: boolean;
  currentFile?: string;
  updatedAt?: number;
}

interface ProgressResponse {
  success?: boolean;
  data?: ProgressSnapshot;
  phase?: string;
  isActive?: boolean;
  perThread?: ThreadStatus[];
  processedFiles?: number;
  totalFiles?: number;
  percentComplete?: number;
}

interface ProgressSnapshot {
  phase: string;
  isActive: boolean;
  perThread: ThreadStatus[];
  processedFiles?: number;
  totalFiles?: number;
  percentComplete?: number;
}

const ACTIVE_PHASES = new Set(['analyzing', 'building', 'metadata', 'tagging']);
const POLL_INTERVAL_MS = 500;
const MAX_POLL_MS = 15_000;
const MAX_INACTIVE_POLLS = 3;

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const TEST_DIR = 'C64Music/MUSICIANS/T/Test_E2E_Heartbeat';
const TEST_DIR_REL = TEST_DIR.replace(/^C64Music[\\/]/, '');
const SID_BASE_DIR = path.join(REPO_ROOT, 'test-workspace', 'hvsc');
const AUDIO_CACHE_DIR = path.join(REPO_ROOT, 'test-workspace', 'audio-cache');

function createSidFile(title: string, author: string): Buffer {
  const headerSize = 124;
  const codeSize = 4;
  const buffer = Buffer.alloc(headerSize + codeSize);

  buffer.write('PSID', 0);
  buffer.writeUInt16BE(0x0002, 4);
  buffer.writeUInt16BE(headerSize, 6);
  buffer.writeUInt16BE(0x1000, 8);
  buffer.writeUInt16BE(0x1000, 10);
  buffer.writeUInt16BE(0x1003, 12);
  buffer.writeUInt16BE(0x0001, 14);
  buffer.writeUInt16BE(0x0001, 16);
  buffer.writeUInt32BE(0x00000001, 18);
  buffer.write(title.slice(0, 31), 22);
  buffer.write(author.slice(0, 31), 54);
  buffer.write('2025 Heartbeat E2E', 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4c, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);

  return buffer;
}

function createWavFile(durationSec: number, freq: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * freq * t);
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + i * 2);
  }

  return buffer;
}

async function waitForClassificationIdle(request: APIRequestContext, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await request.get('/api/classify/progress');
      if (response.ok()) {
        const body = (await response.json()) as ProgressResponse;
        const progress = body.data ?? body;
        if (!progress.isActive || progress.phase === 'idle' || progress.phase === 'completed') {
          return;
        }
      } else {
        return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('Timed out waiting for classification to become idle');
}

async function pauseClassification(request: APIRequestContext): Promise<void> {
  try {
    await request.post('/api/classify/control', { data: { action: 'pause' } });
  } catch {
    // Best-effort cleanup; ignore errors
  }
}

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'Runs once per suite to avoid duplicate classification runs');
test.setTimeout(120_000);

test('Classification Heartbeat - threads should not become stale during feature extraction', async ({ request }) => {
  await withClassificationLock(async () => {
    const startedAt = Date.now();
    console.log('[heartbeat] ensuring classification is idle before starting');
    // If a previous attempt left a classify run behind (e.g. worker retries), stop it first.
    await pauseClassification(request);
    await waitForClassificationIdle(request, 20_000);

    try {
      // Create a small synthetic directory so classification stays fast and deterministic.
      const sidDir = path.join(SID_BASE_DIR, TEST_DIR);
      await fs.mkdir(sidDir, { recursive: true });
      for (let i = 0; i < 8; i += 1) {
        const name = `HB_Test_${String(i + 1).padStart(2, '0')}`;
        const sidPath = path.join(sidDir, `${name}.sid`);
        await fs.writeFile(sidPath, createSidFile(name, 'Heartbeat E2E'));

        const wavPath = path.join(AUDIO_CACHE_DIR, TEST_DIR_REL, `${name}.wav`);
        await fs.mkdir(path.dirname(wavPath), { recursive: true });
        const wavBuffer = createWavFile(1, 220 + i * 30);
        await fs.writeFile(wavPath, wavBuffer);
        // Avoid expensive/async hash generation during classification by pre-writing the expected .sha256.
        const sha256 = crypto.createHash('sha256').update(wavBuffer).digest('hex');
        await fs.writeFile(`${wavPath}.sha256`, sha256, 'utf8');
      }

      console.log('[heartbeat] starting background classification run');
      const startResponse = await request.post('/api/classify', {
        data: {
          path: TEST_DIR,
          forceRebuild: false,
          deleteWavAfterClassification: false,
          skipAlreadyClassified: false,
          async: true,
        },
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });
      console.log('[heartbeat] classify start response status', startResponse.status());

      const startData = ((await startResponse.json().catch(() => ({}))) || {}) as {
        error?: string;
        details?: string;
      };
      const alreadyRunning =
        startData.error?.includes('already running') || startData.details?.includes('already running');
      expect(
        startResponse.ok() || alreadyRunning,
        `Failed to start classification: ${JSON.stringify(startData)}`
      ).toBe(true);
      console.log('[heartbeat] classification start request accepted');

      const staleSnapshots: Array<{
        timestamp: number;
        phase: string;
        staleThreads: ThreadStatus[];
      }> = [];

      let activePolls = 0;
      let pollCount = 0;
      let classificationComplete = false;
      let lastProgress: ProgressSnapshot | null = null;
      const startTime = Date.now();

      while (Date.now() - startTime < MAX_POLL_MS && (!classificationComplete || activePolls === 0)) {
        const progressResponse = await request.get('/api/classify/progress');
        if (!progressResponse.ok()) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }

        const rawProgress = (await progressResponse.json()) as ProgressResponse;
        const progress: ProgressSnapshot = rawProgress.data ?? {
          phase: rawProgress.phase ?? 'unknown',
          isActive: rawProgress.isActive ?? false,
          perThread: rawProgress.perThread ?? [],
          processedFiles: rawProgress.processedFiles,
          totalFiles: rawProgress.totalFiles,
          percentComplete: rawProgress.percentComplete,
        };

        lastProgress = progress;
        pollCount += 1;

        const phase = progress.phase ?? 'unknown';
        const perThread = progress.perThread ?? [];
        const workingThreads = perThread.filter((t) => t.status === 'working');
        const staleThreads = perThread.filter((t) => t.stale);

        if (pollCount === 1 || pollCount % 5 === 0) {
          console.log(
            `[heartbeat] poll=${pollCount} phase=${phase} active=${progress.isActive} stale=${staleThreads.length} ` +
              `working=${workingThreads.length}`
          );
        }

        if (progress.isActive || workingThreads.length > 0) {
          activePolls += 1;
        }

        if (staleThreads.length > 0) {
          staleSnapshots.push({
            timestamp: Date.now() - startTime,
            phase,
            staleThreads: staleThreads.map((t) => ({ ...t })),
          });
        }

        if (phase === 'completed' || phase === 'error' || progress.isActive === false) {
          classificationComplete = true;
          if (activePolls > 0) {
            break;
          }
        }

        if (!progress.isActive && activePolls === 0 && pollCount >= MAX_INACTIVE_POLLS) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      console.log(
        `[heartbeat] finished after ${(Date.now() - startedAt) / 1000}s ` +
          `(polls=${pollCount}, activePolls=${activePolls}, staleIncidents=${staleSnapshots.length}, ` +
          `lastPhase=${lastProgress?.phase ?? 'unknown'})`
      );

      const activePhaseStales = staleSnapshots.filter((s) => ACTIVE_PHASES.has(s.phase));
      expect(
        activePhaseStales.length,
        `No threads should become stale during classification (incidents: ${JSON.stringify(activePhaseStales, null, 2)})`
      ).toBe(0);

      expect(activePolls).toBeGreaterThan(0);
    } finally {
      // Always clean up so retries/other specs start from a known idle state.
      await pauseClassification(request);
      await waitForClassificationIdle(request, 20_000).catch(() => {});
      await fs.rm(path.join(SID_BASE_DIR, TEST_DIR), { recursive: true, force: true }).catch(() => {});
      await fs.rm(path.join(AUDIO_CACHE_DIR, TEST_DIR_REL), { recursive: true, force: true }).catch(() => {});
    }
  });
});
