/** Pure SID write-trace comparison for the ROM fidelity grade (see
 * doc/research/hvsc-rom-fidelity-grading.md). No process or file access here.
 *
 * A trace is the ordered list of SID register writes (chip, address, value, PHI1 cycle)
 * produced by one player over the observation horizon. The reference is the same engine
 * with all three authentic ROMs (mask 7); the variant has some ROMs removed.
 */

export const PAL_CLOCK_HZ = 985248;
export const NTSC_CLOCK_HZ = 1022727;

/** Default timing tolerance T for grade 254, in milliseconds of C64 time. */
export const DEFAULT_TOLERANCE_MS = 2;
/** Absolute drift above which an identical-value trace is a tempo change (class I), not jitter (class B). */
export const TEMPO_DRIFT_MS = 10;
/** A start offset larger than this (cycles, ~20 ms) is not treated as a constant shift when aligning the horizon cut. */
export const MAX_ALIGNABLE_OFFSET_CYCLES = 20000;
/** Largest variant write count still considered "only initialisation writes" (SID init clears ~25 registers). */
export const MAX_INIT_WRITES = 32;
/** Fraction of the horizon that must replay identically for "late divergence" (class F). */
export const LATE_DIVERGENCE_FRACTION = 0.5;
/** Minimum min/max write-count ratio for "near-equal write count" (class D). */
export const NEAR_EQUAL_COUNT_RATIO = 0.9;
/** Minimum alignment similarity for class D; below it, an early divergence is "substantially different music" (E). */
export const MIN_SIMILAR_MUSIC = 0.5;

export type TraceClass = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "X";
export type BSubclass = "<=63cyc" | "<=1ms" | "<=2ms" | ">2ms";

export interface Trace {
  /** (chip << 16) | (address << 8) | value */
  sym: Uint32Array;
  /** PHI1 cycle of each write, non-decreasing */
  cycle: Float64Array;
  /** false when the native trace buffer overflowed (writes beyond the cap are lost) */
  complete: boolean;
  error: string;
  /** "" | "cpu-halt" | "engine" | "resource" */
  errorKind: string;
}

export function errorKindOf(error: string): string {
  if (!error) return "";
  return error.startsWith("Illegal instruction $") ? "cpu-halt" : "engine";
}

export function traceFromFlat(flat: ArrayLike<number>, complete: boolean, error: string, errorKind?: string): Trace {
  if (flat.length % 4) throw new Error("Trace length must be a multiple of 4");
  const n = flat.length / 4, sym = new Uint32Array(n), cycle = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const chip = flat[4 * i]!, address = flat[4 * i + 1]!, value = flat[4 * i + 2]!;
    sym[i] = ((chip & 0xffff) << 16) | ((address & 0xff) << 8) | (value & 0xff);
    cycle[i] = flat[4 * i + 3]!;
  }
  return { sym, cycle, complete, error, errorKind: errorKind ?? errorKindOf(error) };
}

export function clockHzOf(clock: "PAL" | "NTSC"): number { return clock === "NTSC" ? NTSC_CLOCK_HZ : PAL_CLOCK_HZ; }
export function toleranceCycles(clockHz: number, toleranceMs = DEFAULT_TOLERANCE_MS): number { return Math.round(clockHz * toleranceMs / 1000); }

/** Index of the first element with cycle >= value (binary search, cycles non-decreasing). */
export function lowerBound(cycle: Float64Array, value: number, lo = 0, hi = cycle.length): number {
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (cycle[mid]! < value) lo = mid + 1; else hi = mid; }
  return lo;
}

function slice(trace: Trace, end: number): Trace {
  return end >= trace.sym.length ? trace : { ...trace, sym: trace.sym.subarray(0, end), cycle: trace.cycle.subarray(0, end) };
}

/** Restrict both traces to the observation horizon. The reference is cut at horizonCycles; the
 * variant is cut at the same time shifted by the constant start offset, so that a re-timed copy
 * does not appear to gain or lose a trailing write at the boundary. */
export function cutToHorizon(reference: Trace, variant: Trace, horizonCycles: number): { reference: Trace; variant: Trace; offsetCycles: number } {
  const offset = reference.sym.length && variant.sym.length ? variant.cycle[0]! - reference.cycle[0]! : 0;
  const alignable = Math.abs(offset) <= MAX_ALIGNABLE_OFFSET_CYCLES ? offset : 0;
  return {
    reference: slice(reference, lowerBound(reference.cycle, horizonCycles + 1)),
    variant: slice(variant, lowerBound(variant.cycle, horizonCycles + alignable + 1)),
    offsetCycles: offset,
  };
}

// ---------------------------------------------------------------------------------------------
// Alignment (longest common subsequence of (chip,address,value) symbols)
// ---------------------------------------------------------------------------------------------

/** Myers O(ND) shortest-edit-script length; returns the LCS length, or null when the edit distance
 * exceeds maxD. `budget.steps` is decremented by the diagonal steps taken (deterministic work cap). */
export function lcsMyers(a: Uint32Array, aLo: number, aHi: number, b: Uint32Array, bLo: number, bHi: number,
  maxD: number, budget: { steps: number }): number | null {
  const n = aHi - aLo, m = bHi - bLo;
  if (n === 0 || m === 0) return 0;
  const limit = Math.min(maxD, n + m);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return (n + m - d) / 2;
    }
    budget.steps -= d + 1;
    if (budget.steps < 0) return null;
  }
  return null;
}

export interface AlignmentResult {
  /** LCS length (exact) or a lower bound on it (exact === false) */
  matched: number;
  exact: boolean;
}

/** Cheap guaranteed lower bound: common prefix + non-overlapping common suffix. */
function affixMatch(a: Uint32Array, aLo: number, aHi: number, b: Uint32Array, bLo: number, bHi: number): number {
  let p = 0;
  const n = aHi - aLo, m = bHi - bLo, l = Math.min(n, m);
  while (p < l && a[aLo + p] === b[bLo + p]) p++;
  let s = 0;
  while (s < l - p && a[aHi - 1 - s] === b[bHi - 1 - s]) s++;
  return p + s;
}

export const ALIGN_GLOBAL_MAX_D = 2000;
export const ALIGN_BLOCK_MAX_D = 3000;
export const ALIGN_BLOCK_WRITES = 1500;
export const ALIGN_WORK_BUDGET = 250_000_000;

/** Order-preserving alignment of the variant against the reference.
 *
 * Complexity. Common prefix and suffix are stripped in O(n). The remaining middle is aligned
 * with Myers' O(ND) algorithm (D = number of unmatched symbols on both sides): exact and
 * O(n + D^2) in the typical "identical, then diverges or drops a few writes" case.
 * When D exceeds ALIGN_GLOBAL_MAX_D the result is a lower bound, computed time-synchronously:
 * the reference is cut into blocks of ALIGN_BLOCK_WRITES writes; each block is aligned (Myers,
 * D <= ALIGN_BLOCK_MAX_D) with the variant writes that fall in the same constant-offset time
 * span. Blocks partition both traces in order, so the sum of block LCS lengths is a valid lower
 * bound of the global LCS. A deterministic total step budget (ALIGN_WORK_BUDGET) bounds the
 * worst case at roughly a second for 2M-write traces; blocks beyond it contribute only their
 * common prefix/suffix. Memory is O(max D). */
export function alignWrites(reference: Trace, variant: Trace, offsetCycles: number): AlignmentResult {
  const a = reference.sym, b = variant.sym, n = a.length, m = b.length;
  if (n === 0 || m === 0) return { matched: 0, exact: true };
  let p = 0;
  while (p < n && p < m && a[p] === b[p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
  if (p + s >= Math.min(n, m)) return { matched: p + s, exact: true };
  const budget = { steps: ALIGN_WORK_BUDGET };
  const exactMiddle = lcsMyers(a, p, n - s, b, p, m - s, ALIGN_GLOBAL_MAX_D, budget);
  if (exactMiddle !== null) return { matched: p + s + exactMiddle, exact: true };
  // Time-synchronous block fallback (lower bound).
  const alignable = Math.abs(offsetCycles) <= MAX_ALIGNABLE_OFFSET_CYCLES ? offsetCycles : 0;
  let matched = 0, exact = true, varPos = 0;
  for (let start = 0; start < n; start += ALIGN_BLOCK_WRITES) {
    const end = Math.min(n, start + ALIGN_BLOCK_WRITES);
    const last = end === n;
    const varEnd = last ? m : Math.max(varPos, lowerBound(variant.cycle, reference.cycle[end]! + alignable, varPos));
    const aff = affixMatch(a, start, end, b, varPos, varEnd);
    const block = budget.steps > 0 ? lcsMyers(a, start, end, b, varPos, varEnd, ALIGN_BLOCK_MAX_D, budget) : null;
    if (block === null) { matched += aff; exact = false; } else matched += block;
    varPos = varEnd;
  }
  return { matched, exact };
}

// ---------------------------------------------------------------------------------------------
// Features and class
// ---------------------------------------------------------------------------------------------

export interface TraceFeatures {
  clockHz: number;
  horizonSeconds: number;
  referenceWrites: number;
  variantWrites: number;
  bitExact: boolean;
  valueSequenceIdentical: boolean;
  /** Length of the common (chip,address,value) prefix. */
  matchingValuePrefix: number;
  /** Seconds of reference time at which the first value divergence occurs; null if none. */
  firstValueDivergenceSeconds: number | null;
  /** Variant first write minus reference first write, in cycles. */
  startOffsetCycles: number;
  /** max |(variantCycle - referenceCycle) - startOffset| over the matched prefix. */
  maxDriftCycles: number;
  /** Signed drift at the last matched write (cumulative drift), cycles. */
  finalDriftCycles: number;
  alignedWrites: number;
  alignmentExact: boolean;
  /** alignedWrites / referenceWrites (1 when the reference has no writes). */
  alignmentSimilarity: number;
  /** Reference writes to $D418 (volume / 4-bit sample register) and whether they form sample-playback bursts */
  referenceVolumeWrites: number;
  referenceDigi: boolean;
  referenceError: string;
  referenceErrorKind: string;
  variantError: string;
  variantErrorKind: string;
  /** false when either native trace overflowed its 2,000,000-write buffer (the music beyond is unobserved) */
  traceComplete: boolean;
  cls: TraceClass;
  bSubclass: BSubclass | null;
  /** Why the class was chosen: the rule that fired. */
  rule: string;
}

export interface FeatureOptions { clockHz: number; horizonSeconds: number; toleranceMs?: number }

export function computeTraceFeatures(referenceFull: Trace, variantFull: Trace, options: FeatureOptions): TraceFeatures {
  const { clockHz, horizonSeconds } = options;
  const horizonCycles = horizonSeconds * clockHz;
  const { reference, variant, offsetCycles } = cutToHorizon(referenceFull, variantFull, horizonCycles);
  const n = reference.sym.length, m = variant.sym.length, ref = reference.sym, vr = variant.sym;
  let k = 0;
  const common = Math.min(n, m);
  while (k < common && ref[k] === vr[k]) k++;
  const valueSequenceIdentical = n === m && k === n;
  let maxDrift = 0, finalDrift = 0, cyclesEqual = true;
  for (let i = 0; i < k; i++) {
    const delta = variant.cycle[i]! - reference.cycle[i]!;
    if (delta !== 0) cyclesEqual = false;
    const drift = Math.abs(delta - offsetCycles);
    if (drift > maxDrift) maxDrift = drift;
    finalDrift = delta - offsetCycles;
  }
  const bothErrorsEqual = referenceFull.error === variantFull.error;
  const bitExact = valueSequenceIdentical && cyclesEqual && bothErrorsEqual && referenceFull.complete && variantFull.complete;
  let firstDivergence: number | null = null;
  if (!valueSequenceIdentical) {
    firstDivergence = k < n ? reference.cycle[k]! / clockHz : (variant.cycle[k]! - (Math.abs(offsetCycles) <= MAX_ALIGNABLE_OFFSET_CYCLES ? offsetCycles : 0)) / clockHz;
  }
  const alignment = valueSequenceIdentical ? { matched: n, exact: true } : alignWrites(reference, variant, offsetCycles);
  const traceComplete = referenceFull.complete && variantFull.complete;
  const features: TraceFeatures = {
    clockHz, horizonSeconds, referenceWrites: n, variantWrites: m, bitExact, valueSequenceIdentical,
    matchingValuePrefix: k, firstValueDivergenceSeconds: firstDivergence, startOffsetCycles: offsetCycles,
    maxDriftCycles: maxDrift, finalDriftCycles: finalDrift, alignedWrites: alignment.matched, alignmentExact: alignment.exact,
    alignmentSimilarity: n === 0 ? 1 : alignment.matched / n,
    ...volumeStats(reference),
    referenceError: referenceFull.error, referenceErrorKind: referenceFull.errorKind, variantError: variantFull.error, variantErrorKind: variantFull.errorKind,
    traceComplete, cls: "X", bSubclass: null, rule: "",
  };
  const verdict = classify(features);
  features.cls = verdict.cls; features.bSubclass = verdict.bSubclass; features.rule = verdict.rule;
  return features;
}

export const DIGI_WINDOW_CYCLES = 100000;
export const DIGI_MIN_WRITES = 100;
/** Sample playback: more than DIGI_MIN_WRITES writes to $D418 (any chip) within DIGI_WINDOW_CYCLES (the listener-v1 density rule). */
export function volumeStats(trace: Trace): { referenceVolumeWrites: number; referenceDigi: boolean } {
  const cycles: number[] = [];
  for (let i = 0; i < trace.sym.length; i++) if (((trace.sym[i]! >> 8) & 31) === 24) cycles.push(trace.cycle[i]!);
  let digi = false;
  for (let lo = 0, hi = 0; hi < cycles.length && !digi; hi++) {
    while (cycles[hi]! - cycles[lo]! >= DIGI_WINDOW_CYCLES) lo++;
    if (hi - lo + 1 > DIGI_MIN_WRITES) digi = true;
  }
  return { referenceVolumeWrites: cycles.length, referenceDigi: digi };
}

export function bSubclassOf(maxDriftCycles: number, clockHz: number): BSubclass {
  if (maxDriftCycles <= 63) return "<=63cyc";
  if (maxDriftCycles <= clockHz / 1000) return "<=1ms";
  if (maxDriftCycles <= 2 * clockHz / 1000) return "<=2ms";
  return ">2ms";
}

/** Trace class decision. Rules are evaluated in this order; the first that applies wins.
 *
 *  X  inadequate evidence: reference failed with a non-CPU error, the variant failed with a non-CPU engine/resource error,
 *     or the trace buffer overflowed (no claim about the music is made from the trace; audio decides).
 *  A  bit-exact: identical (chip, address, value, cycle) sequence, same error text.
 *  G  no playback: the variant has at most MAX_INIT_WRITES writes, the reference at least 8 more.
 *  H  the variant (not the reference) stopped on an illegal instruction after more than init writes, within the first half of the
 *     horizon (a later jam falls through to the divergence rules, normally F).
 *  I  identical value prefix covering the whole shorter trace, |cumulative drift| > TEMPO_DRIFT_MS.
 *  B  identical value sequence and write count, only timing differs; subclass by max drift.
 *  C  the values are identical apart from a few extra or missing writes (trailing or interior): the alignment
 *     leaves at most max(8, 0.1% of the longer trace) writes unmatched.
 *  F  values diverge, but after more than 50% of the horizon.
 *  D  values diverge within 50% of the horizon, min/max write-count ratio >= 0.9 and alignment similarity >= 0.5.
 *  E  values diverge within 50% of the horizon and either the write counts differ by more than 10% or less than
 *     half of the reference writes align (substantially different music).
 */
export function classify(f: TraceFeatures): { cls: TraceClass; bSubclass: BSubclass | null; rule: string } {
  const none = (cls: TraceClass, rule: string) => ({ cls, bSubclass: null as BSubclass | null, rule });
  const n = f.referenceWrites, m = f.variantWrites;
  if (f.referenceError && f.referenceErrorKind !== "cpu-halt") return none("X", "reference-engine-error");
  if (f.variantError && f.variantErrorKind !== "cpu-halt") return none("X", "variant-engine-error");
  if (!f.traceComplete) return none("X", "trace-truncated");
  if (f.bitExact) return none("A", "bit-exact");
  if (m <= MAX_INIT_WRITES && n - m >= 8) return none("G", "init-writes-only");
  // A jam in the second half of the horizon leaves more than half of it playing identically: that is late divergence (F), not H.
  if (f.variantErrorKind === "cpu-halt" && !f.referenceError && (f.firstValueDivergenceSeconds === null || f.firstValueDivergenceSeconds <= LATE_DIVERGENCE_FRACTION * f.horizonSeconds))
    return none("H", "variant-cpu-halt");
  const prefixFull = f.matchingValuePrefix === Math.min(n, m);
  const tempo = TEMPO_DRIFT_MS * f.clockHz / 1000;
  if (prefixFull && Math.abs(f.finalDriftCycles) > tempo && f.matchingValuePrefix > 0) return none("I", "cumulative-drift");
  if (f.valueSequenceIdentical) return { cls: "B", bSubclass: bSubclassOf(f.maxDriftCycles, f.clockHz), rule: "values-identical" };
  // Edit distance (insertions + deletions) implied by the alignment; with an inexact alignment this is an upper bound.
  const edits = n + m - 2 * f.alignedWrites;
  if (edits <= Math.max(8, Math.ceil(0.001 * Math.max(n, m)))) return none("C", prefixFull ? "trailing-writes" : "few-extra-or-missing-writes");
  const late = f.firstValueDivergenceSeconds !== null && f.firstValueDivergenceSeconds > LATE_DIVERGENCE_FRACTION * f.horizonSeconds;
  if (late) return none("F", "late-divergence");
  if (Math.min(n, m) / Math.max(n, m, 1) >= NEAR_EQUAL_COUNT_RATIO && f.alignmentSimilarity >= MIN_SIMILAR_MUSIC) return none("D", "value-divergence-near-equal-count");
  return none("E", "early-divergence");
}

/** Whether the trace alone proves grade 255/254 at tolerance T (cycles). A variant that fails in
 * exactly the way the reference does (same error text) is as faithful as its trace. */
export function traceGrade(f: TraceFeatures, toleranceCyclesValue: number): 255 | 254 | null {
  if (!f.traceComplete) return null;
  if (f.cls === "A") return 255;
  if (f.cls === "B" && f.variantError === f.referenceError && f.maxDriftCycles <= toleranceCyclesValue) return 254;
  return null;
}
