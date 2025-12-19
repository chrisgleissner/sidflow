import { Buffer } from "node:buffer";

export interface WavPcmInfo {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataStart: number;
  dataLength: number;
}

export interface AnalysisWindow {
  startSample: number;
  sampleCount: number;
  startSec: number;
  durationSec: number;
  totalDurationSec: number;
}

export function computeMinRenderSecForRepresentativeWindow(
  maxClassifySec: number,
  introSkipSec: number
): number {
  if (!Number.isFinite(maxClassifySec) || maxClassifySec <= 0) {
    return 0;
  }

  const resolvedIntroSkipSec =
    Number.isFinite(introSkipSec) && introSkipSec > 0 ? introSkipSec : 30;

  // To skip intros by `introSkipSec` while still having a full classify window available,
  // a capped render must cover at least: introSkipSec + maxClassifySec.
  // Also enforce a floor of 20s to avoid overly short renders.
  return Math.max(20, resolvedIntroSkipSec + maxClassifySec);
}

export function resolveRepresentativeAnalysisWindow(
  buffer: Buffer,
  header: WavPcmInfo,
  maxDurationSec?: number,
  introSkipSec?: number
): AnalysisWindow {
  const bytesPerSample = header.bitsPerSample / 8;
  const totalSamples = Math.floor(
    header.dataLength / (bytesPerSample * Math.max(1, header.numChannels))
  );
  const totalDurationSec = totalSamples > 0 ? totalSamples / header.sampleRate : 0;

  if (
    typeof maxDurationSec !== "number" ||
    !Number.isFinite(maxDurationSec) ||
    maxDurationSec <= 0 ||
    totalSamples <= 0
  ) {
    return {
      startSample: 0,
      sampleCount: Math.max(0, totalSamples),
      startSec: 0,
      durationSec: Math.max(0, totalDurationSec),
      totalDurationSec: Math.max(0, totalDurationSec),
    };
  }

  const requestedSamples = Math.max(1, Math.floor(maxDurationSec * header.sampleRate));
  const sampleCount = Math.min(totalSamples, requestedSamples);

  if (sampleCount >= totalSamples) {
    return {
      startSample: 0,
      sampleCount: Math.max(0, totalSamples),
      startSec: 0,
      durationSec: Math.max(0, totalDurationSec),
      totalDurationSec: Math.max(0, totalDurationSec),
    };
  }

  const maxStartSample = Math.max(0, totalSamples - sampleCount);

  // Try to avoid intros: skip a configurable number of seconds from the start.
  // If the audio is long enough, we deterministically select the window
  // [introSkipSec, introSkipSec + maxDurationSec] (e.g. 30s-45s).
  // Only deviate (do not skip) when the audio is not long enough.
  const resolvedIntroSkipSec =
    typeof introSkipSec === "number" && Number.isFinite(introSkipSec) && introSkipSec > 0
      ? introSkipSec
      : 30;
  const requestedSkipSamples = Math.max(0, Math.floor(resolvedIntroSkipSec * header.sampleRate));

  // If the audio is too short to honor the full intro skip, clamp to the latest
  // valid start sample so we still avoid as much of the intro as possible.
  const bestStart = Math.min(maxStartSample, requestedSkipSamples);

  return {
    startSample: bestStart,
    sampleCount,
    startSec: bestStart / header.sampleRate,
    durationSec: sampleCount / header.sampleRate,
    totalDurationSec: Math.max(0, totalDurationSec),
  };
}
