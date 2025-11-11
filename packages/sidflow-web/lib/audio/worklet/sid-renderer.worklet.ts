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
  new(options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare const currentTime: number;
declare const sampleRate: number;

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
  zeroByteFrames: number;
  missedQuanta: number;
  totalDriftMs: number;
  maxDriftMs: number;
}

type ControlMessage =
  | { type: 'start' }
  | { type: 'stop' };

class SidRendererProcessor extends AudioWorkletProcessor {
  private consumer: SABRingBufferConsumer;
  private channelCount: number;
  private framesConsumed = 0;
  private underruns = 0;
  private minOccupancy = Number.MAX_SAFE_INTEGER;
  private maxOccupancy = 0;
  private telemetryCounter = 0;
  private readonly TELEMETRY_INTERVAL = 128; // Send telemetry every 128 quanta (~3.6s at 44.1kHz)

  // Additional telemetry metrics
  private zeroByteFrames = 0;
  private missedQuanta = 0;
  private lastProcessTime = 0;
  private totalDriftMs = 0;
  private maxDriftMs = 0;
  private quantumCount = 0;
  private zeroByteCheckCounter = 0;
  private readonly ZERO_BYTE_CHECK_INTERVAL = 8; // Check every 8th quantum to reduce CPU overhead
  private isRunning = false;

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

    this.port.onmessage = (event: MessageEvent<ControlMessage>) => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'start') {
        this.isRunning = true;
        this.resetTelemetry();
      } else if (message.type === 'stop') {
        this.isRunning = false;
      }
    };
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

    if (!this.isRunning) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    const frames = output[0].length; // Always 128 for AudioWorklet
    const occupancy = this.consumer.getOccupancy();

    // Track timing drift (using currentTime for high precision)
    const now = currentTime;
    if (this.lastProcessTime > 0) {
      const expectedInterval = frames / sampleRate;
      const actualInterval = now - this.lastProcessTime;
      const driftMs = Math.abs(actualInterval - expectedInterval) * 1000;
      this.totalDriftMs += driftMs;
      this.maxDriftMs = Math.max(this.maxDriftMs, driftMs);
    }
    this.lastProcessTime = now;
    this.quantumCount++;

    // Track occupancy stats
    this.minOccupancy = Math.min(this.minOccupancy, occupancy);
    this.maxOccupancy = Math.max(this.maxOccupancy, occupancy);

    // Try to read from ring buffer
    const framesRead = this.consumer.read(output, frames);

    if (framesRead === frames) {
      // Success: consumed full quantum
      this.framesConsumed += frames;

      // Detect zero-byte frames (completely silent) - sampled to reduce CPU overhead
      // Only check every Nth quantum (~43 times/second at 44.1kHz instead of 344 times/second)
      this.zeroByteCheckCounter++;
      if (this.zeroByteCheckCounter >= this.ZERO_BYTE_CHECK_INTERVAL) {
        this.zeroByteCheckCounter = 0;

        let hasNonZero = false;
        for (let ch = 0; ch < output.length; ch++) {
          const channelData = output[ch];
          for (let i = 0; i < channelData.length; i++) {
            if (channelData[i] !== 0) {
              hasNonZero = true;
              break;
            }
          }
          if (hasNonZero) break;
        }

        if (!hasNonZero) {
          // Scale up by interval since we're sampling
          this.zeroByteFrames += this.ZERO_BYTE_CHECK_INTERVAL;
        }
      }
    } else {
      // Underrun: output silence for this quantum
      this.underruns++;
      // missedQuanta tracks failed AudioWorklet process() calls (buffer starvation)
      this.missedQuanta++;
      // zeroByteFrames tracks all silent output, including forced silence from underruns.
      // This distinguishes between naturally silent music passages (counted above) and
      // dropouts due to buffer starvation (counted here). Both contribute to total silence.
      this.zeroByteFrames++;

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
    const avgDriftMs = this.quantumCount > 0 ? this.totalDriftMs / this.quantumCount : 0;

    const message: TelemetryMessage = {
      type: 'telemetry',
      underruns: this.underruns,
      framesConsumed: this.framesConsumed,
      minOccupancy: this.minOccupancy === Number.MAX_SAFE_INTEGER ? 0 : this.minOccupancy,
      maxOccupancy: this.maxOccupancy,
      currentOccupancy: this.consumer.getOccupancy(),
      zeroByteFrames: this.zeroByteFrames,
      missedQuanta: this.missedQuanta,
      totalDriftMs: avgDriftMs,
      maxDriftMs: this.maxDriftMs,
    };

    this.port.postMessage(message);
  }

  private resetTelemetry(): void {
    this.framesConsumed = 0;
    this.underruns = 0;
    this.minOccupancy = Number.MAX_SAFE_INTEGER;
    this.maxOccupancy = 0;
    this.telemetryCounter = 0;
    this.zeroByteFrames = 0;
    this.missedQuanta = 0;
    this.lastProcessTime = 0;
    this.totalDriftMs = 0;
    this.maxDriftMs = 0;
    this.quantumCount = 0;
    this.zeroByteCheckCounter = 0;
  }
}

registerProcessor('sid-renderer', SidRendererProcessor as unknown as new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor);

// Export for type checking (won't be used at runtime in worklet context)
export { };
