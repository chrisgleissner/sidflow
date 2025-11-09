import type {
  LibsidplayfpWasmModule,
  SidPlayerContext,
  SidPlayerContextOptions,
} from './index.js';
import { loadLibsidplayfp } from './index.js';

export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
}

export class SidAudioEngine {
  private readonly modulePromise: Promise<LibsidplayfpWasmModule>;
  private module: LibsidplayfpWasmModule | undefined;
  private context: SidPlayerContext | undefined;
  private readonly sampleRate: number;
  private readonly stereo: boolean;
  private configured = false;
  private originalSidBuffer: Uint8Array | null = null;
  private currentSongIndex = 0;

  constructor(options: SidAudioEngineOptions = {}) {
    const { module: moduleOverride, sampleRate, stereo, ...loaderOptions } = options;
    this.sampleRate = sampleRate ?? 44100;
    this.stereo = stereo ?? true;
    this.modulePromise = moduleOverride ?? loadLibsidplayfp(loaderOptions);
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

  async loadSidBuffer(data: Uint8Array | ArrayBufferView): Promise<void> {
    this.originalSidBuffer = this.cloneInput(data);
    this.currentSongIndex = 0;
    await this.reloadCurrentSong();
  }

  async selectSong(songIndex: number): Promise<number> {
    if (!this.originalSidBuffer) {
      throw new Error('Load a SID before selecting a song');
    }
    this.currentSongIndex = Math.max(0, Math.trunc(songIndex));
    return this.reloadCurrentSong();
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

  renderCycles(cycles = 20000): Int16Array | null {
    if (!this.context || !this.configured) {
      return null;
    }
    const chunk = this.context.render(cycles);
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
    cyclesPerChunk = 20000,
    onProgress?: (samplesWritten: number) => void
  ): Promise<Int16Array> {
    if (seconds <= 0) {
      throw new Error('Duration must be greater than zero');
    }
    if (!this.context || !this.configured) {
      return new Int16Array(0);
    }
    const context = this.context;
    const sampleRate = context.getSampleRate();
    const channels = context.getChannels();
    const totalSamples = Math.max(1, Math.floor(sampleRate * seconds * channels));
    const buffer = new Int16Array(totalSamples);
    let offset = 0;
    const maxIterations = Math.ceil((sampleRate * seconds) / cyclesPerChunk) * 4;
    let iterations = 0;

    while (offset < totalSamples && iterations < maxIterations) {
      iterations += 1;
      const chunk = this.renderCycles(cyclesPerChunk);
      if (chunk === null) {
        break;
      }
      if (chunk.length === 0) {
        continue;
      }
      const available = Math.min(chunk.length, totalSamples - offset);
      buffer.set(chunk.subarray(0, available), offset);
      offset += available;
      onProgress?.(offset);
    }

    return buffer.subarray(0, offset);
  }
}
