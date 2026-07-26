/**
 * Tests for the playroutine features.
 *
 * These describe the behaviour of the code driving the SID rather than the sound it
 * produces, and they turned out to carry more composer signal than everything else
 * combined: one of them separates same-composer pairs from random pairs at 0.7713
 * against 0.7229 for all 24 original dimensions together. The reason is mechanical —
 * a composer reuses a playroutine, so its register-write pattern is effectively that
 * tooling's signature.
 *
 * Because the features are statistics over raw writes, they are checked against
 * synthetic traces with a known driving pattern rather than against golden numbers.
 */

import { describe, expect, test } from "bun:test";

import {
  computeSidPlayroutineFeatures,
  emptySidPlayroutineFeatures,
} from "../src/sid-playroutine-features.js";
import { PAL_CYCLES_PER_SECOND } from "../src/sid-register-trace.js";

const CYCLES_PER_FRAME = PAL_CYCLES_PER_SECOND / 50;
const OPTIONS = { clock: "PAL" as const, skipSeconds: 0, analysisSeconds: 15 };
const FRAMES = 750;

interface Write {
  frame: number;
  address: number;
  value?: number;
  /** Position within the frame, 0..1. */
  offset?: number;
}

function trace(writes: Write[]) {
  return writes.map((w) => ({
    sidNumber: 0,
    address: w.address,
    value: w.value ?? 0,
    cyclePhi1: (w.frame + (w.offset ?? 0.1)) * CYCLES_PER_FRAME,
  }));
}

/** A single-speed driver rewriting the same registers every frame. */
function steadyDriver(addresses: number[], frames = FRAMES): Write[] {
  const writes: Write[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    for (const address of addresses) writes.push({ frame, address });
  }
  return writes;
}

describe("computeSidPlayroutineFeatures", () => {
  test("reports nothing for an empty trace", () => {
    const features = computeSidPlayroutineFeatures({ ...OPTIONS, traces: [] });
    expect(features).toEqual(emptySidPlayroutineFeatures());
  });

  test("counts writes per frame", () => {
    const sparse = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00])) });
    const busy = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x00, 0x01, 0x04, 0x05, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x0f, 0x12, 0x13])),
    });
    expect(busy.sidWritesPerFrame).toBeGreaterThan(sparse.sidWritesPerFrame);
    expect(sparse.sidWritesPerFrame).toBeGreaterThan(0);
  });

  test("attributes writes to the right register group", () => {
    // Voice 1 frequency low/high.
    const frequency = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01])) });
    expect(frequency.sidWriteShareFrequency).toBeCloseTo(1, 6);
    expect(frequency.sidWriteShareControl).toBe(0);

    // Voice 2 control register (0x07 + 4).
    const control = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x0b])) });
    expect(control.sidWriteShareControl).toBeCloseTo(1, 6);

    // Filter cutoff and resonance.
    const filter = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x15, 0x16, 0x17])) });
    expect(filter.sidWriteShareFilter).toBeCloseTo(1, 6);

    // Mode/volume, which is how digi playback drives the chip.
    const volume = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x18])) });
    expect(volume.sidWriteShareVolume).toBeCloseTo(1, 6);
  });

  test("the register-group shares sum to one", () => {
    const features = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x00, 0x02, 0x04, 0x05, 0x15, 0x18])),
    });
    const total =
      features.sidWriteShareFrequency +
      features.sidWriteSharePulseWidth +
      features.sidWriteShareControl +
      features.sidWriteShareEnvelope +
      features.sidWriteShareFilter +
      features.sidWriteShareVolume;
    expect(total).toBeCloseTo(1, 6);
  });

  test("separates a metronomic driver from a bursty one", () => {
    const steady = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01, 0x04])) });

    // Bursty: a big write batch every eighth frame, nothing between.
    const bursty: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 8) {
      for (let i = 0; i < 24; i += 1) bursty.push({ frame, address: i % 0x19 });
    }
    const burstyFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(bursty) });

    expect(steady.sidWriteRateRegularity).toBeGreaterThan(burstyFeatures.sidWriteRateRegularity);
    expect(burstyFeatures.sidSilentFrameRatio).toBeGreaterThan(steady.sidSilentFrameRatio);
    expect(steady.sidSilentFrameRatio).toBeCloseTo(0, 6);
  });

  test("detects a multi-speed driver from writes spread across the frame", () => {
    const single = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01])) });

    // Four calls per frame, one in each quarter.
    const quad: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      for (const offset of [0.05, 0.3, 0.55, 0.8]) {
        quad.push({ frame, address: 0x00, offset });
        quad.push({ frame, address: 0x01, offset });
      }
    }
    const quadFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(quad) });
    expect(quadFeatures.sidMultiSpeedRatio).toBeGreaterThan(single.sidMultiSpeedRatio);
    expect(quadFeatures.sidMultiSpeedRatio).toBeCloseTo(1, 6);
  });

  test("write-spread entropy rises with the number of registers touched", () => {
    const narrow = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01])) });
    const wide = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver(Array.from({ length: 0x19 }, (_, i) => i))),
    });
    expect(wide.sidWriteSpreadEntropy).toBeGreaterThan(narrow.sidWriteSpreadEntropy);
  });

  test("tracks how many voices are gated on", () => {
    // Gate voice 1 only, then all three, and compare the voice-count histograms.
    const one: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) one.push({ frame, address: 0x04, value: 0x11 });
    const oneFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(one) });

    const three: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      three.push({ frame, address: 0x04, value: 0x11 });
      three.push({ frame, address: 0x0b, value: 0x11 });
      three.push({ frame, address: 0x12, value: 0x11 });
    }
    const threeFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(three) });

    expect(oneFeatures.sidVoiceCount1Ratio).toBeGreaterThan(0.9);
    expect(threeFeatures.sidVoiceCount3Ratio).toBeGreaterThan(0.9);
    expect(threeFeatures.sidVoiceCount1Ratio).toBeLessThan(0.1);
  });

  test("every value is finite and within [0, 1]", () => {
    const features = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x00, 0x04, 0x0b, 0x15, 0x18])),
    });
    for (const [name, value] of Object.entries(features)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(name.startsWith("sid")).toBe(true);
    }
  });

  test("ignores writes outside the analysis window", () => {
    // skipSeconds pushes the window past these writes entirely.
    const features = computeSidPlayroutineFeatures({
      clock: "PAL",
      skipSeconds: 10,
      analysisSeconds: 5,
      traces: trace(steadyDriver([0x00, 0x01], 100)),
    });
    expect(features.sidWritesPerFrame).toBe(0);
  });

  test("the empty feature set has the same shape as a computed one", () => {
    const computed = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00])) });
    expect(Object.keys(emptySidPlayroutineFeatures()).sort()).toEqual(Object.keys(computed).sort());
  });
});

describe("driver-shape features", () => {
  test("locates where in the frame the routine runs, and how tightly", () => {
    // A raster-interrupt driver fires at a fixed line every frame; a main-loop
    // driver wanders. Both are properties of the code, not of the music.
    const fixed: Write[] = [];
    const wandering: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      fixed.push({ frame, address: 0x00, offset: 0.2 });
      wandering.push({ frame, address: 0x00, offset: (frame % 10) / 10 });
    }
    const fixedFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(fixed) });
    const wanderingFeatures = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(wandering) });

    expect(fixedFeatures.sidWriteFramePositionMean).toBeCloseTo(0.2, 2);
    expect(fixedFeatures.sidWriteFramePositionSpread).toBeCloseTo(0, 2);
    expect(wanderingFeatures.sidWriteFramePositionSpread).toBeGreaterThan(0.5);
  });

  test("separates a routine that rewrites unchanged values from one that does not", () => {
    // Some drivers blindly restate their whole register set each frame; others only
    // write what changed. Invisible in the sound, characteristic of the code.
    const blind: Write[] = [];
    const sparing: Write[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      blind.push({ frame, address: 0x00, value: 42 });
      sparing.push({ frame, address: 0x00, value: frame % 251 });
    }
    expect(
      computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(blind) }).sidWriteRedundantRatio,
    ).toBeGreaterThan(0.9);
    expect(
      computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(sparing) }).sidWriteRedundantRatio,
    ).toBeLessThan(0.1);
  });

  test("measures how much of the register file is touched", () => {
    const narrow = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01])) });
    const everything = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver(Array.from({ length: 0x19 }, (_, i) => i))),
    });
    expect(everything.sidWriteRegisterCoverage).toBeCloseTo(1, 6);
    expect(narrow.sidWriteRegisterCoverage).toBeCloseTo(2 / 0x19, 4);
  });

  test("write-order entropy separates a fixed walk from a varied one", () => {
    // A driver that always walks freq -> control produces one transition; one that
    // interleaves families produces many.
    const single = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x00, 0x01])) });
    const varied = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x00, 0x04, 0x02, 0x05, 0x15, 0x18, 0x01])),
    });
    expect(varied.sidWriteOrderEntropy).toBeGreaterThan(single.sidWriteOrderEntropy);
  });

  test("attributes voice writes to the right voice and sums to one", () => {
    const voice2Only = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x07, 0x08, 0x0b])),
    });
    expect(voice2Only.sidWriteVoice2Share).toBeCloseTo(1, 6);
    expect(voice2Only.sidWriteVoice1Share).toBe(0);
    expect(voice2Only.sidWriteVoice3Share).toBe(0);

    const balanced = computeSidPlayroutineFeatures({
      ...OPTIONS,
      traces: trace(steadyDriver([0x00, 0x07, 0x0e])),
    });
    const total =
      balanced.sidWriteVoice1Share + balanced.sidWriteVoice2Share + balanced.sidWriteVoice3Share;
    expect(total).toBeCloseTo(1, 6);
    expect(balanced.sidWriteVoice1Share).toBeCloseTo(1 / 3, 4);
  });

  test("filter and volume writes are not attributed to any voice", () => {
    const globalOnly = computeSidPlayroutineFeatures({ ...OPTIONS, traces: trace(steadyDriver([0x15, 0x18])) });
    expect(globalOnly.sidWriteVoice1Share).toBe(0);
    expect(globalOnly.sidWriteVoice2Share).toBe(0);
    expect(globalOnly.sidWriteVoice3Share).toBe(0);
  });
});
