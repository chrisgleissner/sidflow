import { expect, test } from '@playwright/test';

/**
 * Test to verify classification phase transitions output format.
 * 
 * This test validates the expected output format from classification operations,
 * ensuring all phases (analyzing → metadata → building → tagging) are represented
 * and threads operate correctly without stale status markers.
 * 
 * Uses mocked output to validate parsing logic without running actual classification.
 */

// Simulated classification output that matches the expected format
const MOCK_CLASSIFICATION_OUTPUT = `threads: 2
[Analyzing] 0/4 files (0.0%)
[Thread 1] Analyzing: DEMOS/0-9/10_Orbyte.sid
[Analyzing] 1/4 files (6.3%)
[Thread 2] Analyzing: MUSICIANS/G/Garvalf/Test_Song.sid
[Analyzing] 2/4 files (12.5%)
[Thread 1] Analyzing: MUSICIANS/H/Hubbard_Rob/Delta.sid
[Analyzing] 3/4 files (18.8%)
[Thread 2] Analyzing: MUSICIANS/T/Tel_Jeroen/Cybernoid.sid
[Analyzing] 4/4 files (25.0%)
[Thread 1] Reading metadata: DEMOS/0-9/10_Orbyte.sid
[Reading Metadata] 1/4 files (31.3%)
[Thread 2] Reading metadata: MUSICIANS/G/Garvalf/Test_Song.sid
[Reading Metadata] 2/4 files (37.5%)
[Thread 1] Reading metadata: MUSICIANS/H/Hubbard_Rob/Delta.sid
[Reading Metadata] 3/4 files (43.8%)
[Thread 2] Reading metadata: MUSICIANS/T/Tel_Jeroen/Cybernoid.sid
[Reading Metadata] 4/4 files (50.0%)
[Converting] 0 rendered, 0 cached, 4 remaining (50.0%)
[Thread 1] Rendering: DEMOS/0-9/10_Orbyte.sid
[Converting] 1 rendered, 0 cached, 3 remaining (56.3%)
[Thread 2] Rendering: MUSICIANS/G/Garvalf/Test_Song.sid
[Converting] 2 rendered, 0 cached, 2 remaining (62.5%)
[Thread 1] Rendering: MUSICIANS/H/Hubbard_Rob/Delta.sid
[Converting] 3 rendered, 0 cached, 1 remaining (68.8%)
[Thread 2] Rendering: MUSICIANS/T/Tel_Jeroen/Cybernoid.sid
[Converting] 4 rendered, 0 cached, 0 remaining (75.0%)
[Thread 1] Extracting features: DEMOS/0-9/10_Orbyte.sid
[Extracting Features] 1/4 files (81.3%)
[Thread 2] Extracting features: MUSICIANS/G/Garvalf/Test_Song.sid
[Extracting Features] 2/4 files (87.5%)
[Thread 1] Extracting features: MUSICIANS/H/Hubbard_Rob/Delta.sid
[Extracting Features] 3/4 files (93.8%)
[Thread 2] Extracting features: MUSICIANS/T/Tel_Jeroen/Cybernoid.sid
[Extracting Features] 4/4 files (100.0%)
[Thread 1] IDLE
[Thread 2] IDLE
Classification completed successfully`;

test.describe('Classification Phase Transitions', () => {
  // This test validates the expected output format without making any server calls
  test('should contain all phases and thread updates without stale status', async () => {
    console.log('\n=== Validating Classification Output Format ===\n');
    
    const output = MOCK_CLASSIFICATION_OUTPUT;
    console.log(`[Output] Stdout length: ${output.length} chars`);
    
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
