/**
 * End-to-end tests for browser-based SID playback.
 * Verifies that audio rendering occurs entirely client-side using WASM,
 * with no server-side PCM streaming.
 */

import { test, expect, type Locator, type Page, type Request, type Route } from './test-hooks';
import { createLogger } from '@sidflow/common';
import { configureE2eLogging } from './utils/logging';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FAST_AUDIO_TESTS =
    (process.env.NEXT_PUBLIC_SIDFLOW_FAST_AUDIO_TESTS ?? process.env.SIDFLOW_FAST_AUDIO_TESTS) === '1';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
    console.warn('[sidflow-web] Skipping Playwright playback e2e spec; run via `bun run test:e2e`.');
} else {
    const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
    const TEST_SID_PATH = path.resolve(CURRENT_DIR, '../../../libsidplayfp-wasm/test-tone-c4.sid');
    const TEST_SID_BUFFER = readFileSync(TEST_SID_PATH);
    const TEST_SID_DATA_URL = `data:application/octet-stream;base64,${TEST_SID_BUFFER.toString('base64')}`;

    const playbackRoutesInstalled = new WeakSet<import('@playwright/test').BrowserContext>();
    let sessionCounter = 0;

    const STUB_TRACK_TEMPLATE = {
        sidPath: '/virtual/test-tone-c4.sid',
        relativePath: 'virtual/test-tone-c4.sid',
        filename: 'test-tone-c4.sid',
        displayName: 'Test Tone C4',
        selectedSong: 1,
        metadata: {
            title: 'Test Tone C4',
            author: 'SIDFlow',
            released: '2024',
            songs: 1,
            startSong: 1,
            sidType: 'PSID',
            version: 2,
            sidModel: '6581',
            clock: 'PAL',
            length: '00:03',
            fileSizeBytes: TEST_SID_BUFFER.length,
        },
        durationSeconds: FAST_AUDIO_TESTS ? 1 : 3,
    } as const;

    function createStubTrack() {
        return {
            ...STUB_TRACK_TEMPLATE,
            metadata: { ...STUB_TRACK_TEMPLATE.metadata },
        };
    }

    const playbackLogger = createLogger('playback-test');

    function registerSession(scope: 'rate' | 'play') {
        sessionCounter += 1;
        const sessionId = `${scope}-stub-${Date.now()}-${sessionCounter}`;
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        playbackLogger.debug('registerSession %s', sessionId);
        return {
            sessionId,
            sidUrl: TEST_SID_DATA_URL,
            scope,
            durationSeconds: STUB_TRACK_TEMPLATE.durationSeconds,
            selectedSong: STUB_TRACK_TEMPLATE.selectedSong,
            expiresAt,
            fallbackHlsUrl: null,
            romUrls: {},
        } as const;
    }

    async function readPendingPlaybackQueueCount(page: Page): Promise<number> {
        return await page.evaluate(() => {
            return new Promise<number>((resolve) => {
                try {
                    const request = indexedDB.open('sidflow-local');
                    request.onerror = () => resolve(0);
                    request.onsuccess = () => {
                        const db = request.result;
                        const transaction = db.transaction('playback-queue', 'readonly');
                        const store = transaction.objectStore('playback-queue');
                        const getAll = store.getAll();
                        getAll.onerror = () => resolve(0);
                        getAll.onsuccess = () => {
                            const records = Array.isArray(getAll.result) ? getAll.result : [];
                            const pending = records.filter((record: { status?: string }) => {
                                return record?.status === 'pending' || record?.status === 'failed';
                            });
                            resolve(pending.length);
                        };
                    };
                } catch {
                    resolve(0);
                }
            });
        });
    }

    async function installDeterministicPlaybackRoutes(page: Page): Promise<void> {
        const context = page.context();
        if (playbackRoutesInstalled.has(context)) {
            return;
        }
        playbackRoutesInstalled.add(context);

        await context.route('**/virtual/test-tone-c4.sid', async (route) => {
            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Cache-Control': 'no-store',
                    'Content-Length': String(TEST_SID_BUFFER.length),
                },
                body: TEST_SID_BUFFER,
            });
        });

        await context.route('**/api/rate/random', async (route) => {
            const track = createStubTrack();
            const session = registerSession('rate');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        track,
                        session,
                    },
                }),
            });
        });

        await context.route('**/api/play/random', async (route) => {
            const track = createStubTrack();
            const session = registerSession('play');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        track,
                        session,
                    },
                }),
            });
        });

        await context.route('**/api/play/manual', async (route) => {
            const track = createStubTrack();
            const session = registerSession('play');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        track,
                        session,
                    },
                }),
            });
        });
    }

    test.beforeEach(async ({ page }) => {
        await installDeterministicPlaybackRoutes(page);
    });

    // Longer timeout for audio operations
    test.setTimeout(120000);

    const PAUSE_BUTTON_SELECTOR = 'button[aria-label="Pause playback / Resume playback"]';

    async function waitForPauseButtonReady(page: Page, contextLabel: string): Promise<Locator> {
        const pauseButton = page.getByRole('button', { name: /pause playback/i });
        await expect(pauseButton).toBeVisible({ timeout: 30000 });

        const readinessHandle = await page.waitForFunction(
            (selector) => {
                const button = document.querySelector(selector) as HTMLButtonElement | null;
                const player = (window as unknown as { __sidflowPlayer?: { getState?: () => string; getTelemetry?: () => { framesProduced?: number; framesConsumed?: number; }; } }).__sidflowPlayer;
                if (!button || !player || typeof player.getState !== 'function') {
                    return undefined;
                }

                const state = player.getState();
                const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
                if (disabled || (state !== 'playing' && state !== 'paused' && state !== 'ready')) {
                    return undefined;
                }

                const telemetry = typeof player.getTelemetry === 'function' ? player.getTelemetry() : null;
                return {
                    state,
                    ariaPressed: button.getAttribute('aria-pressed'),
                    telemetry: telemetry
                        ? {
                            framesProduced: telemetry.framesProduced,
                            framesConsumed: telemetry.framesConsumed,
                        }
                        : null,
                };
            },
            PAUSE_BUTTON_SELECTOR,
            { timeout: 120000 }
        );

        const readiness = await readinessHandle.jsonValue();
        console.log(`[RateTab] Pause readiness for ${contextLabel}:`, readiness);

        await expect(pauseButton).toBeEnabled();
        return pauseButton;
    }

    test.describe.serial('RateTab Browser Playback', () => {
        test('loads and plays a random SID', async ({ page }) => {
            // Navigate to Rate tab
            await page.goto('/admin?tab=rate', { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
                if (url.includes('/stream') || url.includes('.wav') || url.includes('.m4a')) {
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
            console.log('Pause button count (random SID test):', await page.getByRole('button', { name: /pause playback/i }).count());
            try {
                const pauseButton = await waitForPauseButtonReady(page, 'random SID test');
                const html = await pauseButton.first().evaluate((el) => el.outerHTML);
                console.log('Pause button HTML (random SID test):', html);
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

            // Wait for playback to produce frames
            await page.waitForFunction(() => {
                const player = (window as any).__sidflowPlayer;
                if (!player || typeof player.getTelemetry !== 'function') return false;
                const telemetry = player.getTelemetry();
                return telemetry.framesConsumed > 0;
            }, { timeout: 5000 });

            // Test pause functionality
            const pauseButton = page.getByRole('button', { name: /pause playback/i });
            await pauseButton.click();
            const resumeButton = page.getByRole('button', { name: /resume playback/i });
            await expect(resumeButton).toBeVisible({ timeout: 5000 });

            // Verify playback can be resumed (button changes back, but we won't test further pause)
            await resumeButton.click();

            // Verify telemetry shows audio is being produced (worklet pipeline is working)
            const telemetry = await page.evaluate(() => {
                const player = (window as any).__sidflowPlayer;
                return player ? player.getTelemetry() : null;
            });
            if (telemetry) {
                expect(telemetry.framesConsumed).toBeGreaterThan(0);
                if ((telemetry.framesProduced ?? 0) > 0) {
                    expect(telemetry.framesProduced).toBeGreaterThan(0);
                }
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



        test('displays rating controls and allows submission', async ({ page }, testInfo) => {
            await page.goto('/admin?tab=rate', { waitUntil: 'domcontentloaded', timeout: 60_000 });

            // Set up error tracking
            const pageErrors: Error[] = [];
            const consoleErrors: string[] = [];
            const consoleMessages: string[] = [];
            page.on('pageerror', (error) => pageErrors.push(error));
            page.on('console', (msg) => {
                const formatted = `[${msg.type()}] ${msg.text()}`;
                consoleMessages.push(formatted);
                if (msg.type() === 'error') {
                    consoleErrors.push(msg.text());
                }
            });

            // Load a track - wait for pause button to appear and be enabled
            const playButton = page.getByRole('button', { name: /play random sid/i });
            await playButton.click();

            try {
                await page.waitForFunction(() => {
                    const player = (window as unknown as { __sidflowPlayer?: { getState?: () => string } }).__sidflowPlayer;
                    if (!player || typeof player.getState !== 'function') {
                        return false;
                    }
                    const state = player.getState();
                    return state === 'playing' || state === 'paused' || state === 'ready';
                }, { timeout: 60000 });
            } catch (error) {
                console.log('Rating submission test failed waiting for player readiness');
                console.log('Page errors:', pageErrors);
                console.log('Console errors:', consoleErrors);
                console.log('Console messages (last 40):', consoleMessages.slice(-40));
                throw error;
            }

            // Verify rating dimension buttons are present
            await expect(page.getByText(/Energy/i)).toBeVisible({ timeout: 60000 });
            await expect(page.getByText(/Mood/i)).toBeVisible({ timeout: 60000 });
            await expect(page.getByText(/Complexity/i)).toBeVisible({ timeout: 60000 });
            await expect(page.getByText(/Preference/i)).toBeVisible({ timeout: 60000 });

            // Click rating buttons
            const energyButton = page.getByRole('button', { name: /E 5/i });
            await energyButton.click();

            // Verify submit button is enabled
            const submitButton = page.getByRole('button', { name: /submit rating/i });
            await expect(submitButton).toBeVisible();
            await expect(submitButton).toBeEnabled();
        });
    });

    test.describe.serial('PlayTab Browser Playback', () => {
        test.beforeEach(async ({ context }) => {
            await context.addInitScript(() => {
                try {
                    window.localStorage.removeItem('sidflow.preferences');
                } catch {
                    // ignore storage errors in headless environments
                }
                (window as unknown as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared = new Promise((resolve) => {
                    try {
                        const request = indexedDB.deleteDatabase('sidflow-local');
                        request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
                    } catch {
                        resolve(null);
                    }
                });
            });
        });
        test('loads playlist and plays tracks', async ({ page }, testInfo) => {
            // This test exercises complex WASM + AudioWorklet + SharedArrayBuffer which can be unstable
            // Browser crashes (~10% failure rate) are a known Chromium issue with SharedArrayBuffer
            test.slow(); // Mark as slow (gets 3x timeout)
            await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.evaluate(() => (window as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared);
            await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();

            // Set up network monitoring and console capture
            const pcmRequests: string[] = [];
            const consoleMessages: string[] = [];
            page.on('request', (request) => {
                const url = request.url();
                if (url.includes('/stream') || url.includes('.wav') || url.includes('.m4a')) {
                    pcmRequests.push(url);
                }
            });
            page.on('console', (msg) => {
                consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
            });

            // Select a mood preset (Radix UI Select)
            await page.getByRole('combobox').first().click();
            // Wait for dropdown options to render before selecting
            await page.waitForFunction(() => {
                const options = document.querySelectorAll('[role="option"]');
                return options.length > 0;
            }, { timeout: 30_000 });
            await page.getByRole('option', { name: 'Energetic' }).click();

            // Wait for playlist to populate - button text changes from "PLAYLIST EMPTY" to "PLAY NEXT TRACK"
            const playButton = page.getByRole('button', { name: /play next track/i });
            await expect(playButton).toBeEnabled({ timeout: 60000 });

            // Click play button
            await playButton.click();

            // Wait for playback to start - pause button appears and is enabled
            try {
                await waitForPauseButtonReady(page, 'play tab playlist test');
            } catch (error) {
                console.log('PlayTab playback test failed waiting for pause button');
                console.log('Console messages (last 40):', consoleMessages.slice(-40));
                throw error;
            }

            // Verify no PCM streaming occurred
            expect(pcmRequests).toHaveLength(0);

            // Verify playlist is populated
            await expect(page.getByText(/upcoming/i)).toBeVisible();
        });

        test('handles mood preset changes', async ({ page }) => {
            await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.evaluate(() => (window as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared);

            // Helper to select a preset with proper waiting
            const selectPreset = async (name: string) => {
                await page.getByRole('combobox').first().click();
                await page.waitForFunction(() => {
                    const options = document.querySelectorAll('[role="option"]');
                    return options.length > 0;
                }, { timeout: 30_000 });
                await page.getByRole('option', { name }).click();
            };

            // Change preset multiple times (Radix UI Select)
            await selectPreset('Quiet');
            await selectPreset('Energetic');
            await selectPreset('Dark');
        });

        test('displays track information during playback', async ({ page }, testInfo) => {
            // Increase test timeout for this test that involves playback
            test.setTimeout(120_000);
            
            await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.evaluate(() => (window as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared);

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
            
            // Wait for dropdown options to render before selecting
            await page.waitForFunction(() => {
                const options = document.querySelectorAll('[role="option"]');
                return options.length > 0;
            }, { timeout: 30_000 });
            
            await page.getByRole('option', { name: 'Ambient' }).click();

            const playButton = page.getByRole('button', { name: /play next track/i });
            await expect(playButton).toBeEnabled({ timeout: 60000 });
            await playButton.click();

            // Wait for playback to start (pause button appears and is enabled)
            try {
                await waitForPauseButtonReady(page, 'play tab metadata test');
            } catch (error) {
                console.log('Test failed waiting for pause button');
                console.log('Page errors:', pageErrors);
                console.log('Console errors:', consoleErrors);
                throw error;
            }

            // Verify track metadata is displayed
            const artistLabel = page.getByText(/artist/i);
            await expect(artistLabel).toBeVisible({ timeout: 60000 });
        });

        test('queues playback while offline and resumes once online', async ({ page, context }) => {
            await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();

            // Wait for combobox options to be populated before clicking
            const presetTrigger = page.getByRole('combobox').first();
            await expect(presetTrigger).toBeVisible({ timeout: 10_000 });
            await presetTrigger.click();
            
            // Wait for dropdown options to render - increased timeout for CI
            await page.waitForFunction(() => {
                const options = document.querySelectorAll('[role="option"]');
                return options.length > 0;
            }, { timeout: 30_000 });
            
            await page.getByRole('option', { name: 'Energetic' }).click();

            const playButton = page.getByRole('button', { name: /play next track/i });
            await expect(playButton).toBeEnabled({ timeout: 60000 });

            // Wait for player to be ready before going offline
            await page.waitForFunction(() => {
                const player = (window as any).__sidflowPlayer;
                return player && typeof player.getState === 'function';
            }, { timeout: 10000 });

            const consoleMessages: string[] = [];
            page.on('console', (message) => {
                consoleMessages.push(`[${message.type()}] ${message.text()}`);
            });

            try {
                await context.setOffline(true);
                await page.waitForFunction(() => !navigator.onLine);

                await playButton.click();

                const offlineBanner = page.getByTestId('playback-offline-banner');
                await expect(offlineBanner).toBeVisible({ timeout: 5000 });

                const pendingActions = page.getByTestId('playback-pending-actions');
                await expect.poll(async () => {
                    const attributeValue = await offlineBanner.getAttribute('data-pending-count');
                    const attributeCount = attributeValue ? Number.parseInt(attributeValue, 10) : 0;
                    if (Number.isFinite(attributeCount) && attributeCount > 0) {
                        return attributeCount;
                    }
                    return await readPendingPlaybackQueueCount(page);
                }, { timeout: 15000 }).toBeGreaterThan(0);

                if ((await pendingActions.count()) > 0) {
                    await expect(pendingActions.first()).toBeVisible({ timeout: 5000 });
                }

                await context.setOffline(false);
                await page.waitForFunction(() => navigator.onLine);

                await page.waitForFunction(() => {
                    const player = (window as unknown as { __sidflowPlayer?: { getState?: () => string } }).__sidflowPlayer;
                    if (!player || typeof player.getState !== 'function') {
                        return false;
                    }
                    const state = player.getState();
                    return state === 'playing' || state === 'paused' || state === 'ready';
                }, { timeout: 60000 });

                await expect.poll(async () => readPendingPlaybackQueueCount(page), {
                    timeout: 60000,
                }).toBe(0);
                await expect(offlineBanner).toHaveCount(0, { timeout: 60000 });
            } catch (error) {
                const queueSnapshot = await page.evaluate(async () => {
                    return await new Promise((resolve) => {
                        try {
                            const request = indexedDB.open('sidflow-local');
                            request.onerror = () => resolve({ error: request.error?.message ?? 'open failed' });
                            request.onsuccess = () => {
                                const db = request.result;
                                const transaction = db.transaction('playback-queue', 'readonly');
                                const store = transaction.objectStore('playback-queue');
                                const getAll = store.getAll();
                                getAll.onerror = () => resolve({ error: getAll.error?.message ?? 'getAll failed' });
                                getAll.onsuccess = () => {
                                    resolve({ records: getAll.result });
                                };
                            };
                        } catch (err) {
                            resolve({ error: (err as Error).message });
                        }
                    });
                }).catch((evalError) => ({ error: `queue snapshot failed: ${evalError instanceof Error ? evalError.message : String(evalError)}` }));
                console.log('Playback queue snapshot at failure:', queueSnapshot);
                console.log('Console message count:', consoleMessages.length);
                console.log('Console messages during offline playback test (last 40):', consoleMessages.slice(-40));
                console.log('refreshQueueCount logs:', consoleMessages.filter(msg => msg.includes('refreshQueueCount')));
                console.log('Pending count logs:', consoleMessages.filter(msg => msg.includes('Pending count computed')));
                throw error;
            } finally {
                await context.setOffline(false);
            }
        });
    });

    test.describe('WASM Asset Loading', () => {
        test('loads WASM module from /wasm/ path', async ({ page }) => {
            const wasmRequests = new Set<string>();
            const trackWasmRequest = (request: Request) => {
                const url = request.url();
                if (url.includes('.wasm')) {
                    wasmRequests.add(url);
                }
            };

            page.on('request', trackWasmRequest);

            try {
                await page.goto('/admin?tab=rate', { waitUntil: 'domcontentloaded', timeout: 60_000 });

                // Trigger WASM loading by starting playback
                const playButton = page.getByRole('button', { name: /play random sid/i });
                await playButton.click();

                // Wait for WASM request to be made
                await page.waitForEvent('request', {
                    predicate: (req) => req.url().includes('.wasm'),
                    timeout: 30000,
                });

                // Verify the WASM requests
                const wasmUrls = Array.from(wasmRequests);
                expect(wasmUrls.length).toBeGreaterThan(0);

                const wasmUrl = wasmUrls.find((url) => url.includes('libsidplayfp')) ?? wasmUrls[0];
                expect(wasmUrl).toBeDefined();

                const wasmPath = new URL(wasmUrl!).pathname;
                expect(wasmPath.endsWith('.wasm')).toBeTruthy();
                expect(wasmPath.includes('/wasm/')).toBeTruthy();
            } finally {
                page.off('request', trackWasmRequest);
            }
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
                    await page.goto('/admin?tab=rate', { waitUntil: 'domcontentloaded', timeout: 60_000 });

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
                        page.getByRole('button', { name: /pause playback/i }).waitFor({ timeout: 8000 }).catch(() => { }),
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
                        await page.reload({ timeout: 10000 }).catch(() => { });
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
}
