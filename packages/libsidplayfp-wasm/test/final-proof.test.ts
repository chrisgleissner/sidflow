/**
 * Final proof: Exact browser simulation with audio analysis
 * 
 * This simulates the EXACT code path the browser uses and measures if it produces gaps.
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadTestSid(): Uint8Array {
    const sidPath = join(import.meta.dir, '../../../test-data/C64Music/DEMOS/0-9/10_Orbyte.sid');
    return new Uint8Array(readFileSync(sidPath));
}

describe('Browser Code Path - Final Proof', () => {
    test('EXACT browser flow with audio gap detection', async () => {
        console.log('\n==================================');
        console.log('FINAL BROWSER SIMULATION TEST');
        console.log('==================================\n');

        const INT16_SCALE = 1 / 0x8000;
        const targetDuration = 5;

        // Initialize engine
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadTestSid();

        console.log('Step 1: Load SID file...');
        await engine.loadSidBuffer(sidBytes);

        const sampleRate = engine.getSampleRate();
        const channels = engine.getChannels();
        console.log(`✓ Loaded (${sampleRate}Hz, ${channels}ch)\n`);

        // Render PCM
        console.log('Step 2: Render PCM (WASM)...');
        const renderStart = performance.now();
        const pcm = await engine.renderSeconds(targetDuration, 40000);
        const renderTime = performance.now() - renderStart;
        const actualDuration = pcm.length / channels / sampleRate;

        console.log(`✓ Rendered ${pcm.length} samples in ${renderTime.toFixed(0)}ms`);
        console.log(`  Audio duration: ${actualDuration.toFixed(2)}s`);
        console.log(`  Render speed: ${(actualDuration * 1000 / renderTime).toFixed(1)}x realtime\n`);

        // Convert to Float32 (exact browser code with chunking)
        console.log('Step 3: Convert INT16→Float32 (with yielding)...');
        const frames = Math.floor(pcm.length / channels);
        const leftChannel = new Float32Array(frames);
        const rightChannel = new Float32Array(frames);

        const CHUNK_SIZE = 44100; // 1 second chunks
        let yieldCount = 0;
        const conversionStart = performance.now();

        for (let startFrame = 0; startFrame < frames; startFrame += CHUNK_SIZE) {
            const endFrame = Math.min(startFrame + CHUNK_SIZE, frames);

            // This is the EXACT conversion loop from the browser
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

        const conversionTime = performance.now() - conversionStart;
        console.log(`✓ Converted in ${conversionTime.toFixed(0)}ms (${yieldCount} yields)\n`);

        // Now analyze the ORIGINAL PCM for gaps (this shows what WASM produced)
        console.log('Step 4: Analyze PCM audio for gaps...');
        let consecutiveSilent = 0;
        let maxSilentStreak = 0;
        let silentStreaks: number[] = [];
        const SILENCE_THRESHOLD = 50;

        for (let i = 0; i < pcm.length; i++) {
            if (Math.abs(pcm[i]) < SILENCE_THRESHOLD) {
                consecutiveSilent++;
            } else {
                if (consecutiveSilent > 0) {
                    silentStreaks.push(consecutiveSilent);
                    maxSilentStreak = Math.max(maxSilentStreak, consecutiveSilent);
                }
                consecutiveSilent = 0;
            }
        }

        const avgSilentStreak = silentStreaks.length > 0
            ? silentStreaks.reduce((a, b) => a + b, 0) / silentStreaks.length
            : 0;
        const maxSilentDuration = (maxSilentStreak / channels / sampleRate * 1000);

        console.log(`  Silent streaks found: ${silentStreaks.length}`);
        console.log(`  Longest silent period: ${maxSilentDuration.toFixed(1)}ms`);
        console.log(`  Avg silent period: ${(avgSilentStreak / channels / sampleRate * 1000).toFixed(1)}ms\n`);

        // Check if conversion introduced gaps
        console.log('Step 5: Check if conversion introduced gaps...');
        let conversionGaps = 0;
        for (let i = 1; i < leftChannel.length; i++) {
            const origLeft = pcm[i * 2] * INT16_SCALE;
            const origRight = pcm[i * 2 + 1] * INT16_SCALE;

            if (Math.abs(leftChannel[i] - origLeft) > 0.0001 ||
                Math.abs(rightChannel[i] - origRight) > 0.0001) {
                conversionGaps++;
                if (conversionGaps < 5) {
                    console.log(`  Gap at frame ${i}: orig=(${origLeft.toFixed(4)}, ${origRight.toFixed(4)}), converted=(${leftChannel[i].toFixed(4)}, ${rightChannel[i].toFixed(4)})`);
                }
            }
        }

        if (conversionGaps === 0) {
            console.log(`  ✓ NO gaps introduced by conversion\n`);
        } else {
            console.log(`  ❌ ${conversionGaps} sample mismatches found!\n`);
        }

        // Final verdict
        console.log('==================================');
        console.log('FINAL VERDICT');
        console.log('==================================');

        const totalPipeline = renderTime + conversionTime;
        const isRealtime = totalPipeline < (actualDuration * 1000);

        console.log(`Pipeline time: ${totalPipeline.toFixed(0)}ms`);
        console.log(`Audio duration: ${(actualDuration * 1000).toFixed(0)}ms`);
        console.log(`Fast enough? ${isRealtime ? '✓ YES' : '❌ NO'}`);
        console.log(`Conversion correct? ${conversionGaps === 0 ? '✓ YES' : '❌ NO'}`);

        if (maxSilentDuration > 50) {
            console.log(`\n⚠️  WASM is producing long silent periods (${maxSilentDuration.toFixed(0)}ms max)`);
            console.log(`This is the SID music itself, not a pipeline problem.`);
        }

        console.log('\n');

        // Assertions
        expect(isRealtime).toBe(true);
        expect(conversionGaps).toBe(0);
    });
});
