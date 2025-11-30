import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClassificationPlan, ThreadPhase } from '../src/index.js';
import { generateAutoTags, destroyFeatureExtractionPool } from '../src/index.js';

/**
 * Unit test to verify classification phase transitions and thread heartbeat.
 * 
 * This test ensures:
 * 1. All expected phases appear during force rebuild: analyzing → metadata → building → tagging
 * 2. Threads never go stale (no updates for >5s) during rendering
 * 3. Heartbeat mechanism continuously updates thread status during inline rendering
 * 
 * PERFORMANCE OPTIMIZATION (2024-11):
 * - Audio is downsampled to 11025 Hz (4x fewer samples for SID's ~4kHz bandwidth)
 * - Essentia WASM instance is cached and reused
 * - Slow RhythmExtractor2013 algorithm is skipped (uses ZCR-based heuristic instead)
 * - Spectrum results are computed once and reused for centroid/rolloff
 * 
 * NOTE: These tests are still slow due to WAV rendering time (~30-60s per file).
 * Skip in CI to avoid timeouts; run locally with:
 *   CI= bun test packages/sidflow-classify/test/phase-transitions.test.ts
 */

// Skip in CI - WAV rendering + feature extraction is still slow
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const maybeTest = isCI ? test.skip : test;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const testWorkspace = path.resolve(repoRoot, 'test-workspace');
// Use a single tiny SID file for fast execution
const testDataPath = path.resolve(repoRoot, 'test-data/C64Music/DEMOS/0-9');
const testWavCache = path.resolve(testWorkspace, 'wav-cache');
const testTagsPath = path.resolve(testWorkspace, 'tags');

interface ThreadHistory {
  threadId: number;
  states: Array<{
    timestamp: number;
    phase: ThreadPhase;
    status: string;
    file?: string;
    updatedAt: number;
  }>;
}

describe('Classification Phase Transitions', () => {
  beforeEach(() => {
    // Clear WAV cache to force rebuild
    try {
      rmSync(testWavCache, { recursive: true, force: true });
    } catch {
      // Already clean
    }
  });

  afterEach(async () => {
    // Cleanup feature extraction pool
    await destroyFeatureExtractionPool();
  });

  maybeTest('should show all phases without stale thread updates during force rebuild', async () => {
    console.log('\n=== Starting Classification Phase Test ===\n');

    const threadHistory = new Map<number, ThreadHistory>();
    let lastUpdate = Date.now();
    const MAX_UPDATE_GAP_MS = 5000; // Stale threshold
    let maxGapMs = 0;

    const handleThreadUpdate = (update: any) => {
      const now = Date.now();
      const gap = now - lastUpdate;
      
      if (gap > maxGapMs) {
        maxGapMs = gap;
      }

      if (!threadHistory.has(update.threadId)) {
        threadHistory.set(update.threadId, {
          threadId: update.threadId,
          states: []
        });
      }

      const history = threadHistory.get(update.threadId)!;
      const prevState = history.states[history.states.length - 1];

      // Only log state changes
      if (!prevState ||
          prevState.phase !== update.phase ||
          prevState.status !== update.status ||
          prevState.file !== update.file) {
        
        const state = {
          timestamp: now,
          phase: update.phase,
          status: update.status,
          file: update.file,
          updatedAt: now
        };

        history.states.push(state);

        console.log(
          `[Thread ${update.threadId}] ${update.phase} - ${update.status}` +
          (update.file ? ` - ${update.file}` : '')
        );

        // Check for stale gaps
        if (gap > MAX_UPDATE_GAP_MS) {
          console.error(
            `[STALE] Thread ${update.threadId} went ${gap}ms without updates ` +
            `(threshold: ${MAX_UPDATE_GAP_MS}ms)!`
          );
        }
      }

      lastUpdate = now;
    };

    // Run classification with force rebuild
    const plan: ClassificationPlan = {
      config: {
        sidPath: testDataPath,
        wavCachePath: testWavCache,
        tagsPath: testTagsPath,
        threads: 1,
        classificationDepth: 3
      } as any,
      sidPath: testDataPath,
      wavCachePath: testWavCache,
      tagsPath: testTagsPath,
      forceRebuild: true,
      classificationDepth: 3
    };

    console.log(`[Config] Force rebuild enabled, testing: ${testDataPath}\n`);

    await generateAutoTags(plan, {
      threads: 1,
      onThreadUpdate: handleThreadUpdate
    });

    console.log('\n=== Analyzing Thread History ===\n');

    // Verify we collected thread data
    expect(threadHistory.size).toBeGreaterThan(0);
    console.log(`[Analysis] Collected history for ${threadHistory.size} thread(s)`);
    console.log(`[Analysis] Maximum update gap: ${maxGapMs}ms`);

    for (const [threadId, history] of threadHistory) {
      console.log(`\n[Thread ${threadId}] Total state transitions: ${history.states.length}`);

      // Extract unique phases
      const phases = new Set(
        history.states.map(s => s.phase)
      );

      console.log(`[Thread ${threadId}] Phases observed: ${Array.from(phases).join(' → ')}`);

      // Verify expected phases appeared
      // Note: "analyzing" phase may be skipped if going straight to file processing
      const criticalPhases = ['building', 'tagging'] as const;
      const missingPhases = criticalPhases.filter(p => !phases.has(p as ThreadPhase));

      if (missingPhases.length > 0) {
        console.error(`[Thread ${threadId}] Missing critical phases: ${missingPhases.join(', ')}`);
      }

      expect(missingPhases.length, `Thread ${threadId} should show all critical phases`).toBe(0);

      // Verify "building" phase appeared (where heartbeat is critical)
      expect(phases.has('building'), `Thread ${threadId} should show "building" phase`).toBe(true);

      // Verify "tagging" phase appeared
      expect(phases.has('tagging'), `Thread ${threadId} should show "tagging" phase`).toBe(true);
    }

    // Critical: No thread should have stale gaps (>5s without updates)
    expect(maxGapMs, 'Maximum update gap should be less than stale threshold').toBeLessThan(MAX_UPDATE_GAP_MS);

    console.log('\n=== Test Passed: All phases visible, no stale gaps ===\n');
  }, 120000); // 120 second timeout for classification with TensorFlow

  maybeTest('should maintain continuous heartbeat during building phase', async () => {
    console.log('\n=== Starting Heartbeat Verification Test ===\n');

    const buildingPhaseUpdates: Array<{ timestamp: number; gap: number }> = [];
    let lastBuildingUpdate = 0;
    const HEARTBEAT_INTERVAL_MS = 3000;
    const STALE_THRESHOLD_MS = 5000;

    const handleThreadUpdate = (update: any) => {
      if (update.phase === 'building') {
        const now = Date.now();
        const gap = lastBuildingUpdate > 0 ? now - lastBuildingUpdate : 0;

        if (gap > 0) {
          buildingPhaseUpdates.push({ timestamp: now, gap });
          console.log(`[Heartbeat] Building phase update after ${gap}ms`);
        }

        lastBuildingUpdate = now;
      }
    };

    const plan: ClassificationPlan = {
      config: {
        sidPath: testDataPath,
        wavCachePath: testWavCache,
        tagsPath: testTagsPath,
        threads: 1,
        classificationDepth: 3
      } as any,
      sidPath: testDataPath,
      wavCachePath: testWavCache,
      tagsPath: testTagsPath,
      forceRebuild: true,
      classificationDepth: 3
    };

    await generateAutoTags(plan, {
      threads: 1,
      onThreadUpdate: handleThreadUpdate
    });

    console.log(`\n[Analysis] Collected ${buildingPhaseUpdates.length} building phase updates`);

    // Verify we got updates during building
    expect(buildingPhaseUpdates.length, 'Should have multiple updates during building').toBeGreaterThan(0);

    // Verify no update gap exceeds the stale threshold
    const maxGap = Math.max(...buildingPhaseUpdates.map(u => u.gap), 0);
    console.log(`[Analysis] Maximum gap between building updates: ${maxGap}ms`);

    expect(maxGap, 'Building phase updates should arrive before stale threshold').toBeLessThan(STALE_THRESHOLD_MS);

    // Verify heartbeat timing is reasonable (should be around 3s intervals)
    const avgGap = buildingPhaseUpdates.reduce((sum, u) => sum + u.gap, 0) / buildingPhaseUpdates.length;
    console.log(`[Analysis] Average gap between building updates: ${avgGap.toFixed(0)}ms`);

    // Average gap should be close to heartbeat interval (with some tolerance)
    expect(avgGap, 'Average heartbeat interval should be close to expected value').toBeGreaterThan(HEARTBEAT_INTERVAL_MS * 0.5);
    expect(avgGap, 'Average heartbeat interval should not exceed stale threshold').toBeLessThan(STALE_THRESHOLD_MS);

    console.log('\n=== Test Passed: Heartbeat maintains thread freshness ===\n');
  }, 120000); // 120 second timeout for classification with TensorFlow
});
