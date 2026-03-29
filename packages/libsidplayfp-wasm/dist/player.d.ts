import type { LibsidplayfpWasmModule, SidPlayerContextOptions } from './index.js';
export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
    cacheSecondsLimit?: number;
}
export interface SidWriteTrace {
    sidNumber: number;
    address: number;
    value: number;
    cyclePhi1: number;
}
export declare class SidAudioEngine {
    private modulePromise;
    private module;
    private context;
    private readonly sampleRate;
    private readonly stereo;
    private readonly maxCacheSeconds;
    private configured;
    private sidWriteTraceEnabled;
    private originalSidBuffer;
    private currentSongIndex;
    private cachePromise;
    private cachedPcm;
    private cacheSampleRate;
    private cacheChannels;
    private cacheCursor;
    private useCachePlayback;
    private cacheToken;
    private pendingChunk;
    private pendingChunkOffset;
    private kernalRom;
    private basicRom;
    private chargenRom;
    private romSupportDisabled;
    private romFailureLogged;
    private readonly bufferPool;
    private releaseContext;
    constructor(options?: SidAudioEngineOptions);
    private ensureModule;
    private createConfiguredContext;
    private loadPatchedBuffer;
    private cloneInput;
    private applySystemROMs;
    private patchStartSong;
    private reloadCurrentSong;
    setSystemROMs(kernal?: Uint8Array | ArrayBufferView | null, basic?: Uint8Array | ArrayBufferView | null, chargen?: Uint8Array | ArrayBufferView | null): Promise<void>;
    loadSidBuffer(data: Uint8Array | ArrayBufferView, songIndex?: number): Promise<void>;
    selectSong(songIndex: number): Promise<number>;
    getChannels(): number;
    getSampleRate(): number;
    getTuneInfo(): Record<string, unknown> | null;
    reset(): void;
    setSidWriteTraceEnabled(enabled: boolean): void;
    getAndClearSidWriteTraces(): SidWriteTrace[];
    renderCycles(cycles?: number): Int16Array | null;
    renderSeconds(seconds: number, cyclesPerChunk?: number, onProgress?: (samplesWritten: number) => void): Promise<Int16Array>;
    renderFrames(frames: number, cyclesPerChunk?: number, onProgress?: (samplesWritten: number) => void, { loop }?: {
        loop?: boolean;
    }): Promise<Int16Array>;
    private consumeChunk;
    seekSeconds(seconds: number, cyclesPerChunk?: number): Promise<number>;
    waitForCacheReady(): Promise<boolean>;
    getCachedSegment(seconds: number, durationSeconds: number): Int16Array | null;
    private fastForwardContext;
    private resetCacheState;
    private resetPendingChunk;
    private startCache;
    private buildCacheBuffer;
    private cacheAvailable;
    /**
     * Clear buffer pool and cached data to free memory.
     * Call this when the engine instance is no longer needed.
     */
    dispose(): void;
}
//# sourceMappingURL=player.d.ts.map