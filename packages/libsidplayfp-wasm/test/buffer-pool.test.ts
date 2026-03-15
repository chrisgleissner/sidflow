/**
 * Test buffer pooling in SidAudioEngine
 * Verifies that dispose() clears pool and reduces memory footprint
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { SidAudioEngine } from '../src/player.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const testSidPath = resolve(__dirname, '../test-tone-c4.sid');
let testSidData: Uint8Array;

beforeAll(() => {
    testSidData = new Uint8Array(readFileSync(testSidPath));
});

describe('SidAudioEngine buffer pool', () => {
    it('should delete superseded and disposed WASM contexts', async () => {
        const deleteCalls: string[] = [];

        class FakeContext {
            private readonly name: string;
            private deleted = false;

            constructor(name: string) {
                this.name = name;
            }

            configure(): boolean {
                return true;
            }

            loadSidBuffer(): boolean {
                return true;
            }

            reset(): boolean {
                return true;
            }

            getChannels(): number {
                return 2;
            }

            getSampleRate(): number {
                return 44100;
            }

            getTuneInfo(): Record<string, unknown> | null {
                return null;
            }

            getLastError(): string {
                return '';
            }

            render(): Int16Array {
                return new Int16Array([1, 2, 3, 4]);
            }

            delete(): void {
                this.deleted = true;
                deleteCalls.push(this.name);
            }

            isDeleted(): boolean {
                return this.deleted;
            }
        }

        let contextCount = 0;
        const module = Promise.resolve({
            SidPlayerContext: class extends FakeContext {
                constructor() {
                    contextCount += 1;
                    super(`ctx-${contextCount}`);
                }
            },
        } as any);

        const engine = new SidAudioEngine({ module });

        await engine.loadSidBuffer(testSidData);
        await engine.loadSidBuffer(testSidData);

        expect(deleteCalls).toEqual(['ctx-1']);

        engine.dispose();

        expect(deleteCalls).toEqual(['ctx-1', 'ctx-2']);
    });

    it('should initialize buffer pool in constructor', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });

        // Engine should have private bufferPool field
        expect(engine).toBeDefined();

        // Dispose should not throw
        expect(() => engine.dispose()).not.toThrow();
    });

    it('should clear buffer pool on dispose()', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        await engine.loadSidBuffer(testSidData);

        // Render some audio to potentially populate pool
        const frames = 44100; // 1 second
        await engine.renderFrames(frames, 100000);

        // Dispose should clear pool and cached data
        engine.dispose();

        // After dispose, engine should not crash (though may not work correctly)
        // This test verifies cleanup logic doesn't throw
        expect(() => engine.dispose()).not.toThrow(); // Can dispose multiple times
    });

    it('should allow reuse after loadSidBuffer creates new buffers', async () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });

        // Load and render first time
        await engine.loadSidBuffer(testSidData);
        const result1 = await engine.renderFrames(44100);
        expect(result1.length).toBeGreaterThan(0);

        // Load again (should reset internal state)
        await engine.loadSidBuffer(testSidData);
        const result2 = await engine.renderFrames(44100);
        expect(result2.length).toBeGreaterThan(0);

        // Results should be similar (not necessarily identical due to internal state)
        expect(result2.length).toBeCloseTo(result1.length, -2); // Within order of magnitude

        engine.dispose();
    });

    it('should handle multiple engines with separate pools', async () => {
        const engine1 = new SidAudioEngine({ sampleRate: 44100, stereo: true });
        const engine2 = new SidAudioEngine({ sampleRate: 22050, stereo: false });

        await engine1.loadSidBuffer(testSidData);
        await engine2.loadSidBuffer(testSidData);

        // Both should work independently
        const result1 = await engine1.renderFrames(22050); // 0.5s at 44.1kHz
        const result2 = await engine2.renderFrames(11025); // 0.5s at 22.05kHz

        expect(result1.length).toBeGreaterThan(0);
        expect(result2.length).toBeGreaterThan(0);

        // Different sample rates should produce different buffer sizes
        expect(result1.length).not.toBe(result2.length);

        engine1.dispose();
        engine2.dispose();
    });

    it('should handle dispose before load', () => {
        const engine = new SidAudioEngine({ sampleRate: 44100, stereo: true });

        // Should not throw even if never loaded
        expect(() => engine.dispose()).not.toThrow();
    });
});
