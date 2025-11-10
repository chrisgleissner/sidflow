/**
 * AudioWorklet processor for SID audio rendering.
 * 
 * This worklet PULLS audio from a SharedArrayBuffer ring buffer populated by a Web Worker.
 * It runs on the audio thread and must never block or allocate memory in the hot path.
 * 
 * Architecture:
 * - Pull-based: reads exactly 128 frames per process() call
 * - Handles underruns gracefully by outputting silence
 * - Tracks telemetry: underruns, frames consumed, buffer occupancy
 */

// AudioWorklet global types (these exist in the worklet scope)
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// Import SAB ring buffer consumer
// Note: This will be bundled/transpiled for the worklet context
import { SABRingBufferConsumer, type SABRingBufferPointers } from '../shared/sab-ring-buffer';

interface SidRendererOptions {
  sabPointers: SABRingBufferPointers;
  channelCount: number;
}

interface TelemetryMessage {
  type: 'telemetry';
  underruns: number;
  framesConsumed: number;
  minOccupancy: number;
  maxOccupancy: number;
  currentOccupancy: number;
}

class SidRendererProcessor extends AudioWorkletProcessor {
  private consumer: SABRingBufferConsumer;
  private channelCount: number;
  private framesConsumed = 0;
  private underruns = 0;
  private minOccupancy = Number.MAX_SAFE_INTEGER;
  private maxOccupancy = 0;
  private telemetryCounter = 0;
  private readonly TELEMETRY_INTERVAL = 128; // Send telemetry every 128 quanta (~3.6s at 44.1kHz)

  constructor(options: AudioWorkletNodeOptions) {
    super();

    const processorOptions = options.processorOptions as SidRendererOptions;
    if (!processorOptions || !processorOptions.sabPointers) {
      throw new Error('[SidRenderer] Missing sabPointers in processorOptions');
    }

    this.channelCount = processorOptions.channelCount || 2;
    this.consumer = new SABRingBufferConsumer(processorOptions.sabPointers);

    console.log('[SidRenderer] Initialized', {
      channelCount: this.channelCount,
      blockSize: processorOptions.sabPointers.blockSize,
      capacity: processorOptions.sabPointers.capacityFrames,
    });
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const frames = output[0].length; // Always 128 for AudioWorklet
    const occupancy = this.consumer.getOccupancy();

    // Track occupancy stats
    this.minOccupancy = Math.min(this.minOccupancy, occupancy);
    this.maxOccupancy = Math.max(this.maxOccupancy, occupancy);

    // Try to read from ring buffer
    const framesRead = this.consumer.read(output, frames);

    if (framesRead === frames) {
      // Success: consumed full quantum
      this.framesConsumed += frames;
    } else {
      // Underrun: output silence for this quantum
      this.underruns++;
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }

      // Log underrun (throttled)
      if (this.underruns <= 5 || this.underruns % 100 === 0) {
        console.warn(`[SidRenderer] Underrun #${this.underruns} at frame ${this.framesConsumed}`);
      }
    }

    // Send periodic telemetry
    this.telemetryCounter++;
    if (this.telemetryCounter >= this.TELEMETRY_INTERVAL) {
      this.telemetryCounter = 0;
      this.sendTelemetry();
    }

    return true; // Keep processor alive
  }

  private sendTelemetry(): void {
    const message: TelemetryMessage = {
      type: 'telemetry',
      underruns: this.underruns,
      framesConsumed: this.framesConsumed,
      minOccupancy: this.minOccupancy === Number.MAX_SAFE_INTEGER ? 0 : this.minOccupancy,
      maxOccupancy: this.maxOccupancy,
      currentOccupancy: this.consumer.getOccupancy(),
    };

    this.port.postMessage(message);
  }
}

registerProcessor('sid-renderer', SidRendererProcessor as unknown as new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor);

// Export for type checking (won't be used at runtime in worklet context)
export {};
