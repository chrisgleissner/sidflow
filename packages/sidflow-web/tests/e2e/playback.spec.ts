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

        // Wait for track to load by checking if pause button appears
        // (The pause button only appears when a track is successfully loaded and playing)
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        try {
            await expect(pauseButton).toBeVisible({ timeout: 25000 });
            await expect(pauseButton).toBeEnabled();
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
        await page.waitForTimeout(2000);

        // Test pause
        await pauseButton.click();
        const resumeButton = page.getByRole('button', { name: /resume playback/i });
        await expect(resumeButton).toBeVisible({ timeout: 1000 });

        // Test resume
        await resumeButton.click();
        await expect(pauseButton).toBeVisible({ timeout: 1000 });

        // Log console messages if test fails
        if (consoleMessages.length > 0) {
            console.log('Browser console messages:', consoleMessages);
        }
    });

    test('handles seek operations', async ({ page }) => {
        await page.goto('/?tab=rate');

        // Load a track - wait for pause button to appear as indicator of successful load
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        await expect(pauseButton).toBeVisible({ timeout: 25000 });

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

    test('displays rating controls and allows submission', async ({ page }) => {
        await page.goto('/?tab=rate');

        // Load a track - wait for pause button as indicator
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        await expect(pauseButton).toBeVisible({ timeout: 25000 });

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
    test('loads playlist and plays tracks', async ({ page }) => {
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

        // Select a mood preset
        const presetSelect = page.locator('select').first();
        await presetSelect.selectOption('energetic');

        // Click play button
        const playButton = page.getByRole('button', { name: /play next track/i });
        await playButton.click();

        // Wait for track to load
        await page.waitForTimeout(15000);

        // Verify playback controls are present
        const pauseButton = page.getByRole('button', { name: /pause/i }).first();
        await expect(pauseButton).toBeVisible({ timeout: 5000 });

        // Verify no PCM streaming occurred
        expect(pcmRequests).toHaveLength(0);

        // Verify playlist is populated
        await expect(page.getByText(/upcoming/i)).toBeVisible();
    });

    test('handles mood preset changes', async ({ page }) => {
        await page.goto('/?tab=play');

        // Change preset multiple times
        const presetSelect = page.locator('select').first();
        await presetSelect.selectOption('quiet');
        await expect(presetSelect).toHaveValue('quiet');

        await presetSelect.selectOption('energetic');
        await expect(presetSelect).toHaveValue('energetic');

        await presetSelect.selectOption('dark');
        await expect(presetSelect).toHaveValue('dark');
    });

    test('displays track information during playback', async ({ page }) => {
        await page.goto('/?tab=play');

        // Select preset and play
        const presetSelect = page.locator('select').first();
        await presetSelect.selectOption('ambient');

        const playButton = page.getByRole('button', { name: /play next track/i });
        await playButton.click();

        // Wait for track info to appear
        await page.waitForTimeout(15000);

        // Verify track metadata is displayed (these are common SID metadata fields)
        // We can't predict exact content, but we can verify the structure exists
        const trackInfo = page.locator('text=/Title|Author|Released/i').first();
        await expect(trackInfo).toBeVisible({ timeout: 5000 });
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
        await page.goto('/?tab=rate');

        // Set up console error monitoring
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // Try to play (may or may not succeed depending on available SIDs)
        const playButton = page.getByRole('button', { name: /play random sid/i });
        await playButton.click();

        // Wait a bit
        await page.waitForTimeout(5000);

        // Verify page is still responsive (no crashes)
        await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();

        // If there were errors, they should be handled gracefully
        // (no uncaught exceptions or blank pages)
    });
});
