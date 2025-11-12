/**
 * End-to-end tests for browser-based SID playback.
 * Verifies that audio rendering occurs entirely client-side using WASM,
 * with no server-side PCM streaming.
 */

import { test, expect, type Page } from '@playwright/test';

// Longer timeout for audio operations
test.setTimeout(60000);

test.describe('RateTab Browser Playback', () => {
    test('loads and plays a random SID', async ({ page }) => {
        // Navigate to Rate tab
        await page.goto('/?tab=rate');
        await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();

        // Capture console messages and errors for debugging
        const consoleMessages: string[] = [];
        const pageErrors: Error[] = [];
        page.on('console', (msg) => {
            consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
        });
        page.on('pageerror', (error) => {
            pageErrors.push(error);
        });

        // Set up network monitoring to verify no PCM streaming
        const pcmRequests: string[] = [];
        const failedRequests: Array<{ url: string; status: number }> = [];
        page.on('request', (request) => {
            const url = request.url();
            // Track any suspicious audio streaming endpoints
            if (url.includes('/stream') || url.includes('.wav') || url.includes('.mp3')) {
                pcmRequests.push(url);
            }
        });
        page.on('response', (response) => {
            if (!response.ok() && response.status() >= 400) {
                failedRequests.push({ url: response.url(), status: response.status() });
            }
        });

        // Click "PLAY RANDOM SID" button
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await expect(playButton).toBeVisible();
        await playButton.click();

        // Wait for track to load - the play/pause button changes from "Resume playback" to "Pause playback"
        // when track starts playing. Also need to wait for it to be enabled (not in loading state).
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        try {
            // Wait for button to exist and be enabled (meaning audio has loaded and is playing)
            await expect(pauseButton).toBeVisible({ timeout: 30000 });
            await expect(pauseButton).toBeEnabled({ timeout: 30000 });
            
            // Give audio pipeline a moment to stabilize
            await page.waitForTimeout(1000);
        } catch (error) {
            // Log debugging info if the button doesn't appear
            console.log('Page errors:', pageErrors);
            console.log('Failed requests:', failedRequests);
            console.log('Console messages:', consoleMessages.slice(-20)); // Last 20 messages
            throw error;
        }

        // Verify no PCM streaming occurred
        expect(pcmRequests).toHaveLength(0);

        // Verify position slider is present (Radix UI slider uses role="slider")
        const positionSlider = page.getByRole('slider');
        await expect(positionSlider).toBeVisible();
        await expect(positionSlider).not.toBeDisabled();

        // Wait a bit to ensure playback is happening
        await page.waitForTimeout(1000);

        // Test pause functionality
        await pauseButton.click();
        const resumeButton = page.getByRole('button', { name: /resume playback/i });
        await expect(resumeButton).toBeVisible({ timeout: 5000 });

        // Verify playback can be resumed (button changes back, but we won't test further pause)
        await resumeButton.click();
        await page.waitForTimeout(500); // Brief wait for state to update

        // Verify telemetry shows audio is being produced (worklet pipeline is working)
        const telemetry = await page.evaluate(() => {
            const player = (window as any).__sidflowPlayer;
            return player ? player.getTelemetry() : null;
        });
        if (telemetry) {
            expect(telemetry.framesConsumed).toBeGreaterThan(0);
            expect(telemetry.framesProduced).toBeGreaterThan(0);
            // Check for underruns
            const hasUnderruns = consoleMessages.some(msg => msg.toLowerCase().includes('underrun'));
            if (hasUnderruns) {
                console.warn('Underruns detected:', consoleMessages.filter(msg => msg.toLowerCase().includes('underrun')));
            }
        }

        // Log console messages if test fails
        if (consoleMessages.length > 0) {
            console.log('Browser console messages:', consoleMessages);
        }
    });

    // TODO: Re-enable once seek operations are properly implemented
    test.skip('handles seek operations', async ({ page }) => {
        await page.goto('/?tab=rate');

        // Load a track - wait for pause button to appear as indicator of successful load
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        await expect(pauseButton).toBeVisible({ timeout: 10000 });

        // Wait for playback to start
        await page.waitForTimeout(2000);

        // Find the position slider (Radix UI slider)
        const positionSlider = page.getByRole('slider');
        await expect(positionSlider).toBeVisible();

        // Get the slider's current aria-valuenow
        const initialValue = await positionSlider.getAttribute('aria-valuenow');

        // Seek by clicking on the slider track (Radix sliders don't support .fill())
        const sliderBox = await positionSlider.boundingBox();
        if (sliderBox) {
            // Click 75% along the slider to seek forward
            await page.mouse.click(sliderBox.x + sliderBox.width * 0.75, sliderBox.y + sliderBox.height / 2);
        }

        // Wait for the seek to take effect
        await page.waitForTimeout(1000);

        // Verify the position changed
        const newValue = await positionSlider.getAttribute('aria-valuenow');
        expect(Number.parseInt(newValue || '0')).toBeGreaterThan(Number.parseInt(initialValue || '0'));
    });

    test('displays rating controls and allows submission', async ({ page }, testInfo) => {
        await page.goto('/?tab=rate');

        // Set up error tracking
        const pageErrors: Error[] = [];
        const consoleErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // Load a track - wait for pause button to appear and be enabled
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        
        try {
            await expect(pauseButton).toBeVisible({ timeout: 30000 });
            await expect(pauseButton).toBeEnabled({ timeout: 30000 });
            await page.waitForTimeout(1000); // Let audio pipeline stabilize
        } catch (error) {
            console.log('Test failed waiting for pause button');
            console.log('Page errors:', pageErrors);
            console.log('Console errors:', consoleErrors);
            throw error;
        }

        // Verify rating dimension buttons are present
        await expect(page.getByText(/Energy/i)).toBeVisible();
        await expect(page.getByText(/Mood/i)).toBeVisible();
        await expect(page.getByText(/Complexity/i)).toBeVisible();
        await expect(page.getByText(/Preference/i)).toBeVisible();

        // Click rating buttons
        const energyButton = page.getByRole('button', { name: /E 5/i });
        await energyButton.click();

        // Verify submit button is enabled
        const submitButton = page.getByRole('button', { name: /submit rating/i });
        await expect(submitButton).toBeVisible();
        await expect(submitButton).toBeEnabled();
    });
});

test.describe('PlayTab Browser Playback', () => {
    test('loads playlist and plays tracks', async ({ page }, testInfo) => {
        // This test exercises complex WASM + AudioWorklet + SharedArrayBuffer which can be unstable
        // Browser crashes (~10% failure rate) are a known Chromium issue with SharedArrayBuffer
        test.slow(); // Mark as slow (gets 3x timeout)
        await page.goto('/?tab=play');
        await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();

        // Set up network monitoring
        const pcmRequests: string[] = [];
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('/stream') || url.includes('.wav') || url.includes('.mp3')) {
                pcmRequests.push(url);
            }
        });

        // Select a mood preset (Radix UI Select)
        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Energetic' }).click();

        // Wait for playlist to populate - button text changes from "PLAYLIST EMPTY" to "PLAY NEXT TRACK"
        const playButton = page.getByRole('button', { name: /play next track/i });
        await expect(playButton).toBeEnabled({ timeout: 30000 });

        // Click play button
        await playButton.click();

        // Wait for playback to start - pause button appears and is enabled
        const pauseButton = page.getByRole('button', { name: /pause/i }).first();
        await expect(pauseButton).toBeVisible({ timeout: 30000 });
        await expect(pauseButton).toBeEnabled({ timeout: 30000 });
        await page.waitForTimeout(1000); // Let audio pipeline stabilize

        // Verify no PCM streaming occurred
        expect(pcmRequests).toHaveLength(0);

        // Verify playlist is populated
        await expect(page.getByText(/upcoming/i)).toBeVisible();
    });

    test('handles mood preset changes', async ({ page }) => {
        await page.goto('/?tab=play');

        // Change preset multiple times (Radix UI Select)
        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Quiet' }).click();

        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Energetic' }).click();

        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Dark' }).click();
    });

    test('displays track information during playback', async ({ page }, testInfo) => {
        await page.goto('/?tab=play');

        // Set up error tracking
        const pageErrors: Error[] = [];
        const consoleErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // Select preset and wait for playlist to populate
        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Ambient' }).click();

        const playButton = page.getByRole('button', { name: /play next track/i });
        await expect(playButton).toBeEnabled({ timeout: 30000 });
        await playButton.click();

        // Wait for playback to start (pause button appears and is enabled)
        const pauseButton = page.getByRole('button', { name: /pause/i });
        
        try {
            await expect(pauseButton).toBeVisible({ timeout: 30000 });
            await expect(pauseButton).toBeEnabled({ timeout: 30000 });
            await page.waitForTimeout(1000); // Let audio pipeline stabilize
        } catch (error) {
            console.log('Test failed waiting for pause button');
            console.log('Page errors:', pageErrors);
            console.log('Console errors:', consoleErrors);
            throw error;
        }

        // Verify track metadata is displayed
        const artistLabel = page.getByText(/artist/i);
        await expect(artistLabel).toBeVisible({ timeout: 5000 });
    });
});

test.describe('WASM Asset Loading', () => {
    test('loads WASM module from /wasm/ path', async ({ page, context }) => {
        // Track WASM file requests
        const wasmRequests: string[] = [];
        page.on('request', (request) => {
            const url = request.url();
            if (url.endsWith('.wasm') || url.includes('/wasm/')) {
                wasmRequests.push(url);
            }
        });

        await page.goto('/?tab=rate');

        // Trigger WASM loading by starting playback
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();

        // Wait for potential WASM load
        await page.waitForTimeout(5000);

        // Verify WASM was requested from correct path
        expect(wasmRequests.length).toBeGreaterThan(0);
        const wasmRequest = wasmRequests.find(url => url.includes('libsidplayfp.wasm'));
        expect(wasmRequest).toBeDefined();
        expect(wasmRequest).toContain('/wasm/');
    });
});

test.describe('Error Handling', () => {
    test('handles playback errors gracefully', async ({ page }) => {
        // This test may encounter browser crashes due to SharedArrayBuffer/AudioWorklet issues (~20% failure rate)
        // Retry once if the page crashes
        let attempt = 0;
        const maxAttempts = 2;
        
        while (attempt < maxAttempts) {
            attempt++;
            
            try {
                await page.goto('/?tab=rate');

                // Verify initial page load
                const heading = page.getByRole('heading', { name: /rate track/i });
                await expect(heading).toBeVisible({ timeout: 10000 });

                // Set up console error monitoring
                const consoleErrors: string[] = [];
                const uncaughtErrors: Error[] = [];
                page.on('console', (msg) => {
                    if (msg.type() === 'error') {
                        consoleErrors.push(msg.text());
                    }
                });
                page.on('pageerror', (error) => {
                    uncaughtErrors.push(error);
                });

                // Try to play (may or may not succeed depending on available SIDs)
                const playButton = page.getByRole('button', { name: /play random sid/i });
                await expect(playButton).toBeVisible({ timeout: 10000 });
                await playButton.click();

                // Wait for either playback to start or error to be handled
                // Check for either pause button (success) or play button still there (error/no change)
                await Promise.race([
                    page.getByRole('button', { name: /pause playback/i }).waitFor({ timeout: 8000 }).catch(() => {}),
                    page.waitForTimeout(8000)
                ]);

                // Verify page is still responsive (no crashes) by checking critical UI elements
                // The heading should still be present regardless of playback success/failure
                await expect(heading).toBeVisible({ timeout: 10000 });
                
                // Verify no uncaught JavaScript exceptions occurred
                expect(uncaughtErrors).toHaveLength(0);
                
                // Check that the play button OR pause button is visible (page didn't freeze)
                const playOrPauseVisible = await Promise.race([
                    playButton.isVisible().catch(() => false),
                    page.getByRole('button', { name: /pause playback/i }).isVisible().catch(() => false)
                ]);
                expect(playOrPauseVisible).toBeTruthy();

                // Success - break out of retry loop
                break;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                // Check if this is a page crash or element not found (likely crash-related)
                const isCrashRelated = errorMessage.includes('crashed') || 
                                      errorMessage.includes('closed') ||
                                      errorMessage.includes('Target page') ||
                                      errorMessage.includes('toBeVisible');
                
                if (isCrashRelated && attempt < maxAttempts) {
                    console.log(`Attempt ${attempt}/${maxAttempts} failed (likely browser crash), retrying...`);
                    // Reload the page and try again
                    await page.reload({ timeout: 10000 }).catch(() => {});
                    continue;
                }
                
                // Not crash-related or out of retries - fail the test
                console.log(`Test failed on attempt ${attempt}/${maxAttempts}: ${errorMessage}`);
                throw error;
            }
        }

        // If there were console errors, they should be app-level errors (handled gracefully),
        // not uncaught exceptions that would crash the page
    });
});
