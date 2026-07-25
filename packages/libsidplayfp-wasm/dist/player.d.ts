import type { LibsidplayfpWasmModule, SidEngine, SidPlayerContextOptions } from './index.js';
export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
    cacheSecondsLimit?: number;
    /**
     * SID emulation to render with. Defaults to DEFAULT_SID_ENGINE (SIDLite);
     * pass `residfp` for the cycle-accurate reference. Ignored when `module` is
     * supplied, since that module has already picked an engine.
     */
    engine?: SidEngine;
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
    private readonly engine;
    private releaseContext;
    constructor(options?: SidAudioEngineOptions);
    private ensureModule;
    private createConfiguredContext;
    private loadPatchedBuffer;
    private cloneInput;
    private applySystemROMs;
    private patchStartSong;
    private reloadCurrentSong;
    /**
     * Which engine this instance requested, or null when the caller supplied
     * their own module. For what the loaded artifact actually is, see
     * `getEngineName()`.
     */
    getEngine(): SidEngine | null;
    /** The builder name baked into the loaded artifact, e.g. "WasmSIDLite". */
    getEngineName(): Promise<string>;
    /**
     * Supply the C64 system ROMs.
     *
     * Strongly recommended: without them libsidplayfp initialises a tune but
     * never advances it, so many tunes render as silence or as a single held
     * frame. Sizes are exact — KERNAL 8192, BASIC 8192, CHARGEN 4096 bytes.
     *
     * The ROMs are copyrighted and are not shipped with this package. Dump them
     * from a real Commodore 64, and see the repository README ("System ROMs")
     * for the file names and search paths SIDFlow itself uses.
     */
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