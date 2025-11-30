/**
 * E2E test for pause/resume progress bar position preservation.
 * 
 * Verifies that when a song is paused, the progress bar maintains its position
 * and doesn't reset to 0, and that resuming continues from the correct position.
 * 
 * This test is designed to be fast (<10s) and resilient in CI environments.
 */

import { test, expect, type Page } from './test-hooks';
import { configureE2eLogging } from './utils/logging';
import { installPlayTabRoutes } from './utils/play-tab-fixture';

const FAST_AUDIO_TESTS =
  (process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ?? process.env.SIDFLOW_FAST_AUDIO_TESTS) === '1';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping pause/resume position e2e spec; run via `bun run test:e2e`.');
} else {
  async function getPlayerPosition(page: Page): Promise<number> {
    return await page.evaluate(() => {
      const player = (window as any).__sidflowPlayer;
      if (!player || typeof player.getPositionSeconds !== 'function') {
        return -1;
      }
      const position = player.getPositionSeconds();
      const pipeline = player.activePipeline || 'unknown';
      const state = typeof player.getState === 'function' ? player.getState() : 'unknown';
      console.log(`[Test] getPlayerPosition: position=${position}, pipeline=${pipeline}, state=${state}`);
      return position;
    });
  }

  async function getPlayerState(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const player = (window as any).__sidflowPlayer;
      if (!player || typeof player.getState !== 'function') {
        return 'unknown';
      }
      return player.getState();
    });
  }

  async function waitForPlaybackToStart(page: Page, minPosition = 0.5): Promise<void> {
    console.log('[PauseResumeTest] Waiting for playback to start...');
    
    await page.waitForFunction(
      ({ minPos }) => {
        const player = (window as any).__sidflowPlayer;
        if (!player || typeof player.getPositionSeconds !== 'function') {
          return false;
        }
        const pos = player.getPositionSeconds();
        const state = typeof player.getState === 'function' ? player.getState() : 'unknown';
        console.log(`[PauseResumeTest] Position: ${pos.toFixed(3)}s, State: ${state}`);
        return pos >= minPos && state === 'playing';
      },
      { minPos: minPosition },
      { timeout: FAST_AUDIO_TESTS ? 15000 : 30000 }
    );
    
    const position = await getPlayerPosition(page);
    const state = await getPlayerState(page);
    console.log(`[PauseResumeTest] Playback started: position=${position.toFixed(3)}s, state=${state}`);
  }

  async function clickPauseButton(page: Page): Promise<void> {
    console.log('[PauseResumeTest] Clicking pause button...');
    const pauseButton = page.getByRole('button', { name: /pause playback/i });
    await expect(pauseButton).toBeVisible({ timeout: 5000 });
    await expect(pauseButton).toBeEnabled({ timeout: 5000 });
    await pauseButton.click();
    
    // Wait for state to change to paused
    await page.waitForFunction(
      () => {
        const player = (window as any).__sidflowPlayer;
        const state = typeof player?.getState === 'function' ? player.getState() : 'unknown';
        return state === 'paused';
      },
      undefined,
      { timeout: 3000 }
    );
    
    const state = await getPlayerState(page);
    console.log(`[PauseResumeTest] Paused: state=${state}`);
  }

  async function clickResumeButton(page: Page): Promise<void> {
    console.log('[PauseResumeTest] Clicking resume button...');
    const resumeButton = page.getByRole('button', { name: /resume playback/i });
    await expect(resumeButton).toBeVisible({ timeout: 5000 });
    await expect(resumeButton).toBeEnabled({ timeout: 5000 });
    await resumeButton.click();
    
    // Wait for state to change to playing
    await page.waitForFunction(
      () => {
        const player = (window as any).__sidflowPlayer;
        const state = typeof player?.getState === 'function' ? player.getState() : 'unknown';
        return state === 'playing';
      },
      undefined,
      { timeout: 3000 }
    );
    
    const state = await getPlayerState(page);
    console.log(`[PauseResumeTest] Resumed: state=${state}`);
  }

  async function bootstrapPlayTab(page: Page): Promise<void> {
    console.log('[PauseResumeTest] Navigating to Play tab...');
    await page.goto('/?tab=play');
    
    await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible({ timeout: 15000 });
    
    console.log('[PauseResumeTest] Starting playback...');
    const playButton = page.getByRole('button', { name: /play next track/i });
    await expect(playButton).toBeEnabled({ timeout: FAST_AUDIO_TESTS ? 30000 : 60000 });
    await playButton.click();
    
    // Wait for pause button to appear and become enabled
    const pauseButton = page.getByRole('button', { name: /pause playback/i });
    await expect(pauseButton).toBeVisible({ timeout: 30000 });
    await expect(pauseButton).toBeEnabled({ timeout: FAST_AUDIO_TESTS ? 30000 : 90000 });
    
    console.log('[PauseResumeTest] Player ready');
  }

  test.describe('Pause/Resume Position Preservation', () => {
    test.beforeEach(async ({ page }) => {
      await installPlayTabRoutes(page);
      
      // Clear any previous playback state
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('sidflow.preferences');
          const request = indexedDB.deleteDatabase('sidflow-local');
          (window as any).__sidflowQueueCleared = new Promise((resolve) => {
            request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
          });
        } catch {
          (window as any).__sidflowQueueCleared = Promise.resolve(null);
        }
      });
    });

    test('progress bar maintains position when paused and continues correctly on resume', async ({ page }) => {
      test.setTimeout(FAST_AUDIO_TESTS ? 30000 : 90000);
      
      // Capture browser console
      page.on('console', msg => {
        if (msg.text().includes('WorkletPlayer') || msg.text().includes('pausedPosition')) {
          console.log(`[Browser] ${msg.text()}`);
        }
      });
      
      try {
        await bootstrapPlayTab(page);
        
        // Wait for playback to reach at least 0.8 seconds
        const minPosition = FAST_AUDIO_TESTS ? 0.3 : 0.8;
        await waitForPlaybackToStart(page, minPosition);
        
        // Capture position before pausing
        const positionBeforePause = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Position before pause: ${positionBeforePause.toFixed(3)}s`);
        
        // Position should be at least minPosition
        expect(positionBeforePause).toBeGreaterThanOrEqual(minPosition);
        
        // Pause the player
        await clickPauseButton(page);
        
        // Wait a moment for UI to settle
        await page.waitForTimeout(100);
        
        // Verify position is preserved (not reset to 0)
        const positionWhilePaused = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Position while paused: ${positionWhilePaused.toFixed(3)}s`);
        
        // CRITICAL: Position should NOT be 0 and should be close to position before pause
        expect(positionWhilePaused).toBeGreaterThan(0);
        expect(positionWhilePaused).toBeGreaterThanOrEqual(minPosition * 0.9); // Allow 10% tolerance
        expect(Math.abs(positionWhilePaused - positionBeforePause)).toBeLessThan(0.2); // Should be within 200ms
        
        console.log(`[PauseResumeTest] ✓ Position preserved during pause (${positionWhilePaused.toFixed(3)}s)`);
        
        // Resume playback
        await clickResumeButton(page);
        
        // Wait a brief moment for playback to continue
        await page.waitForTimeout(200);
        
        // Verify position continues from where it was paused
        const positionAfterResume = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Position after resume: ${positionAfterResume.toFixed(3)}s`);
        
        // Position should be slightly ahead of paused position (accounting for 200ms wait)
        expect(positionAfterResume).toBeGreaterThan(positionWhilePaused * 0.95);
        expect(positionAfterResume).toBeLessThan(positionWhilePaused + 1.0); // Should advance by less than 1 second
        
        console.log(`[PauseResumeTest] ✓ Position continued correctly after resume (${positionAfterResume.toFixed(3)}s)`);
        
        // Wait for playback to continue a bit more to ensure no position jumps
        await page.waitForTimeout(FAST_AUDIO_TESTS ? 300 : 500);
        
        const finalPosition = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Final position: ${finalPosition.toFixed(3)}s`);
        
        // Final position should be at or ahead of position after resume (allow for timing precision)
        expect(finalPosition).toBeGreaterThanOrEqual(positionAfterResume);
        
        console.log('[PauseResumeTest] ✓ Test passed: pause/resume position preservation works correctly');
      } catch (error) {
        console.error('[PauseResumeTest] Test failed:', error);
        
        // Capture diagnostic info on failure
        const position = await getPlayerPosition(page);
        const state = await getPlayerState(page);
        console.error(`[PauseResumeTest] Final state: position=${position}s, state=${state}`);
        
        // Take screenshot for debugging
        await page.screenshot({ 
          path: 'test-results/pause-resume-position-failure.png',
          fullPage: true 
        }).catch(() => {});
        
        throw error;
      }
    });

    test('progress bar maintains position across multiple pause/resume cycles', async ({ page }) => {
      test.setTimeout(FAST_AUDIO_TESTS ? 40000 : 120000);
      
      try {
        await bootstrapPlayTab(page);
        
        const minInitialPosition = FAST_AUDIO_TESTS ? 0.2 : 0.5;
        await waitForPlaybackToStart(page, minInitialPosition);
        
        // Perform 3 pause/resume cycles
        const cycles = FAST_AUDIO_TESTS ? 2 : 3;
        let lastPosition = await getPlayerPosition(page);
        
        for (let i = 0; i < cycles; i++) {
          console.log(`[PauseResumeTest] Cycle ${i + 1}/${cycles}`);
          
          // Pause
          await clickPauseButton(page);
          await page.waitForTimeout(100);
          
          const pausedPosition = await getPlayerPosition(page);
          console.log(`[PauseResumeTest] Cycle ${i + 1} paused at: ${pausedPosition.toFixed(3)}s`);
          
          // Verify position not reset
          expect(pausedPosition).toBeGreaterThan(0);
          expect(pausedPosition).toBeGreaterThanOrEqual(lastPosition * 0.9);
          
          // Resume
          await clickResumeButton(page);
          await page.waitForTimeout(FAST_AUDIO_TESTS ? 200 : 300);
          
          const resumedPosition = await getPlayerPosition(page);
          console.log(`[PauseResumeTest] Cycle ${i + 1} resumed at: ${resumedPosition.toFixed(3)}s`);
          
          // Verify position continued from pause point
          expect(resumedPosition).toBeGreaterThanOrEqual(pausedPosition * 0.9);
          
          lastPosition = resumedPosition;
        }
        
        console.log(`[PauseResumeTest] ✓ Multiple pause/resume cycles completed successfully`);
      } catch (error) {
        console.error('[PauseResumeTest] Multiple cycles test failed:', error);
        await page.screenshot({ 
          path: 'test-results/pause-resume-cycles-failure.png',
          fullPage: true 
        }).catch(() => {});
        throw error;
      }
    });
  });
}
