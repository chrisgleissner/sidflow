/**
 * Tests for the pitch/key/harmony features.
 *
 * These are checked against musical ground truth rather than against golden
 * numbers: a C major scale must come out as C major, a transposed melody must
 * produce the same tonal description, and an unpitched noise voice must not
 * contribute notes. Golden-value tests would pass just as happily if the key
 * finder were rotated by a fifth.
 */

import { describe, expect, test } from "bun:test";

import {
  computeSidTonalFeatures,
  emptySidTonalFeatures,
  estimateKey,
  hzToMidi,
  intervalClass,
  pitchClassProfile,
  rotateToTonic,
  segmentNotes,
  sidFrequencyWordToHz,
  type TonalVoiceFrame,
} from "../src/sid-tonal-features.js";

const PAL_CYCLES = 985_248;
const PAL_FRAMES = 50;

/** MIDI note -> the frequency word a playroutine would write for it. */
function midiToFrequencyWord(midi: number, cyclesPerSecond = PAL_CYCLES): number {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  return Math.round((hz * 2 ** 24) / cyclesPerSecond);
}

interface NoteSpec {
  midi: number | null;
  frames: number;
  waveform?: TonalVoiceFrame["waveform"];
}

/** Lay a sequence of notes onto consecutive frames of one voice. */
function layVoice(spec: NoteSpec[], voice: 1 | 2 | 3 = 1, sidNumber = 0, startFrame = 0): TonalVoiceFrame[] {
  const frames: TonalVoiceFrame[] = [];
  let frame = startFrame;
  for (const note of spec) {
    for (let i = 0; i < note.frames; i++) {
      frames.push({
        sidNumber,
        voice,
        frame,
        frequencyWord: note.midi === null ? 0 : midiToFrequencyWord(note.midi),
        gate: note.midi !== null,
        waveform: note.waveform ?? "pulse",
      });
      frame++;
    }
  }
  return frames;
}

/** Repeat a pitch sequence until it fills enough frames to be analysable. */
function repeatToLength(pitches: number[], repeats: number, framesPerNote = 8): NoteSpec[] {
  const out: NoteSpec[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const midi of pitches) out.push({ midi, frames: framesPerNote });
  }
  return out;
}

/**
 * A voice re-articulating one pitch, with a gate gap between notes.
 *
 * Needed because repeating the same pitch on contiguous frames is, correctly,
 * ONE held note — so a sustained chord yields three notes total and falls under
 * the minimum-notes threshold. Real chordal writing re-triggers.
 */
function layRepeatedNote(
  midi: number,
  repeats: number,
  voice: 1 | 2 | 3,
  onFrames = 8,
  offFrames = 2,
): TonalVoiceFrame[] {
  const spec: NoteSpec[] = [];
  for (let i = 0; i < repeats; i++) {
    spec.push({ midi, frames: onFrames });
    spec.push({ midi: null, frames: offFrames });
  }
  return layVoice(spec, voice);
}

describe("pitch conversion", () => {
  test("the SID frequency formula recovers concert A", () => {
    const word = midiToFrequencyWord(69);
    const hz = sidFrequencyWordToHz(word, PAL_CYCLES);
    expect(hz).toBeCloseTo(440, 0);
    expect(hzToMidi(hz)).toBeCloseTo(69, 2);
  });

  test("an octave up doubles the frequency word", () => {
    expect(midiToFrequencyWord(69 + 12) / midiToFrequencyWord(69)).toBeCloseTo(2, 3);
  });
});

describe("segmentNotes", () => {
  test("holds one note across frames at the same pitch", () => {
    const notes = segmentNotes(layVoice([{ midi: 60, frames: 10 }]), PAL_CYCLES);
    expect(notes.length).toBe(1);
    expect(notes[0]!.midi).toBe(60);
    expect(notes[0]!.frames).toBe(10);
  });

  test("treats vibrato inside a semitone as one held note", () => {
    // Wobble the frequency word by a few units either side of C4.
    const base = midiToFrequencyWord(60);
    const frames: TonalVoiceFrame[] = [];
    for (let i = 0; i < 20; i++) {
      frames.push({
        sidNumber: 0,
        voice: 1,
        frame: i,
        frequencyWord: base + (i % 2 === 0 ? 3 : -3),
        gate: true,
        waveform: "triangle",
      });
    }
    const notes = segmentNotes(frames, PAL_CYCLES);
    expect(notes.length).toBe(1);
    expect(notes[0]!.frames).toBe(20);
  });

  test("splits when the gate closes and when the pitch changes", () => {
    const notes = segmentNotes(
      layVoice([
        { midi: 60, frames: 4 },
        { midi: null, frames: 2 },
        { midi: 60, frames: 4 },
        { midi: 62, frames: 4 },
      ]),
      PAL_CYCLES,
    );
    expect(notes.map((n) => [n.midi, n.frames])).toEqual([
      [60, 4],
      [60, 4],
      [62, 4],
    ]);
  });

  test("ignores noise, which sets a rate rather than a pitch", () => {
    const notes = segmentNotes(
      layVoice([{ midi: 60, frames: 6, waveform: "noise" }]),
      PAL_CYCLES,
    );
    expect(notes.length).toBe(0);
  });

  test("keeps voices and chips as separate streams", () => {
    const frames = [
      ...layVoice([{ midi: 60, frames: 6 }], 1, 0),
      ...layVoice([{ midi: 64, frames: 6 }], 2, 0),
      ...layVoice([{ midi: 67, frames: 6 }], 1, 1),
    ];
    const notes = segmentNotes(frames, PAL_CYCLES);
    expect(new Set(notes.map((n) => n.stream)).size).toBe(3);
  });
});

describe("estimateKey", () => {
  test("identifies C major from a C major scale", () => {
    const profile = pitchClassProfile(
      [0, 2, 4, 5, 7, 9, 11].map((pc, i) => ({
        stream: "0:1",
        sidNumber: 0,
        voice: 1 as const,
        midi: 60 + pc,
        startFrame: i * 8,
        // Weight tonic and dominant, as tonal music does.
        frames: pc === 0 ? 24 : pc === 7 ? 16 : 8,
      })),
    );
    const key = estimateKey(profile);
    expect(key.root).toBe(0);
    expect(key.minor).toBe(false);
    expect(key.correlation).toBeGreaterThan(0.7);
  });

  test("identifies A minor from an A minor scale", () => {
    const profile = pitchClassProfile(
      [9, 11, 0, 2, 4, 5, 7].map((pc, i) => ({
        stream: "0:1",
        sidNumber: 0,
        voice: 1 as const,
        midi: 60 + pc,
        startFrame: i * 8,
        frames: pc === 9 ? 24 : pc === 4 ? 16 : 8,
      })),
    );
    const key = estimateKey(profile);
    expect(key.root).toBe(9);
    expect(key.minor).toBe(true);
  });

  test("a uniform chromatic profile has no strong key", () => {
    const key = estimateKey(new Array(12).fill(1 / 12));
    expect(Math.abs(key.correlation)).toBeLessThan(0.2);
  });
});

describe("rotateToTonic", () => {
  test("puts the tonic at index 0", () => {
    const profile = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0.5];
    expect(rotateToTonic(profile, 9)).toEqual([0.5, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("intervalClass", () => {
  test("folds intervals to the nearer side of the octave", () => {
    expect(intervalClass(0)).toBe(0);
    expect(intervalClass(12)).toBe(0);
    expect(intervalClass(1)).toBe(1);
    expect(intervalClass(11)).toBe(1);
    expect(intervalClass(6)).toBe(6);
    expect(intervalClass(7)).toBe(5);
    expect(intervalClass(-4)).toBe(4);
  });
});

describe("computeSidTonalFeatures", () => {
  const options = { clock: "PAL" as const, skipSeconds: 0, analysisSeconds: 15 };

  test("reports insufficient rather than inventing a key from a few notes", () => {
    const features = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice([{ midi: 60, frames: 8 }, { midi: 62, frames: 8 }]),
    });
    expect(features.sidTonalVariant).toBe("insufficient");
    expect(features.sidKeyStrength).toBe(0);
    expect(features.sidNoteCount).toBe(2);
  });

  test("a major-key tune weights the major third over the minor third", () => {
    const features = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 62, 64, 65, 67, 69, 71, 72], 4)),
    });
    expect(features.sidTonalVariant).toBe("tonal");
    expect(features.sidMajorThirdWeight).toBeGreaterThan(features.sidMinorThirdWeight);
    expect(features.sidDiatonicRatio).toBeGreaterThan(0.95);
    expect(features.sidChromaticism).toBeLessThan(0.05);
  });

  test("a minor-key tune weights the minor third over the major third", () => {
    const features = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([57, 59, 60, 62, 64, 65, 67, 69], 4)),
    });
    expect(features.sidMinorThirdWeight).toBeGreaterThan(features.sidMajorThirdWeight);
    expect(features.sidKeyMinorness).toBeGreaterThan(0.5);
  });

  test("tonal features are transposition invariant", () => {
    // THE property that makes these usable in a distance function: the same tune
    // in a different key must describe as the same tune. Only the nominal root
    // may differ.
    const melody = [60, 62, 64, 67, 65, 64, 62, 60, 64, 67, 72, 67];
    const base = computeSidTonalFeatures({ ...options, voiceFrames: layVoice(repeatToLength(melody, 3)) });
    const up5 = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength(melody.map((m) => m + 5), 3)),
    });

    expect(base.sidTonalVariant).toBe("tonal");
    expect(up5.sidKeyRoot).toBe((base.sidKeyRoot + 5) % 12);
    for (const key of [
      "sidKeyStrength",
      "sidKeyMinorness",
      "sidKeyStability",
      "sidPitchClassEntropy",
      "sidDiatonicRatio",
      "sidTonicWeight",
      "sidDominantWeight",
      "sidMinorThirdWeight",
      "sidMajorThirdWeight",
      "sidMelodicStepRatio",
      "sidMelodicLeapRatio",
      "sidMelodicMeanAbsInterval",
      "sidMelodicRange",
      "sidHarmonyMajorThirdRatio",
      "sidNoteDurationMean",
    ] as const) {
      expect(up5[key]).toBeCloseTo(base[key], 9);
    }
  });

  test("a stepwise melody and an arpeggio differ in leap content", () => {
    const stepwise = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 61, 62, 63, 64, 65, 66, 67], 4)),
    });
    const leapy = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 72, 55, 67, 48, 79, 60, 72], 4)),
    });
    expect(stepwise.sidMelodicStepRatio).toBeGreaterThan(0.9);
    expect(leapy.sidMelodicLeapRatio).toBeGreaterThan(0.9);
    expect(leapy.sidMelodicRange).toBeGreaterThan(stepwise.sidMelodicRange);
  });

  test("a major dyad and a minor dyad differ in harmonic third content", () => {
    // Dyads, not triads: a MINOR triad also contains a major third (its third to
    // its fifth), so root-position triads carry one of each interval class and
    // cannot separate the two modes on third content alone. Two voices can.
    const dyad = (third: number) => [
      ...layRepeatedNote(60, 20, 1),
      ...layRepeatedNote(60 + third, 20, 2),
    ];
    const major = computeSidTonalFeatures({ ...options, voiceFrames: dyad(4) });
    const minor = computeSidTonalFeatures({ ...options, voiceFrames: dyad(3) });

    expect(major.sidHarmonyMajorThirdRatio).toBeGreaterThan(minor.sidHarmonyMajorThirdRatio);
    expect(minor.sidHarmonyMinorThirdRatio).toBeGreaterThan(major.sidHarmonyMinorThirdRatio);
    expect(major.sidHarmonyMajorThirdRatio).toBeCloseTo(1, 6);
    expect(minor.sidHarmonyMinorThirdRatio).toBeCloseTo(1, 6);
  });

  test("a root-position triad reports both of its third types", () => {
    const features = computeSidTonalFeatures({
      ...options,
      voiceFrames: [
        ...layRepeatedNote(60, 20, 1),
        ...layRepeatedNote(64, 20, 2),
        ...layRepeatedNote(67, 20, 3),
      ],
    });
    // C-E is a major third, E-G a minor third, C-G a fourth: one pair each.
    expect(features.sidHarmonyMajorThirdRatio).toBeCloseTo(1 / 3, 6);
    expect(features.sidHarmonyMinorThirdRatio).toBeCloseTo(1 / 3, 6);
    expect(features.sidHarmonyFourthRatio).toBeCloseTo(1 / 3, 6);
  });

  test("a monophonic line reports lower polyphony than a triad", () => {
    // Both must fill the analysis window. Polyphony is averaged over the whole
    // window on purpose, so a sparse triad legitimately scores below a dense
    // single line -- comparing a full mono line against a short chord stab would
    // be testing density, not polyphony.
    const mono = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 62, 64, 65], 48, 4), 1),
    });
    const triad = computeSidTonalFeatures({
      ...options,
      voiceFrames: [
        ...layRepeatedNote(60, 75, 1, 8, 2),
        ...layRepeatedNote(64, 75, 2, 8, 2),
        ...layRepeatedNote(67, 75, 3, 8, 2),
      ],
    });
    expect(mono.sidPolyphonyMean).toBeLessThan(triad.sidPolyphonyMean);
    expect(triad.sidPolyphonyMean).toBeGreaterThan(0.5);
  });

  test("every reported value is finite and within its stated bounds", () => {
    const features = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 63, 66, 69, 61, 64], 6)),
    });
    for (const [name, value] of Object.entries(features)) {
      if (typeof value !== "number") continue;
      expect(Number.isFinite(value)).toBe(true);
      if (name === "sidKeyRoot") {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(12);
        continue;
      }
      if (name === "sidNoteCount") {
        expect(value).toBeGreaterThanOrEqual(0);
        continue;
      }
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("the empty feature set has the same shape as a computed one", () => {
    const computed = computeSidTonalFeatures({
      ...options,
      voiceFrames: layVoice(repeatToLength([60, 62, 64, 65], 6)),
    });
    expect(Object.keys(emptySidTonalFeatures()).sort()).toEqual(Object.keys(computed).sort());
  });
});
