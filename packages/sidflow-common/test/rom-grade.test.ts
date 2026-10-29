import { describe, expect, it } from "bun:test";
import { gradeFromQuality, NO_PLAYBACK_Q } from "../../../scripts/rom-grade/grade-core.js";
import { severityFromSources, type PcmSource } from "../../../scripts/rom-grade/audio-severity.js";
import {
  SeverityStats, WINDOW_FRAMES, WindowAssembler, qualityFromSummary, windowSeverity,
} from "../../../scripts/rom-grade/severity-core.js";
import {
  NTSC_CLOCK_HZ, PAL_CLOCK_HZ, alignWrites, bSubclassOf, computeTraceFeatures, lcsMyers, toleranceCycles, traceFromFlat, traceGrade,
  type Trace, type TraceFeatures,
} from "../../../scripts/rom-grade/trace-core.js";

type W = [number, number, number, number];
const trace = (writes: W[], complete = true, error = ""): Trace => traceFromFlat(writes.flat(), complete, error);
/** n writes, one every `gap` cycles starting at `start`, value pattern depends on the index. */
function song(n: number, gap = 900, start = 20000, valueOf = (i: number): number => (i * 7) & 0xff): W[] {
  return Array.from({ length: n }, (_, i): W => [0, i % 25, valueOf(i), start + i * gap]);
}
const HORIZON = 1; // second -> 985,248 cycles, so 1000 writes at 900 cycles cover 91%
const features = (reference: Trace, variant: Trace, clockHz = PAL_CLOCK_HZ): TraceFeatures =>
  computeTraceFeatures(reference, variant, { clockHz, horizonSeconds: HORIZON });
const shifted = (writes: W[], delta: (i: number) => number): W[] => writes.map(([c, a, v, t], i): W => [c, a, v, t + delta(i)]);

describe("trace classes", () => {
  const reference = song(1000);
  it("A: bit-exact", () => {
    const f = features(trace(reference), trace(reference));
    expect(f.cls).toBe("A");
    expect(f.bitExact).toBe(true);
    expect(traceGrade(f, 1970)).toBe(255);
  });
  it("B: re-timed only, split by drift", () => {
    const small = features(trace(reference), trace(shifted(reference, i => 13 + (i % 3) * 10)));
    expect(small.cls).toBe("B");
    expect(small.bSubclass).toBe("<=63cyc");
    expect(small.valueSequenceIdentical).toBe(true);
    expect(small.startOffsetCycles).toBe(13);
    expect(small.maxDriftCycles).toBe(20);
    const ms1 = features(trace(reference), trace(shifted(reference, i => (i % 2) * 900)));
    expect(ms1.bSubclass).toBe("<=1ms");
    const ms2 = features(trace(reference), trace(shifted(reference, i => (i % 2) * 1900)));
    expect(ms2.bSubclass).toBe("<=2ms");
    const late = features(trace(reference), trace(shifted(reference, i => (i % 2) * 3000)));
    expect(late.cls).toBe("B");
    expect(late.bSubclass).toBe(">2ms");
    expect(traceGrade(small, 1970)).toBe(254);
    expect(traceGrade(ms2, 1970)).toBe(254);
    expect(traceGrade(late, 1970)).toBeNull();
  });
  it("tolerance boundary is inclusive and clock dependent", () => {
    expect(toleranceCycles(PAL_CLOCK_HZ)).toBe(1970);
    expect(toleranceCycles(NTSC_CLOCK_HZ)).toBe(2045);
    const exact = features(trace(reference), trace(shifted(reference, i => (i % 2) * 1970)));
    const over = features(trace(reference), trace(shifted(reference, i => (i % 2) * 1971)));
    expect(traceGrade(exact, 1970)).toBe(254);
    expect(traceGrade(over, 1970)).toBeNull();
    expect(bSubclassOf(63, PAL_CLOCK_HZ)).toBe("<=63cyc");
    expect(bSubclassOf(64, PAL_CLOCK_HZ)).toBe("<=1ms");
  });
  it("a constant start offset is removed before drift is measured, also at the horizon cut", () => {
    const f = features(trace(reference), trace(shifted(reference, () => 5000)));
    expect(f.startOffsetCycles).toBe(5000);
    expect(f.maxDriftCycles).toBe(0);
    expect(f.cls).toBe("B");
    expect(f.bSubclass).toBe("<=63cyc");
  });
  it("C: identical values plus a few missing or extra trailing writes", () => {
    const missing = features(trace(reference), trace(reference.slice(0, 997)));
    expect(missing.cls).toBe("C");
    const extra = features(trace(reference), trace([...reference, [0, 1, 2, 950000], [0, 1, 3, 950900]]));
    expect(extra.cls).toBe("C");
    expect(extra.rule).toBe("trailing-writes");
    // an interior insertion or deletion is the same music with one write more or less
    const inserted = [...reference.slice(0, 100), [0, 7, 7, reference[100]![3] - 1] as W, ...reference.slice(100)];
    const interior = features(trace(reference), trace(inserted));
    expect(interior.cls).toBe("C");
    expect(interior.rule).toBe("few-extra-or-missing-writes");
    expect(features(trace(reference), trace(reference.filter((_, i) => i !== 500))).cls).toBe("C");
    // but 5% of the writes missing is not "a few"
    expect(features(trace(reference), trace(reference.filter((_, i) => i % 20 !== 3))).cls).not.toBe("C");
  });
  it("D: value divergence early with near-equal write count", () => {
    const variant = reference.map(([c, a, v, t], i): W => i >= 100 && i % 3 === 0 ? [c, a, (v + 1) & 0xff, t] : [c, a, v, t]);
    const f = features(trace(reference), trace(variant));
    expect(f.cls).toBe("D");
    expect(f.matchingValuePrefix).toBe(102);
    expect(f.alignmentSimilarity).toBeGreaterThan(0.6);
  });
  it("E: early divergence with substantially different music", () => {
    const variant = song(500, 1800, 20000, i => (i * 13 + 5) & 0xff);
    const f = features(trace(reference), trace(variant));
    expect(f.cls).toBe("E");
    expect(f.firstValueDivergenceSeconds!).toBeLessThan(0.1);
  });
  it("E: near-equal counts but unrelated values are different music, not D", () => {
    const unrelated = reference.map(([c, a, v, t]): W => [c, a, (v * 5 + 3) & 0xff ^ 0x55, t]);
    const f = features(trace(reference), trace(unrelated));
    expect(f.cls).toBe("E");
    expect(f.alignmentSimilarity).toBeLessThan(0.5);
  });
  it("F: late divergence (more than half the horizon plays identically)", () => {
    const variant = reference.map(([c, a, v, t], i): W => i >= 800 ? [c, a, (v + 9) & 0xff, t] : [c, a, v, t]);
    const f = features(trace(reference), trace(variant));
    expect(f.cls).toBe("F");
    expect(f.firstValueDivergenceSeconds!).toBeGreaterThan(0.5);
    // Variant stops in the second half: still F, the first half is intact
    expect(features(trace(reference), trace(reference.slice(0, 700))).cls).toBe("F");
  });
  it("G: only initialisation writes", () => {
    expect(features(trace(reference), trace(reference.slice(0, 1))).cls).toBe("G");
    expect(features(trace(reference), trace([])).cls).toBe("G");
    expect(features(trace(reference), trace(reference.slice(0, 25))).cls).toBe("G");
    // a reference that is itself nearly empty is not a no-playback case
    expect(features(trace(reference.slice(0, 10)), trace(reference.slice(0, 5))).cls).not.toBe("G");
  });
  it("H: CPU jam partway through", () => {
    const halted = trace(reference.slice(0, 300), true, "Illegal instruction $02 at address $bf54");
    const f = features(trace(reference), halted);
    expect(f.cls).toBe("H");
    expect(traceGrade(f, 1970)).toBeNull();
    // a jam after more than half of the horizon has played identically is late divergence
    const late = features(trace(reference), trace(reference.slice(0, 800), true, "Illegal instruction $02 at address $bf54"));
    expect(late.cls).toBe("F");
    // identical failure in the reference is not a variant defect
    const both = features(trace(reference.slice(0, 300), true, "Illegal instruction $02 at address $bf54"), halted);
    expect(both.cls).toBe("A");
    expect(traceGrade(both, 1970)).toBe(255);
  });
  it("I: identical values with cumulative drift (tempo change)", () => {
    const slow = features(trace(reference), trace(shifted(reference, i => Math.round(i * 40))));
    expect(slow.cls).toBe("I");
    expect(slow.finalDriftCycles).toBe(39960);
    const jitter = features(trace(reference), trace(shifted(reference, i => (i % 2) * 5000)));
    expect(jitter.cls).toBe("B");
  });
  it("tempo change that shortens the variant by horizon truncation is still I", () => {
    const slow = shifted(reference, i => Math.round(i * 40)).filter(w => w[3] <= HORIZON * PAL_CLOCK_HZ + 40000);
    expect(features(trace(reference), trace(slow)).cls).toBe("I");
  });
  it("X: truncated traces and engine errors carry no claim from the trace", () => {
    const truncated = features(trace(reference, false), trace(reference, false));
    expect(truncated.cls).toBe("X");
    expect(truncated.rule).toBe("trace-truncated");
    expect(traceGrade(truncated, 1970)).toBeNull();
    expect(features(trace(reference), trace(reference, true, "64 consecutive empty renders")).cls).toBe("X");
  });
  it("NTSC: horizon cycles follow the clock", () => {
    const late = song(1000, 1000, 20000);
    // 1,000 writes at 1,000 cycles; at the NTSC clock 1 s is 1,022,727 cycles so all are inside the horizon
    expect(computeTraceFeatures(trace(late), trace(late), { clockHz: NTSC_CLOCK_HZ, horizonSeconds: 1 }).referenceWrites).toBe(1000);
    expect(computeTraceFeatures(trace(late), trace(late), { clockHz: PAL_CLOCK_HZ, horizonSeconds: 0.5 }).referenceWrites).toBe(473);
  });
  it("digi playback is flagged from $D418 density", () => {
    const burst: W[] = Array.from({ length: 300 }, (_, i): W => [0, 24, i & 15, 10000 + i * 100]);
    expect(features(trace(burst), trace(burst)).referenceDigi).toBe(true);
    expect(features(trace(reference), trace(reference)).referenceDigi).toBe(false);
  });
  it("features are deterministic", () => {
    const variant = reference.map(([c, a, v, t], i): W => i % 11 === 0 ? [c, a, (v + 1) & 0xff, t + 3] : [c, a, v, t + 3]);
    expect(JSON.stringify(features(trace(reference), trace(variant)))).toBe(JSON.stringify(features(trace(reference), trace(variant))));
  });
});

describe("alignment similarity", () => {
  const symbols = (n: number, seed: number): Trace => {
    let x = seed;
    const writes: W[] = [];
    for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; writes.push([0, (x >>> 8) & 31, (x >>> 16) & 255, i * 50]); }
    return trace(writes);
  };
  it("identical, one deletion, empty and disjoint", () => {
    const base = song(200);
    expect(alignWrites(trace(base), trace(base), 0)).toEqual({ matched: 200, exact: true });
    expect(alignWrites(trace(base), trace(base.filter((_, i) => i !== 77)), 0).matched).toBe(199);
    expect(alignWrites(trace([]), trace(base), 0).matched).toBe(0);
    expect(alignWrites(trace(base), trace([]), 0).matched).toBe(0);
    const other = song(200, 900, 20000, i => 200 + (i & 31));
    const disjoint = alignWrites(trace(base.map(([c, a, v, t]): W => [c, a, v & 15, t])), trace(other.map(([c, , v, t]): W => [c, 30, v, t])), 0);
    expect(disjoint.matched).toBe(0);
  });
  it("is order preserving: a reversed sequence matches only a monotone subsequence", () => {
    const a = trace([0, 1, 2, 3, 4, 5].map((v, i): W => [0, 1, v, i * 10]));
    const b = trace([5, 4, 3, 2, 1, 0].map((v, i): W => [0, 1, v, i * 10]));
    expect(alignWrites(a, b, 0).matched).toBe(1);
    expect(lcsMyers(a.sym, 0, 6, b.sym, 0, 6, 100, { steps: 1e6 })).toBe(1);
  });
  it("matches the textbook LCS on random small inputs", () => {
    const lcs = (x: Uint32Array, y: Uint32Array): number => {
      const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
      for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
        dp[i]![j] = x[i - 1] === y[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      return dp[x.length]![y.length]!;
    };
    for (let seed = 1; seed <= 25; seed++) {
      const a = symbols(60, seed), b = symbols(55, seed * 31 + 7);
      // restrict the alphabet so matches are plentiful
      for (const t of [a, b]) for (let i = 0; i < t.sym.length; i++) t.sym[i] = t.sym[i]! & 0x1f03;
      expect(alignWrites(a, b, 0).matched).toBe(lcs(a.sym, b.sym));
    }
  });
  it("scales to two million writes: sparse edits are exact and fast", () => {
    const n = 2_000_000, a = symbols(n, 42);
    const keep: W[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 20011 === 5) continue; // ~100 deletions
      keep.push([0, (a.sym[i]! >> 8) & 31, a.sym[i]! & 255, a.cycle[i]!]);
      if (i % 30011 === 9) keep.push([0, 3, 99, a.cycle[i]! + 1]); // ~66 insertions
    }
    const b = trace(keep);
    const started = performance.now();
    const result = alignWrites(a, b, 0);
    const elapsed = performance.now() - started;
    expect(result.exact).toBe(true);
    expect(result.matched).toBeGreaterThan(n - 200);
    expect(result.matched).toBeLessThanOrEqual(n - 99);
    expect(elapsed).toBeLessThan(10000);
  });
  it("total divergence of two million writes returns a bounded lower bound quickly", () => {
    const n = 2_000_000, a = symbols(n, 1);
    const b = symbols(n, 2);
    // make the first half identical
    for (let i = 0; i < n / 2; i++) { b.sym[i] = a.sym[i]!; }
    const started = performance.now();
    const result = alignWrites(a, b, 0);
    const elapsed = performance.now() - started;
    expect(result.matched).toBeGreaterThanOrEqual(n / 2);
    expect(result.matched / n).toBeLessThan(0.75);
    expect(elapsed).toBeLessThan(20000);
  });
});

describe("window severity", () => {
  const rate = 48000;
  function tone(frames: number, frequency = 440, amplitude = 8000, shift = 0): Int16Array {
    return Int16Array.from({ length: frames * 2 }, (_, i) => Math.round(amplitude * Math.sin(2 * Math.PI * frequency * (Math.floor(i / 2) + shift) / rate)));
  }
  /** a few harmonics, like a SID pulse voice */
  function voice(frames: number, f0: number, shift = 0): Int16Array {
    return Int16Array.from({ length: frames * 2 }, (_, i) => {
      const t = (Math.floor(i / 2) + shift) / rate;
      let sample = 0;
      for (let h = 1; h <= 9; h += 2) sample += Math.sin(2 * Math.PI * f0 * h * t) / h;
      return Math.round(7000 * sample);
    });
  }
  const frames = WINDOW_FRAMES * 4;
  it("identical windows score 0", () => { expect(windowSeverity(tone(WINDOW_FRAMES), tone(WINDOW_FRAMES))).toBe(0); });
  it("a tone against silence scores 1, in both directions of normalisation", () => {
    expect(windowSeverity(tone(WINDOW_FRAMES), new Int16Array(WINDOW_FRAMES * 2))).toBe(1);
    expect(windowSeverity(tone(WINDOW_FRAMES, 440, 300), new Int16Array(WINDOW_FRAMES * 2))).toBe(1);
  });
  it("a quiet window on both sides is skipped", () => {
    expect(windowSeverity(new Int16Array(WINDOW_FRAMES * 2), new Int16Array(WINDOW_FRAMES * 2))).toBeNull();
    expect(windowSeverity(tone(WINDOW_FRAMES, 440, 20), tone(WINDOW_FRAMES, 440, 20))).toBeNull(); // -64 dBFS
  });
  it("a small phase shift scores near 0", () => {
    expect(windowSeverity(voice(WINDOW_FRAMES, 220), voice(WINDOW_FRAMES, 220, 1))).toBeLessThan(0.02);
    expect(windowSeverity(voice(WINDOW_FRAMES, 220), voice(WINDOW_FRAMES, 220, 3))).toBeLessThan(0.05);
  });
  it("a different pitch scores high", () => {
    expect(windowSeverity(voice(WINDOW_FRAMES, 220), voice(WINDOW_FRAMES, 330))).toBeGreaterThan(0.6);
  });
  it("a missing voice scores about half", () => {
    const two = Int16Array.from(voice(WINDOW_FRAMES, 220), (v, i) => v + voice(WINDOW_FRAMES, 1000)[i]!);
    const severity = windowSeverity(two, voice(WINDOW_FRAMES, 220))!;
    expect(severity).toBeGreaterThan(0.2);
    expect(severity).toBeLessThan(0.9);
  });
  it("half of the windows missing gives mean severity about 0.5 (stream)", async () => {
    const reference = tone(frames);
    const variant = Int16Array.from(reference, (v, i) => i < reference.length / 2 ? v : 0);
    const stats = new SeverityStats();
    const assembler = [new WindowAssembler(), new WindowAssembler()];
    assembler[0]!.push(reference); assembler[1]!.push(variant);
    for (let w = 0; w < 4; w++) stats.add(windowSeverity(assembler[0]!.take()!, assembler[1]!.take()!));
    const summary = stats.summary();
    expect(summary.mean).toBe(0.5);
    expect(summary.q).toBe(0.5);
    expect(summary.max).toBe(1);
    expect(summary.median).toBe(0.5);
    expect(gradeFromQuality(qualityFromSummary(summary))).toBe(127);
  });
  it("streams of unequal chunking reach the same severity, and an early-ending source is silence", async () => {
    const reference = tone(frames * 2);
    const source = (pcm: Int16Array, chunk: number, halted = false): PcmSource => {
      let at = 0;
      return { halted, next: async () => { if (at >= pcm.length) return null; const out = pcm.subarray(at, at + chunk); at += chunk; return out; } };
    };
    const seconds = frames * 2 / rate;
    const [same] = await severityFromSources(source(reference, 4000), [source(reference, 177)], seconds);
    expect(same!.summary.mean).toBe(0);
    expect(same!.summary.windows).toBe(8);
    const [stopped] = await severityFromSources(source(reference, 4096), [source(reference.subarray(0, reference.length / 2), 999, true)], seconds);
    expect(stopped!.summary.mean).toBe(0.5);
    expect(stopped!.halted).toBe(true);
  });
  it("is deterministic", () => {
    const a = voice(WINDOW_FRAMES, 220), b = voice(WINDOW_FRAMES, 223, 2);
    expect(windowSeverity(a, b)).toBe(windowSeverity(a, b));
  });
});

describe("grade mapping", () => {
  it("maps quality to 0..253 with the no-playback floor at 1/506", () => {
    expect(gradeFromQuality(1)).toBe(253);
    expect(gradeFromQuality(0)).toBe(0);
    expect(gradeFromQuality(NO_PLAYBACK_Q - 1e-9)).toBe(0);
    expect(gradeFromQuality(NO_PLAYBACK_Q)).toBe(1);
    expect(gradeFromQuality(0.002)).toBe(1);
    expect(gradeFromQuality(0.5)).toBe(127);
    expect(gradeFromQuality(0.999)).toBe(253);
    expect(gradeFromQuality(1 - 0.5 / 253 - 1e-9)).toBe(252);
    expect(gradeFromQuality(1 - 0.5 / 253 + 1e-9)).toBe(253);
    expect(gradeFromQuality(-1)).toBe(0);
    expect(gradeFromQuality(2)).toBe(253);
    expect(() => gradeFromQuality(Number.NaN)).toThrow();
  });
  it("is monotone non-decreasing in quality", () => {
    let previous = -1;
    for (let q = 0; q <= 1; q += 0.0005) { const g = gradeFromQuality(q); expect(g).toBeGreaterThanOrEqual(previous); previous = g; }
  });
  it("gamma is applied through qualityFromSummary", () => {
    const summary = { q: 0.5 } as Parameters<typeof qualityFromSummary>[0];
    expect(qualityFromSummary(summary, 2)).toBe(0.25);
    expect(gradeFromQuality(qualityFromSummary(summary, 2))).toBe(63);
  });
});
