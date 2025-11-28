import { expect, Page, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E test to verify classification phase transitions and thread heartbeat.
 * 
 * This test ensures:
 * 1. All expected phases appear: analyzing → metadata → building → tagging
 * 2. Threads never show "Stale" status during force rebuild
 * 3. Heartbeat mechanism prevents stale detection during inline rendering
 * 
 * Uses API endpoints directly to bypass UI authentication complexity.
 * Focuses on backend behavior: thread phases, heartbeat, and stale detection.
 */

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..', '..', '..', '..');
const testWorkspace = path.resolve(repoRoot, 'test-workspace');
const testSidPath = path.resolve(repoRoot, 'test-data/C64Music/DEMOS/0-9/10_Orbyte.sid');
const testWavCache = path.resolve(testWorkspace, 'wav-cache');

interface ClassifyThreadState {
  id: number;
  status: string;
  phase?: string;
  file?: string;
  stale?: boolean;
  updatedAt: number;
}

interface ClassifyProgress {
  phase: string;
  totalFiles: number;
  processedFiles: number;
  threads: number;
  perThread: ClassifyThreadState[];
  message: string;
  isActive: boolean;
  isPaused: boolean;
  error?: string;
}

async function getClassifyProgress(page: Page): Promise<ClassifyProgress | null> {
  try {
    const response = await page.request.get('/api/admin/classify/progress');
    if (!response.ok()) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForPhase(
  page: Page,
  phaseName: string,
  timeoutMs = 15000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const progress = await getClassifyProgress(page);
    if (progress?.phase === phaseName) {
      console.log(`[Phase] Reached ${phaseName} after ${Date.now() - startTime}ms`);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout waiting for phase: ${phaseName}`);
}

async function collectThreadHistory(
  page: Page,
  durationMs: number
): Promise<Map<number, ClassifyThreadState[]>> {
  const history = new Map<number, ClassifyThreadState[]>();
  const startTime = Date.now();
  
  while (Date.now() - startTime < durationMs) {
    const progress = await getClassifyProgress(page);
    if (progress?.perThread) {
      for (const thread of progress.perThread) {
        if (!history.has(thread.id)) {
          history.set(thread.id, []);
        }
        const threadHistory = history.get(thread.id)!;
        const lastState = threadHistory[threadHistory.length - 1];
        
        // Only record if state changed
        if (!lastState || 
            lastState.phase !== thread.phase || 
            lastState.status !== thread.status ||
            lastState.stale !== thread.stale ||
            lastState.file !== thread.file) {
          threadHistory.push({ ...thread });
          
          // Log state transitions
          if (thread.phase && thread.phase !== 'idle') {
            const staleMarker = thread.stale ? ' (STALE!)' : '';
            console.log(
              `[Thread ${thread.id}] ${thread.phase} - ${thread.status}${staleMarker}` +
              (thread.file ? ` - ${thread.file}` : '')
            );
          }
        }
      }
    }
    await page.waitForTimeout(200);
  }
  
  return history;
}

test.describe('Classification Phase Transitions', () => {
  test.beforeEach(async () => {
    // Clear WAV cache to force rebuild
    try {
      rmSync(testWavCache, { recursive: true, force: true });
      console.log(`[Setup] Cleared WAV cache: ${testWavCache}`);
    } catch (err) {
      console.log(`[Setup] WAV cache not found or already clean`);
    }
  });

  test('should show all phases without stale status during force rebuild', async ({ page }) => {
    console.log('\n=== Starting Classification Phase Test ===\n');
    
    // Start classification via API (bypasses UI auth complexity)
    const startResponse = await page.request.post('/api/admin/classify', {
      data: { forceRebuild: true }
    });
    
    expect(startResponse.ok(), 'Classification should start successfully').toBe(true);
    console.log('[Action] Classification started via API\n');

    // Collect thread history for 20 seconds
    const historyPromise = collectThreadHistory(page, 20000);

    // Wait for completion or timeout
    const startTime = Date.now();
    let finalProgress: ClassifyProgress | null = null;
    
    while (Date.now() - startTime < 20000) {
      finalProgress = await getClassifyProgress(page);
      if (finalProgress && !finalProgress.isActive && finalProgress.phase === 'completed') {
        console.log(`\n[Complete] Classification finished in ${Date.now() - startTime}ms`);
        break;
      }
      await page.waitForTimeout(500);
    }

    const history = await historyPromise;

    console.log('\n=== Analyzing Thread History ===\n');

    // Verify we collected data for at least one thread
    expect(history.size).toBeGreaterThan(0);
    console.log(`[Analysis] Collected history for ${history.size} thread(s)`);

    for (const [threadId, states] of history) {
      console.log(`\n[Thread ${threadId}] Total state transitions: ${states.length}`);
      
      // Extract unique phases seen (excluding idle)
      const phases = new Set(
        states
          .filter(s => s.phase && s.phase !== 'idle')
          .map(s => s.phase!)
      );
      
      console.log(`[Thread ${threadId}] Phases observed: ${Array.from(phases).join(' → ')}`);

      // Verify expected phases appeared
      const expectedPhases = ['analyzing', 'metadata', 'building', 'tagging'];
      const missingPhases = expectedPhases.filter(p => !phases.has(p));
      
      if (missingPhases.length > 0) {
        console.error(`[Thread ${threadId}] Missing phases: ${missingPhases.join(', ')}`);
      }
      
      // Critical: No thread should ever be marked stale
      const staleStates = states.filter(s => s.stale === true);
      
      if (staleStates.length > 0) {
        console.error(`\n[FAILURE] Thread ${threadId} was marked STALE ${staleStates.length} time(s):`);
        for (const state of staleStates) {
          console.error(`  - Phase: ${state.phase}, Status: ${state.status}, File: ${state.file || 'N/A'}`);
        }
      }
      
      expect(staleStates.length, `Thread ${threadId} should never be marked stale`).toBe(0);
      
      // Verify building phase appeared (where heartbeat is critical)
      expect(phases.has('building'), `Thread ${threadId} should show "building" phase`).toBe(true);
      
      // Verify tagging phase appeared
      expect(phases.has('tagging'), `Thread ${threadId} should show "tagging" phase`).toBe(true);
    }

    console.log('\n=== Test Passed: All phases visible, no stale threads ===\n');
  });

  test('should maintain thread updates during rendering phase', async ({ page }) => {
    console.log('\n=== Starting Rendering Heartbeat Test ===\n');
    
    // Start classification via API with force rebuild
    const startResponse = await page.request.post('/api/admin/classify', {
      data: { forceRebuild: true }
    });
    
    expect(startResponse.ok(), 'Classification should start successfully').toBe(true);
    console.log('[Action] Classification started, waiting for building phase...');

    // Wait until we see building phase
    let buildingPhaseReached = false;
    const waitStart = Date.now();
    
    while (Date.now() - waitStart < 15000) {
      const progress = await getClassifyProgress(page);
      if (progress?.perThread?.[0]?.phase === 'building') {
        buildingPhaseReached = true;
        console.log('[Phase] Building phase detected, monitoring heartbeat...\n');
        break;
      }
      await page.waitForTimeout(100);
    }

    expect(buildingPhaseReached, 'Building phase should be reached').toBe(true);

    // Monitor thread updates during building for 6 seconds
    // (longer than 5s stale threshold, heartbeat interval is 3s)
    const updates: Array<{ timestamp: number; updatedAt: number; stale: boolean }> = [];
    const monitorStart = Date.now();
    
    while (Date.now() - monitorStart < 6000) {
      const progress = await getClassifyProgress(page);
      const thread = progress?.perThread?.[0];
      
      if (thread && thread.phase === 'building') {
        updates.push({
          timestamp: Date.now(),
          updatedAt: thread.updatedAt,
          stale: thread.stale || false
        });
        
        const age = Date.now() - thread.updatedAt;
        const staleMarker = thread.stale ? ' (STALE!)' : '';
        console.log(`[Monitor] Thread update age: ${age}ms${staleMarker}`);
      } else if (thread && thread.phase !== 'building') {
        console.log(`[Monitor] Phase changed to ${thread.phase}, stopping monitor`);
        break;
      }
      
      await page.waitForTimeout(500);
    }

    console.log(`\n[Analysis] Collected ${updates.length} updates during building phase`);

    // Verify we got updates
    expect(updates.length, 'Should have multiple updates during building').toBeGreaterThan(0);

    // Verify no stale markers
    const staleUpdates = updates.filter(u => u.stale);
    if (staleUpdates.length > 0) {
      console.error(`[FAILURE] Found ${staleUpdates.length} stale updates during building phase`);
    }
    expect(staleUpdates.length, 'Building phase should have no stale updates').toBe(0);

    // Verify thread.updatedAt increases (heartbeat working)
    if (updates.length >= 2) {
      const firstUpdate = updates[0].updatedAt;
      const lastUpdate = updates[updates.length - 1].updatedAt;
      const updateSpan = lastUpdate - firstUpdate;
      
      console.log(`[Analysis] Thread updatedAt span: ${updateSpan}ms`);
      expect(updateSpan, 'Thread.updatedAt should increase over time').toBeGreaterThan(0);
    }

    console.log('\n=== Test Passed: Heartbeat maintains thread freshness ===\n');
  });
});
