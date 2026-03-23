import { parseSidFile, type SidClock } from "@sidflow/common";
import { SidAudioEngine, type SidWriteTrace } from "@sidflow/libsidplayfp-wasm";
import { readFile } from "node:fs/promises";

import {
  PAL_FRAME_RATE,
  compactSidWriteTraceToFrames,
  resolveSidTraceFrameWindow,
  type CompactSidWriteTraceOptions,
  type SidTraceVideoStandard,
} from "./sid-register-trace.js";
import { RENDER_CYCLES_PER_CHUNK } from "./render/wav-renderer.js";
import type { ExtractFeaturesOptions, FeatureExtractor, FeatureVector } from "./index.js";

const SID_MAX_FILTER_CUTOFF = 0x07ff;
const SID_MAX_PULSE_WIDTH = 0x0fff;

interface VoiceFrameSummary {
  sidNumber: number;
  frame: number;
  voice: 1 | 2 | 3;
  frequencyWord: number;
  pulseWidth: number;
  gate: boolean;
  waveform: "noise" | "pulse" | "saw" | "triangle" | "mixed" | "none";
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

interface GlobalFrameSummary {
  sidNumber: number;
  frame: number;
  filterCutoff: number;
  filterResonance: number;
  volume: number;
}

export interface SidWriteTraceCapture {
  traces: SidWriteTrace[];
  clock: SidClock | SidTraceVideoStandard | undefined;
  skipSeconds?: number;
  analysisSeconds?: number;
}

export type SidWriteTraceProvider = (
  options: ExtractFeaturesOptions,
) => Promise<SidWriteTraceCapture>;

export interface CreateSidNativeFeatureExtractorOptions {
  traceProvider?: SidWriteTraceProvider;
}

export interface ExtractSidNativeFeaturesFromTraceOptions extends CompactSidWriteTraceOptions {
  traces: readonly SidWriteTrace[];
}

export function createHybridFeatureExtractor(
  wavFeatureExtractor: FeatureExtractor,
  sidNativeFeatureExtractor: FeatureExtractor,
): FeatureExtractor {
  return async (options) => {
    const [wavFeatures, sidFeatures] = await Promise.all([
      wavFeatureExtractor(options),
      sidNativeFeatureExtractor(options),
    ]);
    const merged: FeatureVector = {
      ...wavFeatures,
    };

    for (const [key, value] of Object.entries(sidFeatures)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        continue;
      }
      merged[key] = value;
    }

    return merged;
  };
}

export function createSidNativeFeatureExtractor(
  options: CreateSidNativeFeatureExtractorOptions = {},
): FeatureExtractor {
  const traceProvider = options.traceProvider ?? defaultSidWriteTraceProvider;

  return async (extractOptions) => {
    try {
      const capture = await traceProvider(extractOptions);
      return extractSidNativeFeaturesFromWriteTrace({
        traces: capture.traces,
        clock: capture.clock,
        skipSeconds: capture.skipSeconds,
        analysisSeconds: capture.analysisSeconds,
      });
    } catch {
      return createEmptySidNativeFeatures("unavailable", undefined);
    }
  };
}

export async function defaultSidWriteTraceProvider(
  options: ExtractFeaturesOptions,
): Promise<SidWriteTraceCapture> {
  const metadata = await parseSidFile(options.sidFile);
  const sidBuffer = new Uint8Array(await readFile(options.sidFile));
  const engine = new SidAudioEngine();

  try {
    engine.setSidWriteTraceEnabled(true);
    await engine.loadSidBuffer(sidBuffer);

    if (typeof options.songIndex === "number" && options.songIndex > 1) {
      await engine.selectSong(Math.max(0, options.songIndex - 1));
      engine.setSidWriteTraceEnabled(true);
    }

    const frameWindow = resolveSidTraceFrameWindow({ clock: metadata.clock });
    const totalSeconds = frameWindow.totalFrames / frameWindow.frameRate;
    await engine.renderSeconds(totalSeconds, RENDER_CYCLES_PER_CHUNK);

    return {
      traces: engine.getAndClearSidWriteTraces(),
      clock: metadata.clock,
    };
  } finally {
    engine.dispose();
  }
}

export function extractSidNativeFeaturesFromWriteTrace(
  options: ExtractSidNativeFeaturesFromTraceOptions,
): FeatureVector {
  const frameWindow = resolveSidTraceFrameWindow(options);
  const clock = frameWindow.clock;

  if (options.traces.length === 0) {
    return createEmptySidNativeFeatures("empty", clock);
  }

  const events = compactSidWriteTraceToFrames(options.traces, options);
  if (events.length === 0) {
    return createEmptySidNativeFeatures("empty", clock);
  }

  const { voiceFrames, globalFrames } = summarizeCanonicalEvents(events);
  const activeVoiceFrames = voiceFrames.filter((frame) => frame.gate || frame.frequencyWord > 0);
  const onsets = collectGateOnsets(voiceFrames, frameWindow.frameRate);
  const waveformRatios = computeWaveformRatios(activeVoiceFrames);
  const pwmActivity = computePulseWidthActivity(activeVoiceFrames);
  const filterStats = computeFilterStats(globalFrames);
  const roleRatios = computeVoiceRoleRatios(activeVoiceFrames);
  const adsrRatios = computeAdsrRatios(onsets);
  const arpeggioActivity = computeArpeggioActivity(activeVoiceFrames);
  const syncopation = computeSyncopation(onsets);
  const registerMotion = computeRegisterMotion(activeVoiceFrames, globalFrames);
  const melodicClarity = computeMelodicClarity({
    roleLeadRatio: roleRatios.lead,
    waveNoiseRatio: waveformRatios.noise,
    arpeggioActivity,
    rhythmicRegularity: computeRhythmicRegularity(onsets),
  });
  const voiceRoleEntropy = computeVoiceRoleEntropy(roleRatios);
  const d418WritesPerFrame = bucketAddressWritesByFrame(options.traces, 0x18, frameWindow);

  return {
    sidFeatureVariant: "sid-native",
    sidTraceClock: clock,
    sidTraceEventCount: options.traces.length,
    sidTraceFrameCount: frameWindow.analysisFrames,
    sidActiveVoiceFrameRatio: safeDivide(activeVoiceFrames.length, Math.max(1, frameWindow.analysisFrames * 3)),
    sidGateOnsetDensity: safeDivide(onsets.length, Math.max(1 / frameWindow.frameRate, frameWindow.analysisFrames / frameWindow.frameRate)),
    sidRhythmicRegularity: computeRhythmicRegularity(onsets),
    sidSyncopation: syncopation,
    sidArpeggioActivity: arpeggioActivity,
    sidWaveTriangleRatio: waveformRatios.triangle,
    sidWaveSawRatio: waveformRatios.saw,
    sidWavePulseRatio: waveformRatios.pulse,
    sidWaveNoiseRatio: waveformRatios.noise,
    sidWaveMixedRatio: waveformRatios.mixed,
    sidPwmActivity: pwmActivity,
    sidRegisterMotion: registerMotion,
    sidFilterCutoffMean: filterStats.cutoffMean,
    sidFilterMotion: filterStats.cutoffMotion,
    sidFilterResonanceMean: filterStats.resonanceMean,
    sidVolumeMean: filterStats.volumeMean,
    sidSamplePlaybackActivity: clamp01(safeDivide(sumNumbers(d418WritesPerFrame), Math.max(1, frameWindow.analysisFrames * 4))),
    sidRoleBassRatio: roleRatios.bass,
    sidRoleLeadRatio: roleRatios.lead,
    sidRoleAccompanimentRatio: roleRatios.accompaniment,
    sidVoiceRoleEntropy: voiceRoleEntropy,
    sidMelodicClarity: melodicClarity,
    sidAdsrPluckRatio: adsrRatios.pluck,
    sidAdsrPadRatio: adsrRatios.pad,
  };
}

function createEmptySidNativeFeatures(
  variant: "empty" | "unavailable",
  clock: SidClock | SidTraceVideoStandard | undefined,
): FeatureVector {
  return {
    sidFeatureVariant: variant,
    sidTraceClock: clock === "NTSC" ? "NTSC" : "PAL",
    sidTraceEventCount: 0,
    sidTraceFrameCount: 0,
    sidActiveVoiceFrameRatio: 0,
    sidGateOnsetDensity: 0,
    sidRhythmicRegularity: 0,
    sidSyncopation: 0,
    sidArpeggioActivity: 0,
    sidWaveTriangleRatio: 0,
    sidWaveSawRatio: 0,
    sidWavePulseRatio: 0,
    sidWaveNoiseRatio: 0,
    sidWaveMixedRatio: 0,
    sidPwmActivity: 0,
    sidRegisterMotion: 0,
    sidFilterCutoffMean: 0,
    sidFilterMotion: 0,
    sidFilterResonanceMean: 0,
    sidVolumeMean: 0,
    sidSamplePlaybackActivity: 0,
    sidRoleBassRatio: 0,
    sidRoleLeadRatio: 0,
    sidRoleAccompanimentRatio: 0,
    sidVoiceRoleEntropy: 0,
    sidMelodicClarity: 0,
    sidAdsrPluckRatio: 0,
    sidAdsrPadRatio: 0,
  };
}

function summarizeCanonicalEvents(events: ReturnType<typeof compactSidWriteTraceToFrames>): {
  voiceFrames: VoiceFrameSummary[];
  globalFrames: GlobalFrameSummary[];
} {
  const voiceFrames = new Map<string, VoiceFrameSummary>();
  const globalFrames = new Map<string, GlobalFrameSummary>();

  for (const event of events) {
    const voiceKey = `${event.sidNumber}:${event.frame}:${event.voice}`;
    if (event.register.startsWith("VOICE")) {
      const existing = voiceFrames.get(voiceKey) ?? {
        sidNumber: event.sidNumber,
        frame: event.frame,
        voice: event.voice,
        frequencyWord: 0,
        pulseWidth: 0,
        gate: false,
        waveform: "none",
        attack: 0,
        decay: 0,
        sustain: 0,
        release: 0,
      };

      const derived = event.derivedSignal;
      if (typeof derived.frequencyWord === "number") {
        existing.frequencyWord = derived.frequencyWord;
      }
      if (typeof derived.pulseWidth === "number") {
        existing.pulseWidth = derived.pulseWidth;
      }
      if (typeof derived.gate === "boolean") {
        existing.gate = derived.gate;
      }
      if (derived.waveform) {
        existing.waveform = derived.waveform;
      }
      if (typeof derived.attack === "number") {
        existing.attack = derived.attack;
      }
      if (typeof derived.decay === "number") {
        existing.decay = derived.decay;
      }
      if (typeof derived.sustain === "number") {
        existing.sustain = derived.sustain;
      }
      if (typeof derived.release === "number") {
        existing.release = derived.release;
      }

      voiceFrames.set(voiceKey, existing);
      continue;
    }

    if (event.voice !== 1) {
      continue;
    }

    const globalKey = `${event.sidNumber}:${event.frame}`;
    const existingGlobal = globalFrames.get(globalKey) ?? {
      sidNumber: event.sidNumber,
      frame: event.frame,
      filterCutoff: 0,
      filterResonance: 0,
      volume: 0,
    };
    const derived = event.derivedSignal;
    if (typeof derived.filterCutoff === "number") {
      existingGlobal.filterCutoff = derived.filterCutoff;
    }
    if (typeof derived.filterResonance === "number") {
      existingGlobal.filterResonance = derived.filterResonance;
    }
    if (typeof derived.volume === "number") {
      existingGlobal.volume = derived.volume;
    }
    globalFrames.set(globalKey, existingGlobal);
  }

  return {
    voiceFrames: [...voiceFrames.values()].sort(compareVoiceFrames),
    globalFrames: [...globalFrames.values()].sort((left, right) => left.sidNumber - right.sidNumber || left.frame - right.frame),
  };
}

function compareVoiceFrames(left: VoiceFrameSummary, right: VoiceFrameSummary): number {
  return left.sidNumber - right.sidNumber || left.voice - right.voice || left.frame - right.frame;
}

function collectGateOnsets(
  voiceFrames: VoiceFrameSummary[],
  frameRate: number,
): Array<VoiceFrameSummary & { timeSec: number }> {
  const onsets: Array<VoiceFrameSummary & { timeSec: number }> = [];
  const previousGate = new Map<string, boolean>();

  for (const frame of voiceFrames) {
    const key = `${frame.sidNumber}:${frame.voice}`;
    const previous = previousGate.get(key) ?? false;
    if (!previous && frame.gate) {
      onsets.push({
        ...frame,
        timeSec: frame.frame / frameRate,
      });
    }
    previousGate.set(key, frame.gate);
  }

  return onsets;
}

function computeRhythmicRegularity(onsets: Array<{ timeSec: number }>): number {
  if (onsets.length < 3) {
    return 0;
  }

  const intervals: number[] = [];
  for (let index = 1; index < onsets.length; index += 1) {
    intervals.push(onsets[index]!.timeSec - onsets[index - 1]!.timeSec);
  }

  const mean = sumNumbers(intervals) / intervals.length;
  if (mean <= 0) {
    return 0;
  }

  const variance = intervals.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / intervals.length;
  return clamp01(1 - Math.sqrt(Math.max(0, variance)) / mean);
}

function computeSyncopation(onsets: Array<{ timeSec: number }>): number {
  if (onsets.length < 3) {
    return 0;
  }

  const intervals: number[] = [];
  for (let index = 1; index < onsets.length; index += 1) {
    const interval = onsets[index]!.timeSec - onsets[index - 1]!.timeSec;
    if (interval > 0) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) {
    return 0;
  }

  const sorted = [...intervals].sort((left, right) => left - right);
  const dominantPeriod = sorted[Math.floor(sorted.length / 2)]!;
  if (dominantPeriod <= 0) {
    return 0;
  }

  let offBeatCount = 0;
  for (let index = 1; index < onsets.length; index += 1) {
    const phase = (onsets[index]!.timeSec / dominantPeriod) % 1;
    const distanceToGrid = Math.min(phase, 1 - phase);
    if (distanceToGrid > 0.2 && distanceToGrid < 0.45) {
      offBeatCount += 1;
    }
  }

  return clamp01(safeDivide(offBeatCount, Math.max(1, onsets.length - 1)));
}

function computeWaveformRatios(voiceFrames: VoiceFrameSummary[]): Record<"triangle" | "saw" | "pulse" | "noise" | "mixed", number> {
  const counts = {
    triangle: 0,
    saw: 0,
    pulse: 0,
    noise: 0,
    mixed: 0,
  };

  for (const frame of voiceFrames) {
    if (frame.waveform in counts) {
      counts[frame.waveform as keyof typeof counts] += 1;
    }
  }

  const total = Math.max(1, voiceFrames.length);
  return {
    triangle: counts.triangle / total,
    saw: counts.saw / total,
    pulse: counts.pulse / total,
    noise: counts.noise / total,
    mixed: counts.mixed / total,
  };
}

function computePulseWidthActivity(voiceFrames: VoiceFrameSummary[]): number {
  const grouped = groupVoiceFrames(voiceFrames.filter((frame) => frame.waveform === "pulse" || frame.waveform === "mixed"));
  const deltas: number[] = [];

  for (const frames of grouped.values()) {
    for (let index = 1; index < frames.length; index += 1) {
      deltas.push(Math.abs(frames[index]!.pulseWidth - frames[index - 1]!.pulseWidth) / SID_MAX_PULSE_WIDTH);
    }
  }

  return clamp01(safeDivide(sumNumbers(deltas), Math.max(1, deltas.length)));
}

function computeFilterStats(globalFrames: GlobalFrameSummary[]): {
  cutoffMean: number;
  cutoffMotion: number;
  resonanceMean: number;
  volumeMean: number;
} {
  if (globalFrames.length === 0) {
    return {
      cutoffMean: 0,
      cutoffMotion: 0,
      resonanceMean: 0,
      volumeMean: 0,
    };
  }

  const cutoffMean = safeDivide(sumNumbers(globalFrames.map((frame) => frame.filterCutoff / SID_MAX_FILTER_CUTOFF)), globalFrames.length);
  const resonanceMean = safeDivide(sumNumbers(globalFrames.map((frame) => frame.filterResonance / 0x0f)), globalFrames.length);
  const volumeMean = safeDivide(sumNumbers(globalFrames.map((frame) => frame.volume / 0x0f)), globalFrames.length);

  const grouped = new Map<number, GlobalFrameSummary[]>();
  for (const frame of globalFrames) {
    const existing = grouped.get(frame.sidNumber) ?? [];
    existing.push(frame);
    grouped.set(frame.sidNumber, existing);
  }

  const deltas: number[] = [];
  for (const frames of grouped.values()) {
    for (let index = 1; index < frames.length; index += 1) {
      deltas.push(Math.abs(frames[index]!.filterCutoff - frames[index - 1]!.filterCutoff) / SID_MAX_FILTER_CUTOFF);
    }
  }

  return {
    cutoffMean: clamp01(cutoffMean),
    cutoffMotion: clamp01(safeDivide(sumNumbers(deltas), Math.max(1, deltas.length))),
    resonanceMean: clamp01(resonanceMean),
    volumeMean: clamp01(volumeMean),
  };
}

function computeVoiceRoleRatios(voiceFrames: VoiceFrameSummary[]): Record<"bass" | "lead" | "accompaniment", number> {
  if (voiceFrames.length === 0) {
    return { bass: 0, lead: 0, accompaniment: 0 };
  }

  const grouped = groupVoiceFrames(voiceFrames);
  const perVoice = [...grouped.entries()].map(([key, frames]) => {
    const frequencies = frames.map((frame) => frame.frequencyWord).filter((value) => value > 0).sort((left, right) => left - right);
    const medianFrequency = frequencies.length === 0 ? 0 : frequencies[Math.floor(frequencies.length / 2)]!;
    const activeFrames = frames.length;
    return { key, activeFrames, medianFrequency };
  }).filter((entry) => entry.activeFrames > 0);

  if (perVoice.length === 0) {
    return { bass: 0, lead: 0, accompaniment: 0 };
  }

  const bassVoice = [...perVoice].sort((left, right) => left.medianFrequency - right.medianFrequency)[0]!;
  const leadVoice = [...perVoice].sort((left, right) => (right.medianFrequency * right.activeFrames) - (left.medianFrequency * left.activeFrames))[0]!;
  const totalActiveFrames = perVoice.reduce((sum, entry) => sum + entry.activeFrames, 0);

  let bass = 0;
  let lead = 0;
  let accompaniment = 0;
  for (const entry of perVoice) {
    const ratio = safeDivide(entry.activeFrames, totalActiveFrames);
    if (entry.key === bassVoice.key) {
      bass += ratio;
    } else if (entry.key === leadVoice.key) {
      lead += ratio;
    } else {
      accompaniment += ratio;
    }
  }

  if (leadVoice.key === bassVoice.key) {
    lead = Math.max(lead, bass);
    bass = lead;
    accompaniment = Math.max(0, 1 - lead);
  }

  return {
    bass: clamp01(bass),
    lead: clamp01(lead),
    accompaniment: clamp01(accompaniment),
  };
}

function computeAdsrRatios(onsets: VoiceFrameSummary[]): Record<"pluck" | "pad", number> {
  if (onsets.length === 0) {
    return { pluck: 0, pad: 0 };
  }

  let pluck = 0;
  let pad = 0;
  for (const onset of onsets) {
    if (onset.attack <= 3 && onset.release <= 4) {
      pluck += 1;
    }
    if (onset.attack >= 8 && onset.release >= 8) {
      pad += 1;
    }
  }

  return {
    pluck: safeDivide(pluck, onsets.length),
    pad: safeDivide(pad, onsets.length),
  };
}

function computeRegisterMotion(
  voiceFrames: VoiceFrameSummary[],
  globalFrames: GlobalFrameSummary[],
): number {
  const groupedVoiceFrames = groupVoiceFrames(voiceFrames);
  const motionSamples: number[] = [];

  for (const frames of groupedVoiceFrames.values()) {
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1]!;
      const current = frames[index]!;
      if (current.frame !== previous.frame + 1) {
        continue;
      }

      const frequencyMotion = clamp01(Math.abs(12 * Math.log2(Math.max(1, current.frequencyWord) / Math.max(1, previous.frequencyWord))) / 12);
      const pulseMotion = Math.abs(current.pulseWidth - previous.pulseWidth) / SID_MAX_PULSE_WIDTH;
      const gateMotion = current.gate === previous.gate ? 0 : 1;
      const waveformMotion = current.waveform === previous.waveform ? 0 : 1;
      motionSamples.push(clamp01((0.45 * frequencyMotion) + (0.25 * pulseMotion) + (0.15 * gateMotion) + (0.15 * waveformMotion)));
    }
  }

  const groupedGlobalFrames = new Map<number, GlobalFrameSummary[]>();
  for (const frame of globalFrames) {
    const existing = groupedGlobalFrames.get(frame.sidNumber) ?? [];
    existing.push(frame);
    groupedGlobalFrames.set(frame.sidNumber, existing);
  }

  for (const frames of groupedGlobalFrames.values()) {
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1]!;
      const current = frames[index]!;
      if (current.frame !== previous.frame + 1) {
        continue;
      }
      const filterMotion = Math.abs(current.filterCutoff - previous.filterCutoff) / SID_MAX_FILTER_CUTOFF;
      motionSamples.push(clamp01(filterMotion));
    }
  }

  return clamp01(safeDivide(sumNumbers(motionSamples), Math.max(1, motionSamples.length)));
}

function computeArpeggioActivity(voiceFrames: VoiceFrameSummary[]): number {
  const grouped = groupVoiceFrames(voiceFrames.filter((frame) => frame.gate && frame.frequencyWord > 0));
  let qualifyingChanges = 0;
  let totalChanges = 0;

  for (const frames of grouped.values()) {
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1]!;
      const current = frames[index]!;
      if (previous.frame + 1 !== current.frame || previous.frequencyWord <= 0 || current.frequencyWord <= 0) {
        continue;
      }

      totalChanges += 1;
      const deltaSemitones = Math.abs(12 * Math.log2(current.frequencyWord / previous.frequencyWord));
      if (deltaSemitones >= 1.5 && deltaSemitones <= 12) {
        qualifyingChanges += 1;
      }
    }
  }

  return clamp01(safeDivide(qualifyingChanges, Math.max(1, totalChanges)));
}

function computeMelodicClarity(options: {
  roleLeadRatio: number;
  waveNoiseRatio: number;
  arpeggioActivity: number;
  rhythmicRegularity: number;
}): number {
  return clamp01(
    (0.45 * options.roleLeadRatio) +
      (0.25 * (1 - options.waveNoiseRatio)) +
      (0.15 * (1 - options.arpeggioActivity)) +
      (0.15 * options.rhythmicRegularity),
  );
}

function computeVoiceRoleEntropy(roleRatios: Record<"bass" | "lead" | "accompaniment", number>): number {
  const values = [roleRatios.bass, roleRatios.lead, roleRatios.accompaniment].filter((value) => value > 0);
  if (values.length === 0) {
    return 0;
  }

  const entropy = -values.reduce((sum, value) => sum + (value * Math.log(value)), 0);
  return clamp01(entropy / Math.log(3));
}

function groupVoiceFrames(voiceFrames: VoiceFrameSummary[]): Map<string, VoiceFrameSummary[]> {
  const grouped = new Map<string, VoiceFrameSummary[]>();
  for (const frame of voiceFrames) {
    const key = `${frame.sidNumber}:${frame.voice}`;
    const existing = grouped.get(key) ?? [];
    existing.push(frame);
    grouped.set(key, existing);
  }
  return grouped;
}

function bucketAddressWritesByFrame(
  traces: readonly SidWriteTrace[],
  address: number,
  frameWindow: ReturnType<typeof resolveSidTraceFrameWindow>,
): number[] {
  const counts = new Array<number>(frameWindow.analysisFrames).fill(0);
  const maxCycle = frameWindow.totalFrames * frameWindow.cyclesPerFrame;

  for (const trace of traces) {
    if (trace.address !== address || trace.cyclePhi1 >= maxCycle) {
      continue;
    }

    const absoluteFrame = Math.floor(trace.cyclePhi1 / frameWindow.cyclesPerFrame);
    const analysisFrame = absoluteFrame - frameWindow.skipFrames;
    if (analysisFrame >= 0 && analysisFrame < counts.length) {
      counts[analysisFrame] += 1;
    }
  }

  return counts;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}