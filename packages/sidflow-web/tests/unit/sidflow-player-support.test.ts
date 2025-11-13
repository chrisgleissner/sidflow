import { describe, expect, it } from 'bun:test';
import { detectWorkletSupport } from '@/lib/player/sidflow-player';

describe('detectWorkletSupport', () => {
    class FakeAudioContext {
        // No-op placeholder to satisfy typeof AudioContext expectations in tests
    }
    (FakeAudioContext.prototype as unknown as { audioWorklet?: unknown }).audioWorklet = {};

    it('returns supported when required features exist', () => {
        const result = detectWorkletSupport({
            window: {
                crossOriginIsolated: true,
                AudioContext: FakeAudioContext as unknown as typeof AudioContext,
            },
            sharedArrayBuffer: {},
        });
        expect(result.supported).toBe(true);
        expect(result.reasons).toHaveLength(0);
    });

    it('flags missing SharedArrayBuffer', () => {
        const result = detectWorkletSupport({
            window: {
                crossOriginIsolated: true,
                AudioContext: FakeAudioContext as unknown as typeof AudioContext,
            },
            sharedArrayBuffer: undefined,
        });
        expect(result.supported).toBe(false);
        expect(result.reasons).toContain('missing-shared-array-buffer');
    });

    it('flags missing cross-origin isolation', () => {
        const result = detectWorkletSupport({
            window: {
                crossOriginIsolated: false,
                AudioContext: FakeAudioContext as unknown as typeof AudioContext,
            },
            sharedArrayBuffer: {},
        });
        expect(result.supported).toBe(false);
        expect(result.reasons).toContain('cross-origin-isolation-disabled');
    });

    it('flags missing audio worklet support', () => {
        const result = detectWorkletSupport({
            window: {
                crossOriginIsolated: true,
                AudioContext: undefined,
            },
            sharedArrayBuffer: {},
        });
        expect(result.supported).toBe(false);
        expect(result.reasons).toContain('missing-audio-context');
    });
});
