import type { LibsidplayfpWasmModule, SidPlayerContextOptions } from "./index.js";
export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
}
export declare class SidAudioEngine {
    private readonly modulePromise;
    private module;
    private context;
    private readonly sampleRate;
    private readonly stereo;
    private configured;
    constructor(options?: SidAudioEngineOptions);
    private ensureContext;
    loadSidBuffer(data: Uint8Array | ArrayBufferView): Promise<void>;
    selectSong(songIndex: number): number;
    getChannels(): number;
    getSampleRate(): number;
    getTuneInfo(): Record<string, unknown> | null;
    reset(): void;
    renderCycles(cycles?: number): Int16Array | null;
    renderSeconds(seconds: number, cyclesPerChunk?: number, onProgress?: (samplesWritten: number) => void): Promise<Int16Array>;
}
//# sourceMappingURL=player.d.ts.map