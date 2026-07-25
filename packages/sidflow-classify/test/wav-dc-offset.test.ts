/**
 * The DC blocker applied to every rendered WAV before encoding.
 *
 * It exists because rendered SID audio can carry a large DC component and the
 * amount depends on the engine: measured over a 237-tune sample, reSIDfp sits
 * at 0.001-0.005 full scale while SIDLite reaches 0.11-0.27 on roughly 4% of
 * tunes. DC is inaudible, but it inflates RMS and drags the low spectral bands,
 * so without this the same tune would classify differently depending only on
 * which engine rendered it.
 */

import { describe, expect, it } from "bun:test";

import { removeDcOffset } from "../src/render/wav-renderer.js";

const SAMPLE_RATE = 44100;
const CHANNELS = 2;

function synth(options: {
  freq: number;
  amplitude: number;
  dc: number;
  seconds?: number;
  channels?: number;
}): Int16Array {
  const { freq, amplitude, dc, seconds = 2, channels = CHANNELS } = options;
  const frames = SAMPLE_RATE * seconds;
  const out = new Int16Array(frames * channels);
  for (let frame = 0; frame < frames; frame++) {
    const value = Math.round((amplitude * Math.sin((2 * Math.PI * freq * frame) / SAMPLE_RATE) + dc) * 32767);
    for (let channel = 0; channel < channels; channel++) {
      out[frame * channels + channel] = value;
    }
  }
  return out;
}

function stats(samples: Int16Array) {
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index]! / 32768;
    sum += value;
    sumSquares += value * value;
  }
  const dc = sum / samples.length;
  return { dc, ac: Math.sqrt(Math.max(0, sumSquares / samples.length - dc * dc)) };
}

describe("removeDcOffset", () => {
  it("removes a large DC offset", () => {
    const samples = synth({ freq: 1000, amplitude: 0.5, dc: 0.25 });
    expect(stats(samples).dc).toBeCloseTo(0.25, 3);

    removeDcOffset(samples, SAMPLE_RATE, CHANNELS);

    // Three orders of magnitude below where SIDLite's worst tunes sat.
    expect(Math.abs(stats(samples).dc)).toBeLessThan(0.001);
  });

  it("leaves audible content essentially untouched", () => {
    // The corner is 5 Hz, far below the SID's musical range, so anything a
    // listener or a spectral feature cares about must survive intact.
    for (const freq of [100, 1000, 5000]) {
      const samples = synth({ freq, amplitude: 0.5, dc: 0 });
      const before = stats(samples).ac;
      removeDcOffset(samples, SAMPLE_RATE, CHANNELS);
      const after = stats(samples).ac;
      expect(after / before, `${freq} Hz was attenuated`).toBeGreaterThan(0.99);
    }
  });

  it("removes DC without eating the signal riding on it", () => {
    const samples = synth({ freq: 440, amplitude: 0.4, dc: 0.2 });
    const before = stats(samples).ac;
    removeDcOffset(samples, SAMPLE_RATE, CHANNELS);
    const after = stats(samples);
    expect(Math.abs(after.dc)).toBeLessThan(0.001);
    expect(after.ac / before).toBeGreaterThan(0.99);
  });

  it("filters each channel independently", () => {
    const frames = SAMPLE_RATE;
    const samples = new Int16Array(frames * 2);
    for (let frame = 0; frame < frames; frame++) {
      // Left carries DC, right does not.
      samples[frame * 2] = Math.round((0.3 * Math.sin((2 * Math.PI * 500 * frame) / SAMPLE_RATE) + 0.2) * 32767);
      samples[frame * 2 + 1] = Math.round(0.3 * Math.sin((2 * Math.PI * 500 * frame) / SAMPLE_RATE) * 32767);
    }
    removeDcOffset(samples, SAMPLE_RATE, 2);

    const left: number[] = [];
    const right: number[] = [];
    for (let frame = 0; frame < frames; frame++) {
      left.push(samples[frame * 2]! / 32768);
      right.push(samples[frame * 2 + 1]! / 32768);
    }
    const mean = (xs: number[]) => xs.reduce((sum, value) => sum + value, 0) / xs.length;
    expect(Math.abs(mean(left))).toBeLessThan(0.001);
    expect(Math.abs(mean(right))).toBeLessThan(0.001);
  });

  it("handles empty and mono input without throwing", () => {
    expect(() => removeDcOffset(new Int16Array(0), SAMPLE_RATE, 2)).not.toThrow();

    const mono = synth({ freq: 1000, amplitude: 0.5, dc: 0.25, channels: 1 });
    removeDcOffset(mono, SAMPLE_RATE, 1);
    expect(Math.abs(stats(mono).dc)).toBeLessThan(0.001);
  });

  it("does not clip when the input is already near full scale", () => {
    const samples = synth({ freq: 1000, amplitude: 0.95, dc: 0.04 });
    removeDcOffset(samples, SAMPLE_RATE, CHANNELS);
    for (let index = 0; index < samples.length; index++) {
      expect(samples[index]).toBeGreaterThanOrEqual(-32768);
      expect(samples[index]).toBeLessThanOrEqual(32767);
    }
  });
});
