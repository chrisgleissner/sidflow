/**
 * Audio integrity test with synthetic waveform
 * 
 * Creates a test SID that should produce a continuous tone,
 * then verifies the rendered audio has no gaps, glitches, or interruptions
 * that would be audible to a user.
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function loadRealSid(): Uint8Array {
    const sidPath = join(import.meta.dir, '../../../test-data/C64Music/DEMOS/0-9/10_Orbyte.sid');
    return new Uint8Array(readFileSync(sidPath));
}

/**
 * Analyze audio for continuity issues
 */
function analyzeAudioContinuity(pcm: Int16Array, sampleRate: number, channels: number): {
    hasGaps: boolean;
    hasGlitches: boolean;
    silentSamples: number;
    glitchCount: number;
    avgLevel: number;
    maxLevel: number;
    continuityScore: number;
} {
    const frames = pcm.length / channels;
    let silentSamples = 0;
    let glitchCount = 0;
    let totalLevel = 0;
    let maxLevel = 0;
    let prevSample = 0;

    const SILENCE_THRESHOLD = 10; // Below this is considered silence (very quiet)
    const GLITCH_THRESHOLD = 10000; // Sample-to-sample change above this is a glitch

    for (let i = 0; i < pcm.length; i++) {
        const sample = Math.abs(pcm[i]);

        // Track silence
        if (sample < SILENCE_THRESHOLD) {
            silentSamples++;
        }

        // Track glitches (extreme sample-to-sample jumps)
        const delta = Math.abs(sample - Math.abs(prevSample));
        if (delta > GLITCH_THRESHOLD) {
            glitchCount++;
        }

        totalLevel += sample;
        maxLevel = Math.max(maxLevel, sample);
        prevSample = pcm[i];
    }

    const avgLevel = totalLevel / pcm.length;
    const silenceRatio = silentSamples / pcm.length;
    const glitchRatio = glitchCount / pcm.length;

    // Continuity score: 100 = perfect, 0 = terrible
    // Penalize silence and glitches
    const continuityScore = Math.max(0, 100 - (silenceRatio * 50) - (glitchRatio * 1000));

    return {
        hasGaps: silenceRatio > 0.1, // More than 10% silence
        hasGlitches: glitchCount > frames * 0.01, // More than 1% glitch rate
        silentSamples,
        glitchCount,
        avgLevel,
        maxLevel,
        continuityScore
    };
}

/**
 * Detect audio dropouts (consecutive silent samples)
 */
function detectDropouts(pcm: Int16Array, sampleRate: number, channels: number): Array<{
    startSample: number;
    duration: number;
    startTime: number;
}> {
    const SILENCE_THRESHOLD = 10; // Very quiet threshold
    const MIN_DROPOUT_SAMPLES = Math.floor(sampleRate * channels * 0.005); // 5ms minimum (more sensitive)

    const dropouts: Array<{ startSample: number; duration: number; startTime: number }> = [];
    let dropoutStart = -1;
    let consecutiveSilent = 0;

    for (let i = 0; i < pcm.length; i++) {
        if (Math.abs(pcm[i]) < SILENCE_THRESHOLD) {
            if (dropoutStart === -1) {
                dropoutStart = i;
            }
            consecutiveSilent++;
        } else {
            if (consecutiveSilent >= MIN_DROPOUT_SAMPLES) {
                dropouts.push({
                    startSample: dropoutStart,
                    duration: consecutiveSilent,
                    startTime: (dropoutStart / channels / sampleRate)
                });
            }
            dropoutStart = -1;
            consecutiveSilent = 0;
        }
    }

    return dropouts;
}

/**
 * Calculate RMS (Root Mean Square) level over time windows
 * to detect volume variations that would sound like stuttering
 */
function analyzeRMSVariation(pcm: Int16Array, sampleRate: number, channels: number): {
    rmsValues: number[];
    avgRMS: number;
    stdDevRMS: number;
    coefficientOfVariation: number;
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
    const stdDevRMS = Math.sqrt(variance);
    const coefficientOfVariation = (stdDevRMS / avgRMS) * 100;

    return {
        rmsValues,
        avgRMS,
        stdDevRMS,
        coefficientOfVariation
    };
}

describe('Audio Continuity Verification', () => {
    test('verify real SID produces continuous audio without gaps', async () => {
        console.log('\n=== AUDIO CONTINUITY TEST ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadRealSid();
        await engine.loadSidBuffer(sidBytes);

        // Render 5 seconds
        const targetDuration = 5;
        const pcm = await engine.renderSeconds(targetDuration, 40000);

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();
        const actualDuration = pcm.length / channels / sampleRate;

        console.log(`Rendered ${actualDuration.toFixed(2)}s of audio (${pcm.length} samples)`);

        // Analyze continuity
        const analysis = analyzeAudioContinuity(pcm, sampleRate, channels);

        console.log(`\nContinuity Analysis:`);
        console.log(`  Silent samples: ${analysis.silentSamples} (${(analysis.silentSamples / pcm.length * 100).toFixed(2)}%)`);
        console.log(`  Glitches detected: ${analysis.glitchCount}`);
        console.log(`  Avg level: ${analysis.avgLevel.toFixed(0)}`);
        console.log(`  Max level: ${analysis.maxLevel}`);
        console.log(`  Continuity score: ${analysis.continuityScore.toFixed(1)}/100`);
        console.log(`  Has gaps? ${analysis.hasGaps ? '❌ YES' : '✓ NO'}`);
        console.log(`  Has glitches? ${analysis.hasGlitches ? '❌ YES' : '✓ NO'}`);

        // Detect dropouts
        const dropouts = detectDropouts(pcm, sampleRate, channels);
        console.log(`\nDropout Detection:`);
        if (dropouts.length === 0) {
            console.log(`  ✓ No dropouts detected`);
        } else {
            console.log(`  ❌ Found ${dropouts.length} dropout(s):`);
            dropouts.forEach((dropout, i) => {
                const durationMs = (dropout.duration / channels / sampleRate * 1000).toFixed(1);
                console.log(`     ${i + 1}. At ${dropout.startTime.toFixed(3)}s, duration ${durationMs}ms`);
            });
        }

        // RMS variation (should be relatively stable for continuous music)
        const rmsAnalysis = analyzeRMSVariation(pcm, sampleRate, channels);
        console.log(`\nRMS Variation (volume stability):`);
        console.log(`  Avg RMS: ${rmsAnalysis.avgRMS.toFixed(0)}`);
        console.log(`  Std Dev: ${rmsAnalysis.stdDevRMS.toFixed(0)}`);
        console.log(`  Coefficient of Variation: ${rmsAnalysis.coefficientOfVariation.toFixed(1)}%`);
        console.log(`  ${rmsAnalysis.coefficientOfVariation < 50 ? '✓' : '❌'} Volume is ${rmsAnalysis.coefficientOfVariation < 50 ? 'stable' : 'unstable'}`);

        // Assertions
        expect(analysis.continuityScore).toBeGreaterThan(50); // Reasonable continuity
        expect(dropouts.length).toBe(0); // No dropouts
        expect(analysis.avgLevel).toBeGreaterThan(100); // Has actual audio content
    });

    test('simulate EXACT browser playback: load → render → convert → verify', async () => {
        console.log('\n=== BROWSER PLAYBACK SIMULATION - 5s ===\n');

        const targetDuration = 5;
        const INT16_SCALE = 1 / 0x8000;

        // STAGE 1: Engine initialization
        const t0 = performance.now();
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const t1 = performance.now();
        console.log(`1. Engine init: ${(t1 - t0).toFixed(2)}ms`);

        // STAGE 2: Load SID file
        const t2 = performance.now();
        const sidBytes = loadRealSid();
        await engine.loadSidBuffer(sidBytes);
        const t3 = performance.now();
        console.log(`2. Load SID: ${(t3 - t2).toFixed(2)}ms`);

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();

        // STAGE 3: Render PCM (this is what causes choppy audio if too slow)
        const t4 = performance.now();
        const pcm = await engine.renderSeconds(targetDuration, 40000);
        const t5 = performance.now();
        const renderTime = t5 - t4;

        const actualDuration = pcm.length / channels / sampleRate;
        console.log(`3. Render PCM: ${renderTime.toFixed(2)}ms`);
        console.log(`   Audio duration: ${actualDuration.toFixed(2)}s`);

        // STAGE 4: Convert INT16 to Float32 with chunking (what we do in browser)
        const t6 = performance.now();
        const frames = Math.floor(pcm.length / channels);
        const leftChannel = new Float32Array(frames);
        const rightChannel = new Float32Array(frames);

        const CHUNK_SIZE = 44100; // 1 second chunks
        let yieldCount = 0;

        for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
            const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);
            for (let frame = startFrame; frame < endFrame; frame++) {
                const idx = frame * 2;
                leftChannel[frame] = pcm[idx] * INT16_SCALE;
                rightChannel[frame] = pcm[idx + 1] * INT16_SCALE;
            }
            if (endFrame < frames) {
                await new Promise(resolve => setTimeout(resolve, 0));
                yieldCount++;
            }
        }
        const t7 = performance.now();
        const conversionTime = t7 - t6;
        console.log(`4. INT16→Float32: ${conversionTime.toFixed(2)}ms (${yieldCount} yields)`);

        // TOTAL
        const totalTime = t7 - t0;
        const realtimeRatio = (actualDuration * 1000) / totalTime;

        console.log(`\n=== RESULTS ===`);
        console.log(`Total pipeline: ${totalTime.toFixed(2)}ms`);
        console.log(`Real-time ratio: ${realtimeRatio.toFixed(2)}x`);
        console.log(`Would finish before audio ends? ${totalTime < actualDuration * 1000 ? '✓ YES' : '❌ NO'}`);

        // Verify converted audio maintains continuity
        const analysis = analyzeAudioContinuity(pcm, sampleRate, channels);
        console.log(`\nAudio quality:`);
        console.log(`  Continuity score: ${analysis.continuityScore.toFixed(1)}/100`);
        console.log(`  Dropouts: ${detectDropouts(pcm, sampleRate, channels).length}`);

        // Critical assertions
        expect(realtimeRatio).toBeGreaterThan(1.0);
        expect(totalTime).toBeLessThan(actualDuration * 1000);
        expect(analysis.continuityScore).toBeGreaterThan(50);
    });

    test('measure conversion blocking and verify no long blocks', async () => {
        console.log('\n=== MAIN THREAD BLOCKING ANALYSIS ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadRealSid();
        await engine.loadSidBuffer(sidBytes);

        const pcm = await engine.renderSeconds(5, 40000);
        const frames = Math.floor(pcm.length / 2);
        const INT16_SCALE = 1 / 0x8000;

        console.log(`Converting ${frames} frames (${(frames / 44100).toFixed(2)}s audio)`);

        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        const CHUNK_SIZE = 44100; // 1 second
        const blockTimes: number[] = [];

        for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
            const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);

            const blockStart = performance.now();
            for (let frame = startFrame; frame < endFrame; frame++) {
                const idx = frame * 2;
                left[frame] = pcm[idx] * INT16_SCALE;
                right[frame] = pcm[idx + 1] * INT16_SCALE;
            }
            const blockTime = performance.now() - blockStart;
            blockTimes.push(blockTime);

            const chunkSize = endFrame - startFrame;
            const chunkDuration = (chunkSize / 44100) * 1000;
            console.log(`  Block ${Math.floor(startFrame / CHUNK_SIZE) + 1}: ${blockTime.toFixed(2)}ms for ${chunkDuration.toFixed(0)}ms audio`);

            if (endFrame < frames) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const maxBlock = Math.max(...blockTimes);
        const avgBlock = blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length;
        const totalConversion = blockTimes.reduce((a, b) => a + b, 0);

        console.log(`\n=== BLOCKING RESULTS ===`);
        console.log(`Total conversion: ${totalConversion.toFixed(2)}ms`);
        console.log(`Avg block: ${avgBlock.toFixed(2)}ms`);
        console.log(`Max block: ${maxBlock.toFixed(2)}ms`);
        console.log(`Blocks processed: ${blockTimes.length}`);
        console.log(`Blocks main thread (>16ms)? ${maxBlock > 16 ? '❌ YES' : '✓ NO'}`);

        // Should not block for too long
        expect(maxBlock).toBeLessThan(50); // Max 50ms per block
    });

    test('stress test: rapid consecutive renders', async () => {
        console.log('\n=== RAPID RENDER STRESS TEST ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadRealSid();

        const iterations = 5;
        const renderTimes: number[] = [];
        const continuityScores: number[] = [];

        console.log(`Running ${iterations} consecutive load+render cycles...\n`);

        for (let i = 0; i < iterations; i++) {
            await engine.loadSidBuffer(sidBytes);

            const start = performance.now();
            const pcm = await engine.renderSeconds(2, 40000); // 2 seconds
            const elapsed = performance.now() - start;

            renderTimes.push(elapsed);

            const analysis = analyzeAudioContinuity(pcm, 44100, 2);
            continuityScores.push(analysis.continuityScore);

            console.log(`  Cycle ${i + 1}: ${elapsed.toFixed(2)}ms, continuity ${analysis.continuityScore.toFixed(1)}/100`);
        }

        const avgTime = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
        const avgContinuity = continuityScores.reduce((a, b) => a + b, 0) / continuityScores.length;

        console.log(`\nAvg render time: ${avgTime.toFixed(2)}ms`);
        console.log(`Avg continuity: ${avgContinuity.toFixed(1)}/100`);
        console.log(`All cycles successful: ${renderTimes.every(t => t < 500) ? '✓' : '❌'}`);

        expect(avgTime).toBeLessThan(300);
        expect(avgContinuity).toBeGreaterThan(50);
    });

    test('save rendered audio for manual inspection (WAV file)', async () => {
        console.log('\n=== SAVE AUDIO FOR MANUAL VERIFICATION ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadRealSid();
        await engine.loadSidBuffer(sidBytes);

        const pcm = await engine.renderSeconds(5, 40000);
        const sampleRate = 44100;
        const channels = 2;

        // Create WAV file header
        const dataSize = pcm.length * 2; // 16-bit samples
        const wavHeader = new ArrayBuffer(44);
        const view = new DataView(wavHeader);

        // "RIFF" chunk
        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + dataSize, true); // file size - 8
        view.setUint32(8, 0x57415645, false); // "WAVE"

        // "fmt " subchunk
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true); // subchunk size
        view.setUint16(20, 1, true); // audio format (PCM)
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true); // byte rate
        view.setUint16(32, channels * 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample

        // "data" subchunk
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, dataSize, true);

        // Combine header + PCM data
        const wavBuffer = new Uint8Array(44 + dataSize);
        wavBuffer.set(new Uint8Array(wavHeader), 0);

        // Copy PCM data as bytes (INT16 little-endian)
        const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        wavBuffer.set(pcmBytes, 44);

        const outputPath = join(import.meta.dir, '../test-output.wav');
        writeFileSync(outputPath, wavBuffer);

        console.log(`✓ Saved audio to: ${outputPath}`);
        console.log(`  Duration: ${(pcm.length / channels / sampleRate).toFixed(2)}s`);
        console.log(`  Sample rate: ${sampleRate}Hz`);
        console.log(`  Channels: ${channels}`);
        console.log(`\nYou can play this file to verify audio quality manually.`);

        expect(pcm.length).toBeGreaterThan(0);
    });
});
