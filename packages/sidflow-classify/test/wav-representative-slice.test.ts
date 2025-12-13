import { describe, expect, test } from "bun:test";
import { sliceWavBufferToRepresentativeStart } from "../src/render/wav-postprocess.js";

function generatePcm16Wav(samples: Int16Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = samples.length * bytesPerSample;
  const fileSize = 36 + dataLength;

  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i]!, 44 + i * 2);
  }

  return buffer;
}

describe("sliceWavBufferToRepresentativeStart", () => {
  test("shifts start to a high-energy window (intro-skipping)", () => {
    const sampleRate = 10;
    // 10 seconds total (100 samples). First 5s silent, last 5s loud.
    const samples = new Int16Array(100);
    for (let i = 50; i < 100; i += 1) {
      samples[i] = 1000;
    }

    const wav = generatePcm16Wav(samples, sampleRate);

    const result = sliceWavBufferToRepresentativeStart(wav, {
      maxWindowSeconds: 4,
    });

    expect(result.bytesRemoved).toBeGreaterThan(0);
    expect(result.startSec).toBeGreaterThan(0);

    // The new file should start inside the loud section.
    const firstSample = result.buffer.readInt16LE(44);
    expect(firstSample).toBe(1000);

    // Header sizes should match the buffer length.
    expect(result.buffer.readUInt32LE(4)).toBe(result.buffer.length - 8);
    const dataSize = result.buffer.readUInt32LE(40);
    expect(dataSize).toBe(result.buffer.length - 44);
  });

  test("does nothing when maxWindowSeconds covers the whole file", () => {
    const sampleRate = 10;
    const samples = new Int16Array(20);
    for (let i = 0; i < 20; i += 1) {
      samples[i] = 1000;
    }

    const wav = generatePcm16Wav(samples, sampleRate);
    const result = sliceWavBufferToRepresentativeStart(wav, {
      maxWindowSeconds: 10,
    });

    expect(result.bytesRemoved).toBe(0);
    expect(result.startSec).toBe(0);
    expect(result.buffer.length).toBe(wav.length);
  });
});
