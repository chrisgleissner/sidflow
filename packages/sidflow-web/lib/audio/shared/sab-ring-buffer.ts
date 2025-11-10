/**
 * Lock-free SharedArrayBuffer ring buffer for audio streaming.
 * 
 * Architecture:
 * - Single producer (Web Worker) writes audio data
 * - Single consumer (AudioWorklet) reads audio data
 * - Lock-free using Atomics for coordination
 * - All operations aligned to 128 * channelCount frames (AudioWorklet quantum)
 * 
 * Memory Layout:
 * - Header (Int32Array): [readIdx, writeIdx, capacity, channelCount, blockSize]
 * - PCM Data (Float32Array): interleaved audio samples
 */

const HEADER_INTS = 5;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

export interface SABRingBufferConfig {
  /**
   * Number of audio frames (samples per channel) the buffer can hold.
   * Will be aligned to blockSize (typically 128).
   */
  capacityFrames: number;

  /**
   * Number of audio channels (1 = mono, 2 = stereo)
   */
  channelCount: number;

  /**
   * Block size for aligned operations (typically 128 frames for AudioWorklet)
   */
  blockSize?: number;
}

export interface SABRingBufferPointers {
  /**
   * SharedArrayBuffer containing header + PCM data
   */
  buffer: SharedArrayBuffer;

  /**
   * Capacity in frames (already aligned)
   */
  capacityFrames: number;

  /**
   * Number of channels
   */
  channelCount: number;

  /**
   * Block size for operations
   */
  blockSize: number;
}

/**
 * Creates a new SharedArrayBuffer ring buffer for audio.
 */
export function createSABRingBuffer(config: SABRingBufferConfig): SABRingBufferPointers {
  const blockSize = config.blockSize ?? 128;
  const channelCount = config.channelCount;

  // Align capacity to block size
  const capacityFrames = Math.ceil(config.capacityFrames / blockSize) * blockSize;
  const capacitySamples = capacityFrames * channelCount;

  // Allocate SharedArrayBuffer: header + PCM data
  const pcmBytes = capacitySamples * Float32Array.BYTES_PER_ELEMENT;
  const totalBytes = HEADER_BYTES + pcmBytes;
  const buffer = new SharedArrayBuffer(totalBytes);

  // Initialize header
  const header = new Int32Array(buffer, 0, HEADER_INTS);
  Atomics.store(header, 0, 0); // readIdx
  Atomics.store(header, 1, 0); // writeIdx
  Atomics.store(header, 2, capacityFrames);
  Atomics.store(header, 3, channelCount);
  Atomics.store(header, 4, blockSize);

  return {
    buffer,
    capacityFrames,
    channelCount,
    blockSize,
  };
}

/**
 * Producer (Web Worker) side of the ring buffer.
 */
export class SABRingBufferProducer {
  private readonly header: Int32Array;
  private readonly pcm: Float32Array;
  private readonly capacityFrames: number;
  private readonly channelCount: number;
  private readonly blockSize: number;
  private readonly capacitySamples: number;

  constructor(pointers: SABRingBufferPointers) {
    this.header = new Int32Array(pointers.buffer, 0, HEADER_INTS);
    this.capacityFrames = pointers.capacityFrames;
    this.channelCount = pointers.channelCount;
    this.blockSize = pointers.blockSize;
    this.capacitySamples = this.capacityFrames * this.channelCount;

    const pcmOffset = HEADER_BYTES;
    const pcmLength = this.capacitySamples;
    this.pcm = new Float32Array(pointers.buffer, pcmOffset, pcmLength);
  }

  /**
   * Returns number of frames available for writing.
   * Always returns a multiple of blockSize.
   */
  getAvailableWrite(): number {
    const readIdx = Atomics.load(this.header, 0);
    const writeIdx = Atomics.load(this.header, 1);

    let available: number;
    if (writeIdx >= readIdx) {
      available = this.capacityFrames - (writeIdx - readIdx) - 1;
    } else {
      available = readIdx - writeIdx - 1;
    }

    // Align down to blockSize
    return Math.floor(available / this.blockSize) * this.blockSize;
  }

  /**
   * Writes audio data to the buffer. Data must be aligned to blockSize * channelCount.
   * Returns number of frames actually written.
   */
  write(data: Float32Array): number {
    const frames = data.length / this.channelCount;

    // Verify alignment
    if (frames % this.blockSize !== 0) {
      throw new Error(
        `Write size ${frames} frames not aligned to blockSize ${this.blockSize}`
      );
    }

    const available = this.getAvailableWrite();
    if (available === 0) {
      return 0; // Backpressure: buffer full
    }

    const framesToWrite = Math.min(frames, available);
    const samplesToWrite = framesToWrite * this.channelCount;

    const writeIdx = Atomics.load(this.header, 1);
    const writePos = writeIdx * this.channelCount;

    // Handle wrap-around
    if (writeIdx + framesToWrite <= this.capacityFrames) {
      // Contiguous write
      this.pcm.set(data.subarray(0, samplesToWrite), writePos);
    } else {
      // Split write
      const firstFrames = this.capacityFrames - writeIdx;
      const firstSamples = firstFrames * this.channelCount;
      this.pcm.set(data.subarray(0, firstSamples), writePos);

      const remainingSamples = samplesToWrite - firstSamples;
      this.pcm.set(data.subarray(firstSamples, firstSamples + remainingSamples), 0);
    }

    // Update write index
    const newWriteIdx = (writeIdx + framesToWrite) % this.capacityFrames;
    Atomics.store(this.header, 1, newWriteIdx);

    return framesToWrite;
  }

  /**
   * Returns current buffer occupancy in frames.
   */
  getOccupancy(): number {
    const readIdx = Atomics.load(this.header, 0);
    const writeIdx = Atomics.load(this.header, 1);

    if (writeIdx >= readIdx) {
      return writeIdx - readIdx;
    } else {
      return this.capacityFrames - readIdx + writeIdx;
    }
  }
}

/**
 * Consumer (AudioWorklet) side of the ring buffer.
 */
export class SABRingBufferConsumer {
  private readonly header: Int32Array;
  private readonly pcm: Float32Array;
  private readonly capacityFrames: number;
  private readonly channelCount: number;
  private readonly blockSize: number;
  private readonly capacitySamples: number;

  constructor(pointers: SABRingBufferPointers) {
    this.header = new Int32Array(pointers.buffer, 0, HEADER_INTS);
    this.capacityFrames = pointers.capacityFrames;
    this.channelCount = pointers.channelCount;
    this.blockSize = pointers.blockSize;
    this.capacitySamples = this.capacityFrames * this.channelCount;

    const pcmOffset = HEADER_BYTES;
    const pcmLength = this.capacitySamples;
    this.pcm = new Float32Array(pointers.buffer, pcmOffset, pcmLength);
  }

  /**
   * Returns number of frames available for reading.
   * Always returns a multiple of blockSize.
   */
  getAvailableRead(): number {
    const readIdx = Atomics.load(this.header, 0);
    const writeIdx = Atomics.load(this.header, 1);

    let available: number;
    if (writeIdx >= readIdx) {
      available = writeIdx - readIdx;
    } else {
      available = this.capacityFrames - readIdx + writeIdx;
    }

    // Align down to blockSize
    return Math.floor(available / this.blockSize) * this.blockSize;
  }

  /**
   * Reads audio data from the buffer into the provided output array.
   * Frames must be a multiple of blockSize.
   * Returns number of frames actually read.
   */
  read(output: Float32Array[], frames: number): number {
    // Verify alignment
    if (frames % this.blockSize !== 0) {
      throw new Error(
        `Read size ${frames} frames not aligned to blockSize ${this.blockSize}`
      );
    }

    const available = this.getAvailableRead();
    if (available === 0) {
      // Underrun: no data available
      return 0;
    }

    const framesToRead = Math.min(frames, available);
    const readIdx = Atomics.load(this.header, 0);
    const readPos = readIdx * this.channelCount;

    // De-interleave PCM data into output channels
    if (readIdx + framesToRead <= this.capacityFrames) {
      // Contiguous read
      for (let frame = 0; frame < framesToRead; frame++) {
        const srcIdx = readPos + frame * this.channelCount;
        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][frame] = this.pcm[srcIdx + ch];
        }
      }
    } else {
      // Split read
      const firstFrames = this.capacityFrames - readIdx;

      // First part
      for (let frame = 0; frame < firstFrames; frame++) {
        const srcIdx = readPos + frame * this.channelCount;
        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][frame] = this.pcm[srcIdx + ch];
        }
      }

      // Second part (wrapped)
      const remainingFrames = framesToRead - firstFrames;
      for (let frame = 0; frame < remainingFrames; frame++) {
        const srcIdx = frame * this.channelCount;
        for (let ch = 0; ch < this.channelCount; ch++) {
          output[ch][firstFrames + frame] = this.pcm[srcIdx + ch];
        }
      }
    }

    // Update read index
    const newReadIdx = (readIdx + framesToRead) % this.capacityFrames;
    Atomics.store(this.header, 0, newReadIdx);

    return framesToRead;
  }

  /**
   * Returns current buffer occupancy in frames.
   */
  getOccupancy(): number {
    const readIdx = Atomics.load(this.header, 0);
    const writeIdx = Atomics.load(this.header, 1);

    if (writeIdx >= readIdx) {
      return writeIdx - readIdx;
    } else {
      return this.capacityFrames - readIdx + writeIdx;
    }
  }
}
