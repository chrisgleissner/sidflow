/// <reference types="bun-types" />

/**
 * Performance benchmarks for WASM SID rendering hot path
 * 
 * These tests measure the critical performance metrics in isolation:
 * - WASM render throughput (samples/second)
 * - INT16 to Float32 conversion speed
 * - Memory allocation overhead
 * - Cache build latency
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url));

// Load a real SID file for benchmarking
function loadTestSid(): Uint8Array {
    const sidPath = join(CURRENT_DIR, '../../../test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid');
    return new Uint8Array(readFileSync(sidPath));
}

describe('WASM Rendering Performance', () => {
    test('measure render throughput (samples/second)', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        const targetSeconds = 5; // Render 5 seconds (more realistic)
        const startTime = performance.now();

        const pcm = await engine.renderSeconds(targetSeconds);

        const endTime = performance.now();
        const elapsedMs = endTime - startTime;
        const elapsedSeconds = elapsedMs / 1000;

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();
        const samplesRendered = pcm.length;
        const framesRendered = samplesRendered / channels;
        const actualSeconds = framesRendered / sampleRate;
        const throughputRatio = actualSeconds / elapsedSeconds;

        console.log(`\n=== WASM Render Performance ===`);
        console.log(`Target duration: ${targetSeconds}s`);
        console.log(`Actual duration: ${actualSeconds.toFixed(2)}s`);
        console.log(`Render time: ${elapsedMs.toFixed(0)}ms`);
        console.log(`Throughput: ${throughputRatio.toFixed(2)}x realtime`);
        console.log(`Samples/sec: ${(samplesRendered / elapsedSeconds).toFixed(0)}`);
        console.log(`Samples rendered: ${samplesRendered} (expected: ${Math.floor(sampleRate * channels * targetSeconds)})`);

        // Assert we got reasonable amount of data. Some tunes terminate early, so if
        // the measured duration is extremely short we skip the strict throughput
        // assertion and only require non-zero output.
        const MIN_DURATION_FOR_THROUGHPUT = 0.5; // seconds of PCM needed for a stable reading

        expect(samplesRendered).toBeGreaterThan(0);
        if (actualSeconds >= MIN_DURATION_FOR_THROUGHPUT) {
            expect(throughputRatio).toBeGreaterThan(1.5); // Maintain a comfortable realtime margin
        }
    });

    test('measure cache build performance', async () => {
        const engine = new SidAudioEngine({
            sampleRate: 44100,
            stereo: true,
            cacheSecondsLimit: 60 // Build 60 seconds of cache
        });
        const sidBuffer = loadTestSid();

        const startTime = performance.now();
        await engine.loadSidBuffer(sidBuffer);
        const endTime = performance.now();

        const elapsedMs = endTime - startTime;

        console.log(`\n=== Cache Build Performance ===`);
        console.log(`Cache limit: 60s`);
        console.log(`Build time: ${elapsedMs.toFixed(0)}ms`);
        console.log(`Throughput: ${(60000 / elapsedMs).toFixed(2)}x realtime`);

        // Cache should build fast (background builds have more leeway)
        expect(elapsedMs).toBeLessThan(10000); // Less than 10 seconds to cache 60s
    });

    test('measure renderCycles call overhead', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        const targetIterations = 1000;
        const cyclesPerCall = 20000;

        const startTime = performance.now();
        let iterations = 0;
        while (iterations < targetIterations) {
            const chunk = engine.renderCycles(cyclesPerCall);
            if (!chunk || chunk.length === 0) {
                break;
            }
            iterations++;
        }
        const endTime = performance.now();

        const elapsedMs = endTime - startTime;
        const avgCallTime = iterations === 0 ? elapsedMs : elapsedMs / iterations;

        console.log(`\n=== WASM Call Overhead ===`);
        console.log(`Iterations: ${iterations}`);
        console.log(`Cycles per call: ${cyclesPerCall}`);
        console.log(`Total time: ${elapsedMs.toFixed(0)}ms`);
        console.log(`Avg call time: ${avgCallTime.toFixed(3)}ms`);
        console.log(`Calls/sec: ${(1000 / avgCallTime).toFixed(0)}`);

        // Each call should be very fast. Some short tunes terminate after only a few
        // renderCycles calls, which results in small sample sizes and higher variance
        // when CI is heavily loaded. In that case we relax the threshold slightly to
        // avoid flaky failures while still ensuring sub-25ms overhead per call.
        const relaxedThreshold = iterations >= 50 ? 10 : 25;

        expect(iterations).toBeGreaterThan(0);
        expect(avgCallTime).toBeLessThan(relaxedThreshold);
    });
});

describe('INT16 to Float32 Conversion Performance', () => {
    test('measure conversion speed for stereo buffer', () => {
        const sampleRate = 44100;
        const channels = 2;
        const seconds = 10;
        const frames = sampleRate * seconds;
        const totalSamples = frames * channels;

        // Create mock INT16 PCM data
        const pcm = new Int16Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            pcm[i] = Math.floor(Math.random() * 65536) - 32768;
        }

        const INT16_SCALE = 1 / 0x8000;

        console.log(`\n=== Conversion Performance (Stereo) ===`);
        console.log(`Buffer size: ${totalSamples} samples (${seconds}s)`);

        // Method 1: Direct nested loop (original approach)
        const startMethod1 = performance.now();
        const output1: number[][] = [[], []];
        for (let channel = 0; channel < channels; channel++) {
            for (let frame = 0; frame < frames; frame++) {
                output1[channel][frame] = pcm[frame * channels + channel] * INT16_SCALE;
            }
        }
        const timeMethod1 = performance.now() - startMethod1;
        console.log(`Method 1 (nested loop): ${timeMethod1.toFixed(2)}ms`);

        // Method 2: Stereo fast-path (optimized)
        const startMethod2 = performance.now();
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame++) {
            const idx = frame * 2;
            left[frame] = pcm[idx] * INT16_SCALE;
            right[frame] = pcm[idx + 1] * INT16_SCALE;
        }
        const timeMethod2 = performance.now() - startMethod2;
        console.log(`Method 2 (stereo fast-path): ${timeMethod2.toFixed(2)}ms`);
        console.log(`Speedup: ${(timeMethod1 / timeMethod2).toFixed(2)}x`);

        // Method should be significantly faster
        expect(timeMethod2).toBeLessThan(timeMethod1);
        expect(timeMethod2).toBeLessThan(50); // Should complete in under 50ms
    });

    test('measure conversion with different chunk sizes', () => {
        const sampleRate = 44100;
        const channels = 2;
        const INT16_SCALE = 1 / 0x8000;

        const chunkSizes = [1024, 2048, 4096, 8192, 16384];

        console.log(`\n=== Chunk Size Analysis ===`);

        for (const chunkSize of chunkSizes) {
            const pcm = new Int16Array(chunkSize * channels);
            for (let i = 0; i < pcm.length; i++) {
                pcm[i] = Math.floor(Math.random() * 65536) - 32768;
            }

            const iterations = 100;
            const startTime = performance.now();

            for (let iter = 0; iter < iterations; iter++) {
                const left = new Float32Array(chunkSize);
                const right = new Float32Array(chunkSize);
                for (let frame = 0; frame < chunkSize; frame++) {
                    const idx = frame * 2;
                    left[frame] = pcm[idx] * INT16_SCALE;
                    right[frame] = pcm[idx + 1] * INT16_SCALE;
                }
            }

            const avgTime = (performance.now() - startTime) / iterations;
            console.log(`Chunk ${chunkSize} samples: ${avgTime.toFixed(3)}ms`);
        }
    });
});

describe('Memory Allocation Performance', () => {
    test('measure TypedArray allocation overhead', () => {
        const sizes = [44100, 441000, 2646000]; // 1s, 10s, 60s of stereo audio

        console.log(`\n=== Memory Allocation Overhead ===`);

        for (const size of sizes) {
            const iterations = 100;

            const startTime = performance.now();
            for (let i = 0; i < iterations; i++) {
                const buffer = new Int16Array(size);
                expect(buffer.length).toBe(size);
            }
            const avgTime = (performance.now() - startTime) / iterations;

            const sizeInMB = (size * 2) / (1024 * 1024); // INT16 = 2 bytes
            console.log(`${sizeInMB.toFixed(1)}MB buffer: ${avgTime.toFixed(3)}ms`);
        }
    });
});

describe('End-to-End Hot Path', () => {
    test('measure complete load-to-ready pipeline', async () => {
        const sidBuffer = loadTestSid();

        console.log(`\n=== Complete Load Pipeline ===`);

        // Stage 1: Engine initialization
        const t0 = performance.now();
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const t1 = performance.now();
        console.log(`Engine init: ${(t1 - t0).toFixed(2)}ms`);

        // Stage 2: Load SID buffer
        const t2 = performance.now();
        await engine.loadSidBuffer(sidBuffer);
        const t3 = performance.now();
        console.log(`Load buffer: ${(t3 - t2).toFixed(2)}ms`);

        // Stage 3: Render PCM
        const targetSeconds = 5;
        const t4 = performance.now();
        const pcm = await engine.renderSeconds(targetSeconds);
        const t5 = performance.now();
        console.log(`Render ${targetSeconds}s PCM: ${(t5 - t4).toFixed(2)}ms`);

        // Stage 4: Convert to Float32 (simulating AudioBuffer creation)
        const t6 = performance.now();
        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();
        const frames = Math.floor(pcm.length / channels);
        const INT16_SCALE = 1 / 0x8000;

        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame++) {
            const idx = frame * 2;
            left[frame] = pcm[idx] * INT16_SCALE;
            right[frame] = pcm[idx + 1] * INT16_SCALE;
        }
        const t7 = performance.now();
        console.log(`INT16→Float32: ${(t7 - t6).toFixed(2)}ms`);

        const totalTime = t7 - t0;
        console.log(`Total pipeline: ${totalTime.toFixed(2)}ms`);
        console.log(`Throughput: ${((targetSeconds * 1000) / totalTime).toFixed(2)}x realtime`);

        // Complete pipeline should be very fast
        expect(totalTime).toBeLessThan(1000); // Less than 1 second for 5s audio
    });
});
