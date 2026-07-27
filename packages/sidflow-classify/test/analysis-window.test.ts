/**
 * Tests for the analysis window, which decides which part of a tune gets described.
 *
 * The rule it implements, and why: a fixed 15-second intro skip is right for a full-length
 * tune and skips the entirety of a jingle. Measured on HVSC, 16,398 of 87,868 tracks
 * (18.66%) were described by a window that opened after the music had stopped, and 34 of
 * the 58 similarity dimensions became a shared constant across a fifth of the corpus.
 *
 *   under 10s   skip 0, analyse the whole tune — every song is classified, and
 *               sidTraceFrameCount tells a consumer how much evidence each was measured
 *               over so it can filter on that itself
 *   10s         skip 0,    analyse all 10s
 *   20s         skip 7.5s, analyse 12.5s
 *   30s and up  skip 15s,  analyse 15s   (unchanged)
 */

import { describe, expect, test } from "bun:test";

import {
  FULL_SKIP_SECONDS,
  MIN_ANALYSABLE_SECONDS,
  resolveAnalysisWindow,
} from "../src/analysis-window.js";

const SKIP = 15;
const ANALYSIS = 15;
const resolve = (duration: number | undefined) => resolveAnalysisWindow(duration, SKIP, ANALYSIS);

describe("analysis window", () => {
  test("analyses the whole of a tune shorter than ten seconds, rather than dropping it", () => {
    // Every song is classified; a consumer that wants to skip thin evidence can read
    // sidTraceFrameCount. What must NOT happen is a window that opens past the end.
    for (const duration of [9.9, 5, 1.14, 0.5]) {
      const window = resolve(duration);
      expect(window.skipSeconds).toBe(0);
      expect(window.analysisSeconds).toBeCloseTo(duration, 6);
    }
  });

  test("at exactly ten seconds, analyses the whole tune", () => {
    const window = resolve(MIN_ANALYSABLE_SECONDS);
    expect(window.skipSeconds).toBe(0);
    expect(window.analysisSeconds).toBeCloseTo(10, 6);
  });

  test("at twenty seconds, skips 7.5 and analyses the rest", () => {
    const window = resolve(20);
    expect(window.skipSeconds).toBeCloseTo(7.5, 6);
    expect(window.analysisSeconds).toBeCloseTo(12.5, 6);
  });

  test("at thirty seconds and beyond, the configured window is unchanged", () => {
    // The large majority of the corpus. Any change here alters shipped features, so this
    // pins that the fix is confined to short tunes.
    for (const duration of [FULL_SKIP_SECONDS, 45, 120, 600]) {
      const window = resolve(duration);
      expect(window.skipSeconds).toBe(SKIP);
      expect(window.analysisSeconds).toBe(ANALYSIS);
    }
  });

  test("the window never runs past the end of the tune, at any length", () => {
    // The defect in one line: skip + analysis must stay inside the music. Checked from
    // half a second, because every song is now classified.
    for (let duration = 0.5; duration <= 40; duration += 0.5) {
      const window = resolve(duration);
      expect(window.skipSeconds + window.analysisSeconds).toBeLessThanOrEqual(duration + 1e-9);
    }
  });

  test("is continuous, so a one-second difference cannot change the description wholesale", () => {
    // A step function would mean two near-identical tunes get described completely
    // differently, which shows up as spurious dissimilarity.
    let previous = resolve(MIN_ANALYSABLE_SECONDS).skipSeconds;
    for (let duration = MIN_ANALYSABLE_SECONDS; duration <= FULL_SKIP_SECONDS; duration += 0.25) {
      const skip = resolve(duration).skipSeconds;
      expect(skip - previous).toBeLessThan(0.5);
      expect(skip).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = skip;
    }
    expect(previous).toBe(SKIP);
  });

  test("keeps the configured window when the duration is unknown", () => {
    // Guessing "short" would drop real tunes that simply have no Songlengths entry.
    for (const unknown of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const window = resolveAnalysisWindow(unknown as number | undefined, SKIP, ANALYSIS);
      expect(window.skipSeconds).toBe(SKIP);
      expect(window.analysisSeconds).toBe(ANALYSIS);
    }
  });

  test("honours a non-default configured skip", () => {
    // The ramp is defined relative to the configured skip, not hardcoded to 15.
    const window = resolveAnalysisWindow(20, 30, 20);
    expect(window.skipSeconds).toBeCloseTo(15, 6);
    expect(window.analysisSeconds).toBeCloseTo(5, 6);
  });

  test("never returns a non-positive analysis window", () => {
    for (let duration = 0.1; duration <= 30; duration += 0.1) {
      expect(resolve(duration).analysisSeconds).toBeGreaterThan(0);
    }
  });
});
