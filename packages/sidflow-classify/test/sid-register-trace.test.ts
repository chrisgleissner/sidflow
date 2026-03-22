import { describe, expect, it } from "bun:test";

import type { SidWriteTrace } from "@sidflow/libsidplayfp-wasm";

import {
  PAL_CYCLES_PER_SECOND,
  PAL_FRAME_RATE,
  compactSidWriteTraceToFrames,
  normalizeSidTraceClock,
  resolveSidTraceFrameWindow,
} from "../src/sid-register-trace.js";

describe("normalizeSidTraceClock", () => {
  it("defaults ambiguous clocks to PAL for deterministic bucketing", () => {
    expect(normalizeSidTraceClock("Unknown")).toBe("PAL");
    expect(normalizeSidTraceClock("PAL+NTSC")).toBe("PAL");
    expect(normalizeSidTraceClock("PAL")).toBe("PAL");
    expect(normalizeSidTraceClock("NTSC")).toBe("NTSC");
  });
});

describe("resolveSidTraceFrameWindow", () => {
  it("computes frame counts from skip and analysis durations", () => {
    const window = resolveSidTraceFrameWindow({
      clock: "PAL",
      skipSeconds: 15,
      analysisSeconds: 15,
    });

    expect(window.clock).toBe("PAL");
    expect(window.frameRate).toBe(PAL_FRAME_RATE);
    expect(window.skipFrames).toBe(750);
    expect(window.analysisFrames).toBe(750);
    expect(window.cyclesPerFrame).toBeCloseTo(PAL_CYCLES_PER_SECOND / PAL_FRAME_RATE, 6);
  });
});

describe("compactSidWriteTraceToFrames", () => {
  it("carries pre-skip state into the first analysis frame", () => {
    const frameCycles = PAL_CYCLES_PER_SECOND / PAL_FRAME_RATE;
    const traces: SidWriteTrace[] = [
      { sidNumber: 0, address: 0x00, value: 0x34, cyclePhi1: 100 },
      { sidNumber: 0, address: 0x01, value: 0x12, cyclePhi1: 200 },
      { sidNumber: 0, address: 0x18, value: 0x0f, cyclePhi1: 300 },
    ];

    const events = compactSidWriteTraceToFrames(traces, {
      clock: "PAL",
      skipSeconds: 1 / PAL_FRAME_RATE,
      analysisSeconds: 1 / PAL_FRAME_RATE,
    });

    const firstFrameVoice1FreqHi = events.find(
      (event) => event.frame === 0 && event.voice === 1 && event.register === "VOICE1_FREQ_HI",
    );
    expect(firstFrameVoice1FreqHi).toBeDefined();
    expect(firstFrameVoice1FreqHi?.value).toBe(0x12);
    expect(firstFrameVoice1FreqHi?.derivedSignal.frequencyWord).toBe(0x1234);

    const modeVolumeEvents = events.filter((event) => event.frame === 0 && event.register === "MODE_VOLUME");
    expect(modeVolumeEvents).toHaveLength(3);
    expect(modeVolumeEvents.map((event) => event.voice)).toEqual([1, 2, 3]);
    expect(modeVolumeEvents.every((event) => event.derivedSignal.volume === 0x0f)).toBeTrue();
    expect(modeVolumeEvents.every((event) => event.cyclePhi1 === 300)).toBeTrue();
    expect(events.every((event) => event.frame === 0)).toBeTrue();
    expect(events).toHaveLength(33);
    expect(frameCycles).toBeGreaterThan(1);
  });

  it("keeps the last write within a frame", () => {
    const traces: SidWriteTrace[] = [
      { sidNumber: 0, address: 0x04, value: 0x11, cyclePhi1: 100 },
      { sidNumber: 0, address: 0x04, value: 0x41, cyclePhi1: 200 },
    ];

    const events = compactSidWriteTraceToFrames(traces, {
      clock: "PAL",
      skipSeconds: 0,
      analysisSeconds: 1 / PAL_FRAME_RATE,
    });

    const controlEvent = events.find((event) => event.frame === 0 && event.register === "VOICE1_CONTROL");
    expect(controlEvent).toBeDefined();
    expect(controlEvent?.value).toBe(0x41);
    expect(controlEvent?.cyclePhi1).toBe(200);
    expect(controlEvent?.derivedSignal.waveform).toBe("pulse");
    expect(controlEvent?.derivedSignal.gate).toBeTrue();
  });

  it("separates traces by sid number", () => {
    const traces: SidWriteTrace[] = [
      { sidNumber: 0, address: 0x18, value: 0x02, cyclePhi1: 100 },
      { sidNumber: 1, address: 0x18, value: 0x07, cyclePhi1: 120 },
    ];

    const events = compactSidWriteTraceToFrames(traces, {
      clock: "PAL",
      skipSeconds: 0,
      analysisSeconds: 1 / PAL_FRAME_RATE,
    });

    const sid0 = events.filter((event) => event.sidNumber === 0 && event.register === "MODE_VOLUME");
    const sid1 = events.filter((event) => event.sidNumber === 1 && event.register === "MODE_VOLUME");

    expect(sid0).toHaveLength(3);
    expect(sid1).toHaveLength(3);
    expect(sid0.every((event) => event.derivedSignal.volume === 0x02)).toBeTrue();
    expect(sid1.every((event) => event.derivedSignal.volume === 0x07)).toBeTrue();
  });
});