/**
 * Pitch, key, melody and harmony features derived from the SID register trace.
 *
 * ## Why these exist
 *
 * The classifier's perceptual vector described rhythm, waveform mix, filter
 * behaviour, voice roles and envelope shapes — and nothing whatsoever about
 * pitch. There was no key, no mode, no melodic interval content and no harmony.
 * The one dimension that sounded like it covered melody, `sidMelodicClarity`, is
 * a heuristic blend of voice-role and noise ratios; it never looks at a note.
 *
 * That is a large blind spot for a "songs similar to this one" station, because
 * tonality and melodic idiom are among the strongest cues a listener uses. Two
 * tunes can share tempo, waveform mix and filter style while one is a bright
 * major arpeggio piece and the other a chromatic minor dirge, and the old vector
 * could not tell them apart.
 *
 * ## Why the register trace is the right source
 *
 * Note pitch is not estimated here, it is READ. The SID oscillator frequency is
 * exactly `f = Fn * Fclk / 2^24` for frequency word `Fn`, so the trace gives the
 * composer's literal intent — no pitch tracking, no octave errors, no polyphony
 * confusion. That is strictly better than inferring pitch from rendered audio,
 * and it costs nothing extra: the trace is already captured for the existing
 * SID-native features.
 *
 * A consequence worth knowing: these features depend only on what the playroutine
 * wrote to the chip, so they are identical under reSIDfp and SIDLite. The
 * exception is tunes whose playroutine READS back OSC3/ENV3 for randomness, where
 * the two SID models can diverge and change subsequent writes.
 *
 * ## Deliberate design choices
 *
 * Everything tonal is made TRANSPOSITION-INVARIANT by rotating the pitch-class
 * profile onto the estimated tonic. Absolute key is a nominal quantity — C# is
 * not "between" C and D in any sense a distance function should believe — so
 * feeding a raw key index into a Euclidean metric would inject nonsense. What
 * generalises is the shape of the scale relative to its own tonic.
 *
 * Every value is bounded to [0, 1] so the existing normalisation path can consume
 * it directly, and every ratio is duration-weighted rather than note-counted: a
 * held tonic matters more to how a tune reads than a passing semiquaver.
 */

import {
  resolveSidTraceFrameWindow,
  type CompactSidWriteTraceOptions,
} from "./sid-register-trace.js";

/** The subset of a voice frame this module needs. */
export interface TonalVoiceFrame {
  sidNumber: number;
  frame: number;
  voice: 1 | 2 | 3;
  frequencyWord: number;
  gate: boolean;
  waveform: "noise" | "pulse" | "saw" | "triangle" | "mixed" | "none";
}

export interface SidNote {
  stream: string;
  sidNumber: number;
  voice: 1 | 2 | 3;
  /** Rounded to the nearest semitone. */
  midi: number;
  startFrame: number;
  frames: number;
}

const SID_ACCUMULATOR_BITS = 24;

/**
 * Lowest and highest MIDI notes treated as musical.
 *
 * The frequency word spans 0.06 Hz to ~4 kHz, so the bottom of that range is not
 * a note anyone hears as pitched — it is a sweep, an unset register, or an LFO
 * driving something else. MIDI 12 (~16 Hz) is already below the audible
 * fundamental; anything under it is discarded rather than allowed to pollute the
 * pitch-class histogram.
 */
const MIN_MIDI = 12;
const MAX_MIDI = 127;

/** Noise is unpitched: its frequency word sets a rate, not a note. */
function isPitched(frame: TonalVoiceFrame): boolean {
  return (
    frame.gate &&
    frame.frequencyWord > 0 &&
    frame.waveform !== "none" &&
    frame.waveform !== "noise"
  );
}

export function sidFrequencyWordToHz(frequencyWord: number, cyclesPerSecond: number): number {
  return (frequencyWord * cyclesPerSecond) / 2 ** SID_ACCUMULATOR_BITS;
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Segment a voice's frames into notes.
 *
 * A note is a maximal run of consecutive frames that are pitched and share the
 * same semitone. Quantising to a semitone before comparing is what makes vibrato
 * and fine pitch drift read as one held note instead of dozens of one-frame
 * notes; a genuine slide still produces a run of short notes, which the duration
 * statistics then describe honestly.
 */
export function segmentNotes(
  frames: readonly TonalVoiceFrame[],
  cyclesPerSecond: number,
): SidNote[] {
  const byStream = new Map<string, TonalVoiceFrame[]>();
  for (const frame of frames) {
    const key = `${frame.sidNumber}:${frame.voice}`;
    const list = byStream.get(key);
    if (list) list.push(frame);
    else byStream.set(key, [frame]);
  }

  const notes: SidNote[] = [];
  for (const [stream, list] of byStream) {
    list.sort((left, right) => left.frame - right.frame);
    let current: SidNote | null = null;
    let previousFrame = Number.NEGATIVE_INFINITY;

    for (const frame of list) {
      const contiguous = frame.frame === previousFrame + 1;
      previousFrame = frame.frame;

      if (!isPitched(frame)) {
        current = null;
        continue;
      }
      const midi = Math.round(hzToMidi(sidFrequencyWordToHz(frame.frequencyWord, cyclesPerSecond)));
      if (!Number.isFinite(midi) || midi < MIN_MIDI || midi > MAX_MIDI) {
        current = null;
        continue;
      }

      if (current && contiguous && current.midi === midi) {
        current.frames += 1;
        continue;
      }
      current = {
        stream,
        sidNumber: frame.sidNumber,
        voice: frame.voice,
        midi,
        startFrame: frame.frame,
        frames: 1,
      };
      notes.push(current);
    }
  }

  notes.sort((left, right) => left.startFrame - right.startFrame || left.stream.localeCompare(right.stream));
  return notes;
}

// ------------------------------------------------------------------ tonality

/**
 * Krumhansl-Kessler key profiles: the probe-tone ratings from Krumhansl's
 * "Cognitive Foundations of Musical Pitch". Used rather than a hand-tuned scale
 * mask because they encode how strongly listeners actually associate each degree
 * with a key, which is what makes the correlation meaningful for weakly tonal
 * material.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/** Duration-weighted pitch-class histogram, normalised to sum 1. */
export function pitchClassProfile(notes: readonly SidNote[]): number[] {
  const profile = new Array<number>(12).fill(0);
  let total = 0;
  for (const note of notes) {
    profile[((note.midi % 12) + 12) % 12]! += note.frames;
    total += note.frames;
  }
  if (total <= 0) return profile;
  for (let i = 0; i < 12; i++) profile[i]! /= total;
  return profile;
}

export interface KeyEstimate {
  root: number;
  minor: boolean;
  /** Correlation of the profile with the winning template, in [-1, 1]. */
  correlation: number;
  majorBest: number;
  minorBest: number;
}

export function estimateKey(profile: readonly number[]): KeyEstimate {
  let best: KeyEstimate = { root: 0, minor: false, correlation: -Infinity, majorBest: -Infinity, minorBest: -Infinity };
  let majorBest = -Infinity;
  let minorBest = -Infinity;

  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => profile[(i + root) % 12]!);
    const major = pearson(rotated, MAJOR_PROFILE);
    const minor = pearson(rotated, MINOR_PROFILE);
    if (major > majorBest) majorBest = major;
    if (minor > minorBest) minorBest = minor;
    if (major > best.correlation) best = { root, minor: false, correlation: major, majorBest: 0, minorBest: 0 };
    if (minor > best.correlation) best = { root, minor: true, correlation: minor, majorBest: 0, minorBest: 0 };
  }

  if (!Number.isFinite(best.correlation)) {
    return { root: 0, minor: false, correlation: 0, majorBest: 0, minorBest: 0 };
  }
  return { ...best, majorBest, minorBest };
}

/** Rotate a pitch-class profile so the estimated tonic sits at index 0. */
export function rotateToTonic(profile: readonly number[], root: number): number[] {
  return Array.from({ length: 12 }, (_, i) => profile[(i + root) % 12]!);
}

function entropyOf(weights: readonly number[]): number {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const weight of weights) {
    const p = weight / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

// -------------------------------------------------------------------- melody

/**
 * The melodic stream: the voice carrying the tune.
 *
 * Chosen as the stream with the highest activity-weighted median pitch, matching
 * how computeVoiceRoleRatios already identifies a lead, so the two features do
 * not disagree about which voice is the melody.
 */
export function selectLeadStream(notes: readonly SidNote[]): string | null {
  const byStream = new Map<string, SidNote[]>();
  for (const note of notes) {
    const list = byStream.get(note.stream);
    if (list) list.push(note);
    else byStream.set(note.stream, [note]);
  }
  let bestStream: string | null = null;
  let bestScore = -Infinity;
  for (const [stream, list] of byStream) {
    const pitches = list.map((note) => note.midi).sort((left, right) => left - right);
    const median = pitches[Math.floor(pitches.length / 2)] ?? 0;
    const activeFrames = list.reduce((sum, note) => sum + note.frames, 0);
    const score = median * activeFrames;
    if (score > bestScore || (score === bestScore && bestStream !== null && stream < bestStream)) {
      bestScore = score;
      bestStream = stream;
    }
  }
  return bestStream;
}

// ------------------------------------------------------------------- harmony

/** Interval class: the smaller of the two ways round the octave, so 0..6. */
export function intervalClass(semitones: number): number {
  const folded = ((semitones % 12) + 12) % 12;
  return Math.min(folded, 12 - folded);
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export interface SidTonalFeatures {
  sidTonalVariant: "tonal" | "insufficient";
  sidNoteCount: number;
  sidNoteRate: number;
  sidPolyphonyMean: number;

  sidKeyRoot: number;
  sidKeyIsMinor: number;
  sidKeyStrength: number;
  sidKeyMinorness: number;
  sidKeyStability: number;

  sidPitchClassEntropy: number;
  sidDiatonicRatio: number;
  sidChromaticism: number;
  sidTonicWeight: number;
  sidDominantWeight: number;
  sidMinorThirdWeight: number;
  sidMajorThirdWeight: number;
  sidFlatSeventhWeight: number;
  sidTritoneWeight: number;

  sidMelodicRepeatRatio: number;
  sidMelodicStepRatio: number;
  sidMelodicThirdRatio: number;
  sidMelodicLeapRatio: number;
  sidMelodicMeanAbsInterval: number;
  sidMelodicRange: number;
  sidMelodicAscendingRatio: number;
  sidMelodicIntervalEntropy: number;

  sidHarmonyUnisonOctaveRatio: number;
  sidHarmonySemitoneRatio: number;
  sidHarmonyToneRatio: number;
  sidHarmonyMinorThirdRatio: number;
  sidHarmonyMajorThirdRatio: number;
  sidHarmonyFourthRatio: number;
  sidHarmonyTritoneRatio: number;

  sidNoteDurationMean: number;
  sidNoteDurationEntropy: number;
}

export function emptySidTonalFeatures(): SidTonalFeatures {
  return {
    sidTonalVariant: "insufficient",
    sidNoteCount: 0,
    sidNoteRate: 0,
    sidPolyphonyMean: 0,
    sidKeyRoot: 0,
    sidKeyIsMinor: 0,
    sidKeyStrength: 0,
    sidKeyMinorness: 0.5,
    sidKeyStability: 0,
    sidPitchClassEntropy: 0,
    sidDiatonicRatio: 0,
    sidChromaticism: 0,
    sidTonicWeight: 0,
    sidDominantWeight: 0,
    sidMinorThirdWeight: 0,
    sidMajorThirdWeight: 0,
    sidFlatSeventhWeight: 0,
    sidTritoneWeight: 0,
    sidMelodicRepeatRatio: 0,
    sidMelodicStepRatio: 0,
    sidMelodicThirdRatio: 0,
    sidMelodicLeapRatio: 0,
    sidMelodicMeanAbsInterval: 0,
    sidMelodicRange: 0,
    sidMelodicAscendingRatio: 0.5,
    sidMelodicIntervalEntropy: 0,
    sidHarmonyUnisonOctaveRatio: 0,
    sidHarmonySemitoneRatio: 0,
    sidHarmonyToneRatio: 0,
    sidHarmonyMinorThirdRatio: 0,
    sidHarmonyMajorThirdRatio: 0,
    sidHarmonyFourthRatio: 0,
    sidHarmonyTritoneRatio: 0,
    sidNoteDurationMean: 0,
    sidNoteDurationEntropy: 0,
  };
}

/**
 * Below this many notes the statistics are noise rather than description: a
 * pitch-class profile built from three notes will correlate strongly with some
 * key purely by accident, and reporting that as a confident key estimate would be
 * worse than reporting nothing.
 */
const MIN_NOTES_FOR_TONALITY = 12;

export interface ComputeSidTonalFeaturesOptions extends CompactSidWriteTraceOptions {
  voiceFrames: readonly TonalVoiceFrame[];
}

export function computeSidTonalFeatures(options: ComputeSidTonalFeaturesOptions): SidTonalFeatures {
  const window = resolveSidTraceFrameWindow(options);
  const { frameRate, cyclesPerSecond, analysisFrames } = window;
  const notes = segmentNotes(options.voiceFrames, cyclesPerSecond);

  if (notes.length < MIN_NOTES_FOR_TONALITY) {
    return { ...emptySidTonalFeatures(), sidNoteCount: notes.length };
  }

  const analysisSeconds = Math.max(1 / frameRate, analysisFrames / frameRate);
  const profile = pitchClassProfile(notes);
  const key = estimateKey(profile);
  const rotated = rotateToTonic(profile, key.root);
  const degrees = key.minor ? MINOR_DEGREES : MAJOR_DEGREES;
  const diatonic = degrees.reduce((sum, degree) => sum + rotated[degree]!, 0);

  // Key stability: re-estimate on each quarter of the window and see how often
  // the local tonic agrees with the global one. A tune that modulates, or that
  // never established a key to begin with, scores low.
  const quarters: SidNote[][] = [[], [], [], []];
  for (const note of notes) {
    const q = Math.min(3, Math.floor((note.startFrame / Math.max(1, analysisFrames)) * 4));
    quarters[Math.max(0, q)]!.push(note);
  }
  let agreeing = 0;
  let measured = 0;
  for (const quarter of quarters) {
    if (quarter.length < MIN_NOTES_FOR_TONALITY / 2) continue;
    measured++;
    const local = estimateKey(pitchClassProfile(quarter));
    if (local.root === key.root && local.minor === key.minor) agreeing++;
  }
  const keyStability = measured === 0 ? 0 : agreeing / measured;

  // ---- melody: successive intervals within the lead stream
  const leadStream = selectLeadStream(notes);
  const lead = notes.filter((note) => note.stream === leadStream);
  const intervals: number[] = [];
  for (let i = 1; i < lead.length; i++) intervals.push(lead[i]!.midi - lead[i - 1]!.midi);

  const buckets = { repeat: 0, step: 0, third: 0, leap: 0 };
  let ascending = 0;
  let nonZero = 0;
  let absSum = 0;
  for (const interval of intervals) {
    const size = Math.abs(interval);
    absSum += size;
    if (size === 0) buckets.repeat++;
    else if (size <= 2) buckets.step++;
    else if (size <= 4) buckets.third++;
    else buckets.leap++;
    if (interval !== 0) {
      nonZero++;
      if (interval > 0) ascending++;
    }
  }
  const intervalCount = Math.max(1, intervals.length);
  const leadPitches = lead.map((note) => note.midi);
  const melodicRange = leadPitches.length === 0 ? 0 : Math.max(...leadPitches) - Math.min(...leadPitches);

  // ---- harmony: interval classes between voices sounding in the same frame
  const soundingByFrame = new Map<number, number[]>();
  for (const note of notes) {
    for (let f = note.startFrame; f < note.startFrame + note.frames; f++) {
      const list = soundingByFrame.get(f);
      if (list) list.push(note.midi);
      else soundingByFrame.set(f, [note.midi]);
    }
  }
  const harmonyCounts = new Array<number>(7).fill(0);
  let harmonyPairs = 0;
  let polyphonySum = 0;
  for (const pitches of soundingByFrame.values()) {
    polyphonySum += pitches.length;
    for (let i = 0; i < pitches.length; i++) {
      for (let j = i + 1; j < pitches.length; j++) {
        harmonyCounts[intervalClass(pitches[i]! - pitches[j]!)]!++;
        harmonyPairs++;
      }
    }
  }
  const harmonyTotal = Math.max(1, harmonyPairs);
  // Averaged over the whole analysis window, not just frames that sounded, so a
  // sparse tune is not credited with dense polyphony.
  const polyphonyMean = polyphonySum / Math.max(1, analysisFrames);

  // ---- note durations, on a log scale because they span two orders of magnitude
  const durationSeconds = notes.map((note) => note.frames / frameRate);
  const durationMean = durationSeconds.reduce((sum, value) => sum + value, 0) / durationSeconds.length;
  const durationBuckets = new Array<number>(8).fill(0);
  for (const seconds of durationSeconds) {
    const index = Math.min(7, Math.max(0, Math.floor(Math.log2(Math.max(seconds, 1 / frameRate) * frameRate))));
    durationBuckets[index]!++;
  }

  return {
    sidTonalVariant: "tonal",
    sidNoteCount: notes.length,
    sidNoteRate: clamp01(notes.length / analysisSeconds / 20),
    sidPolyphonyMean: clamp01(polyphonyMean / 3),

    sidKeyRoot: key.root,
    sidKeyIsMinor: key.minor ? 1 : 0,
    // Correlation in [-1,1] mapped to [0,1]; a tune with no tonal centre lands
    // near 0.5 rather than at an extreme.
    sidKeyStrength: clamp01((key.correlation + 1) / 2),
    sidKeyMinorness: clamp01((key.minorBest - key.majorBest + 1) / 2),
    sidKeyStability: clamp01(keyStability),

    sidPitchClassEntropy: clamp01(entropyOf(profile) / Math.log2(12)),
    sidDiatonicRatio: clamp01(diatonic),
    sidChromaticism: clamp01(1 - diatonic),
    sidTonicWeight: clamp01(rotated[0]!),
    sidDominantWeight: clamp01(rotated[7]!),
    sidMinorThirdWeight: clamp01(rotated[3]!),
    sidMajorThirdWeight: clamp01(rotated[4]!),
    sidFlatSeventhWeight: clamp01(rotated[10]!),
    sidTritoneWeight: clamp01(rotated[6]!),

    sidMelodicRepeatRatio: clamp01(buckets.repeat / intervalCount),
    sidMelodicStepRatio: clamp01(buckets.step / intervalCount),
    sidMelodicThirdRatio: clamp01(buckets.third / intervalCount),
    sidMelodicLeapRatio: clamp01(buckets.leap / intervalCount),
    sidMelodicMeanAbsInterval: clamp01(absSum / intervalCount / 12),
    sidMelodicRange: clamp01(melodicRange / 48),
    sidMelodicAscendingRatio: nonZero === 0 ? 0.5 : clamp01(ascending / nonZero),
    sidMelodicIntervalEntropy: clamp01(
      entropyOf([buckets.repeat, buckets.step, buckets.third, buckets.leap]) / 2,
    ),

    sidHarmonyUnisonOctaveRatio: clamp01(harmonyCounts[0]! / harmonyTotal),
    sidHarmonySemitoneRatio: clamp01(harmonyCounts[1]! / harmonyTotal),
    sidHarmonyToneRatio: clamp01(harmonyCounts[2]! / harmonyTotal),
    sidHarmonyMinorThirdRatio: clamp01(harmonyCounts[3]! / harmonyTotal),
    sidHarmonyMajorThirdRatio: clamp01(harmonyCounts[4]! / harmonyTotal),
    sidHarmonyFourthRatio: clamp01(harmonyCounts[5]! / harmonyTotal),
    sidHarmonyTritoneRatio: clamp01(harmonyCounts[6]! / harmonyTotal),

    sidNoteDurationMean: clamp01(durationMean / 2),
    sidNoteDurationEntropy: clamp01(entropyOf(durationBuckets) / 3),
  };
}
