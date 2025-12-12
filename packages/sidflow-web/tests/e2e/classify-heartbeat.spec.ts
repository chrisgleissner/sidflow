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

test('Classification Heartbeat - threads should not become stale during feature extraction', async ({ request }) => {
  const startedAt = Date.now();
  console.log('[heartbeat] ensuring classification is idle before starting');
  await waitForClassificationIdle(request);

  const startResponse = await request.post('/api/classify', {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });

  const startData = ((await startResponse.json().catch(() => ({}))) || {}) as { error?: string; details?: string };
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

  if (!classificationComplete && (lastProgress?.isActive ?? false)) {
    await pauseClassification(request);
    await waitForClassificationIdle(request, 5_000).catch(() => {});
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
});
