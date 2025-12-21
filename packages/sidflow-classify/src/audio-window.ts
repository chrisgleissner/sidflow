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
  const preferredStart = Math.min(maxStartSample, requestedSkipSamples);

  // Some tracks have long quiet intros/outros (or render anomalies). To avoid
  // selecting a near-silent analysis window, pick the most energetic window
  // among a small deterministic set of candidates.
  const frameBytes = bytesPerSample * Math.max(1, header.numChannels);
  const canSamplePcm =
    header.bitsPerSample === 16 &&
    frameBytes > 0 &&
    header.dataStart >= 0 &&
    header.dataStart + header.dataLength <= buffer.length;

  const clampStart = (s: number) => Math.max(0, Math.min(maxStartSample, Math.floor(s)));
  const secToSamples = (sec: number) => Math.floor(sec * header.sampleRate);

  const candidateStarts = Array.from(
    new Set([
      preferredStart,
      clampStart(preferredStart + secToSamples(5)),
      clampStart(preferredStart + secToSamples(10)),
      maxStartSample,
      0,
    ])
  ).sort((a, b) => a - b);

  const approximateRmsAt = (startSample: number): number => {
    if (!canSamplePcm) return 0;

    const maxFrames = Math.min(sampleCount, totalSamples - startSample);
    if (maxFrames <= 0) return 0;

    const stride = Math.max(1, Math.floor(maxFrames / 5000));
    let sumSquares = 0;
    let n = 0;

    for (let i = 0; i < maxFrames; i += stride) {
      const frameOffset = header.dataStart + (startSample + i) * frameBytes;
      if (frameOffset + frameBytes > header.dataStart + header.dataLength) break;

      let mono = 0;
      for (let ch = 0; ch < header.numChannels; ch++) {
        const sampleOffset = frameOffset + ch * bytesPerSample;
        const v = buffer.readInt16LE(sampleOffset) / 32768;
        mono += v;
      }
      mono /= Math.max(1, header.numChannels);
      sumSquares += mono * mono;
      n += 1;
    }

    if (n <= 0) return 0;
    return Math.sqrt(sumSquares / n);
  };

  let bestStart = preferredStart;
  if (canSamplePcm) {
    let bestRms = -1;
    for (const s of candidateStarts) {
      const rms = approximateRmsAt(s);
      if (rms > bestRms || (rms === bestRms && s === preferredStart)) {
        bestRms = rms;
        bestStart = s;
      }
    }

    // If the best window is still effectively silent, fall back to the preferred
    // start (so we don't accidentally bias toward the intro without evidence).
    if (bestRms >= 0 && bestRms < 1e-4) {
      bestStart = preferredStart;
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
