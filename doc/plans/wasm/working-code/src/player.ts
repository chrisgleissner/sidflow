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
  private modulePromise: Promise<LibsidplayfpWasmModule>;
  private module?: LibsidplayfpWasmModule;
  private context?: SidPlayerContext;
  private sampleRate: number;
  private stereo: boolean;
  private configured = false;

  constructor(options: SidAudioEngineOptions = {}) {
    this.sampleRate = options.sampleRate ?? 44100;
    this.stereo = options.stereo ?? true;
    this.modulePromise = options.module ?? loadLibsidplayfp(options);
  }

  private async ensureContext(): Promise<SidPlayerContext> {
    if (this.context) {
      return this.context;
    }
    this.module = await this.modulePromise;
    this.context = new this.module.SidPlayerContext();
    if (!this.context.configure(this.sampleRate, this.stereo)) {
      throw new Error(`Failed to configure SID player: ${this.context.getLastError()}`);
    }
    this.configured = true;
    return this.context;
  }

  async loadSidBuffer(data: Uint8Array | ArrayBufferView): Promise<void> {
    const context = await this.ensureContext();
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data.buffer);
    if (!context.loadSidBuffer(payload)) {
      throw new Error(context.getLastError());
    }
  }

  selectSong(songIndex: number): number {
    if (!this.context) {
      throw new Error('SID player not initialized');
    }
    return this.context.selectSong(songIndex);
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
    if (!chunk) {
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
    const context = await this.ensureContext();
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
