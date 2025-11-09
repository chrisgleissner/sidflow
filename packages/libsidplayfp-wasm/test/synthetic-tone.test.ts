/**
 * Test synthetic SID tone for perfect continuity
 * 
 * Verifies that our artificially generated C4 tone:
 * 1. Has NO dropouts or silent periods
 * 2. Maintains constant frequency (no drift)
 * 3. Has stable amplitude (no volume fluctuations)
 * 4. Produces smooth, continuous audio
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadSyntheticSid(): Uint8Array {
    const sidPath = join(import.meta.dir, '../test-tone-c4.sid');
    return new Uint8Array(readFileSync(sidPath));
}

/**
 * Detect zero-crossings to measure actual frequency
 */
function measureFrequency(pcm: Int16Array, sampleRate: number, channel: number, channels: number): number {
    const samples: number[] = [];
    for (let i = 0; i < pcm.length; i += channels) {
        samples.push(pcm[i + channel]);
    }

    // Count zero crossings
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
            crossings++;
        }
    }

    const duration = samples.length / sampleRate;
    const frequency = crossings / duration / 2; // Divide by 2 because we count both positive and negative crossings

    return frequency;
}

/**
 * Check for any silent periods
 */
function detectSilence(pcm: Int16Array, sampleRate: number, channels: number): Array<{
    start: number;
    duration: number;
    startTime: number;
}> {
    const SILENCE_THRESHOLD = 50; // Very low threshold
    const MIN_SILENT_SAMPLES = Math.floor(sampleRate * channels * 0.001); // 1ms

    const silentPeriods: Array<{ start: number; duration: number; startTime: number }> = [];
    let silentStart = -1;
    let silentCount = 0;

    for (let i = 0; i < pcm.length; i++) {
        if (Math.abs(pcm[i]) < SILENCE_THRESHOLD) {
            if (silentStart === -1) {
                silentStart = i;
            }
            silentCount++;
        } else {
            if (silentCount >= MIN_SILENT_SAMPLES) {
                silentPeriods.push({
                    start: silentStart,
                    duration: silentCount,
                    startTime: silentStart / channels / sampleRate
                });
            }
            silentStart = -1;
            silentCount = 0;
        }
    }

    return silentPeriods;
}

/**
 * Measure RMS amplitude over time
 */
function measureAmplitudeStability(pcm: Int16Array, sampleRate: number, channels: number): {
    avgRMS: number;
    stdDev: number;
    coefficientOfVariation: number;
    minRMS: number;
    maxRMS: number;
} {
    const windowSize = Math.floor(sampleRate * channels * 0.1); // 100ms windows
    const rmsValues: number[] = [];

    for (let start = 0; start < pcm.length; start += windowSize) {
        const end = Math.min(start + windowSize, pcm.length);
        let sumSquares = 0;

        for (let i = start; i < end; i++) {
            sumSquares += pcm[i] * pcm[i];
        }

        const rms = Math.sqrt(sumSquares / (end - start));
        rmsValues.push(rms);
    }

    const avgRMS = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
    const variance = rmsValues.reduce((sum, val) => sum + Math.pow(val - avgRMS, 2), 0) / rmsValues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / avgRMS) * 100;
    const minRMS = Math.min(...rmsValues);
    const maxRMS = Math.max(...rmsValues);

    return {
        avgRMS,
        stdDev,
        coefficientOfVariation,
        minRMS,
        maxRMS
    };
}

describe('Synthetic C4 Tone Verification', () => {
    test('verify C4 tone has perfect continuity', async () => {
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║   SYNTHETIC C4 TONE ANALYSIS          ║');
        console.log('╚════════════════════════════════════════╝\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadSyntheticSid();

        console.log('Loading synthetic C4 SID file...');
        await engine.loadSidBuffer(sidBytes);

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();
        console.log('Tune info:', engine.getTuneInfo());
        console.log(`✓ Loaded (${sampleRate}Hz, ${channels}ch)\n`);

        // Render the full 3+ seconds
        console.log('Rendering audio...');
        const pcm = await engine.renderSeconds(5); // Use default cycle batches
        const actualDuration = pcm.length / channels / sampleRate;
        console.log(`✓ Rendered ${pcm.length} samples (${actualDuration.toFixed(2)}s)\n`);

        const zeroSamples = pcm.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
        console.log(`Zero sample ratio: ${(zeroSamples / pcm.length * 100).toFixed(2)}%`);
        const nonZero = pcm.filter(v => v !== 0).slice(0, 20);
        console.log('First non-zero samples:', nonZero.join(', '));

        // Test 1: Check for silent periods
        console.log('TEST 1: Silence Detection');
        console.log('─────────────────────────');
        const silentPeriods = detectSilence(pcm, sampleRate, channels);

        if (silentPeriods.length === 0) {
            console.log('✓ NO silent periods detected');
            console.log('  Perfect continuity!\n');
        } else {
            console.log(`❌ Found ${silentPeriods.length} silent period(s):`);
            silentPeriods.slice(0, 5).forEach((period, i) => {
                const durationMs = (period.duration / channels / sampleRate * 1000).toFixed(1);
                console.log(`  ${i + 1}. At ${period.startTime.toFixed(3)}s, duration ${durationMs}ms`);
            });
            if (silentPeriods.length > 5) {
                console.log(`  ... and ${silentPeriods.length - 5} more\n`);
            }
            const first = silentPeriods[0];
            if (first) {
                const slice = Array.from(
                    pcm.slice(first.start, Math.min(first.start + first.duration, first.start + 20))
                );
                console.log('  Sample snapshot around first silent period:', slice.join(', '));
            }
        }

        // Test 2: Measure actual frequency
        console.log('TEST 2: Frequency Accuracy');
        console.log('─────────────────────────');
        const expectedFreq = 261.63; // C4
        const measuredFreqLeft = measureFrequency(pcm, sampleRate, 0, channels);
        const measuredFreqRight = measureFrequency(pcm, sampleRate, 1, channels);
        const freqErrorLeft = Math.abs(measuredFreqLeft - expectedFreq);
        const freqErrorRight = Math.abs(measuredFreqRight - expectedFreq);

        console.log(`Expected: ${expectedFreq} Hz (C4)`);
        console.log(`Left channel: ${measuredFreqLeft.toFixed(2)} Hz (error: ${freqErrorLeft.toFixed(2)} Hz)`);
        console.log(`Right channel: ${measuredFreqRight.toFixed(2)} Hz (error: ${freqErrorRight.toFixed(2)} Hz)`);

        if (freqErrorLeft < 1.0 && freqErrorRight < 1.0) {
            console.log('✓ Frequency is accurate (<1 Hz error)\n');
        } else {
            console.log('❌ Frequency error exceeds tolerance\n');
        }

        // Test 3: Amplitude stability
        console.log('TEST 3: Amplitude Stability');
        console.log('─────────────────────────');
        const ampAnalysis = measureAmplitudeStability(pcm, sampleRate, channels);

        console.log(`Average RMS: ${ampAnalysis.avgRMS.toFixed(0)}`);
        console.log(`Std Dev: ${ampAnalysis.stdDev.toFixed(0)}`);
        console.log(`Coefficient of Variation: ${ampAnalysis.coefficientOfVariation.toFixed(1)}%`);
        console.log(`Range: ${ampAnalysis.minRMS.toFixed(0)} - ${ampAnalysis.maxRMS.toFixed(0)}`);

        if (ampAnalysis.coefficientOfVariation < 10) {
            console.log('✓ Amplitude is very stable (<10% variation)\n');
        } else if (ampAnalysis.coefficientOfVariation < 25) {
            console.log('⚠ Amplitude has moderate variation\n');
        } else {
            console.log('❌ Amplitude is unstable\n');
        }

        // Test 4: Check for glitches (extreme sample-to-sample jumps)
        console.log('TEST 4: Glitch Detection');
        console.log('─────────────────────────');
        let glitches = 0;
        const GLITCH_THRESHOLD = 10000; // Large sample-to-sample jump

        for (let i = 1; i < pcm.length; i++) {
            const delta = Math.abs(pcm[i] - pcm[i - 1]);
            if (delta > GLITCH_THRESHOLD) {
                glitches++;
                if (glitches <= 3) {
                    const time = (i / channels / sampleRate).toFixed(4);
                    console.log(`  Glitch at ${time}s: jump of ${delta}`);
                }
            }
        }

        if (glitches === 0) {
            console.log('✓ NO glitches detected\n');
        } else {
            console.log(`❌ Found ${glitches} glitch(es)\n`);
        }

        // Test 5: Verify duration
        console.log('TEST 5: Duration Check');
        console.log('─────────────────────────');
        console.log(`Duration: ${actualDuration.toFixed(2)}s`);

        if (actualDuration >= 3.0) {
            console.log('✓ Duration is at least 3 seconds\n');
        } else {
            console.log('❌ Duration is less than 3 seconds\n');
        }

        // FINAL VERDICT
        console.log('╔════════════════════════════════════════╗');
        console.log('║           FINAL VERDICT                ║');
        console.log('╚════════════════════════════════════════╝\n');

        const isPerfect = silentPeriods.length === 0
            && freqErrorLeft < 1.0
            && freqErrorRight < 1.0
            && ampAnalysis.coefficientOfVariation < 25
            && glitches === 0
            && actualDuration >= 3.0;

        if (isPerfect) {
            console.log('✅ SYNTHETIC TONE IS PERFECT');
            console.log('   • No dropouts');
            console.log('   • Accurate frequency');
            console.log('   • Stable amplitude');
            console.log('   • No glitches');
            console.log('   • Correct duration');
            console.log('\n   → Pipeline is working correctly!\n');
        } else {
            console.log('❌ ISSUES DETECTED');
            if (silentPeriods.length > 0) console.log('   • Has silent periods/dropouts');
            if (freqErrorLeft >= 1.0 || freqErrorRight >= 1.0) console.log('   • Frequency inaccurate');
            if (ampAnalysis.coefficientOfVariation >= 25) console.log('   • Amplitude unstable');
            if (glitches > 0) console.log('   • Contains glitches');
            if (actualDuration < 3.0) console.log('   • Duration too short');
            console.log('\n   → Pipeline has problems!\n');
        }

        // Assertions
        expect(silentPeriods.length).toBe(0); // NO dropouts allowed
        expect(freqErrorLeft).toBeLessThan(5.0); // Frequency accurate within 5 Hz (~2% tolerance)
        expect(freqErrorRight).toBeLessThan(5.0);
        expect(ampAnalysis.coefficientOfVariation).toBeLessThan(30); // Reasonable stability
        expect(glitches).toBe(0); // NO glitches
        expect(actualDuration).toBeGreaterThanOrEqual(3.0); // At least 3 seconds
    });

    test('verify browser pipeline with synthetic tone', async () => {
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║   BROWSER PIPELINE WITH SYNTHETIC      ║');
        console.log('╚════════════════════════════════════════╝\n');

        const INT16_SCALE = 1 / 0x8000;

        // Exact browser flow
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadSyntheticSid();
        await engine.loadSidBuffer(sidBytes);

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();

        // Render
        const renderStart = performance.now();
        const pcm = await engine.renderSeconds(5, 40000);
        const renderTime = performance.now() - renderStart;
        const actualDuration = pcm.length / channels / sampleRate;

        console.log(`Rendered: ${actualDuration.toFixed(2)}s in ${renderTime.toFixed(0)}ms`);
        console.log(`Speed: ${(actualDuration * 1000 / renderTime).toFixed(1)}x realtime`);

        // Convert with chunking (exact browser code)
        const frames = Math.floor(pcm.length / channels);
        const leftChannel = new Float32Array(frames);
        const rightChannel = new Float32Array(frames);

        const CHUNK_SIZE = 44100;
        let conversionTime = 0;

        for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
            const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);

            const chunkStart = performance.now();
            for (let frame = startFrame; frame < endFrame; frame++) {
                const idx = frame * 2;
                leftChannel[frame] = pcm[idx] * INT16_SCALE;
                rightChannel[frame] = pcm[idx + 1] * INT16_SCALE;
            }
            conversionTime += performance.now() - chunkStart;

            if (endFrame < frames) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log(`Converted: ${conversionTime.toFixed(0)}ms\n`);

        // Verify conversion didn't introduce errors
        let conversionErrors = 0;
        for (let i = 0; i < frames; i++) {
            const expectedLeft = pcm[i * 2] * INT16_SCALE;
            const expectedRight = pcm[i * 2 + 1] * INT16_SCALE;

            if (Math.abs(leftChannel[i] - expectedLeft) > 0.00001 ||
                Math.abs(rightChannel[i] - expectedRight) > 0.00001) {
                conversionErrors++;
            }
        }

        const totalPipeline = renderTime + conversionTime;
        const isRealtime = totalPipeline < (actualDuration * 1000);

        console.log('RESULTS:');
        console.log(`  Pipeline time: ${totalPipeline.toFixed(0)}ms`);
        console.log(`  Audio duration: ${(actualDuration * 1000).toFixed(0)}ms`);
        console.log(`  Fast enough? ${isRealtime ? '✓' : '❌'}`);
        console.log(`  Conversion errors? ${conversionErrors === 0 ? '✓ NO' : `❌ ${conversionErrors}`}\n`);

        expect(isRealtime).toBe(true);
        expect(conversionErrors).toBe(0);
    });
});
