/**
 * Debug test to inspect what renderCycles actually returns
 */

import { describe, test, expect } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadTestSid(): Uint8Array {
    const sidPath = join(import.meta.dir, '../../../test-data/C64Music/DEMOS/0-9/10_Orbyte.sid');
    return new Uint8Array(readFileSync(sidPath));
}

describe('RenderCycles Debug', () => {
    test('inspect renderCycles output', async () => {
        console.log('\n=== RENDER CYCLES DEBUG ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadTestSid();
        await engine.loadSidBuffer(sidBytes);

        console.log('Calling renderCycles 100 times...\n');

        const chunkSizes: number[] = [];
        const expectedSamplesPerCall = Math.floor((20000 / 985248) * 44100 * 2); // Approx samples for 20k cycles

        for (let i = 0; i < 100; i++) {
            const chunk = engine.renderCycles(20000);

            if (chunk === null) {
                console.log(`Call ${i + 1}: NULL (song ended)`);
                break;
            }

            chunkSizes.push(chunk.length);

            if (i < 10 || chunk.length === 0) {
                console.log(`Call ${i + 1}: ${chunk.length} samples`);
            }
        }

        console.log(`\n=== ANALYSIS ===`);
        console.log(`Total calls: ${chunkSizes.length}`);
        console.log(`Total samples: ${chunkSizes.reduce((a, b) => a + b, 0)}`);
        console.log(`Avg samples per call: ${(chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length).toFixed(0)}`);
        console.log(`Min samples: ${Math.min(...chunkSizes)}`);
        console.log(`Max samples: ${Math.max(...chunkSizes)}`);
        console.log(`Zero-length chunks: ${chunkSizes.filter(s => s === 0).length}`);

        const uniqueSizes = [...new Set(chunkSizes)].sort((a, b) => a - b);
        console.log(`Unique chunk sizes: ${uniqueSizes.join(', ')}`);

        // Check for pattern
        const firstTenSizes = chunkSizes.slice(0, 10).join(', ');
        console.log(`First 10 chunk sizes: ${firstTenSizes}`);

        expect(chunkSizes.length).toBeGreaterThan(0);
    });

    test('inspect renderSeconds with detailed progress', async () => {
        console.log('\n=== RENDER SECONDS DEBUG ===\n');

        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const sidBytes = loadTestSid();
        await engine.loadSidBuffer(sidBytes);

        const progressUpdates: number[] = [];

        const pcm = await engine.renderSeconds(5, 20000, (samplesWritten) => {
            progressUpdates.push(samplesWritten);
        });

        console.log(`Rendered ${pcm.length} samples total`);
        console.log(`Progress updates: ${progressUpdates.length}`);
        console.log(`First 10 updates: ${progressUpdates.slice(0, 10).join(', ')}`);
        console.log(`Last 10 updates: ${progressUpdates.slice(-10).join(', ')}`);

        // Check for gaps in progress
        const gaps: number[] = [];
        for (let i = 1; i < Math.min(progressUpdates.length, 50); i++) {
            const gap = progressUpdates[i] - progressUpdates[i - 1];
            gaps.push(gap);
        }

        console.log(`\nGaps between progress updates (first 50):`);
        console.log(`Avg gap: ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(0)} samples`);
        console.log(`Min gap: ${Math.min(...gaps)}`);
        console.log(`Max gap: ${Math.max(...gaps)}`);

        const uniqueGaps = [...new Set(gaps)].sort((a, b) => a - b);
        console.log(`Unique gap sizes: ${uniqueGaps.slice(0, 20).join(', ')}`);
    });
});
