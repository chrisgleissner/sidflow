import type { LibsidplayfpWasmModule, SidPlayerContextOptions } from './index.js';
export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
    cacheSecondsLimit?: number;
}
export declare class SidAudioEngine {
    private readonly modulePromise;
    private module;
    private context;
    private readonly sampleRate;
    private readonly stereo;
    private readonly maxCacheSeconds;
    private configured;
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
    constructor(options?: SidAudioEngineOptions);
    private ensureModule;
    private createConfiguredContext;
    private loadPatchedBuffer;
    private cloneInput;
    private patchStartSong;
    private reloadCurrentSong;
    loadSidBuffer(data: Uint8Array | ArrayBufferView): Promise<void>;
    selectSong(songIndex: number): Promise<number>;
    getChannels(): number;
    getSampleRate(): number;
    getTuneInfo(): Record<string, unknown> | null;
    reset(): void;
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
}
//# sourceMappingURL=player.d.ts.map