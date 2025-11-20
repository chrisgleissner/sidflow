import type {
  LibsidplayfpWasmModule,
  SidPlayerContext,
  SidPlayerContextOptions,
} from './index.js';
import { loadLibsidplayfp } from './index.js';

const DEFAULT_CACHE_SECONDS = 600;
const BUFFER_POOL_SIZE = 8;
const BUFFER_SIZE_SAMPLES = 88200; // 1 second stereo at 44.1kHz

/**
 * Simple buffer pool to reduce GC pressure during playback.
 * Manages Int16Array instances for reuse across render operations.
 */
class BufferPool {
  private readonly pool: Int16Array[] = [];
  private readonly maxSize: number;
  private readonly bufferSize: number;

  constructor(maxSize = BUFFER_POOL_SIZE, bufferSize = BUFFER_SIZE_SAMPLES) {
    this.maxSize = maxSize;
    this.bufferSize = bufferSize;
  }

  acquire(): Int16Array {
    const buffer = this.pool.pop();
    if (buffer) {
      buffer.fill(0); // Clear for reuse
      return buffer;
    }
    return new Int16Array(this.bufferSize);
  }

  release(buffer: Int16Array): void {
    if (this.pool.length < this.maxSize && buffer.length === this.bufferSize) {
      this.pool.push(buffer);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }
}

export interface SidAudioEngineOptions extends SidPlayerContextOptions {
  sampleRate?: number;
  stereo?: boolean;
  module?: Promise<LibsidplayfpWasmModule>;
  cacheSecondsLimit?: number;
}

export class SidAudioEngine {
  private readonly modulePromise: Promise<LibsidplayfpWasmModule>;
  private module: LibsidplayfpWasmModule | undefined;
  private context: SidPlayerContext | undefined;
  private readonly sampleRate: number;
  private readonly stereo: boolean;
  private readonly maxCacheSeconds: number;
  private configured = false;
  private originalSidBuffer: Uint8Array | null = null;
  private currentSongIndex = 0;
  private cachePromise: Promise<void> | null = null;
  private cachedPcm: Int16Array | null = null;
  private cacheSampleRate = 0;
  private cacheChannels = 0;
  private cacheCursor = 0;
  private useCachePlayback = false;
  private cacheToken = 0;
  private pendingChunk: Int16Array | null = null;
  private pendingChunkOffset = 0;
  private kernalRom: Uint8Array | null = null;
  private basicRom: Uint8Array | null = null;
  private chargenRom: Uint8Array | null = null;
  private romSupportDisabled = false;
  private romFailureLogged = false;
  private readonly bufferPool: BufferPool;

  constructor(options: SidAudioEngineOptions = {}) {
    const {
      module: moduleOverride,
      sampleRate,
      stereo,
      cacheSecondsLimit,
      ...loaderOptions
    } = options;
    this.sampleRate = sampleRate ?? 44100;
    this.stereo = stereo ?? true;
    this.maxCacheSeconds = cacheSecondsLimit ?? DEFAULT_CACHE_SECONDS;
    this.modulePromise = moduleOverride ?? loadLibsidplayfp(loaderOptions);

    // Initialize buffer pool with size appropriate for sample rate and stereo
    const framesPerBuffer = Math.max(1, Math.floor(this.sampleRate));
    const samplesPerBuffer = framesPerBuffer * (this.stereo ? 2 : 1);
    this.bufferPool = new BufferPool(BUFFER_POOL_SIZE, samplesPerBuffer);
  }

  private async ensureModule(): Promise<LibsidplayfpWasmModule> {
    if (this.module) {
      return this.module;
    }
    this.module = await this.modulePromise;
    return this.module;
  }

  private async createConfiguredContext(): Promise<SidPlayerContext> {
    const module = await this.ensureModule();
    const ctx = new module.SidPlayerContext();
    if (!ctx.configure(this.sampleRate, this.stereo)) {
      throw new Error(`Failed to configure SID player: ${ctx.getLastError()}`);
    }
    return ctx;
  }

  private async loadPatchedBuffer(patched: Uint8Array): Promise<SidPlayerContext> {
    const ctx = await this.createConfiguredContext();
    if (!ctx.loadSidBuffer(patched)) {
      throw new Error(ctx.getLastError());
    }
    this.applySystemROMs(ctx);
    if (!ctx.reset()) {
      throw new Error(ctx.getLastError());
    }
    this.context = ctx;
    this.configured = true;
    return ctx;
  }

  private cloneInput(data: Uint8Array | ArrayBufferView): Uint8Array {
    if (data instanceof Uint8Array) {
      return new Uint8Array(data);
    }
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  private applySystemROMs(ctx: SidPlayerContext): void {
    if (this.romSupportDisabled) {
      return;
    }

    if (!this.kernalRom && !this.basicRom && !this.chargenRom) {
      return;
    }

    try {
      const success = ctx.setSystemROMs(
        this.kernalRom ?? null,
        this.basicRom ?? null,
        this.chargenRom ?? null
      );
      if (!success) {
        throw new Error(ctx.getLastError());
      }
      console.log('[SidAudioEngine] ROMs applied successfully');
    } catch (error) {
      this.romSupportDisabled = true;
      if (!this.romFailureLogged) {
        this.romFailureLogged = true;
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[SidAudioEngine] Custom ROM injection failed; falling back to built-in ROMs', {
          reason,
        });
      }

      try {
        ctx.setSystemROMs(null, null, null);
      } catch (fallbackError) {
        const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error('[SidAudioEngine] Failed to reset ROM configuration after custom ROM failure', {
          reason,
        });
      }
    }
  }

  private patchStartSong(buffer: Uint8Array, songIndex: number): { data: Uint8Array; applied: number } {
    if (buffer.length < 0x12) {
      throw new Error('SID buffer too small');
    }

    const headerOffset = 0x10;
    const patched = buffer.slice();
    const songs = (patched[0x0e] << 8) | patched[0x0f];
    const maxSong = songs > 0 ? songs : 1;
    const applied = Math.min(Math.max(1, Math.trunc(songIndex) + 1), maxSong);
    patched[headerOffset] = (applied >> 8) & 0xff;
    patched[headerOffset + 1] = applied & 0xff;

    return { data: patched, applied: applied - 1 };
  }

  private async reloadCurrentSong(): Promise<number> {
    if (!this.originalSidBuffer) {
      return 0;
    }
    const { data, applied } = this.patchStartSong(this.originalSidBuffer, this.currentSongIndex);
    await this.loadPatchedBuffer(data);
    this.currentSongIndex = applied;
    return applied;
  }

  async setSystemROMs(
    kernal?: Uint8Array | ArrayBufferView | null,
    basic?: Uint8Array | ArrayBufferView | null,
    chargen?: Uint8Array | ArrayBufferView | null
  ): Promise<void> {
    this.kernalRom = kernal ? this.cloneInput(kernal) : null;
    this.basicRom = basic ? this.cloneInput(basic) : null;
    this.chargenRom = chargen ? this.cloneInput(chargen) : null;
    this.romSupportDisabled = false;

    this.resetCacheState();
    this.resetPendingChunk();

    if (!this.context) {
      return;
    }

    this.romSupportDisabled = false;
    this.romFailureLogged = false;

    try {
      const applied = this.context.setSystemROMs(
        this.kernalRom ?? null,
        this.basicRom ?? null,
        this.chargenRom ?? null
      );
      if (!applied) {
        throw new Error(this.context.getLastError());
      }
    } catch (error) {
      this.romSupportDisabled = true;
      if (!this.romFailureLogged) {
        this.romFailureLogged = true;
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[SidAudioEngine] Custom ROM injection failed; falling back to built-in ROMs', {
          reason,
        });
      }

      try {
        this.context.setSystemROMs(null, null, null);
      } catch (fallbackError) {
        const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error('[SidAudioEngine] Failed to reset ROM configuration after custom ROM failure', {
          reason,
        });
      }
    }

    if (this.originalSidBuffer) {
      await this.reloadCurrentSong();
    }
  }

  async loadSidBuffer(data: Uint8Array | ArrayBufferView): Promise<void> {
    this.originalSidBuffer = this.cloneInput(data);
    this.currentSongIndex = 0;
    this.resetCacheState();
    this.resetPendingChunk();
    await this.reloadCurrentSong();
    // Don't start cache during initial load - it conflicts with rendering
    // Cache will be built on-demand for seeking
  }

  async selectSong(songIndex: number): Promise<number> {
    if (!this.originalSidBuffer) {
      throw new Error('Load a SID before selecting a song');
    }
    this.currentSongIndex = Math.max(0, Math.trunc(songIndex));
    this.resetCacheState();
    this.resetPendingChunk();
    const applied = await this.reloadCurrentSong();
    // Don't start cache during song selection - it conflicts with rendering
    return applied;
  }

  getChannels(): number {
    if (!this.context) {
      throw new Error('SID player not initialized');
    }
    return this.context.getChannels();
  }

  getSampleRate(): number {
    if (!this.context) {
      throw new Error('SID player not initialized');
    }
    return this.context.getSampleRate();
  }

  getTuneInfo(): Record<string, unknown> | null {
    if (!this.context) {
      return null;
    }
    return this.context.getTuneInfo();
  }

  reset(): void {
    if (!this.context) {
      return;
    }
    this.context.reset();
  }

  renderCycles(cycles = 100000): Int16Array | null {
    if (!this.context || !this.configured) {
      return null;
    }
    let chunk: Int16Array | null;
    try {
      chunk = this.context.render(cycles);
    } catch {
      return null;
    }
    if (chunk === null) {
      return null;
    }
    if (chunk.length === 0) {
      return new Int16Array(0);
    }
    return chunk.slice();
  }

  async renderSeconds(
    seconds: number,
    cyclesPerChunk = 100000,
    onProgress?: (samplesWritten: number) => void
  ): Promise<Int16Array> {
    if (seconds <= 0) {
      throw new Error('Duration must be greater than zero');
    }
    if (!this.context || !this.configured) {
      return new Int16Array(0);
    }

    // Direct rendering using main context (cache is for seeking only)
    const context = this.context;
    const sampleRate = context.getSampleRate();
    const channels = context.getChannels();
    const frames = Math.max(1, Math.floor(sampleRate * seconds));
    return this.renderFrames(frames, cyclesPerChunk, onProgress);
  }

  async renderFrames(
    frames: number,
    cyclesPerChunk = 100000,
    onProgress?: (samplesWritten: number) => void,
    { loop = false }: { loop?: boolean } = {}
  ): Promise<Int16Array> {
    if (frames <= 0) {
      throw new Error('Frame count must be greater than zero');
    }
    if (!this.context || !this.configured) {
      return new Int16Array(0);
    }

    const context = this.context;
    const channels = context.getChannels();
    const totalSamples = frames * channels;
    const buffer = new Int16Array(totalSamples);
    let offset = 0;
    const chunkCycles = Math.max(1, Math.floor(cyclesPerChunk));
    let emptyReads = 0;
    const emptyReadLimit = Math.max(32, Math.ceil(frames / Math.max(1, chunkCycles)) * 4);

    while (offset < totalSamples) {
      const next = this.consumeChunk(chunkCycles);
      const chunk = next?.chunk ?? null;
      const start = next?.start ?? 0;

      if (!chunk || chunk.length <= start) {
        emptyReads += 1;
        if (loop && emptyReads < emptyReadLimit) {
          if (!context.reset()) {
            break;
          }
          this.resetPendingChunk();
          continue;
        }
        break;
      }

      emptyReads = 0;

      const available = Math.min(chunk.length - start, totalSamples - offset);
      if (available <= 0) {
        break;
      }

      buffer.set(chunk.subarray(start, start + available), offset);
      offset += available;
      onProgress?.(offset);

      if (start + available < chunk.length) {
        // Preserve the remainder for the next call
        this.pendingChunk = chunk;
        this.pendingChunkOffset = start + available;
      } else {
        this.resetPendingChunk();
      }
    }

    return offset === buffer.length ? buffer : buffer.subarray(0, offset);
  }

  private consumeChunk(cyclesPerChunk: number): { chunk: Int16Array; start: number } | null {
    if (this.pendingChunk && this.pendingChunkOffset < this.pendingChunk.length) {
      const chunk = this.pendingChunk;
      const start = this.pendingChunkOffset;
      this.pendingChunk = null;
      this.pendingChunkOffset = 0;
      return { chunk, start };
    }

    const chunk = this.renderCycles(cyclesPerChunk);
    if (!chunk || chunk.length === 0) {
      return null;
    }
    return { chunk, start: 0 };
  }

  async seekSeconds(seconds: number, cyclesPerChunk = 100000): Promise<number> {
    if (seconds <= 0) {
      this.useCachePlayback = this.cacheAvailable();
      this.cacheCursor = 0;
      this.resetPendingChunk();
      await this.reloadCurrentSong();
      return 0;
    }

    if (this.cacheAvailable()) {
      const samplesPerSecond = this.cacheSampleRate * this.cacheChannels;
      const targetSample = Math.floor(samplesPerSecond * seconds);
      if (targetSample < this.cachedPcm!.length) {
        this.useCachePlayback = true;
        this.cacheCursor = targetSample;
        return targetSample;
      }
    }

    this.useCachePlayback = false;
    this.resetPendingChunk();
    await this.reloadCurrentSong();
    return this.fastForwardContext(seconds, cyclesPerChunk);
  }

  async waitForCacheReady(): Promise<boolean> {
    if (this.cachePromise) {
      try {
        await this.cachePromise;
      } catch {
        return false;
      }
    }
    return this.cacheAvailable();
  }

  getCachedSegment(seconds: number, durationSeconds: number): Int16Array | null {
    if (!this.cacheAvailable() || seconds < 0 || durationSeconds <= 0) {
      return null;
    }
    const samplesPerSecond = this.cacheSampleRate * this.cacheChannels;
    const start = Math.floor(samplesPerSecond * seconds);
    const length = Math.max(1, Math.floor(samplesPerSecond * durationSeconds));
    if (!this.cachedPcm || start + length > this.cachedPcm.length) {
      return null;
    }
    return this.cachedPcm.subarray(start, start + length).slice();
  }

  private async fastForwardContext(seconds: number, cyclesPerChunk: number): Promise<number> {
    if (!this.context) {
      throw new Error('SID player not initialized');
    }
    const sampleRate = this.context.getSampleRate();
    const channels = this.context.getChannels();
    const targetSamples = Math.floor(sampleRate * channels * seconds);
    let skipped = 0;
    let iterations = 0;
    const maxIterations = Math.max(32, Math.ceil(targetSamples / cyclesPerChunk) * 4);
    while (skipped < targetSamples && iterations < maxIterations) {
      let chunk: Int16Array | null;
      try {
        chunk = this.context.render(cyclesPerChunk);
      } catch {
        break;
      }
      if (chunk === null || chunk.length === 0) {
        break;
      }
      skipped += chunk.length;
      iterations += 1;
    }
    return skipped;
  }

  private resetCacheState(): void {
    this.cacheToken += 1;
    this.cachePromise = null;
    this.cachedPcm = null;
    this.cacheSampleRate = 0;
    this.cacheChannels = 0;
    this.cacheCursor = 0;
    this.useCachePlayback = false;
    this.resetPendingChunk();
  }

  private resetPendingChunk(): void {
    this.pendingChunk = null;
    this.pendingChunkOffset = 0;
  }

  private startCache(): void {
    if (!this.originalSidBuffer) {
      return;
    }
    const { data } = this.patchStartSong(this.originalSidBuffer, this.currentSongIndex);
    const token = this.cacheToken;
    const promise = this.buildCacheBuffer(data, token);
    this.cachePromise = promise;
    promise.finally(() => {
      if (this.cachePromise === promise) {
        this.cachePromise = null;
      }
    });
  }

  private async buildCacheBuffer(buffer: Uint8Array, token: number): Promise<void> {
    const module = await this.ensureModule();
    const ctx = new module.SidPlayerContext();
    if (!ctx.configure(this.sampleRate, this.stereo)) {
      return;
    }
    if (!ctx.loadSidBuffer(buffer)) {
      return;
    }
    try {
      this.applySystemROMs(ctx);
    } catch {
      return;
    }
    if (!ctx.reset()) {
      return;
    }
    const channels = this.stereo ? 2 : 1;
    const maxSamples = Math.floor(this.sampleRate * channels * this.maxCacheSeconds);
    const chunks: Int16Array[] = [];
    let collected = 0;
    let iterationCount = 0;

    while (collected < maxSamples) {
      // Yield to event loop every 20 iterations (balanced for performance and responsiveness)
      if (++iterationCount % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      let chunk: Int16Array | null;
      try {
        chunk = ctx.render(100000);
      } catch {
        break;
      }
      if (chunk === null || chunk.length === 0) {
        break;
      }

      // Store a defensive copy - render() returns WASM memory that may be reused
      const copy = chunk.slice();
      chunks.push(copy);
      collected += copy.length;
    }

    if (this.cacheToken !== token) {
      return;
    }

    // Combine all chunks into final cache buffer
    // Use single allocation instead of pool (this buffer lives for entire cache lifetime)
    const combined = new Int16Array(collected);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    this.cachedPcm = combined;
    this.cacheSampleRate = this.sampleRate;
    this.cacheChannels = channels;
    this.cacheCursor = 0;
  }

  private cacheAvailable(): boolean {
    return (
      !!this.cachedPcm &&
      this.cacheSampleRate === this.sampleRate &&
      this.cacheChannels === (this.stereo ? 2 : 1)
    );
  }

  /**
   * Clear buffer pool and cached data to free memory.
   * Call this when the engine instance is no longer needed.
   */
  dispose(): void {
    this.bufferPool.clear();
    this.resetCacheState();
    this.originalSidBuffer = null;
  }
}
