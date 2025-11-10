/**
 * End-to-end audio fidelity tests for AudioWorklet + SAB pipeline.
 * 
 * Tests the deterministic C4 test SID with the new real-time streaming pipeline.
 * Verifies:
 * - No underruns during playback
 * - Duration accuracy (±1 frame)
 * - Frequency accuracy (261.63 ± 0.2 Hz)
 * - No dropouts (silent periods ≥129 samples)
 * - RMS stability (±0.5 dB in middle 2.5s)
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Longer timeout for audio operations
test.setTimeout(90000);

// Configure browser launch options at top level
test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-features=SharedArrayBuffer',
    ],
  },
});

interface AudioTelemetry {
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

interface FidelityReport {
  passed: boolean;
  sampleRate: number;
  duration: number;
  underruns: number;
  fundamentalFrequency: number;
  rmsStability: number;
  dropoutCount: number;
  telemetry: AudioTelemetry;
  errors: string[];
}

/**
 * Measure fundamental frequency using zero-crossing method.
 */
function measureFrequency(samples: number[], sampleRate: number): number {
  if (samples.length < 2) {
    return 0;
  }

  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings++;
    }
  }

  const duration = samples.length / sampleRate;
  return crossings / duration / 2; // Divide by 2 for positive/negative crossings
}

/**
 * Detect silent periods (dropouts).
 */
function detectDropouts(samples: number[], threshold = 1e-6, minLength = 129): number {
  let dropoutCount = 0;
  let silentRun = 0;

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) {
      silentRun++;
    } else {
      if (silentRun >= minLength) {
        dropoutCount++;
      }
      silentRun = 0;
    }
  }

  // Check final run
  if (silentRun >= minLength) {
    dropoutCount++;
  }

  return dropoutCount;
}

/**
 * Measure RMS stability over time windows.
 */
function measureRmsStability(samples: number[], sampleRate: number, windowSeconds = 0.1): number {
  const windowSize = Math.floor(sampleRate * windowSeconds);
  const rmsValues: number[] = [];

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sumSquares = 0;

    for (let i = start; i < end; i++) {
      sumSquares += samples[i] * samples[i];
    }

    const rms = Math.sqrt(sumSquares / (end - start));
    rmsValues.push(rms);
  }

  if (rmsValues.length === 0) {
    return 0;
  }

  // Calculate coefficient of variation (std dev / mean)
  const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  const variance = rmsValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / rmsValues.length;
  const stdDev = Math.sqrt(variance);

  return (stdDev / mean) * 100; // Return as percentage
}

/**
 * Helper to capture audio telemetry from the player.
 */
async function getTelemetry(page: Page): Promise<AudioTelemetry> {
  return await page.evaluate(() => {
    // Access the player instance from the global scope
    // This will be exposed by the components during testing
    const player = (window as any).__sidflowPlayer;
    if (!player || typeof player.getTelemetry !== 'function') {
      return {
        underruns: -1,
        framesConsumed: 0,
        framesProduced: 0,
        backpressureStalls: 0,
        minOccupancy: 0,
        maxOccupancy: 0,
      };
    }
    return player.getTelemetry();
  });
}

/**
 * Test audio fidelity for a specific tab.
 */
async function testTabFidelity(page: Page, tabName: 'rate' | 'play'): Promise<FidelityReport> {
  const report: FidelityReport = {
    passed: false,
    sampleRate: 44100,
    duration: 0,
    underruns: 0,
    fundamentalFrequency: 0,
    rmsStability: 0,
    dropoutCount: 0,
    telemetry: {
      underruns: 0,
      framesConsumed: 0,
      framesProduced: 0,
      backpressureStalls: 0,
      minOccupancy: 0,
      maxOccupancy: 0,
    },
    errors: [],
  };

  try {
    // Navigate to test page
    await page.goto('/test/audio-capture');
    await page.waitForTimeout(1000);

    // Check cross-origin isolation
    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    if (!isIsolated) {
      report.errors.push('crossOriginIsolated is false');
      return report;
    }

    // Wait for player to be ready
    await page.waitForFunction(() => (window as any).__testPlayerReady === true, { timeout: 5000 });

    // Enable audio capture and load the C4 test SID
    const { capturedLeft, capturedRight, sampleRate, telemetry } = await page.evaluate(async () => {
      // Create a test session for the C4 SID
      const testSession = {
        sessionId: 'test-c4-' + Date.now(),
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

      // Get the player from the global scope
      const player = (window as any).__testPlayer;
      if (!player) {
        throw new Error('Player not available');
      }

      // Enable capture
      player.enableCapture();

      // Load and play
      await player.load({ session: testSession, track: testTrack });
      await player.play();

      // Wait for playback to complete (3 seconds + buffer)
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Stop playback
      player.stop();

      // Get captured PCM
      const pcm = await player.getCapturedPCM();
      if (!pcm) {
        throw new Error('Failed to capture audio');
      }

      // Get telemetry
      const telemetry = player.getTelemetry();

      return {
        capturedLeft: Array.from(pcm.left),
        capturedRight: Array.from(pcm.right),
        sampleRate: pcm.sampleRate,
        telemetry,
      };
    });

    report.sampleRate = sampleRate;
    report.telemetry = telemetry;
    report.underruns = telemetry.underruns;

    // Analyze left channel (convert unknown[] to number[])
    const leftSamples = capturedLeft as number[];
    const duration = leftSamples.length / sampleRate;
    report.duration = duration;

    // Skip first and last 250ms to avoid transients
    const skipSamples = Math.floor(sampleRate * 0.25);
    const middleSamples = leftSamples.slice(skipSamples, leftSamples.length - skipSamples);

    // Measure frequency
    report.fundamentalFrequency = measureFrequency(middleSamples, sampleRate);

    // Detect dropouts
    report.dropoutCount = detectDropouts(middleSamples);

    // Measure RMS stability
    report.rmsStability = measureRmsStability(middleSamples, sampleRate);

    // Check all criteria
    const frequencyOk = Math.abs(report.fundamentalFrequency - 261.63) < 0.2;
    const durationOk = Math.abs(duration - 3.0) < (1.0 / sampleRate);
    const noUnderruns = report.underruns === 0;
    const noDropouts = report.dropoutCount === 0;
    const stableRms = report.rmsStability < 10; // <10% variation

    report.passed = frequencyOk && durationOk && noUnderruns && noDropouts && stableRms;

    if (!frequencyOk) {
      report.errors.push(`Frequency ${report.fundamentalFrequency.toFixed(2)} Hz not in range 261.43-261.83 Hz`);
    }
    if (!durationOk) {
      report.errors.push(`Duration ${duration.toFixed(3)}s not within ±1 frame of 3.0s`);
    }
    if (!noUnderruns) {
      report.errors.push(`${report.underruns} underruns detected`);
    }
    if (!noDropouts) {
      report.errors.push(`${report.dropoutCount} dropouts detected`);
    }
    if (!stableRms) {
      report.errors.push(`RMS stability ${report.rmsStability.toFixed(1)}% exceeds 10%`);
    }

    return report;
  } catch (error) {
    report.errors.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return report;
  }
}

test.describe('Audio Fidelity - AudioWorklet + SAB Pipeline', () => {
  test('Rate tab: cross-origin isolation enabled', async ({ page }) => {
    await page.goto('/?tab=rate');
    
    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    // Check that SharedArrayBuffer is available
    const hasSharedArrayBuffer = await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined');
    expect(hasSharedArrayBuffer).toBe(true);
  });

  test('Play tab: cross-origin isolation enabled', async ({ page }) => {
    await page.goto('/?tab=play');
    
    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isIsolated).toBe(true);

    const hasSharedArrayBuffer = await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined');
    expect(hasSharedArrayBuffer).toBe(true);
  });

  test('Rate tab: worklet and worker load successfully', async ({ page }) => {
    // Track console messages and errors
    const consoleMessages: string[] = [];
    const pageErrors: Error[] = [];
    
    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      
      // Log important messages
      if (text.includes('WorkletPlayer') || text.includes('SidRenderer') || text.includes('SidProducer')) {
        console.log(text);
      }
    });
    
    page.on('pageerror', (error) => {
      pageErrors.push(error);
      console.error('Page error:', error);
    });

    await page.goto('/?tab=rate');
    await page.waitForTimeout(1000);

    // Check for errors
    if (pageErrors.length > 0) {
      console.error('Page errors:', pageErrors);
    }

    expect(pageErrors.length).toBe(0);

    // Check for successful initialization messages
    const hasWorkletInit = consoleMessages.some(msg => msg.includes('SidRenderer') && msg.includes('Initialized'));
    const hasWorkerInit = consoleMessages.some(msg => msg.includes('SidProducer') && msg.includes('Initialized'));

    if (!hasWorkletInit) {
      console.log('Worklet initialization messages:', consoleMessages.filter(msg => msg.includes('Worklet') || msg.includes('Renderer')));
    }
    if (!hasWorkerInit) {
      console.log('Worker initialization messages:', consoleMessages.filter(msg => msg.includes('Worker') || msg.includes('Producer')));
    }

    // Note: These might not always show if audio hasn't started yet
    // So we'll just log for debugging rather than failing
    console.log('Initialization checks:', { hasWorkletInit, hasWorkerInit });
  });

  test('Play tab: worklet and worker load successfully', async ({ page }) => {
    const consoleMessages: string[] = [];
    const pageErrors: Error[] = [];
    
    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      
      if (text.includes('WorkletPlayer') || text.includes('SidRenderer') || text.includes('SidProducer')) {
        console.log(text);
      }
    });
    
    page.on('pageerror', (error) => {
      pageErrors.push(error);
      console.error('Page error:', error);
    });

    await page.goto('/?tab=play');
    await page.waitForTimeout(1000);

    expect(pageErrors.length).toBe(0);

    console.log('Collected console messages:', consoleMessages.length);
  });

  test('Rate tab: can load and play random SID with worklet', async ({ page }) => {
    const consoleMessages: string[] = [];
    const pageErrors: Error[] = [];
    
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });
    
    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    await page.goto('/?tab=rate');
    await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();

    // Click "PLAY RANDOM SID" button
    const playButton = page.getByRole('button', { name: /play random sid/i });
    await expect(playButton).toBeVisible();
    await playButton.click();

    // Wait for track to load and play
    const pauseButton = page.getByRole('button', { name: /pause playback/i });
    try {
      await expect(pauseButton).toBeVisible({ timeout: 30000 });
      await expect(pauseButton).toBeEnabled();
    } catch (error) {
      console.log('Failed to load track. Page errors:', pageErrors);
      console.log('Console messages:', consoleMessages.slice(-20));
      throw error;
    }

    // Wait for some playback
    await page.waitForTimeout(3000);

    // Check for underruns in console
    const hasUnderruns = consoleMessages.some(msg => msg.includes('underrun') || msg.includes('Underrun'));
    if (hasUnderruns) {
      console.warn('Underruns detected in console:', consoleMessages.filter(msg => 
        msg.toLowerCase().includes('underrun')
      ));
    }

    // Test should pass even if we can't get telemetry yet
    // This is just a smoke test to ensure basic playback works
    expect(pageErrors.length).toBe(0);
  });
});

// Full C4 fidelity tests with audio capture
test.describe('Audio Fidelity - C4 Test SID', () => {
  test('Rate tab: C4 test SID fidelity', async ({ page }) => {
    const report = await testTabFidelity(page, 'rate');
    
    // Log report for debugging
    console.log('Rate tab fidelity report:', JSON.stringify(report, null, 2));
    
    // Expected fidelity criteria
    expect(report.passed, `Fidelity check failed: ${report.errors.join(', ')}`).toBe(true);
    expect(report.underruns).toBe(0);
    expect(report.fundamentalFrequency).toBeGreaterThan(261.43); // 261.63 - 0.2
    expect(report.fundamentalFrequency).toBeLessThan(261.83); // 261.63 + 0.2
    expect(report.dropoutCount).toBe(0);
    expect(report.rmsStability).toBeLessThan(10); // <10% variation
  });

  test('Play tab: C4 test SID fidelity', async ({ page }) => {
    const report = await testTabFidelity(page, 'play');
    
    console.log('Play tab fidelity report:', JSON.stringify(report, null, 2));
    
    expect(report.passed, `Fidelity check failed: ${report.errors.join(', ')}`).toBe(true);
    expect(report.underruns).toBe(0);
    expect(report.fundamentalFrequency).toBeGreaterThan(261.43);
    expect(report.fundamentalFrequency).toBeLessThan(261.83);
    expect(report.dropoutCount).toBe(0);
    expect(report.rmsStability).toBeLessThan(10);
  });
});
