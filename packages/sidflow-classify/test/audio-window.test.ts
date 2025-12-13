/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";

import { encodePcmToWav } from "../src/render/wav-renderer.js";
import { resolveRepresentativeAnalysisWindow, type WavPcmInfo } from "../src/audio-window.js";

function makeMonoPcm(sampleRate: number, durationSec: number, value: number): Int16Array {
  const length = Math.floor(sampleRate * durationSec);
  const samples = new Int16Array(length);
  samples.fill(value);
  return samples;
}

describe("resolveRepresentativeAnalysisWindow", () => {
  it("returns start=0 when audio is shorter than max window", () => {
    const sampleRate = 8000;
    const samples = makeMonoPcm(sampleRate, 1.0, 1000);
    const wav = encodePcmToWav(samples, sampleRate, 1);

    const header: WavPcmInfo = {
      numChannels: 1,
      sampleRate,
      bitsPerSample: 16,
      dataStart: 44,
      dataLength: samples.length * 2,
    };

    const window = resolveRepresentativeAnalysisWindow(wav, header, 2);
    expect(window.startSample).toBe(0);
    expect(window.startSec).toBe(0);
    expect(window.durationSec).toBeCloseTo(1.0, 3);
  });

  it("prefers a later, higher-energy fragment (skips intro when possible)", () => {
    const sampleRate = 8000;

    // 30s total: 0-10s silent, 10-30s loud.
    // Default introSkipSec is 10s, so the representative window should start at >= 10s.
    const silent = makeMonoPcm(sampleRate, 10.0, 0);
    const loud = makeMonoPcm(sampleRate, 20.0, 12000);

    const combined = new Int16Array(silent.length + loud.length);
    combined.set(silent, 0);
    combined.set(loud, silent.length);

    const wav = encodePcmToWav(combined, sampleRate, 1);

    const header: WavPcmInfo = {
      numChannels: 1,
      sampleRate,
      bitsPerSample: 16,
      dataStart: 44,
      dataLength: combined.length * 2,
    };

    const window = resolveRepresentativeAnalysisWindow(wav, header, 10);

    expect(window.durationSec).toBeCloseTo(10.0, 2);
    expect(window.startSec).toBeGreaterThanOrEqual(9.5);
  });

  it("clamps intro skip when the song is too short", () => {
    const sampleRate = 8000;

    // 15s total, request 10s window and 10s intro skip.
    // Only 5s are available as a start offset (15 - 10), so skip must clamp to <= 5s.
    const silent = makeMonoPcm(sampleRate, 5.0, 0);
    const loud = makeMonoPcm(sampleRate, 10.0, 12000);

    const combined = new Int16Array(silent.length + loud.length);
    combined.set(silent, 0);
    combined.set(loud, silent.length);

    const wav = encodePcmToWav(combined, sampleRate, 1);

    const header: WavPcmInfo = {
      numChannels: 1,
      sampleRate,
      bitsPerSample: 16,
      dataStart: 44,
      dataLength: combined.length * 2,
    };

    const window = resolveRepresentativeAnalysisWindow(wav, header, 10, 10);
    expect(window.durationSec).toBeCloseTo(10.0, 2);
    expect(window.startSec).toBeLessThanOrEqual(5.1);
  });
});
