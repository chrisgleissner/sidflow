/**
 * Ultimate 64 UDP audio capture utilities
 * Implements packet reordering, loss detection, and PCM assembly
 * Based on doc/plans/scale/c64-stream-spec.md
 */

import { createLogger } from "./logger.js";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";

const logger = createLogger("ultimate64-capture");

export const AUDIO_PACKET_SIZE = 770; // 2 byte header + 768 byte payload
export const SAMPLES_PER_PACKET = 192; // stereo samples (384 mono samples)
export const SAMPLE_RATE_PAL = 47983; // Hz
export const SAMPLE_RATE_NTSC = 47940; // Hz
export const PACKET_TIMEOUT_MS = 100; // Time to wait for out-of-order packets

export interface AudioPacket {
  readonly sequenceNumber: number;
  readonly samples: Int16Array; // stereo interleaved s16le
  readonly receivedAt: number;
}

export interface CaptureStatistics {
  readonly packetsReceived: number;
  readonly packetsReordered: number;
  readonly packetsLost: number;
  readonly lossRate: number; // 0.0 to 1.0
  readonly durationMs: number;
}

export interface CaptureOptions {
  readonly port: number;
  readonly maxLossRate?: number; // Fail if loss rate exceeds this (default 0.01 = 1%)
  readonly bufferTimeMs?: number; // Reorder buffer time (default 100ms)
  readonly targetDurationMs?: number; // Stop after this duration
}

export class Ultimate64AudioCapture extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private capturing = false;
  private startTime = 0;
  private lastSequence = -1;
  private packetsReceived = 0;
  private packetsReordered = 0;
  private packetsLost = 0;
  private reorderBuffer: Map<number, AudioPacket> = new Map();
  private expectedSequence = 0;
  private samples: Int16Array[] = [];
  private targetDurationMs: number;
  private maxLossRate: number;
  private bufferTimeMs: number;

  constructor(options: CaptureOptions) {
    super();
    this.targetDurationMs = options.targetDurationMs ?? 0;
    this.maxLossRate = options.maxLossRate ?? 0.01;
    this.bufferTimeMs = options.bufferTimeMs ?? PACKET_TIMEOUT_MS;
  }

  /**
   * Start capturing UDP audio packets
   */
  async start(port: number): Promise<void> {
    if (this.capturing) {
      throw new Error("Already capturing");
    }

    logger.debug(`Starting UDP capture on port ${port}`);

    this.socket = dgram.createSocket("udp4");
    this.capturing = true;
    this.startTime = Date.now();
    this.packetsReceived = 0;
    this.packetsReordered = 0;
    this.packetsLost = 0;
    this.reorderBuffer.clear();
    this.expectedSequence = 0;
    this.samples = [];

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket not initialized"));
        return;
      }

      this.socket.on("message", (msg) => {
        this.handlePacket(msg);
      });

      this.socket.on("error", (err) => {
        logger.error("Socket error:", err);
        this.emit("error", err);
        reject(err);
      });

      this.socket.bind(port, () => {
        logger.debug(`UDP socket bound to port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop capturing and return collected PCM samples
   */
  stop(): { samples: Int16Array; stats: CaptureStatistics } {
    if (!this.capturing) {
      throw new Error("Not capturing");
    }

    this.capturing = false;

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Process any remaining buffered packets
    this.flushReorderBuffer();

    // Concatenate all sample chunks
    const totalSamples = this.samples.reduce((sum, chunk) => sum + chunk.length, 0);
    const allSamples = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of this.samples) {
      allSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const durationMs = Date.now() - this.startTime;
    const stats: CaptureStatistics = {
      packetsReceived: this.packetsReceived,
      packetsReordered: this.packetsReordered,
      packetsLost: this.packetsLost,
      lossRate:
        this.packetsReceived > 0
          ? this.packetsLost / (this.packetsReceived + this.packetsLost)
          : 0,
      durationMs,
    };

    logger.debug(
      `Capture stopped: ${stats.packetsReceived} packets, ${stats.packetsLost} lost (${(stats.lossRate * 100).toFixed(2)}%)`
    );

    if (stats.lossRate > this.maxLossRate) {
      logger.warn(
        `Packet loss rate ${(stats.lossRate * 100).toFixed(2)}% exceeds threshold ${(this.maxLossRate * 100).toFixed(2)}%`
      );
    }

    this.emit("stopped", stats);

    return { samples: allSamples, stats };
  }

  /**
   * Handle incoming UDP packet
   */
  private handlePacket(buffer: Buffer): void {
    if (!this.capturing) {
      return;
    }

    // Check duration limit
    if (this.targetDurationMs > 0) {
      const elapsed = Date.now() - this.startTime;
      if (elapsed >= this.targetDurationMs) {
        logger.debug(`Target duration ${this.targetDurationMs}ms reached`);
        setImmediate(() => this.stop());
        return;
      }
    }

    if (buffer.length !== AUDIO_PACKET_SIZE) {
      logger.warn(`Invalid packet size: ${buffer.length} (expected ${AUDIO_PACKET_SIZE})`);
      return;
    }

    // Parse packet header (16-bit LE sequence number)
    const sequenceNumber = buffer.readUInt16LE(0);

    // Parse payload (192 stereo samples, s16le)
    const samples = new Int16Array(SAMPLES_PER_PACKET * 2); // 384 mono samples
    for (let i = 0; i < SAMPLES_PER_PACKET * 2; i++) {
      samples[i] = buffer.readInt16LE(2 + i * 2);
    }

    const packet: AudioPacket = {
      sequenceNumber,
      samples,
      receivedAt: Date.now(),
    };

    this.packetsReceived++;

    // Handle sequence numbering (with wraparound at 65536)
    if (sequenceNumber === this.expectedSequence) {
      // In-order packet
      this.processSamples(packet.samples);
      this.expectedSequence = (this.expectedSequence + 1) & 0xffff;
      this.lastSequence = sequenceNumber;

      // Try to flush buffered packets
      this.flushReorderBuffer();
    } else if (this.isAfter(sequenceNumber, this.expectedSequence)) {
      // Out-of-order packet (arrived early)
      this.reorderBuffer.set(sequenceNumber, packet);
      this.packetsReordered++;
      logger.debug(
        `Buffering out-of-order packet ${sequenceNumber} (expected ${this.expectedSequence})`
      );
    } else {
      // Duplicate or very late packet
      logger.debug(`Ignoring duplicate/late packet ${sequenceNumber}`);
    }

    // Detect packet loss
    this.detectPacketLoss();
  }

  /**
   * Check if sequence a comes after sequence b (handling wraparound)
   */
  private isAfter(a: number, b: number): boolean {
    const diff = (a - b) & 0xffff;
    return diff > 0 && diff < 32768;
  }

  /**
   * Flush buffered packets that are now in sequence
   */
  private flushReorderBuffer(): void {
    while (this.reorderBuffer.has(this.expectedSequence)) {
      const packet = this.reorderBuffer.get(this.expectedSequence)!;
      this.reorderBuffer.delete(this.expectedSequence);
      this.processSamples(packet.samples);
      this.expectedSequence = (this.expectedSequence + 1) & 0xffff;
      this.lastSequence = packet.sequenceNumber;
    }
  }

  /**
   * Detect and handle packet loss
   */
  private detectPacketLoss(): void {
    if (this.reorderBuffer.size === 0) {
      return;
    }

    const now = Date.now();

    // Check if oldest buffered packet has been waiting too long
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const packet of this.reorderBuffer.values()) {
      if (packet.receivedAt < oldestTime) {
        oldestTime = packet.receivedAt;
      }
    }

    if (now - oldestTime > this.bufferTimeMs) {
      // Assume packets before the oldest buffered packet are lost
      const oldestSeq = Math.min(...Array.from(this.reorderBuffer.keys()));
      const lostCount = this.countLostPackets(this.expectedSequence, oldestSeq);

      if (lostCount > 0) {
        logger.warn(
          `Detected ${lostCount} lost packets (${this.expectedSequence} to ${oldestSeq})`
        );
        this.packetsLost += lostCount;

        // Fill gap with silence
        this.fillSilence(lostCount);

        // Move expected sequence forward
        this.expectedSequence = oldestSeq;
        this.flushReorderBuffer();
      }
    }
  }

  /**
   * Count lost packets between two sequence numbers
   */
  private countLostPackets(from: number, to: number): number {
    if (from === to) {
      return 0;
    }
    const diff = (to - from) & 0xffff;
    return diff > 32768 ? 0 : diff;
  }

  /**
   * Fill gap with silence samples
   */
  private fillSilence(packetCount: number): void {
    const samplesPerPacket = SAMPLES_PER_PACKET * 2; // stereo
    const silenceSamples = new Int16Array(samplesPerPacket * packetCount);
    this.samples.push(silenceSamples);
  }

  /**
   * Process and store samples
   */
  private processSamples(samples: Int16Array): void {
    this.samples.push(samples);
  }

  /**
   * Get current capture statistics
   */
  getStatistics(): CaptureStatistics {
    const durationMs = this.capturing ? Date.now() - this.startTime : 0;
    return {
      packetsReceived: this.packetsReceived,
      packetsReordered: this.packetsReordered,
      packetsLost: this.packetsLost,
      lossRate:
        this.packetsReceived > 0
          ? this.packetsLost / (this.packetsReceived + this.packetsLost)
          : 0,
      durationMs,
    };
  }
}
