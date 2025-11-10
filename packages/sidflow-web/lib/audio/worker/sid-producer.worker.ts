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

  private isRunning = false;
  private shouldStop = false;
  private renderLoopPromise: Promise<void> | null = null;

  private readonly PRE_ROLL_FRAMES = 8192;
  private readonly RENDER_CHUNK_FRAMES = 2048; // Render in 2048-frame chunks

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
    console.log('[SidProducer] Initializing...', message);

    this.targetSampleRate = message.targetSampleRate;
    this.producer = new SABRingBufferProducer(message.sabPointers);
    this.channelCount = message.sabPointers.channelCount;
    this.blockSize = message.sabPointers.blockSize;

    // Initialize WASM engine
    const locateFile = message.wasmLocateFile ?? ((asset: string) => `/wasm/${asset}`);
    const module = await loadLibsidplayfp({ locateFile });
    this.engine = new SidAudioEngine({
      module: Promise.resolve(module),
      sampleRate: this.targetSampleRate,
      stereo: this.channelCount === 2,
    });

    console.log('[SidProducer] ✓ Initialized', {
      sampleRate: this.targetSampleRate,
      channels: this.channelCount,
      blockSize: this.blockSize,
    });
  }

  private async handleLoad(message: LoadMessage): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized');
    }

    console.log('[SidProducer] Loading SID...', {
      size: message.sidBytes.length,
      song: message.selectedSong,
      duration: message.durationSeconds,
    });

    await this.engine.loadSidBuffer(message.sidBytes);

    if (message.selectedSong !== undefined && message.selectedSong > 0) {
      await this.engine.selectSong(message.selectedSong - 1);
    }

    console.log('[SidProducer] ✓ Loaded SID');

    this.postMessage({ type: 'loaded' });
  }

  private async handleStart(): Promise<void> {
    if (!this.engine || !this.producer) {
      throw new Error('Not initialized');
    }

    if (this.isRunning) {
      console.warn('[SidProducer] Already running');
      return;
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.framesProduced = 0;
    this.backpressureStalls = 0;
    this.minOccupancy = Number.MAX_SAFE_INTEGER;
    this.maxOccupancy = 0;

    console.log('[SidProducer] Starting render loop...');

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
    console.log('[SidProducer] Stopping...');
    this.shouldStop = true;
    this.isRunning = false;
  }

  private async preRoll(): Promise<void> {
    if (!this.engine || !this.producer) {
      return;
    }

    console.log(`[SidProducer] Pre-rolling ${this.PRE_ROLL_FRAMES} frames...`);

    let framesToProduce = this.PRE_ROLL_FRAMES;
    while (framesToProduce > 0 && !this.shouldStop) {
      const chunkFrames = Math.min(this.RENDER_CHUNK_FRAMES, framesToProduce);
      const produced = await this.renderChunk(chunkFrames);

      if (produced === 0) {
        // Engine stopped producing
        break;
      }

      framesToProduce -= produced;
    }

    console.log(`[SidProducer] ✓ Pre-rolled ${this.framesProduced} frames`);
  }

  private async renderLoop(): Promise<void> {
    let telemetryCounter = 0;
    const TELEMETRY_INTERVAL = 50; // Send telemetry every 50 chunks

    while (!this.shouldStop) {
      const produced = await this.renderChunk(this.RENDER_CHUNK_FRAMES);

      if (produced === 0) {
        // Engine stopped or backpressure
        // Sleep briefly to avoid tight loop
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Send periodic telemetry
      telemetryCounter++;
      if (telemetryCounter >= TELEMETRY_INTERVAL) {
        telemetryCounter = 0;
        this.sendTelemetry();
      }
    }

    // Signal ended
    this.postMessage({
      type: 'ended',
      framesProduced: this.framesProduced,
    });

    console.log('[SidProducer] ✓ Stopped', {
      framesProduced: this.framesProduced,
      backpressureStalls: this.backpressureStalls,
    });
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
    const available = this.producer.getAvailableWrite();
    let writableFrames = Math.min(desiredFrames, Math.floor(available / this.blockSize) * this.blockSize);

    if (writableFrames === 0) {
      this.backpressureStalls++;
      if (this.backpressureStalls <= 5 || this.backpressureStalls % 100 === 0) {
        console.warn(
          `[SidProducer] Backpressure stall: available ${available}, desired ${desiredFrames}, framesProduced ${this.framesProduced}`
        );
      }
      return 0; // Backpressure: buffer full
    }

    // Render PCM from WASM engine
    const pcmInt16 = await this.engine.renderFrames(writableFrames, 40000);

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

    // Convert Int16 → Float32 interleaved
    const pcmFloat = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
      pcmFloat[i] = pcmInt16[i] * INT16_SCALE;
    }

    // Write to ring buffer
    const written = this.producer.write(pcmFloat);
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
