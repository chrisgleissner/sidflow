import { describe, expect, test } from "bun:test";
import { trimLeadingSilenceWavBuffer } from "../src/render/wav-postprocess.js";

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

describe("trimLeadingSilenceWavBuffer", () => {
  test("removes a short leading silent prefix", () => {
    const sampleRate = 10;
    // 1 second silence (10 samples), then signal
    const samples = new Int16Array(20);
    for (let i = 10; i < 20; i += 1) {
      samples[i] = 1000;
    }

    const wav = generatePcm16Wav(samples, sampleRate);
    const trimmed = trimLeadingSilenceWavBuffer(wav, { maxTrimSeconds: 2, threshold: 1e-4 });

    expect(trimmed.length).toBeLessThan(wav.length);

    // First sample should now be non-zero
    const firstSample = trimmed.readInt16LE(44);
    expect(Math.abs(firstSample)).toBeGreaterThan(0);
  });

  test("does not trim when audio starts immediately", () => {
    const sampleRate = 10;
    const samples = new Int16Array(10);
    samples[0] = 1000;
    for (let i = 1; i < 10; i += 1) {
      samples[i] = 1000;
    }

    const wav = generatePcm16Wav(samples, sampleRate);
    const trimmed = trimLeadingSilenceWavBuffer(wav, { maxTrimSeconds: 2, threshold: 1e-4 });

    expect(trimmed.length).toBe(wav.length);
  });
});
