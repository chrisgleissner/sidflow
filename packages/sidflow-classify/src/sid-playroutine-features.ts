/**
 * Playroutine and arrangement-texture features from the raw SID write trace.
 *
 * ## Why this is a distinct kind of information
 *
 * The classifier has three sources so far: spectral features from rendered audio,
 * register-state features (waveform mix, filter, voice roles), and note-level pitch
 * features. Measured on HVSC, adding more SPECTRAL dimensions bought almost nothing
 * — the learning curve moved 0.1791 to 0.1803 between 20 and 24 dimensions — while
 * adding PITCH, a genuinely different kind of information, was worth +18.8% once the
 * useful dimensions were selected.
 *
 * This module adds a fourth kind: the behaviour of the code that generated the
 * music. A composer does not write each tune's player from scratch; they reuse a
 * playroutine, and a playroutine has a characteristic signature in how it drives the
 * chip — how many writes per frame, which registers it touches and in what
 * proportion, whether it runs once per frame or two, three or four times, and how
 * regularly. None of that is visible in the rendered audio's spectrum, and none of
 * it is visible in the register STATE that the existing features summarise; it lives
 * in the pattern of writes.
 *
 * That makes it a promising direction on the same reasoning that made pitch one: the
 * measured finding driving this whole campaign is that composers are identified by
 * arrangement habits rather than by harmony, and which playroutine someone reaches
 * for is about as habitual as it gets.
 *
 * ## What is deliberately not here
 *
 * No attempt is made to identify a specific named playroutine. That would need a
 * signature database, would date badly, and would produce a nominal label unusable
 * in a distance function. These are continuous descriptors of driving behaviour.
 */

import type { SidWriteTrace } from "libsidplayfp-wasm";

import {
  resolveSidTraceFrameWindow,
  type CompactSidWriteTraceOptions,
} from "./sid-register-trace.js";

/** Voice register offsets within each 7-byte voice block. */
const VOICE_BLOCK = 7;
const VOICE_COUNT = 3;
const FILTER_FIRST = 0x15;
const FILTER_LAST = 0x17;
const MODE_VOLUME = 0x18;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export interface SidPlayroutineFeatures {
  /**
   * Writes per frame, normalised against a busy-but-plausible ceiling.
   *
   * A single-speed routine updating three voices touches on the order of a dozen
   * registers per frame; a multi-speed routine several times that. Normalising by 96
   * keeps ordinary tunes well inside the range without saturating the fast ones.
   */
  sidWritesPerFrame: number;
  /**
   * Playroutine call rate relative to the video frame, i.e. single, double, triple
   * or quadruple speed, estimated from how writes cluster within each frame and
   * normalised so 1x maps to 0 and 4x to 1.
   */
  sidMultiSpeedRatio: number;
  /** Share of writes going to each register group. These sum to 1. */
  sidWriteShareFrequency: number;
  sidWriteSharePulseWidth: number;
  sidWriteShareControl: number;
  sidWriteShareEnvelope: number;
  sidWriteShareFilter: number;
  sidWriteShareVolume: number;
  /**
   * How evenly writes are spread over the registers the routine touches, as a
   * normalised entropy. A routine rewriting everything every frame scores high; one
   * that only nudges a frequency scores low.
   */
  sidWriteSpreadEntropy: number;
  /**
   * Regularity of the per-frame write count, as 1 minus its coefficient of
   * variation. A metronomic driver scores near 1; one that bursts on note changes
   * and idles between them scores lower.
   */
  sidWriteRateRegularity: number;
  /** Fraction of analysed frames in which the routine wrote nothing at all. */
  sidSilentFrameRatio: number;
  /** Fraction of frames with exactly one, two, or three voices gated on. */
  sidVoiceCount1Ratio: number;
  sidVoiceCount2Ratio: number;
  sidVoiceCount3Ratio: number;
  /**
   * How much the number of sounding voices varies over time, normalised. Captures
   * arrangement dynamics — voices entering and dropping out — which a mean
   * polyphony figure averages away.
   */
  sidVoiceCountVariation: number;

  /**
   * Where in the video frame the routine does its work, as a mean position in
   * 0..1, and how tightly it holds that position.
   *
   * A playroutine is called from a raster interrupt at a fixed line, so the mean is
   * close to a constant of the routine rather than of the tune. The spread
   * distinguishes a fixed-raster call from one running in the main loop, and both
   * are properties of the driver, not of the music.
   */
  sidWriteFramePositionMean: number;
  sidWriteFramePositionSpread: number;
  /**
   * Share of writes that store the value already in that register.
   *
   * Some routines blindly rewrite their whole state every frame; others only write
   * what changed. That is a design decision of the driver and is invisible in the
   * resulting sound.
   */
  sidWriteRedundantRatio: number;
  /** How many of the 25 registers the routine ever touches, normalised. */
  sidWriteRegisterCoverage: number;
  /**
   * Entropy over transitions between register groups on consecutive writes,
   * normalised. Captures the routine's write ORDER — whether it walks voice by
   * voice or register-type by register-type — which the per-group shares cannot see.
   */
  sidWriteOrderEntropy: number;
  /** Share of voice-register writes going to each of the three voices. */
  sidWriteVoice1Share: number;
  sidWriteVoice2Share: number;
  sidWriteVoice3Share: number;
}

export function emptySidPlayroutineFeatures(): SidPlayroutineFeatures {
  return {
    sidWritesPerFrame: 0,
    sidMultiSpeedRatio: 0,
    sidWriteShareFrequency: 0,
    sidWriteSharePulseWidth: 0,
    sidWriteShareControl: 0,
    sidWriteShareEnvelope: 0,
    sidWriteShareFilter: 0,
    sidWriteShareVolume: 0,
    sidWriteSpreadEntropy: 0,
    sidWriteRateRegularity: 0,
    sidSilentFrameRatio: 1,
    sidVoiceCount1Ratio: 0,
    sidVoiceCount2Ratio: 0,
    sidVoiceCount3Ratio: 0,
    sidVoiceCountVariation: 0,
    sidWriteFramePositionMean: 0,
    sidWriteFramePositionSpread: 0,
    sidWriteRedundantRatio: 0,
    sidWriteRegisterCoverage: 0,
    sidWriteOrderEntropy: 0,
    sidWriteVoice1Share: 0,
    sidWriteVoice2Share: 0,
    sidWriteVoice3Share: 0,
  };
}

/** Which functional group a SID register address belongs to. */
function registerGroup(address: number): keyof Omit<
  SidPlayroutineFeatures,
  | "sidWritesPerFrame"
  | "sidMultiSpeedRatio"
  | "sidWriteSpreadEntropy"
  | "sidWriteRateRegularity"
  | "sidSilentFrameRatio"
  | "sidVoiceCount1Ratio"
  | "sidVoiceCount2Ratio"
  | "sidVoiceCount3Ratio"
  | "sidVoiceCountVariation"
  | "sidWriteFramePositionMean"
  | "sidWriteFramePositionSpread"
  | "sidWriteRedundantRatio"
  | "sidWriteRegisterCoverage"
  | "sidWriteOrderEntropy"
  | "sidWriteVoice1Share"
  | "sidWriteVoice2Share"
  | "sidWriteVoice3Share"
> | null {
  if (address >= FILTER_FIRST && address <= FILTER_LAST) return "sidWriteShareFilter";
  if (address === MODE_VOLUME) return "sidWriteShareVolume";
  if (address >= VOICE_COUNT * VOICE_BLOCK) return null;
  switch (address % VOICE_BLOCK) {
    case 0:
    case 1:
      return "sidWriteShareFrequency";
    case 2:
    case 3:
      return "sidWriteSharePulseWidth";
    case 4:
      return "sidWriteShareControl";
    case 5:
    case 6:
      return "sidWriteShareEnvelope";
    default:
      return null;
  }
}

function normalisedEntropy(counts: readonly number[]): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  const nonZero = counts.filter((value) => value > 0).length;
  if (total <= 0 || nonZero <= 1) return 0;
  let h = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    h -= p * Math.log2(p);
  }
  return clamp01(h / Math.log2(counts.length));
}

export interface ComputeSidPlayroutineFeaturesOptions extends CompactSidWriteTraceOptions {
  traces: readonly SidWriteTrace[];
}

export function computeSidPlayroutineFeatures(
  options: ComputeSidPlayroutineFeaturesOptions,
): SidPlayroutineFeatures {
  const window = resolveSidTraceFrameWindow(options);
  const { cyclesPerFrame, skipFrames, analysisFrames } = window;
  if (options.traces.length === 0 || analysisFrames <= 0) {
    return emptySidPlayroutineFeatures();
  }

  const firstCycle = skipFrames * cyclesPerFrame;
  const lastCycle = (skipFrames + analysisFrames) * cyclesPerFrame;

  const writesPerFrame = new Float64Array(analysisFrames);
  const groupCounts = new Map<string, number>();
  const perRegisterCounts = new Array<number>(0x19).fill(0);
  /** Write positions within each frame, for estimating the call rate. */
  const subFrameBuckets = new Float64Array(4);
  let totalWrites = 0;

  // Gate state per (chip, voice), carried forward so a frame with no CONTROL write
  // still reports the voices that are sounding.
  const gateOn = new Map<string, boolean>();
  const voicesPerFrame = new Int32Array(analysisFrames);

  // Driver-shape accumulators.
  let positionSum = 0;
  let positionSquareSum = 0;
  let redundantWrites = 0;
  const lastValue = new Map<number, number>();
  const groupTransitions = new Map<string, number>();
  let previousGroup: string | null = null;
  const voiceWrites = [0, 0, 0];

  const sorted = [...options.traces].sort((left, right) => left.cyclePhi1 - right.cyclePhi1);
  for (const trace of sorted) {
    if (trace.cyclePhi1 < firstCycle || trace.cyclePhi1 >= lastCycle) continue;
    const address = trace.address & 0xff;
    if (address >= 0x19) continue;

    const frame = Math.min(analysisFrames - 1, Math.floor((trace.cyclePhi1 - firstCycle) / cyclesPerFrame));
    writesPerFrame[frame]! += 1;
    perRegisterCounts[address]! += 1;
    totalWrites += 1;

    const group = registerGroup(address);
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);

    // Where in the frame the write landed. A single-speed routine concentrates its
    // writes in one quarter; a 4x routine spreads them across all four.
    const withinFrame = (trace.cyclePhi1 - firstCycle) / cyclesPerFrame - frame;
    subFrameBuckets[Math.min(3, Math.max(0, Math.floor(withinFrame * 4)))]! += 1;
    positionSum += withinFrame;
    positionSquareSum += withinFrame * withinFrame;

    const value = trace.value & 0xff;
    if (lastValue.get(address) === value) redundantWrites += 1;
    lastValue.set(address, value);

    if (group) {
      if (previousGroup !== null) {
        const key = `${previousGroup}>${group}`;
        groupTransitions.set(key, (groupTransitions.get(key) ?? 0) + 1);
      }
      previousGroup = group;
    }
    if (address < VOICE_COUNT * VOICE_BLOCK) {
      voiceWrites[Math.floor(address / VOICE_BLOCK)]! += 1;
    }

    if (address < VOICE_COUNT * VOICE_BLOCK && address % VOICE_BLOCK === 4) {
      gateOn.set(`${trace.sidNumber}:${Math.floor(address / VOICE_BLOCK)}`, (trace.value & 0x01) === 1);
    }
    // Recording the running gate count at each write approximates the sounding
    // voice count for that frame without a second pass over frame state.
    let sounding = 0;
    for (const on of gateOn.values()) if (on) sounding += 1;
    voicesPerFrame[frame] = Math.max(voicesPerFrame[frame]!, Math.min(3, sounding));
  }

  if (totalWrites === 0) {
    return emptySidPlayroutineFeatures();
  }

  const meanWrites = totalWrites / analysisFrames;
  let variance = 0;
  let silentFrames = 0;
  for (let frame = 0; frame < analysisFrames; frame += 1) {
    variance += (writesPerFrame[frame]! - meanWrites) ** 2;
    if (writesPerFrame[frame]! === 0) silentFrames += 1;
  }
  variance /= analysisFrames;
  const coefficientOfVariation = meanWrites > 0 ? Math.sqrt(variance) / meanWrites : 0;

  // Occupied quarters of the frame is a robust proxy for the call rate: it does not
  // depend on the absolute write count, which varies hugely between routines.
  const occupiedQuarters = [...subFrameBuckets].filter((count) => count > totalWrites * 0.05).length;

  const voiceHistogram = [0, 0, 0, 0];
  for (let frame = 0; frame < analysisFrames; frame += 1) {
    voiceHistogram[voicesPerFrame[frame]!]! += 1;
  }
  const meanVoices = voicesPerFrame.reduce((sum, value) => sum + value, 0) / analysisFrames;
  let voiceVariance = 0;
  for (let frame = 0; frame < analysisFrames; frame += 1) {
    voiceVariance += (voicesPerFrame[frame]! - meanVoices) ** 2;
  }
  voiceVariance /= analysisFrames;

  const share = (group: string): number => clamp01((groupCounts.get(group) ?? 0) / totalWrites);
  const meanPosition = positionSum / totalWrites;
  const positionVariance = Math.max(0, positionSquareSum / totalWrites - meanPosition * meanPosition);
  const touchedRegisters = perRegisterCounts.filter((count) => count > 0).length;
  const totalVoiceWrites = voiceWrites.reduce((sum, value) => sum + value, 0);
  const voiceShare = (index: number): number =>
    totalVoiceWrites > 0 ? clamp01(voiceWrites[index]! / totalVoiceWrites) : 0;

  return {
    sidWritesPerFrame: clamp01(meanWrites / 96),
    sidMultiSpeedRatio: clamp01((occupiedQuarters - 1) / 3),
    sidWriteShareFrequency: share("sidWriteShareFrequency"),
    sidWriteSharePulseWidth: share("sidWriteSharePulseWidth"),
    sidWriteShareControl: share("sidWriteShareControl"),
    sidWriteShareEnvelope: share("sidWriteShareEnvelope"),
    sidWriteShareFilter: share("sidWriteShareFilter"),
    sidWriteShareVolume: share("sidWriteShareVolume"),
    sidWriteSpreadEntropy: normalisedEntropy(perRegisterCounts),
    sidWriteRateRegularity: clamp01(1 - coefficientOfVariation),
    sidSilentFrameRatio: clamp01(silentFrames / analysisFrames),
    sidVoiceCount1Ratio: clamp01(voiceHistogram[1]! / analysisFrames),
    sidVoiceCount2Ratio: clamp01(voiceHistogram[2]! / analysisFrames),
    sidVoiceCount3Ratio: clamp01(voiceHistogram[3]! / analysisFrames),
    // Standard deviation of a value in 0..3, so 1.5 is the practical ceiling.
    sidVoiceCountVariation: clamp01(Math.sqrt(voiceVariance) / 1.5),
    sidWriteFramePositionMean: clamp01(meanPosition),
    // A uniform spread over the frame has sd ~0.289, so that is the practical max.
    sidWriteFramePositionSpread: clamp01(Math.sqrt(positionVariance) / 0.289),
    sidWriteRedundantRatio: clamp01(redundantWrites / totalWrites),
    sidWriteRegisterCoverage: clamp01(touchedRegisters / 0x19),
    sidWriteOrderEntropy: normalisedEntropy([...groupTransitions.values()]),
    sidWriteVoice1Share: voiceShare(0),
    sidWriteVoice2Share: voiceShare(1),
    sidWriteVoice3Share: voiceShare(2),
  };
}
