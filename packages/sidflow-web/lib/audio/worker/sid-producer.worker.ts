/**
 * Web Worker that produces audio by running the libsidplayfp WASM engine.
 * 
 * This worker:
 * - Initializes the WASM SID engine
 * - Renders PCM audio at the target sample rate
 * - Writes PCM to a SharedArrayBuffer ring buffer
 * - Handles backpressure when buffer is full
 * - Pre-rolls buffer before signaling ready to play
 */

import loadLibsidplayfp, { SidAudioEngine } from '@sidflow/libsidplayfp-wasm';
import { SABRingBufferProducer, type SABRingBufferPointers } from '../shared/sab-ring-buffer';

const INT16_SCALE = 1 / 0x8000;

interface InitMessage {
  type: 'init';
  sabPointers: SABRingBufferPointers;
  targetSampleRate: number;
  wasmLocateFile?: (asset: string) => string;
}

interface LoadMessage {
  type: 'load';
  sidBytes: Uint8Array;
  selectedSong?: number;
  durationSeconds: number;
  roms?: {
    kernal?: Uint8Array | null;
    basic?: Uint8Array | null;
    chargen?: Uint8Array | null;
  };
}

interface StartMessage {
  type: 'start';
}

interface StopMessage {
  type: 'stop';
}

type WorkerMessage = InitMessage | LoadMessage | StartMessage | StopMessage;

interface ReadyMessage {
  type: 'ready';
  framesProduced: number;
}

interface LoadedMessage {
  type: 'loaded';
}

interface TelemetryMessage {
  type: 'telemetry';
  framesProduced: number;
  backpressureStalls: number;
  minOccupancy: number;
  maxOccupancy: number;
  currentOccupancy: number;
  renderMaxDurationMs?: number;
  renderAvgDurationMs?: number;
  capacityFrames?: number;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

interface EndedMessage {
  type: 'ended';
  framesProduced: number;
}

type WorkerResponse = ReadyMessage | LoadedMessage | TelemetryMessage | ErrorMessage | EndedMessage;

class SidProducerWorker {
  private producer: SABRingBufferProducer | null = null;
  private engine: SidAudioEngine | null = null;
  private targetSampleRate = 44100;
  private channelCount = 2;
  private blockSize = 128;

  private framesProduced = 0;
  private backpressureStalls = 0;
  private minOccupancy = Number.MAX_SAFE_INTEGER;
  private maxOccupancy = 0;
  private maxRenderDurationMs = 0;
  private totalRenderDurationMs = 0;
  private renderChunkCount = 0;
  private lastChunkTimestamp = 0;
  private capacityFrames = 0;

  private isRunning = false;
  private shouldStop = false;
  private renderLoopPromise: Promise<void> | null = null;

  // Keep roughly 30% of the ring buffer primed (~0.9s with default capacity).
  private readonly PRE_ROLL_TARGET_RATIO = 0.3;
  private readonly MIN_PREROLL_FRAMES = 8192;
  private preRollFrames = this.MIN_PREROLL_FRAMES;

  private renderChunkFrames = 2048; // Render chunk size in frames (aligned to blockSize)
  private renderCyclesPerChunk = 120_000;

  private engineInitPromise: Promise<void> | null = null;
  private engineInitialized = false;

  async handleMessage(message: WorkerMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'init':
          await this.handleInit(message);
          break;
        case 'load':
          await this.handleLoad(message);
          break;
        case 'start':
          await this.handleStart();
          break;
        case 'stop':
          this.handleStop();
          break;
      }
    } catch (error) {
      this.postError(error);
    }
  }

  private async handleInit(message: InitMessage): Promise<void> {
    if (this.engineInitPromise) {
      console.warn('[SidProducer] Init requested while previous initialization is still running. Waiting for completion.');
      await this.engineInitPromise;
      return;
    }

    const initPromise = this.initializeEngine(message);
    this.engineInitPromise = initPromise;

    try {
      await initPromise;
    } finally {
      this.engineInitPromise = null;
    }
  }

  private async handleLoad(message: LoadMessage): Promise<void> {
    await this.ensureEngineReady();

    if (!this.engine) {
      throw new Error('Engine not initialized');
    }

    const romSet = this.prepareRomSet(message.roms);
    const romsToApply = null; // TEMP: disable custom ROMs to isolate load hang

    // Loading SID (verbose logging reduced for test clarity)
    await this.engine.setSystemROMs(
      romSet?.kernal ?? null,
      romSet?.basic ?? null,
      romSet?.chargen ?? null
    );
    // ROM configuration applied

    await this.engine.loadSidBuffer(message.sidBytes);
    console.log('[SidProducer] ✓ Loaded SID buffer into engine');

    if (message.selectedSong !== undefined && message.selectedSong > 0) {
      await this.engine.selectSong(message.selectedSong - 1);
      console.log('[SidProducer] ✓ Selected song', {
        selectedSong: message.selectedSong,
      });
    }

    // SID loaded

    this.postMessage({ type: 'loaded' });
  }

  private async handleStart(): Promise<void> {
    await this.ensureEngineReady();

    if (!this.engine || !this.producer) {
      throw new Error('Not initialized');
    }

    if (this.isRunning) {
      // Already running
      return;
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.framesProduced = 0;
    this.backpressureStalls = 0;
    this.minOccupancy = Number.MAX_SAFE_INTEGER;
    this.maxOccupancy = 0;
    this.maxRenderDurationMs = 0;
    this.totalRenderDurationMs = 0;
    this.renderChunkCount = 0;

    // Starting render loop

    // Pre-roll: fill buffer before signaling ready
    await this.preRoll();

    // Signal ready to start playback
    this.postMessage({
      type: 'ready',
      framesProduced: this.framesProduced,
    });

    // Start continuous render loop
    this.renderLoopPromise = this.renderLoop();
  }

  private handleStop(): void {
    // Stopping
    this.shouldStop = true;
    this.isRunning = false;
  }

  private async preRoll(): Promise<void> {
    if (!this.engine || !this.producer) {
      return;
    }

    console.log('[SidProducer] Pre-roll start', {
      targetFrames: this.preRollFrames,
    });

    // Pre-rolling buffer

    while (!this.shouldStop) {
      const occupancy = this.producer.getOccupancy();
      if (occupancy >= this.preRollFrames) {
        break;
      }

      const framesNeeded = this.preRollFrames - occupancy;
      if (framesNeeded < this.blockSize) {
        break;
      }
      const chunkFrames = Math.min(this.renderChunkFrames, framesNeeded);
      const produced = await this.renderChunk(chunkFrames);

      if (produced === 0) {
        // Engine paused or target reached; yield briefly before retrying
        await this.yieldControl();
      }
    }

    // Pre-roll complete

    // Reset occupancy metrics now that buffer is primed
    const finalOccupancy = this.producer.getOccupancy();
    this.minOccupancy = finalOccupancy;
    this.maxOccupancy = Math.max(this.maxOccupancy, finalOccupancy);

    console.log('[SidProducer] Pre-roll complete', {
      occupancy: finalOccupancy,
      shouldStop: this.shouldStop,
    });
  }

  private async renderLoop(): Promise<void> {
    let telemetryCounter = 0;
    const telemetryInterval = 50; // Send telemetry every 50 chunks

    while (!this.shouldStop) {
      let produced = 0;

      do {
        produced = await this.renderChunk(this.renderChunkFrames);

        // Send periodic telemetry after each render attempt
        telemetryCounter++;
        if (telemetryCounter >= telemetryInterval) {
          telemetryCounter = 0;
          this.sendTelemetry();
        }

        if (this.shouldStop) {
          break;
        }
      } while (produced > 0);

      if (this.shouldStop) {
        break;
      }

      if (produced === 0) {
        // Engine stopped or buffer at target threshold; yield briefly to avoid a tight loop
        await this.yieldControl();
      }
    }

    // Signal ended
    this.postMessage({
      type: 'ended',
      framesProduced: this.framesProduced,
    });

    // Stopped
  }

  private yieldControl(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
  }

  private async renderChunk(frames: number): Promise<number> {
    if (!this.engine || !this.producer) {
      return 0;
    }

    // Align to blockSize
    const desiredFrames = Math.floor(frames / this.blockSize) * this.blockSize;
    if (desiredFrames === 0) {
      return 0;
    }

    // Check available space
    const currentOccupancy = this.producer.getOccupancy();
    this.minOccupancy = Math.min(this.minOccupancy, currentOccupancy);
    if (currentOccupancy === 0) {
      console.warn('[SidProducer] Occupancy reached zero before producing new audio', {
        framesProduced: this.framesProduced,
      });
    }

    const available = this.producer.getAvailableWrite();
    let writableFrames = Math.min(desiredFrames, Math.floor(available / this.blockSize) * this.blockSize);

    if (writableFrames === 0) {
      const highWatermark = this.capacityFrames > 0
        ? Math.max(this.preRollFrames, this.capacityFrames - Math.max(this.renderChunkFrames, this.blockSize))
        : this.preRollFrames;

      if (currentOccupancy >= highWatermark) {
        await this.yieldControl();
        return 0; // Buffer intentionally topped up; no need to treat as stall
      }

      this.backpressureStalls++;
      if (this.backpressureStalls <= 5 || this.backpressureStalls % 100 === 0) {
        console.warn(
          `[SidProducer] Backpressure stall: available ${available}, desired ${desiredFrames}, framesProduced ${this.framesProduced}`
        );
      }
      return 0; // Backpressure: buffer full
    }

    const deficitFrames = this.preRollFrames - currentOccupancy;
    const minChunk = Math.min(desiredFrames, this.renderChunkFrames);
    const deficitAligned = Math.floor(Math.max(0, deficitFrames) / this.blockSize) * this.blockSize;
    const desiredTopUp = Math.max(minChunk, deficitAligned);

    writableFrames = Math.min(writableFrames, desiredTopUp);

    if (writableFrames === 0) {
      // Nothing writable after alignment – yield so consumer can drain further
      await this.yieldControl();
      return 0;
    }

    // Render PCM from WASM engine
    const startTime = performance.now();
    const pcmInt16 = await this.engine.renderFrames(writableFrames, this.renderCyclesPerChunk);
    const durationMs = performance.now() - startTime;
    this.maxRenderDurationMs = Math.max(this.maxRenderDurationMs, durationMs);
    this.totalRenderDurationMs += durationMs;
    this.renderChunkCount += 1;

    if (pcmInt16.length === 0) {
      const errorMessage = JSON.stringify({
        writableFrames,
        cyclesPerChunk: 40000,
        framesProduced: this.framesProduced,
        available,
      });
      this.postMessage({ type: 'error', error: `renderFrames returned 0 samples ${errorMessage}` });
      console.error('[SidProducer] renderFrames returned 0 samples', {
        writableFrames,
        cyclesPerChunk: 40000,
        framesProduced: this.framesProduced,
      });
      return 0;
    }

    const actualFrames = Math.floor(pcmInt16.length / this.channelCount);

    if (actualFrames !== writableFrames) {
      console.warn('[SidProducer] renderFrames produced fewer frames than requested', {
        requestedFrames: writableFrames,
        actualFrames,
      });
    }

    // Convert Int16 → Float32 interleaved
    const pcmFloat = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
      pcmFloat[i] = pcmInt16[i] * INT16_SCALE;
    }

    // Ensure we only write aligned frames to avoid ring buffer errors
    const alignedFrames = Math.floor(actualFrames / this.blockSize) * this.blockSize;
    if (alignedFrames === 0) {
      // No complete blocks to write, return the actual frames rendered for accounting
      return actualFrames;
    }

    const alignedSamples = alignedFrames * this.channelCount;
    const alignedPcm = pcmFloat.subarray(0, alignedSamples);

    // Write aligned portion to ring buffer
    const written = this.producer.write(alignedPcm);
    if (written === 0) {
      console.warn('[SidProducer] write() wrote 0 frames unexpectedly', {
        requestedFrames: actualFrames,
        available,
        framesProduced: this.framesProduced,
      });
    }
    this.framesProduced += written;

    // Track occupancy
    const occupancy = this.producer.getOccupancy();
    this.minOccupancy = Math.min(this.minOccupancy, occupancy);
    this.maxOccupancy = Math.max(this.maxOccupancy, occupancy);

    if (occupancy < this.blockSize) {
      console.warn('[SidProducer] Occupancy dropped below one quantum', {
        occupancy,
        framesProduced: this.framesProduced,
      });
    }

    const now = performance.now();
    if (this.lastChunkTimestamp > 0) {
      const delta = now - this.lastChunkTimestamp;
      const lowOccupancy = occupancy < this.preRollFrames / 2;
      const threshold = lowOccupancy ? 10 : 25;
      // Only log gaps in low-occupancy situations (potential underrun risk)
      if (delta > threshold && lowOccupancy) {
        console.warn('[SidProducer] Detected long gap in low-occupancy state', {
          gapMs: delta,
          framesWritten: written,
          occupancy,
        });
      }
    }
    this.lastChunkTimestamp = now;

    return written;
  }

  private sendTelemetry(): void {
    if (!this.producer) {
      return;
    }

    this.postMessage({
      type: 'telemetry',
      framesProduced: this.framesProduced,
      backpressureStalls: this.backpressureStalls,
      minOccupancy: this.minOccupancy === Number.MAX_SAFE_INTEGER ? 0 : this.minOccupancy,
      maxOccupancy: this.maxOccupancy,
      currentOccupancy: this.producer.getOccupancy(),
      renderMaxDurationMs: this.maxRenderDurationMs,
      renderAvgDurationMs: this.renderChunkCount > 0 ? this.totalRenderDurationMs / this.renderChunkCount : 0,
      capacityFrames: this.capacityFrames,
    });
  }

  private configureBufferingStrategy(pointers: SABRingBufferPointers): void {
    if (!this.producer) {
      return;
    }

    const capacityFrames = pointers.capacityFrames;
    const alignedCapacity = Math.floor(capacityFrames / this.blockSize) * this.blockSize;
    this.capacityFrames = alignedCapacity;

    const targetPreRoll = Math.floor(
      Math.max(this.MIN_PREROLL_FRAMES, capacityFrames * this.PRE_ROLL_TARGET_RATIO) / this.blockSize
    ) * this.blockSize;
    const maxPreRoll = Math.max(this.blockSize, alignedCapacity - this.blockSize);
    this.preRollFrames = Math.min(Math.max(this.MIN_PREROLL_FRAMES, targetPreRoll), maxPreRoll);

    const quarterCapacity = Math.max(
      this.blockSize,
      Math.floor(alignedCapacity / 4 / this.blockSize) * this.blockSize
    );
    const minChunk = this.blockSize * 8;
    const maxChunk = this.blockSize * 16;
    const rawChunk = Math.min(Math.max(minChunk, quarterCapacity), maxChunk);
    const alignedChunk = Math.max(this.blockSize, Math.floor(rawChunk / this.blockSize) * this.blockSize);
    this.renderChunkFrames = Math.min(this.preRollFrames, alignedChunk);

    if (this.renderChunkFrames < this.blockSize) {
      this.renderChunkFrames = this.blockSize;
    }

    const cyclesPerFrameEstimate = 48; // Conservative cycles per frame for SID playback
    const baselineCycles = 80_000;
    const computedCycles = this.renderChunkFrames * cyclesPerFrameEstimate;
    this.renderCyclesPerChunk = Math.max(baselineCycles, computedCycles);

    console.log('[SidProducer] Buffer strategy configured', {
      capacityFrames: alignedCapacity,
      preRollFrames: this.preRollFrames,
      renderChunkFrames: this.renderChunkFrames,
      renderCyclesPerChunk: this.renderCyclesPerChunk,
      blockSize: this.blockSize,
    });
  }

  private postMessage(message: WorkerResponse): void {
    self.postMessage(message);
  }

  private postError(error: unknown): void {
    const message: ErrorMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    this.postMessage(message);
    console.error('[SidProducer] Error:', error);
  }

  private async initializeEngine(message: InitMessage): Promise<void> {
    // Initializing

    this.engineInitialized = false;
    this.engine = null;

    this.targetSampleRate = message.targetSampleRate;
    this.producer = new SABRingBufferProducer(message.sabPointers);
    this.channelCount = message.sabPointers.channelCount;
    this.blockSize = message.sabPointers.blockSize;

    this.configureBufferingStrategy(message.sabPointers);

    // Initialize WASM engine
    const locateFile = message.wasmLocateFile ?? ((asset: string) => `/wasm/${asset}`);
    const module = await loadLibsidplayfp({ locateFile });
    this.engine = new SidAudioEngine({
      module: Promise.resolve(module),
      sampleRate: this.targetSampleRate,
      stereo: this.channelCount === 2,
    });

    this.engineInitialized = true;

    console.log('[SidProducer] ✓ Initialized', {
      sampleRate: this.targetSampleRate,
      channels: this.channelCount,
      blockSize: this.blockSize,
    });
  }

  private async ensureEngineReady(): Promise<void> {
    if (this.engineInitPromise) {
      await this.engineInitPromise;
    }

    if (!this.engineInitialized || !this.engine || !this.producer) {
      throw new Error('Engine not initialized');
    }
  }

  private prepareRomSet(roms?: {
    kernal?: Uint8Array | null;
    basic?: Uint8Array | null;
    chargen?: Uint8Array | null;
  }): { kernal: Uint8Array; basic: Uint8Array; chargen: Uint8Array } | null {
    if (!roms) {
      return null;
    }

    const provided = {
      kernal: roms.kernal ?? null,
      basic: roms.basic ?? null,
      chargen: roms.chargen ?? null,
    } as const;

    const providedKinds = (Object.keys(provided) as Array<keyof typeof provided>).filter(
      (key) => provided[key] !== null
    );

    if (providedKinds.length === 0) {
      return null;
    }

    const missingKinds = (Object.keys(provided) as Array<keyof typeof provided>).filter(
      (key) => provided[key] === null
    );

    if (missingKinds.length > 0) {
      console.warn(
        '[SidProducer] Partial ROM configuration detected – skipping custom ROMs',
        {
          provided: providedKinds,
          missing: missingKinds,
        }
      );
      return null;
    }

    const expectedSizes: Record<keyof typeof provided, number> = {
      kernal: 8192,
      basic: 8192,
      chargen: 4096,
    };

    for (const key of providedKinds) {
      const blob = provided[key]!;
      const expected = expectedSizes[key];
      if (blob.length !== expected) {
        throw new Error(`Invalid ${key.toUpperCase()} ROM size: expected ${expected} bytes, received ${blob.length}`);
      }
    }

    return {
      kernal: provided.kernal!,
      basic: provided.basic!,
      chargen: provided.chargen!,
    };
  }
}

// Worker entry point
const worker = new SidProducerWorker();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  worker.handleMessage(event.data).catch((error) => {
    console.error('[SidProducer] Unhandled error:', error);
  });
};

// Export for type checking
export type { WorkerMessage, WorkerResponse };
