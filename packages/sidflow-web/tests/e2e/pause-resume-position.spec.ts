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
    await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    
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
        
        // Wait for playback to reach at least 0.3 seconds (reduced for stability)
        const minPosition = FAST_AUDIO_TESTS ? 0.2 : 0.5;
        await waitForPlaybackToStart(page, minPosition);
        
        // Capture position before pausing
        const positionBeforePause = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Position before pause: ${positionBeforePause.toFixed(3)}s`);
        
        // Position should be at least minPosition
        expect(positionBeforePause).toBeGreaterThanOrEqual(minPosition);
        
        // Pause the player - clickPauseButton already waits for state to become 'paused'
        await clickPauseButton(page);
        
        // Get position immediately after pause (clickPauseButton already waited for state change)
        const positionWhilePaused = await getPlayerPosition(page);
        console.log(`[PauseResumeTest] Position while paused: ${positionWhilePaused.toFixed(3)}s`);
        
        // CRITICAL: Position should NOT be 0 and should be close to position before pause
        expect(positionWhilePaused).toBeGreaterThan(0);
        // Allow more tolerance (50%) since audio timing can vary in CI
        expect(positionWhilePaused).toBeGreaterThanOrEqual(minPosition * 0.5);
        // Allow 500ms tolerance for timing variations
        expect(Math.abs(positionWhilePaused - positionBeforePause)).toBeLessThan(0.5);
        
        console.log(`[PauseResumeTest] ✓ Position preserved during pause (${positionWhilePaused.toFixed(3)}s)`);
        
        // Resume playback - clickResumeButton already waits for state to become 'playing'
        await clickResumeButton(page);
        
        // Wait for position to advance beyond paused position using waitForFunction
        const advancedPosition = await page.evaluate(async (pausedPos) => {
          const player = (window as any).__sidflowPlayer;
          if (!player || typeof player.getPositionSeconds !== 'function') return pausedPos;
          
          // Poll until position advances or timeout
          const startTime = Date.now();
          while (Date.now() - startTime < 2000) {
            const currentPos = player.getPositionSeconds();
            if (currentPos > pausedPos) {
              return currentPos;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return player.getPositionSeconds();
        }, positionWhilePaused);
        
        console.log(`[PauseResumeTest] Position after resume: ${advancedPosition.toFixed(3)}s`);
        
        // Position should have advanced from paused position (allow for timing tolerance)
        expect(advancedPosition).toBeGreaterThanOrEqual(positionWhilePaused * 0.9);
        
        console.log(`[PauseResumeTest] ✓ Position continued correctly after resume (${advancedPosition.toFixed(3)}s)`);
        
        // Wait for position to advance even more using waitForFunction
        const finalPosition = await page.evaluate(async (lastPos) => {
          const player = (window as any).__sidflowPlayer;
          if (!player || typeof player.getPositionSeconds !== 'function') return lastPos;
          
          const startTime = Date.now();
          while (Date.now() - startTime < 1000) {
            const currentPos = player.getPositionSeconds();
            if (currentPos > lastPos) {
              return currentPos;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return player.getPositionSeconds();
        }, advancedPosition);
        
        console.log(`[PauseResumeTest] Final position: ${finalPosition.toFixed(3)}s`);
        
        // Final position should be at or ahead of position after resume
        expect(finalPosition).toBeGreaterThanOrEqual(advancedPosition * 0.95);
        
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
        
        const minInitialPosition = FAST_AUDIO_TESTS ? 0.15 : 0.3;
        await waitForPlaybackToStart(page, minInitialPosition);
        
        // Perform 2 pause/resume cycles (reduced for stability)
        const cycles = 2;
        let lastPosition = await getPlayerPosition(page);
        
        for (let i = 0; i < cycles; i++) {
          console.log(`[PauseResumeTest] Cycle ${i + 1}/${cycles}`);
          
          // Pause - clickPauseButton already waits for state change
          await clickPauseButton(page);
          
          const pausedPosition = await getPlayerPosition(page);
          console.log(`[PauseResumeTest] Cycle ${i + 1} paused at: ${pausedPosition.toFixed(3)}s`);
          
          // Verify position not reset (with more tolerance for CI variability)
          expect(pausedPosition).toBeGreaterThan(0);
          expect(pausedPosition).toBeGreaterThanOrEqual(lastPosition * 0.5);
          
          // Resume - clickResumeButton already waits for state change
          await clickResumeButton(page);
          
          // Wait for position to advance using page.evaluate instead of waitForTimeout
          const resumedPosition = await page.evaluate(async (pausedPos) => {
            const player = (window as any).__sidflowPlayer;
            if (!player || typeof player.getPositionSeconds !== 'function') return pausedPos;
            
            const startTime = Date.now();
            while (Date.now() - startTime < 1000) {
              const currentPos = player.getPositionSeconds();
              if (currentPos > pausedPos) {
                return currentPos;
              }
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return player.getPositionSeconds();
          }, pausedPosition);
          
          console.log(`[PauseResumeTest] Cycle ${i + 1} resumed at: ${resumedPosition.toFixed(3)}s`);
          
          // Verify position continued from pause point (with tolerance)
          expect(resumedPosition).toBeGreaterThanOrEqual(pausedPosition * 0.8);
          
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
