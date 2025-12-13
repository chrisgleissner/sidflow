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
    Number.isFinite(introSkipSec) && introSkipSec > 0 ? introSkipSec : 10;

  // To skip intros by `introSkipSec` while still having a full classify window available,
  // a capped render must cover at least: introSkipSec + maxClassifySec.
  // Also enforce a floor of 20s to avoid overly short renders.
  return Math.max(20, resolvedIntroSkipSec + maxClassifySec);
}

function normalizeSample(buffer: Buffer, offset: number, bitsPerSample: number): number {
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32768.0;
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2147483648.0;
  }
  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128.0;
  }
  // Keep behavior aligned with existing extraction (8/16/32 supported).
  return 0;
}

function computeEnergyScore(
  buffer: Buffer,
  header: WavPcmInfo,
  startSample: number,
  sampleCount: number
): number {
  const bytesPerSample = header.bitsPerSample / 8;
  if (!Number.isFinite(bytesPerSample) || bytesPerSample <= 0) {
    return 0;
  }

  const maxProbeSamples = Math.min(sampleCount, Math.max(1, Math.floor(header.sampleRate * 2)));
  const maxProbePoints = 5_000;
  const stride = Math.max(1, Math.floor(maxProbeSamples / maxProbePoints));

  let sumSquares = 0;
  let count = 0;

  for (let i = 0; i < maxProbeSamples; i += stride) {
    const absoluteSample = startSample + i;
    let sum = 0;

    for (let ch = 0; ch < header.numChannels; ch++) {
      const sampleOffset =
        header.dataStart + (absoluteSample * header.numChannels + ch) * bytesPerSample;
      if (sampleOffset + bytesPerSample > header.dataStart + header.dataLength) {
        continue;
      }
      sum += normalizeSample(buffer, sampleOffset, header.bitsPerSample);
    }

    const mono = sum / Math.max(1, header.numChannels);
    sumSquares += mono * mono;
    count += 1;
  }

  return count > 0 ? sumSquares / count : 0;
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
  // Only deviate (reduce the skip) when the song is not long enough.
  const resolvedIntroSkipSec =
    typeof introSkipSec === "number" && Number.isFinite(introSkipSec) && introSkipSec > 0
      ? introSkipSec
      : 10;
  const requestedSkipSamples = Math.max(0, Math.floor(resolvedIntroSkipSec * header.sampleRate));
  const minStartSample = Math.min(maxStartSample, requestedSkipSamples);

  const candidateCount = 5;
  const candidates: number[] = [];
  for (let i = 0; i < candidateCount; i += 1) {
    const t = i / (candidateCount - 1);
    const start = Math.round(minStartSample + t * (maxStartSample - minStartSample));
    candidates.push(Math.max(0, Math.min(maxStartSample, start)));
  }

  let bestStart = candidates[0] ?? 0;
  let bestScore = -1;

  for (const start of new Set(candidates)) {
    const score = computeEnergyScore(buffer, header, start, sampleCount);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return {
    startSample: bestStart,
    sampleCount,
    startSec: bestStart / header.sampleRate,
    durationSec: sampleCount / header.sampleRate,
    totalDurationSec: Math.max(0, totalDurationSec),
  };
}
