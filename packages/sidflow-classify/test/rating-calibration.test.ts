/**
 * Tests for corpus-quantile calibration of the 1-5 rating scale.
 *
 * The property that matters is not "the numbers changed" but that calibration
 * populates all five levels WITHOUT reordering anything. A mapping that improved
 * occupancy by shuffling tracks would make category stations look diverse while
 * being wrong, which is worse than the collapse it replaced.
 */

import { describe, expect, test } from "bun:test";

import {
  MIN_RECORDS_FOR_RATING_QUANTILES,
  buildRatingQuantiles,
  calibratedRatingFromRaw,
} from "../src/deterministic-ratings.js";

function makeRaw(values: number[]): Array<{ c: number; e: number; m: number }> {
  return values.map((v) => ({ c: v, e: v, m: v }));
}

/** Shannon entropy in bits over the observed level occupancy. */
function entropyBits(levels: number[]): number {
  const counts = new Map<number, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  let h = 0;
  for (const count of counts.values()) {
    const p = count / levels.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

describe("calibratedRatingFromRaw", () => {
  test("assigns each of the five levels across the breakpoints", () => {
    const breaks = [0.2, 0.4, 0.6, 0.8];
    expect(calibratedRatingFromRaw(0.0, breaks)).toBe(1);
    expect(calibratedRatingFromRaw(0.1, breaks)).toBe(1);
    expect(calibratedRatingFromRaw(0.3, breaks)).toBe(2);
    expect(calibratedRatingFromRaw(0.5, breaks)).toBe(3);
    expect(calibratedRatingFromRaw(0.7, breaks)).toBe(4);
    expect(calibratedRatingFromRaw(0.9, breaks)).toBe(5);
    expect(calibratedRatingFromRaw(1.0, breaks)).toBe(5);
  });

  test("is monotone, so it never reorders two tracks", () => {
    const breaks = [0.2, 0.4, 0.6, 0.8];
    let previous = 0;
    for (let raw = 0; raw <= 1; raw += 0.001) {
      const level = calibratedRatingFromRaw(raw, breaks);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  test("stays inside 1..5 for out-of-range input", () => {
    const breaks = [0.2, 0.4, 0.6, 0.8];
    expect(calibratedRatingFromRaw(-5, breaks)).toBe(1);
    expect(calibratedRatingFromRaw(5, breaks)).toBe(5);
  });
});

describe("buildRatingQuantiles", () => {
  test("refuses to calibrate from too few records", () => {
    const tooFew = makeRaw(Array.from({ length: MIN_RECORDS_FOR_RATING_QUANTILES - 1 }, (_, i) => i / 100));
    expect(buildRatingQuantiles(tooFew)).toBeNull();
  });

  test("produces four ascending breakpoints per dimension", () => {
    const quantiles = buildRatingQuantiles(makeRaw(Array.from({ length: 500 }, (_, i) => i / 500)))!;
    for (const dim of ["c", "e", "m"] as const) {
      expect(quantiles[dim].length).toBe(4);
      for (let i = 1; i < 4; i++) expect(quantiles[dim][i]!).toBeGreaterThan(quantiles[dim][i - 1]!);
    }
  });

  test("a uniform corpus is split into five equal fifths", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i / 1000);
    const quantiles = buildRatingQuantiles(makeRaw(values))!;
    const levels = values.map((v) => calibratedRatingFromRaw(v, quantiles.e));
    for (let level = 1; level <= 5; level++) {
      const share = levels.filter((l) => l === level).length / levels.length;
      expect(share).toBeGreaterThan(0.18);
      expect(share).toBeLessThan(0.22);
    }
    expect(entropyBits(levels)).toBeCloseTo(Math.log2(5), 2);
  });

  test("rescues a tightly concentrated corpus, which is the collapse being fixed", () => {
    // The real shape: raw scores clustered hard around 0.5, because each is an
    // average of sigmoids. The uncalibrated mapping puts essentially all of this
    // on level 3.
    let seed = 12345;
    const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x100000000);
    const values = Array.from({ length: 2000 }, () => {
      // Sum of three uniforms / 3: concentrated, symmetric, in a narrow band.
      const concentrated = (random() + random() + random()) / 3;
      return 0.5 + (concentrated - 0.5) * 0.2;
    });

    const uncalibrated = values.map((v) => Math.max(1, Math.min(5, Math.round(1 + 4 * v))));
    expect(new Set(uncalibrated).size).toBeLessThanOrEqual(3);
    expect(entropyBits(uncalibrated)).toBeLessThan(1.2);

    const quantiles = buildRatingQuantiles(makeRaw(values))!;
    const calibrated = values.map((v) => calibratedRatingFromRaw(v, quantiles.e));
    expect(new Set(calibrated).size).toBe(5);
    expect(entropyBits(calibrated)).toBeGreaterThan(2.3);

    // And the rescue must not have reordered anything.
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < Math.min(values.length, i + 40); j++) {
        if (values[i]! < values[j]!) expect(calibrated[i]!).toBeLessThanOrEqual(calibrated[j]!);
        if (values[i]! > values[j]!) expect(calibrated[i]!).toBeGreaterThanOrEqual(calibrated[j]!);
      }
    }
  });

  test("handles a corpus with heavy ties without crashing or inverting", () => {
    // Half the corpus at exactly one value: the breakpoints collide, so levels
    // cannot all be filled. That is a property of the data; it must degrade
    // gracefully rather than produce nonsense.
    const values = [...Array.from({ length: 500 }, () => 0.5), ...Array.from({ length: 500 }, (_, i) => 0.6 + i / 5000)];
    const quantiles = buildRatingQuantiles(makeRaw(values))!;
    const levels = values.map((v) => calibratedRatingFromRaw(v, quantiles.e));
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(5);
    }
    // The tied block must all receive the same level.
    expect(new Set(levels.slice(0, 500)).size).toBe(1);
  });

  test("ignores non-finite scores rather than poisoning the breakpoints", () => {
    const values = Array.from({ length: 200 }, (_, i) => i / 200);
    const withJunk = makeRaw(values);
    withJunk.push({ c: Number.NaN, e: Number.NaN, m: Number.NaN });
    withJunk.push({ c: Number.POSITIVE_INFINITY, e: Number.POSITIVE_INFINITY, m: Number.POSITIVE_INFINITY });
    const quantiles = buildRatingQuantiles(withJunk)!;
    for (const value of quantiles.e) expect(Number.isFinite(value)).toBe(true);
    expect(quantiles.e[3]!).toBeLessThan(1);
  });
});
