/**
 * End-to-end tests for telemetry validation.
 * 
 * Verifies that:
 * - No underruns occur during normal playback
 * - No zero-byte frames are produced
 * - Timing drift stays within acceptable bounds
 * - Buffer occupancy remains healthy
 * - Telemetry is accessible via window.telemetrySink in test mode
 */

import { test, expect, type Page } from '@playwright/test';

// Longer timeout for audio operations
test.setTimeout(90000);

// Configure browser launch options
test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-features=SharedArrayBuffer',
    ],
  },
});

interface TelemetryData {
  underruns: number;
  framesConsumed: number;
  framesProduced: number;
  backpressureStalls: number;
  minOccupancy: number;
  maxOccupancy: number;
  zeroByteFrames: number;
  missedQuanta: number;
  avgDriftMs: number;
  maxDriftMs: number;
  contextSuspendCount: number;
  contextResumeCount: number;
}

/**
 * Get telemetry from the player
 */
async function getTelemetry(page: Page): Promise<TelemetryData | null> {
  return await page.evaluate(() => {
    const player = (window as any).__sidflowPlayer;
    if (!player || typeof player.getTelemetry !== 'function') {
      return null;
    }
    return player.getTelemetry();
  });
}

/**
 * Set telemetry mode for testing
 */
async function setTelemetryMode(page: Page, mode: 'production' | 'test' | 'disabled'): Promise<void> {
  await page.evaluate((m) => {
    (window as any).NEXT_PUBLIC_TELEMETRY_MODE = m;
    // Reinitialize telemetry service if needed
    if ((window as any).telemetry) {
      (window as any).telemetry.setMode(m);
    }
  }, mode);
}

/**
 * Get telemetry events from test sink
 */
async function getTelemetrySink(page: Page): Promise<any[]> {
  return await page.evaluate(() => {
    return (window as any).telemetrySink || [];
  });
}

test.describe('Telemetry Validation', () => {
  test('verifies no underruns during normal playback', async ({ page }) => {
    // Navigate to audio capture test page
    await page.goto('/test/audio-capture');
    await page.waitForTimeout(1000);

    // Check cross-origin isolation
    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    // Wait for player to be ready
    await page.waitForFunction(() => (window as any).__testPlayerReady === true, { timeout: 5000 });

    // Play a short track
    await page.evaluate(async () => {
      const testSession = {
        sessionId: 'telemetry-test-' + Date.now(),
        sidUrl: '/test-tone-c4.sid',
        scope: 'test' as const,
        durationSeconds: 3.0,
        selectedSong: 0,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      const testTrack = {
        sidPath: '/test-tone-c4.sid',
        relativePath: 'test-tone-c4.sid',
        filename: 'test-tone-c4.sid',
        displayName: 'Test Tone C4',
        selectedSong: 0,
        metadata: {
          title: 'Test Tone C4',
          author: 'SIDFlow',
          released: '2025',
          songs: 1,
          startSong: 0,
          sidType: 'PSID',
          version: 2,
          sidModel: 'MOS6581',
          clock: 'PAL',
          fileSizeBytes: 380,
        },
        durationSeconds: 3.0,
      };

      const player = (window as any).__testPlayer;
      if (!player) {
        throw new Error('Player not available');
      }

      await player.load({ session: testSession, track: testTrack });
      await player.play();
    });

    // Wait for playback to complete
    await page.waitForTimeout(4000);

    // Get telemetry
    const telemetry = await getTelemetry(page);
    expect(telemetry).not.toBeNull();

    // Verify no underruns
    expect(telemetry!.underruns).toBe(0);
    expect(telemetry!.missedQuanta).toBe(0);

    // Verify frames were consumed
    expect(telemetry!.framesConsumed).toBeGreaterThan(0);
    expect(telemetry!.framesProduced).toBeGreaterThan(0);

    // Stop playback
    await page.evaluate(() => {
      const player = (window as any).__testPlayer;
      if (player) {
        player.stop();
      }
    });
  });

  test('verifies zero-byte frames are minimal', async ({ page }) => {
    await page.goto('/test/audio-capture');
    await page.waitForTimeout(1000);

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    await page.waitForFunction(() => (window as any).__testPlayerReady === true, { timeout: 5000 });

    // Play a track
    await page.evaluate(async () => {
      const testSession = {
        sessionId: 'telemetry-test-' + Date.now(),
        sidUrl: '/test-tone-c4.sid',
        scope: 'test' as const,
        durationSeconds: 3.0,
        selectedSong: 0,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      const testTrack = {
        sidPath: '/test-tone-c4.sid',
        relativePath: 'test-tone-c4.sid',
        filename: 'test-tone-c4.sid',
        displayName: 'Test Tone C4',
        selectedSong: 0,
        metadata: {
          title: 'Test Tone C4',
          author: 'SIDFlow',
          released: '2025',
          songs: 1,
          startSong: 0,
          sidType: 'PSID',
          version: 2,
          sidModel: 'MOS6581',
          clock: 'PAL',
          fileSizeBytes: 380,
        },
        durationSeconds: 3.0,
      };

      const player = (window as any).__testPlayer;
      await player.load({ session: testSession, track: testTrack });
      await player.play();
    });

    await page.waitForTimeout(4000);

    const telemetry = await getTelemetry(page);
    expect(telemetry).not.toBeNull();

    // Zero-byte frames should be minimal (less than 1% of total frames)
    const zeroByteRate = telemetry!.framesConsumed > 0
      ? (telemetry!.zeroByteFrames / telemetry!.framesConsumed) * 100
      : 0;

    expect(zeroByteRate).toBeLessThan(1.0);

    await page.evaluate(() => {
      const player = (window as any).__testPlayer;
      if (player) player.stop();
    });
  });

  test('verifies timing drift stays within bounds', async ({ page }) => {
    await page.goto('/test/audio-capture');
    await page.waitForTimeout(1000);

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    await page.waitForFunction(() => (window as any).__testPlayerReady === true, { timeout: 5000 });

    await page.evaluate(async () => {
      const testSession = {
        sessionId: 'telemetry-test-' + Date.now(),
        sidUrl: '/test-tone-c4.sid',
        scope: 'test' as const,
        durationSeconds: 3.0,
        selectedSong: 0,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      const testTrack = {
        sidPath: '/test-tone-c4.sid',
        relativePath: 'test-tone-c4.sid',
        filename: 'test-tone-c4.sid',
        displayName: 'Test Tone C4',
        selectedSong: 0,
        metadata: {
          title: 'Test Tone C4',
          author: 'SIDFlow',
          released: '2025',
          songs: 1,
          startSong: 0,
          sidType: 'PSID',
          version: 2,
          sidModel: 'MOS6581',
          clock: 'PAL',
          fileSizeBytes: 380,
        },
        durationSeconds: 3.0,
      };

      const player = (window as any).__testPlayer;
      await player.load({ session: testSession, track: testTrack });
      await player.play();
    });

    await page.waitForTimeout(4000);

    const telemetry = await getTelemetry(page);
    expect(telemetry).not.toBeNull();

    // Average drift should be very low (< 0.5ms)
    expect(telemetry!.avgDriftMs).toBeLessThan(0.5);

    // Max drift should be acceptable (< 2ms)
    expect(telemetry!.maxDriftMs).toBeLessThan(2.0);

    await page.evaluate(() => {
      const player = (window as any).__testPlayer;
      if (player) player.stop();
    });
  });

  test('verifies buffer occupancy is healthy', async ({ page }) => {
    await page.goto('/test/audio-capture');
    await page.waitForTimeout(1000);

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    await page.waitForFunction(() => (window as any).__testPlayerReady === true, { timeout: 5000 });

    await page.evaluate(async () => {
      const testSession = {
        sessionId: 'telemetry-test-' + Date.now(),
        sidUrl: '/test-tone-c4.sid',
        scope: 'test' as const,
        durationSeconds: 3.0,
        selectedSong: 0,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };

      const testTrack = {
        sidPath: '/test-tone-c4.sid',
        relativePath: 'test-tone-c4.sid',
        filename: 'test-tone-c4.sid',
        displayName: 'Test Tone C4',
        selectedSong: 0,
        metadata: {
          title: 'Test Tone C4',
          author: 'SIDFlow',
          released: '2025',
          songs: 1,
          startSong: 0,
          sidType: 'PSID',
          version: 2,
          sidModel: 'MOS6581',
          clock: 'PAL',
          fileSizeBytes: 380,
        },
        durationSeconds: 3.0,
      };

      const player = (window as any).__testPlayer;
      await player.load({ session: testSession, track: testTrack });
      await player.play();
    });

    await page.waitForTimeout(4000);

    const telemetry = await getTelemetry(page);
    expect(telemetry).not.toBeNull();

    // Buffer should have had some data (minOccupancy > 0)
    expect(telemetry!.minOccupancy).toBeGreaterThan(0);

    // Buffer should not be constantly full (maxOccupancy < capacity)
    // Capacity is 16384 frames, so maxOccupancy should be less than 90% of that
    expect(telemetry!.maxOccupancy).toBeLessThan(16384 * 0.9);

    await page.evaluate(() => {
      const player = (window as any).__testPlayer;
      if (player) player.stop();
    });
  });

  test('verifies telemetry sink works in test mode', async ({ page }) => {
    // Navigate to a page with telemetry
    await page.goto('/?tab=rate');
    await page.waitForTimeout(1000);

    // Initialize telemetry sink and set mode to test
    await page.evaluate(() => {
      (window as any).telemetrySink = [];
      (window as any).NEXT_PUBLIC_TELEMETRY_MODE = 'test';
    });

    // Trigger some telemetry events by interacting with the page
    await page.evaluate(() => {
      // Manually track an event using telemetry service
      const telemetry = (window as any).telemetry;
      if (telemetry) {
        telemetry.setMode('test');
        telemetry.trackPlaybackLoad({
          sessionId: 'test-session',
          sidPath: 'test.sid',
          status: 'start',
        });
      }
    });

    // Wait a moment for events to propagate
    await page.waitForTimeout(500);

    // Get telemetry sink
    const sink = await getTelemetrySink(page);

    // Verify events were captured
    expect(sink.length).toBeGreaterThan(0);
    
    // Verify event structure
    const firstEvent = sink[0];
    expect(firstEvent).toHaveProperty('type');
    expect(firstEvent).toHaveProperty('timestamp');
  });
});
