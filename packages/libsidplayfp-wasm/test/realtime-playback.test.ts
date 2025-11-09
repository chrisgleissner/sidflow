/**
 * Real-time playback simulation tests
 * 
 * These tests simulate actual audio playback conditions to verify the hot path
 * can sustain real-time streaming without gaps, glitches, or buffer underruns.
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadTestSid(): Uint8Array {
    const sidPath = join(import.meta.dir, '../../../test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid');
    return new Uint8Array(readFileSync(sidPath));
}

describe('Real-Time Streaming Simulation', () => {
    test('simulate continuous 60-second playback at 44.1kHz', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        const sampleRate = 44100;
        const channels = 2;
        const bufferSizeSeconds = 0.1; // 100ms buffer (typical Web Audio buffer)
        const samplesPerBuffer = Math.floor(sampleRate * bufferSizeSeconds * channels);
        const playbackDurationSeconds = 60;
        const buffersNeeded = Math.ceil(playbackDurationSeconds / bufferSizeSeconds);

        console.log('\n=== Real-Time Streaming Test ===');
        console.log(`Buffer size: ${bufferSizeSeconds * 1000}ms (${samplesPerBuffer} samples)`);
        console.log(`Total duration: ${playbackDurationSeconds}s`);
        console.log(`Buffers needed: ${buffersNeeded}`);

        let totalSamplesRendered = 0;
        let totalRenderTime = 0;
        let maxBufferTime = 0;
        let minBufferTime = Infinity;
        const bufferTimes: number[] = [];
        let underruns = 0;

        // Simulate real-time playback: we must render each buffer faster than it plays
        for (let i = 0; i < buffersNeeded; i++) {
            const renderStart = performance.now();

            // Render one buffer worth of audio
            const chunk = engine.renderCycles(20000); // Standard cycle count

            const renderEnd = performance.now();
            const renderTime = renderEnd - renderStart;

            if (chunk === null || chunk.length === 0) {
                // Song ended - this is OK for short songs
                console.log(`Song ended at buffer ${i} (${(i * bufferSizeSeconds).toFixed(1)}s)`);
                break;
            }

            totalSamplesRendered += chunk.length;
            totalRenderTime += renderTime;
            bufferTimes.push(renderTime);

            maxBufferTime = Math.max(maxBufferTime, renderTime);
            minBufferTime = Math.min(minBufferTime, renderTime);

            // Check if we rendered fast enough for real-time
            const bufferPlaybackTime = (chunk.length / channels / sampleRate) * 1000; // ms
            if (renderTime > bufferPlaybackTime) {
                underruns++;
            }

            // Simulate audio callback timing (yield to event loop)
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const avgBufferTime = totalRenderTime / bufferTimes.length;
        const avgBufferPlaybackTime = bufferSizeSeconds * 1000;
        const realTimeRatio = avgBufferPlaybackTime / avgBufferTime;

        console.log(`\nRender Statistics:`);
        console.log(`Total samples: ${totalSamplesRendered}`);
        console.log(`Total render time: ${totalRenderTime.toFixed(0)}ms`);
        console.log(`Avg buffer render time: ${avgBufferTime.toFixed(3)}ms`);
        console.log(`Target buffer time: ${avgBufferPlaybackTime.toFixed(3)}ms`);
        console.log(`Min buffer time: ${minBufferTime.toFixed(3)}ms`);
        console.log(`Max buffer time: ${maxBufferTime.toFixed(3)}ms`);
        console.log(`Real-time ratio: ${realTimeRatio.toFixed(2)}x`);
        console.log(`Buffer underruns: ${underruns} (${((underruns / bufferTimes.length) * 100).toFixed(1)}%)`);

        // Assert real-time performance
        expect(underruns).toBe(0); // NO buffer underruns allowed
        expect(realTimeRatio).toBeGreaterThan(2); // Should render at least 2x faster than playback
        expect(maxBufferTime).toBeLessThan(avgBufferPlaybackTime); // Even slowest buffer must be fast enough
    });

    test('measure jitter in render times', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        const iterations = 100;
        const renderTimes: number[] = [];

        console.log('\n=== Render Jitter Analysis ===');

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            const chunk = engine.renderCycles(20000);
            const end = performance.now();

            if (chunk === null || chunk.length === 0) {
                break;
            }

            renderTimes.push(end - start);
        }

        const mean = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
        const variance = renderTimes.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / renderTimes.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = (stdDev / mean) * 100;

        console.log(`Samples: ${renderTimes.length}`);
        console.log(`Mean: ${mean.toFixed(3)}ms`);
        console.log(`Std Dev: ${stdDev.toFixed(3)}ms`);
        console.log(`Coefficient of Variation: ${coefficientOfVariation.toFixed(1)}%`);
        console.log(`Min: ${Math.min(...renderTimes).toFixed(3)}ms`);
        console.log(`Max: ${Math.max(...renderTimes).toFixed(3)}ms`);

        // Low jitter is critical for smooth playback
        expect(coefficientOfVariation).toBeLessThan(50); // Less than 50% variation
    });

    test('test concurrent rendering (background cache + foreground playback)', async () => {
        const engine = new SidAudioEngine({
            sampleRate: 44100,
            stereo: true,
            cacheSecondsLimit: 60
        });
        const sidBuffer = loadTestSid();

        console.log('\n=== Concurrent Rendering Test ===');

        // Start cache building (background)
        const cacheStart = performance.now();
        const cachePromise = engine.loadSidBuffer(sidBuffer);

        // Immediately try to render for playback (foreground)
        const playbackStart = performance.now();
        const samples: number[] = [];

        // Simulate rendering for playback while cache builds
        for (let i = 0; i < 20; i++) {
            const renderStart = performance.now();
            const pcm = await engine.renderSeconds(0.1); // 100ms chunks
            const renderTime = performance.now() - renderStart;
            samples.push(pcm.length);

            console.log(`Chunk ${i}: ${pcm.length} samples in ${renderTime.toFixed(2)}ms`);

            if (pcm.length === 0) {
                break;
            }
        }

        await cachePromise;
        const cacheEnd = performance.now();

        console.log(`\nCache build time: ${(cacheEnd - cacheStart).toFixed(0)}ms`);
        console.log(`Playback render time: ${(performance.now() - playbackStart).toFixed(0)}ms`);
        console.log(`Total samples rendered: ${samples.reduce((a, b) => a + b, 0)}`);

        // Both should complete successfully
        expect(samples.length).toBeGreaterThan(0);
    });

    test('stress test: rapid start/stop cycles', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();

        console.log('\n=== Rapid Start/Stop Stress Test ===');

        const cycles = 10;
        const renderTimes: number[] = [];

        for (let cycle = 0; cycle < cycles; cycle++) {
            // Load
            await engine.loadSidBuffer(sidBuffer);

            // Render a small chunk
            const start = performance.now();
            const pcm = await engine.renderSeconds(0.5); // 500ms
            const elapsed = performance.now() - start;
            renderTimes.push(elapsed);

            expect(pcm.length).toBeGreaterThan(0);
        }

        const avgTime = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
        console.log(`Cycles: ${cycles}`);
        console.log(`Avg time per cycle: ${avgTime.toFixed(2)}ms`);
        console.log(`Times: ${renderTimes.map(t => t.toFixed(1)).join(', ')}ms`);

        // Should be consistent
        expect(avgTime).toBeLessThan(100); // Each cycle should be fast
    });

    test('validate no memory leaks during extended rendering', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        console.log('\n=== Memory Leak Test ===');

        if (global.gc) {
            global.gc();
        }

        const initialMemory = process.memoryUsage().heapUsed;
        const iterations = 500;

        for (let i = 0; i < iterations; i++) {
            const chunk = engine.renderCycles(20000);
            if (chunk === null || chunk.length === 0) {
                break;
            }
            // Let the chunk be garbage collected
        }

        if (global.gc) {
            global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryGrowth = ((finalMemory - initialMemory) / 1024 / 1024).toFixed(2);

        console.log(`Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Growth: ${memoryGrowth} MB`);

        // Should not leak significantly
        expect(parseFloat(memoryGrowth)).toBeLessThan(50); // Less than 50MB growth
    });
});

describe('Browser Audio API Simulation', () => {
    test('simulate AudioWorklet buffer consumption pattern', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBuffer = loadTestSid();
        await engine.loadSidBuffer(sidBuffer);

        // AudioWorklet typically processes 128-frame chunks at 44.1kHz
        const QUANTUM_SIZE = 128;
        const QUANTUM_DURATION_MS = (QUANTUM_SIZE / 44100) * 1000; // ~2.9ms
        const BUFFER_AHEAD = 10; // Buffer 10 quantums ahead

        console.log('\n=== AudioWorklet Simulation ===');
        console.log(`Quantum size: ${QUANTUM_SIZE} frames (${QUANTUM_DURATION_MS.toFixed(2)}ms)`);
        console.log(`Buffer ahead: ${BUFFER_AHEAD} quantums`);

        // Pre-render buffer
        const preRenderStart = performance.now();
        const initialBuffer = await engine.renderSeconds(0.5); // 500ms initial buffer
        const preRenderTime = performance.now() - preRenderStart;

        console.log(`Initial buffer: ${initialBuffer.length} samples in ${preRenderTime.toFixed(2)}ms`);

        let totalQuantums = 0;
        let totalRenderTime = 0;
        const quantumRenderTimes: number[] = [];

        // Simulate consuming and replenishing
        for (let i = 0; i < 1000; i++) {
            // Every quantum, we need to render more audio
            if (i % BUFFER_AHEAD === 0) {
                const renderStart = performance.now();
                const chunk = engine.renderCycles(5000); // Smaller chunks for quantum-sized rendering
                const renderTime = performance.now() - renderStart;

                if (chunk === null || chunk.length === 0) {
                    break;
                }

                quantumRenderTimes.push(renderTime);
                totalRenderTime += renderTime;
            }

            totalQuantums++;
        }

        const avgQuantumRenderTime = quantumRenderTimes.length > 0
            ? totalRenderTime / quantumRenderTimes.length
            : 0;

        console.log(`\nQuantums processed: ${totalQuantums}`);
        console.log(`Render calls: ${quantumRenderTimes.length}`);
        console.log(`Avg render time: ${avgQuantumRenderTime.toFixed(3)}ms`);
        console.log(`Quantum duration: ${QUANTUM_DURATION_MS.toFixed(3)}ms`);
        console.log(`Headroom: ${((QUANTUM_DURATION_MS / avgQuantumRenderTime) * 100).toFixed(0)}%`);

        // Must render faster than quantum playback
        if (avgQuantumRenderTime > 0) {
            expect(avgQuantumRenderTime).toBeLessThan(QUANTUM_DURATION_MS * BUFFER_AHEAD);
        }
    });
});
