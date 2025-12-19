import { describe, expect, test } from "bun:test";
import { estimateBpmAutocorr } from "../src/bpm-estimator.js";

function makeClickTrack(sampleRate: number, durationSec: number, bpm: number): Float32Array {
  const total = Math.max(1, Math.floor(sampleRate * durationSec));
  const audio = new Float32Array(total);
  const beatSec = 60 / bpm;
  const clickSamples = Math.max(1, Math.floor(sampleRate * 0.003));

  for (let t = 0; t < durationSec; t += beatSec) {
    const start = Math.floor(t * sampleRate);
    for (let i = 0; i < clickSamples && start + i < total; i++) {
      audio[start + i] = 1;
    }
  }

  return audio;
}

describe("estimateBpmAutocorr", () => {
  test("recovers BPM for a simple click track", () => {
    const sampleRate = 11025;
    const audio = makeClickTrack(sampleRate, 10, 120);
    const est = estimateBpmAutocorr(audio, sampleRate);
    expect(est).not.toBeNull();
    expect(est!.bpm).toBeGreaterThan(110);
    expect(est!.bpm).toBeLessThan(130);
    expect(est!.confidence).toBeGreaterThan(0.2);
  });

  test("returns null for too-short audio", () => {
    const sampleRate = 11025;
    const audio = makeClickTrack(sampleRate, 0.2, 120);
    const est = estimateBpmAutocorr(audio, sampleRate);
    expect(est).toBeNull();
  });
});
