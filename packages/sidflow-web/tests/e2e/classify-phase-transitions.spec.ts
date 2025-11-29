import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * E2E test to verify classification phase transitions and thread updates.
 * 
 * This test ensures:
 * 1. All expected phases appear in output: analyzing → metadata → building → tagging
 * 2. No "stale" status markers appear during force rebuild
 * 3. Both threads perform work during multi-threaded classification
 * 4. Rendering (building) phase shows active thread updates
 * 
 * The test verifies phase transitions by examining the classification stdout output
 * rather than polling the progress API, since classification runs synchronously.
 */

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..', '..', '..', '..');
const testWorkspace = path.resolve(repoRoot, 'test-workspace');
const testWavCache = path.resolve(testWorkspace, 'wav-cache');

test.describe('Classification Phase Transitions', () => {
  test.beforeEach(async () => {
    // Clear WAV cache to force rebuild
    try {
      rmSync(testWavCache, { recursive: true, force: true });
      console.log(`[Setup] Cleared WAV cache: ${testWavCache}`);
    } catch {
      console.log(`[Setup] WAV cache not found or already clean`);
    }
  });

  test('should show all phases and thread updates without stale status during force rebuild', async ({ page }) => {
    console.log('\n=== Starting Classification Phase Test ===\n');
    
    // Start classification via API with force rebuild
    const startResponse = await page.request.post('/api/classify', {
      data: { forceRebuild: true }
    });
    
    expect(startResponse.ok(), `Classification should start successfully (status: ${startResponse.status()})`).toBe(true);
    console.log('[Action] Classification completed via API\n');
    
    // Parse the response to verify phase transitions happened
    const responseBody = await startResponse.json();
    expect(responseBody.success).toBe(true);
    
    const output = responseBody.data?.output as string ?? '';
    console.log(`[Output] Stdout length: ${output.length} chars`);
    console.log(`[Output] First 800 chars:\n${output.substring(0, 800)}`);
    
    // ====================================
    // Test 1: Verify all expected phases appeared in the stdout output
    // ====================================
    console.log('\n=== Verifying Phase Presence in Output ===\n');
    
    const expectedPhasePatterns = [
      { phase: 'analyzing', patterns: ['[Analyzing]', '[Thread'] },
      { phase: 'metadata', patterns: ['[Reading Metadata]', 'Reading metadata:'] },
      { phase: 'building', patterns: ['[Converting]', 'Rendering:'] },
      { phase: 'tagging', patterns: ['[Extracting Features]', 'Extracting features:'] },
    ];
    
    for (const { phase, patterns } of expectedPhasePatterns) {
      const found = patterns.some(pattern => output.includes(pattern));
      const foundPatterns = patterns.filter(pattern => output.includes(pattern));
      
      if (found) {
        console.log(`[✓] Phase '${phase}' found (patterns: ${foundPatterns.join(', ')})`);
      } else {
        console.error(`[✗] Phase '${phase}' NOT found (looked for: ${patterns.join(' OR ')})`);
      }
      
      expect(found, `Phase '${phase}' should appear in classification output`).toBe(true);
    }
    
    // ====================================
    // Test 2: Verify threads alternated work (multi-threaded operation)
    // ====================================
    console.log('\n=== Verifying Multi-threaded Operation ===\n');
    
    const thread1Count = (output.match(/\[Thread 1\]/g) ?? []).length;
    const thread2Count = (output.match(/\[Thread 2\]/g) ?? []).length;
    console.log(`[Threads] Thread 1 messages: ${thread1Count}, Thread 2 messages: ${thread2Count}`);
    
    expect(thread1Count, 'Thread 1 should have performed work').toBeGreaterThan(0);
    expect(thread2Count, 'Thread 2 should have performed work').toBeGreaterThan(0);
    
    // ====================================
    // Test 3: Verify no stale markers in output
    // ====================================
    console.log('\n=== Verifying No Stale Markers ===\n');
    
    const hasStaleMarker = output.toLowerCase().includes('stale');
    expect(hasStaleMarker, 'Output should not contain "stale" marker').toBe(false);
    console.log('[✓] No stale markers found in output');
    
    // ====================================
    // Test 4: Verify IDLE status appeared at end (clean completion)
    // ====================================
    console.log('\n=== Verifying Clean Completion ===\n');
    
    expect(output.includes('[Thread 1] IDLE'), 'Thread 1 should show IDLE at end').toBe(true);
    expect(output.includes('[Thread 2] IDLE'), 'Thread 2 should show IDLE at end').toBe(true);
    console.log('[✓] Both threads completed cleanly (IDLE status)');
    
    // ====================================
    // Test 5: Verify rendering phase had multiple thread updates
    // ====================================
    console.log('\n=== Verifying Rendering Phase Thread Activity ===\n');
    
    const renderingLines = output.split('\n').filter(line => 
      line.includes('Rendering:') || line.includes('[Converting]')
    );
    
    console.log(`[Rendering] Found ${renderingLines.length} rendering-related lines`);
    
    // Each file should have a thread rendering message
    const threadRenderingCount = renderingLines.filter(line => line.includes('Rendering:')).length;
    console.log(`[Rendering] Thread rendering messages: ${threadRenderingCount}`);
    
    expect(threadRenderingCount, 'Should have rendering messages for all files').toBeGreaterThanOrEqual(4);
    
    // Verify both threads participated in rendering
    const thread1Renders = renderingLines.filter(line => line.includes('[Thread 1]')).length;
    const thread2Renders = renderingLines.filter(line => line.includes('[Thread 2]')).length;
    
    console.log(`[Rendering] Thread 1 renders: ${thread1Renders}, Thread 2 renders: ${thread2Renders}`);
    
    expect(thread1Renders, 'Thread 1 should have rendered files').toBeGreaterThan(0);
    expect(thread2Renders, 'Thread 2 should have rendered files').toBeGreaterThan(0);
    
    // Verify progress tracking during rendering
    const convertingLines = renderingLines.filter(line => line.includes('[Converting]'));
    console.log(`[Rendering] Progress updates: ${convertingLines.length}`);
    
    expect(convertingLines.length, 'Should have progress updates during rendering').toBeGreaterThanOrEqual(4);
    
    console.log('\n=== All Tests Passed: Phases verified, threads active, no stale status ===\n');
  });
});
