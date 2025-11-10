/**
 * Unit tests for SharedArrayBuffer ring buffer.
 */

import { describe, test, expect } from 'bun:test';
import {
  createSABRingBuffer,
  SABRingBufferProducer,
  SABRingBufferConsumer,
} from '@/lib/audio/shared/sab-ring-buffer';

describe('SAB Ring Buffer', () => {
  test('creates buffer with correct alignment', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 1000,
      channelCount: 2,
      blockSize: 128,
    });

    // Should align to 128-frame boundary
    expect(pointers.capacityFrames).toBe(1024); // 1000 rounded up to 8 * 128
    expect(pointers.channelCount).toBe(2);
    expect(pointers.blockSize).toBe(128);
    expect(pointers.buffer).toBeInstanceOf(SharedArrayBuffer);
  });

  test('producer and consumer can write and read', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 512,
      channelCount: 2,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);
    const consumer = new SABRingBufferConsumer(pointers);

    // Initially empty
    expect(producer.getAvailableWrite()).toBe(512 - 128); // Reserve 1 block for safety
    expect(consumer.getAvailableRead()).toBe(0);
    expect(producer.getOccupancy()).toBe(0);

    // Write one block (128 frames stereo = 256 samples)
    const writeData = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      writeData[i] = i / 256; // Linear ramp
    }

    const written = producer.write(writeData);
    expect(written).toBe(128);
    expect(producer.getOccupancy()).toBe(128);
    expect(consumer.getAvailableRead()).toBe(128);

    // Read one block
    const leftChannel = new Float32Array(128);
    const rightChannel = new Float32Array(128);
    const read = consumer.read([leftChannel, rightChannel], 128);

    expect(read).toBe(128);
    expect(consumer.getOccupancy()).toBe(0);

    // Verify de-interleaving
    for (let i = 0; i < 128; i++) {
      expect(leftChannel[i]).toBeCloseTo(writeData[i * 2], 6);
      expect(rightChannel[i]).toBeCloseTo(writeData[i * 2 + 1], 6);
    }
  });

  test('handles wrap-around correctly', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 256,
      channelCount: 2,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);
    const consumer = new SABRingBufferConsumer(pointers);

    // Write and read to advance indices near the end
    const block = new Float32Array(256); // 128 frames * 2 channels

    // Fill with pattern
    for (let i = 0; i < 256; i++) {
      block[i] = Math.sin((i / 256) * Math.PI * 2);
    }

    // Write and read to move indices
    producer.write(block);
    const left1 = new Float32Array(128);
    const right1 = new Float32Array(128);
    consumer.read([left1, right1], 128);

    // Write again (should wrap)
    producer.write(block);

    // Read and verify
    const left2 = new Float32Array(128);
    const right2 = new Float32Array(128);
    const read = consumer.read([left2, right2], 128);

    expect(read).toBe(128);

    // Verify data integrity across wrap
    for (let i = 0; i < 128; i++) {
      expect(left2[i]).toBeCloseTo(block[i * 2], 5);
      expect(right2[i]).toBeCloseTo(block[i * 2 + 1], 5);
    }
  });

  test('enforces block alignment', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 512,
      channelCount: 2,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);
    const consumer = new SABRingBufferConsumer(pointers);

    // Try to write non-aligned size (100 frames = 200 samples)
    const badData = new Float32Array(200);
    expect(() => producer.write(badData)).toThrow(/aligned/);

    // Try to read non-aligned size
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    expect(() => consumer.read([left, right], 100)).toThrow(/aligned/);
  });

  test('handles backpressure when full', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 256,
      channelCount: 2,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);

    // Fill buffer (capacity - 1 block for safety)
    const block = new Float32Array(256); // 128 frames * 2 channels
    producer.write(block); // 128 frames written

    // Try to write more than available
    const written = producer.write(block);
    expect(written).toBe(0); // Should return 0 (backpressure)
  });

  test('handles underrun when empty', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 256,
      channelCount: 2,
      blockSize: 128,
    });

    const consumer = new SABRingBufferConsumer(pointers);

    // Try to read from empty buffer
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    const read = consumer.read([left, right], 128);

    expect(read).toBe(0); // Should return 0 (underrun)
  });

  test('concurrent operations maintain consistency', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 512,
      channelCount: 2,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);
    const consumer = new SABRingBufferConsumer(pointers);

    // Simulate interleaved writes and reads
    const block = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      block[i] = i;
    }

    let totalWritten = 0;
    let totalRead = 0;

    // Write 3 blocks
    for (let i = 0; i < 3; i++) {
      const written = producer.write(block);
      totalWritten += written;
    }

    expect(totalWritten).toBe(384); // 3 * 128

    // Read 2 blocks
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    for (let i = 0; i < 2; i++) {
      const read = consumer.read([left, right], 128);
      totalRead += read;
    }

    expect(totalRead).toBe(256); // 2 * 128

    // Occupancy should be 1 block
    expect(producer.getOccupancy()).toBe(128);
    expect(consumer.getOccupancy()).toBe(128);
  });

  test('mono channel support', () => {
    const pointers = createSABRingBuffer({
      capacityFrames: 256,
      channelCount: 1,
      blockSize: 128,
    });

    const producer = new SABRingBufferProducer(pointers);
    const consumer = new SABRingBufferConsumer(pointers);

    // Write mono data (128 samples = 128 frames)
    const monoData = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      monoData[i] = i / 128;
    }

    producer.write(monoData);

    // Read mono data
    const channel = new Float32Array(128);
    const read = consumer.read([channel], 128);

    expect(read).toBe(128);
    for (let i = 0; i < 128; i++) {
      expect(channel[i]).toBeCloseTo(monoData[i], 6);
    }
  });
});
