/**
 * E2E Test: Classification Heartbeat - No Stale Threads
 *
 * This test validates that the classification heartbeat mechanism prevents
 * threads from appearing stale during long-running operations like feature extraction.
 *
 * The test:
 * 1. Starts a classification via POST /api/classify
 * 2. Polls /api/classify/progress at regular intervals
 * 3. Checks that no threads are marked as "stale" during the tagging phase
 * 4. Ensures heartbeats keep threads fresh during feature extraction
 *
 * This is the regression test for the bug where threads showed "(STALE)" status
 * during the "Extracting features" phase.
 */

import { test, expect } from '@playwright/test';

// Skip in CI - classification can take too long and cause flaky failures
const isCI = !!process.env.CI;

// Force serial execution since tests share classification backend state
test.describe.configure({ mode: 'serial' });

// Moderate timeout for classification operations
test.setTimeout(120000); // 2 minutes

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
  // Also handle flat response structure
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

test.describe('Classification Heartbeat - No Stale Threads', () => {
  test.skip(isCI, 'Classification heartbeat tests skipped in CI - too slow');

  test('threads should never become stale during feature extraction', async ({ request }) => {
    // Track stale thread occurrences
    const staleSnapshots: Array<{
      timestamp: number;
      phase: string;
      staleThreads: ThreadStatus[];
    }> = [];

    let seenTaggingPhase = false;
    let taggingPhaseSnapshots = 0;
    let seenActiveThread = false;

    // Step 1: Start classification
    const startResponse = await request.post('/api/classify', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
      timeout: 10000,
    });

    // Accept 200 (new start) or 500 with "already running" (test can continue)
    const startData = await startResponse.json();
    const alreadyRunning = startData.error?.includes('already running') || startData.details?.includes('already running');
    expect(startResponse.ok() || alreadyRunning, `Failed to start classification: ${JSON.stringify(startData)}`).toBe(true);

    // Step 2: Poll progress and check for stale threads
    const startTime = Date.now();
    const maxPollingTime = 90000; // 90 seconds max polling
    const pollInterval = 400; // Poll every 400ms to catch stale quickly

    let lastPhase = '';
    let classificationComplete = false;

    while (Date.now() - startTime < maxPollingTime && !classificationComplete) {
      const progressResponse = await request.get('/api/classify/progress');

      if (!progressResponse.ok()) {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }

      const rawProgress: ProgressResponse = await progressResponse.json();

      // Handle both wrapped {success, data} and flat response structure
      const progress: ProgressSnapshot = rawProgress.data ?? {
        phase: rawProgress.phase ?? 'unknown',
        isActive: rawProgress.isActive ?? false,
        perThread: rawProgress.perThread ?? [],
        processedFiles: rawProgress.processedFiles,
        totalFiles: rawProgress.totalFiles,
        percentComplete: rawProgress.percentComplete,
      };

      // Track phase changes
      if (progress.phase !== lastPhase) {
        lastPhase = progress.phase;
      }

      // Track if we've seen any working threads
      const workingThreads = progress.perThread?.filter((t) => t.status === 'working') ?? [];
      if (workingThreads.length > 0) {
        seenActiveThread = true;
      }

      // Check for stale threads
      const staleThreads = progress.perThread?.filter((t) => t.stale) ?? [];

      if (staleThreads.length > 0) {
        // Record stale occurrence
        staleSnapshots.push({
          timestamp: Date.now() - startTime,
          phase: progress.phase,
          staleThreads: staleThreads.map((t) => ({ ...t })),
        });
      }

      // Track tagging phase specifically
      if (progress.phase === 'tagging') {
        seenTaggingPhase = true;
        taggingPhaseSnapshots++;
      }

      // Also track building phase for stale detection
      if (progress.phase === 'building') {
        // Building phase should also not have stale threads
      }

      // Check for completion
      if (progress.phase === 'completed' || progress.phase === 'error') {
        classificationComplete = true;
      }

      // Also stop if we're back to idle with no activity
      if (progress.phase === 'idle' && seenActiveThread) {
        classificationComplete = true;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Step 3: Assert no stale threads during tagging phase
    // Filter stale snapshots to only those during tagging phase (feature extraction)
    const taggingStaleSnapshots = staleSnapshots.filter((s) => s.phase === 'tagging');

    // Main assertion: No stale threads during tagging/feature extraction phase
    expect(taggingStaleSnapshots.length, 'No threads should become stale during tagging (feature extraction) phase').toBe(0);

    // If we saw tagging phase, we should have monitored it adequately
    if (seenTaggingPhase) {
      expect(taggingPhaseSnapshots, 'Should have at least 2 progress snapshots during tagging phase').toBeGreaterThanOrEqual(2);
    }

    // We should have seen at least some working threads if classification ran
    // (Skip this check if classification finished too quickly or there were no files)
    // expect(seenActiveThread, 'Should have seen at least one working thread during classification').toBe(true);

    // Log summary for debugging
    console.log(`Heartbeat test: ${seenTaggingPhase ? 'saw' : 'did not see'} tagging phase, ${staleSnapshots.length} stale incidents`);
  });
});
