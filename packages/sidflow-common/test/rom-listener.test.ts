import { describe, expect, it } from "bun:test";
import { BufferedDigest, ListenerComparator, LISTENER_WINDOW, spectralDifference } from "../../../scripts/rom-audit/listener.js";
import { createHash } from "node:crypto";
import { assessMask, observationHorizon, validateRecord } from "../../../scripts/rom-audit/methodology.js";
import { censusRecord, engineRun, lane } from "./rom-audit-fixtures.js";

const rate = 48000;
function tone(frames: number, frequency = 440, amplitude = 10000, shift = 0, channel: "both" | "left" | "right" = "both"): Int16Array {
  return Int16Array.from({ length: frames * 2 }, (_, i) => channel === "left" && i % 2 || channel === "right" && !(i % 2) ? 0 :
    Math.round(amplitude * Math.sin(2 * Math.PI * frequency * (Math.floor(i / 2) + shift) / rate)));
}
const writes = (value = 15, offset = 0): Float64Array => new Float64Array([0, 24, value, 1000 + offset]);
function compare(a: Int16Array, b: Int16Array, wa = writes(), wb = writes(14)) {
  const comparator = new ListenerComparator();
  // Different chunk lengths reproduce differing scheduler pull boundaries.
  let x = 0, y = 0;
  while (x < a.length || y < b.length) {
    if (x < a.length) { comparator.append(0, a.subarray(x, x + 178), x ? new Float64Array() : wa); x += 178; }
    if (y < b.length) { comparator.append(1, b.subarray(y, y + 182), y ? new Float64Array() : wb); y += 182; }
    comparator.compare();
  }
  return comparator.finish();
}

describe("listener comparison", () => {
  it("keeps byte-identical hashes when buffering tiny and oversized pulls", () => {
    const bytes = Uint8Array.from({ length: 200003 }, (_, i) => i % 251), digest = new BufferedDigest();
    for (const [start, end] of [[0, 1], [1, 65535], [65535, 65537], [65537, bytes.length]]) digest.update(bytes.subarray(start, end));
    expect(digest.digest()).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("accepts tiny phase/timing shifts, DC changes and quiet differences", () => {
    const a = tone(48000), b = tone(48000, 440, 10000, 12);
    expect(compare(a, b).audible).toBe(false);
    expect(compare(a, Int16Array.from(a, v => v + 300)).audible).toBe(false);
    expect(compare(tone(48000, 440, 10), tone(48000, 880, 10)).audible).toBe(false);
    expect(compare(new Int16Array(96000), new Int16Array(96000)).audible).toBe(false);
  });
  it("does not mistake a constant write offset or pull boundary for changed music", () => {
    const result = compare(tone(48000), tone(48000, 440, 10000, 12), writes(), writes(15, 250));
    expect(result.audible).toBe(false); expect(result.method).toBe("register-equivalent");
  });
  it("detects missing music, a changed pitch, a large volume change and a missing stereo channel", () => {
    const a = tone(48000);
    for (const b of [new Int16Array(a.length), tone(48000, 660), tone(48000, 440, 3000), tone(48000, 440, 10000, 0, "left")]) {
      const result = compare(a, b); expect(result.audible).toBe(true); expect(result.method).toBe("spectral");
    }
    expect(spectralDifference(tone(LISTENER_WINDOW, 10000), tone(LISTENER_WINDOW, 8000))).toBeGreaterThan(0.15);
  });
  it("detects a short missing passage late in a long otherwise matching stream", () => {
    const a = tone(48000 * 4), b = a.slice();
    b.fill(0, 48000 * 2 * 3, 48000 * 2 * 3 + 6000);
    const result = compare(a, b); expect(result.audible).toBe(true); expect(result.firstDifferenceSample).toBeGreaterThan(48000 * 2 * 2);
  });
  it("does not call silent changed or missing writes an audible defect", () => {
    const silence = new Int16Array(48000 * 2);
    expect(compare(silence, silence, writes(), writes(0)).audible).toBe(false);
    expect(compare(silence, silence, writes(), new Float64Array()).audible).toBe(false);
  });
  it("compares queued write streams independently of chunk boundaries", () => {
    const comparator = new ListenerComparator(), pcm = tone(LISTENER_WINDOW);
    comparator.append(0, pcm, new Float64Array([0, 0, 12, 1000, 0, 1, 34, 2000]));
    comparator.append(1, pcm, new Float64Array([0, 0, 12, 1010])); comparator.compare();
    comparator.append(0, pcm, new Float64Array());
    comparator.append(1, pcm, new Float64Array([0, 1, 34, 2010])); comparator.compare();
    expect(comparator.finish().method).toBe("register-equivalent");
  });
});

describe("listener decisions", () => {
  const seconds = 15;
  function run(audible: boolean) {
    return engineRun("sidlite", seconds, { comparison: "listener-v1", lanes: ["full", "none"].map(set => lane(set as "full" | "none", "zero", {
      outcome: audible ? "audible-difference" : "equivalent", listener: { policy: "listener-v1", method: audible ? "spectral" : "register-equivalent",
        windows: Math.ceil(seconds * 48000 / 1024), differentWindows: audible ? 3 : 0, maxDistance: audible ? 1 : 0, maxAbsoluteDifference: audible ? 0.1 : 0, audible, firstDifferenceSample: audible ? 0 : null }
    })) });
  }
  it("returns compatible or incompatible for successful measurements", () => {
    for (const audible of [false, true]) for (const mask of [0, 3]) {
      const measured = run(audible); validateRecord({ ...censusRecord(), runs: [measured] }, ["sidlite"]);
      expect(assessMask(measured, observationHorizon("0:10"), seconds, 48000, mask).state).toBe(audible ? "incompatible" : "compatible");
    }
  });
  it("reserves unknown for invalid/missing measurements and rejects forged listener evidence", () => {
    const measured = run(false); measured.lanes[0]!.listener!.audible = true;
    expect(() => validateRecord({ ...censusRecord(), runs: [measured] }, ["sidlite"])).toThrow("Invalid listener evidence");
    expect(assessMask(undefined, observationHorizon("0:10"), seconds, 48000, 0).state).toBe("unknown");
  });
});

import { benchmarkSample, projectCensus, benchmarkStratum, type BenchmarkCandidate } from "../../../scripts/rom-audit/benchmark-model.js";
describe("corpus-weighted benchmark", () => {
  const candidate = (id: number, seconds: number, kind = "PSID"): BenchmarkCandidate => ({ path: `${id}.sid`, song: 1, sha256: id.toString(16).padStart(64, "0"), seconds, kind });
  it("weights rare expensive strata by corpus size instead of their pilot frequency", () => {
    const jobs = [...Array.from({ length: 1000 }, (_, i) => candidate(i, 15)), ...Array.from({ length: 4 }, (_, i) => candidate(i + 1000, 600, "BASIC"))];
    const sample = benchmarkSample(jobs, 8);
    expect(sample.filter(j => j.kind === "BASIC").length).toBe(4);
    const projection = projectCensus(jobs, sample.map(job => ({ job, seconds: job.kind === "BASIC" ? 100 : 1 })), 4);
    expect(projection.projectedHours).toBeCloseTo(1400 / 4 / 3600);
    expect(projection.budgetHours).toBeCloseTo(projection.projectedHours * 1.15);
    expect(benchmarkSample([...jobs].reverse(), 8)).toEqual(sample);
  });
  it("refuses incomplete strata and invalid inputs", () => {
    const jobs = [candidate(1, 15), candidate(2, 600, "BASIC")];
    expect(() => benchmarkSample(jobs, 1)).toThrow();
    expect(() => projectCensus(jobs, [{ job: jobs[0]!, seconds: 1 }], 2)).toThrow("Unmeasured");
    expect(() => projectCensus(jobs, [], 0)).toThrow();
    expect(benchmarkStratum(candidate(1, 120))).toBe("PSID/30-120");
  });
});

it("uses audio for dense digi writes even when values and millisecond timings match", () => {
  const comparator = new ListenerComparator();
  const packed = Float64Array.from({ length: 8000 }, (_, i) => [0, 24, Math.floor(i / 4) % 16, Math.floor(i / 4) * 250][i % 4]!);
  comparator.append(0, tone(48000, 440), packed);
  comparator.append(1, tone(48000, 660), packed);
  comparator.compare();
  const result = comparator.finish(); expect(result.method).toBe("spectral"); expect(result.audible).toBe(true);
});


it("detects a brief loud missing sound even when only one window differs", () => {
  const a = new Int16Array(LISTENER_WINDOW * 2 * 20), b = a.slice();
  a.set(tone(400, 880), LISTENER_WINDOW * 2 * 10 + 100);
  const result = compare(a, b); expect(result.audible).toBe(true); expect(result.differentWindows).toBe(1);
});

import { createRomEligibilityLookup, romConsumerProfile, romEngineId, romSetId, ROM_DENY_SCHEMA, REFERENCE_ROM_SHA256 } from "../src/rom-eligibility.js";
import { fakeEngine, fixtureHash } from "./rom-audit-fixtures.js";
import { METHODOLOGY } from "../../../scripts/rom-audit/methodology.js";
it("does not transfer an incompatible result to an unmeasured fallback SID model", () => {
  const engine = fakeEngine("sidlite"), profile = romConsumerProfile("sidlite");
  for (const fixed of [0, 1] as const) {
    const lookup = createRomEligibilityLookup({ schema: ROM_DENY_SCHEMA, methodology: METHODOLOGY, engineId: romEngineId(engine, profile), romSetId: romSetId(),
      entries: { [fixtureHash]: [[0, 9, 0, 0, fixed]] } }, { ...engine, profile, methodology: METHODOLOGY, fallbackSidModel: "MOS6581" });
    for (const supplied of [false, true]) expect(lookup(fixtureHash, 1, { kernal: supplied ? REFERENCE_ROM_SHA256.kernal : null,
      basic: supplied ? REFERENCE_ROM_SHA256.basic : null, chargen: null }).state).toBe(fixed ? "incompatible" : "unknown");
  }
});

import { verifyPilotPopulation } from "../../../scripts/rom-audit/harden.js";
it("refuses to qualify a clean but incomplete reviewed pilot", () => {
  const headers = [{ path: "a.sid", sha256: fixtureHash }], selection = [{ path: "a.sid", song: 1 }, { path: "a.sid", song: 2 }];
  const rows = new Map([[`${fixtureHash}#1`, censusRecord(15, 1)]]);
  expect(() => verifyPilotPopulation(selection, headers, rows)).toThrow("complete reviewed selection");
  rows.set(`${fixtureHash}#2`, censusRecord(15, 2));
  expect(() => verifyPilotPopulation(selection, headers, rows)).not.toThrow();
  expect(() => verifyPilotPopulation([selection[0]!, selection[0]!], headers, rows)).toThrow();
});

it("detects a missing or changed quiet melody above a loud bass", () => {
  const bass = tone(48000, 110), lead = tone(48000, 880, 1000);
  const reference = Int16Array.from(bass, (value, i) => value + lead[i]!);
  expect(compare(reference, bass).audible).toBe(true);
  const changed = tone(48000, 660, 1000);
  expect(compare(reference, Int16Array.from(bass, (value, i) => value + changed[i]!)).audible).toBe(true);
  const shiftedBass = tone(48000, 110, 10000, 12), shiftedLead = tone(48000, 880, 1000, 12);
  expect(compare(reference, Int16Array.from(shiftedBass, (value, i) => value + shiftedLead[i]!)).audible).toBe(false);
});

it("accepts small time shifts in sawtooth and noise waveforms", () => {
  const frames = 48000, shifted = 12;
  const saw = Int16Array.from({ length: (frames + shifted) * 2 }, (_, i) => ((Math.floor(i / 2) * 440 / rate) % 1 - 0.5) * 16000);
  expect(compare(saw.subarray(0, frames * 2), saw.subarray(shifted * 2)).audible).toBe(false);
  let state = 123456;
  const noise = new Int16Array((frames + shifted) * 2);
  for (let i = 0; i < noise.length; i += 2) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; noise[i] = noise[i + 1] = (state & 16383) - 8192; }
  expect(compare(noise.subarray(0, frames * 2), noise.subarray(shifted * 2)).audible).toBe(false);
});

it("judges silence after a decoder stop by the reference audio, including held notes", () => {
  for (const missingMusic of [false, true]) {
    const comparator = new ListenerComparator(), initial = tone(24000);
    comparator.append(0, initial, writes()); comparator.append(1, initial, writes()); comparator.compare();
    comparator.forceAudio();
    comparator.append(0, missingMusic ? tone(24000) : new Int16Array(48000), new Float64Array());
    comparator.append(1, new Int16Array(48000), new Float64Array()); comparator.compare();
    expect(comparator.finish().audible).toBe(missingMusic);
  }
});

it("does not invent an audible click from DC padding in a partial final window", () => {
  expect(compare(new Int16Array(48000 * 2).fill(-10000), new Int16Array(48000 * 2)).audible).toBe(false);
});
