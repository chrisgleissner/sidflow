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
    private kernalRom;
    private basicRom;
    private chargenRom;
    private romSupportDisabled;
    private romFailureLogged;
    constructor(options?: SidAudioEngineOptions);
    private ensureModule;
    private createConfiguredContext;
    private loadPatchedBuffer;
    private cloneInput;
    private applySystemROMs;
    private patchStartSong;
    private reloadCurrentSong;
    setSystemROMs(kernal?: Uint8Array | ArrayBufferView | null, basic?: Uint8Array | ArrayBufferView | null, chargen?: Uint8Array | ArrayBufferView | null): Promise<void>;
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