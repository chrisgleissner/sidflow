import { FEATURE_EXTRACTION_SAMPLE_RATE } from "./essentia-features.js";

export const ESSENTIA_FRAME_SIZE = 2048;
export const ESSENTIA_HOP_SIZE = 1024;
export const ESSENTIA_MAX_FRAMES = 24;

export interface FrameExtractionBuffers {
  frame: Float32Array;
}

type OnlineStats = {
  count: number;
  sum: number;
  sumSq: number;
};

function add(stats: OnlineStats, x: number): void {
  if (!Number.isFinite(x)) return;
  stats.count += 1;
  stats.sum += x;
  stats.sumSq += x * x;
}

function mean(stats: OnlineStats): number | undefined {
  if (stats.count <= 0) return undefined;
  return stats.sum / stats.count;
}

function std(stats: OnlineStats): number | undefined {
  if (stats.count <= 0) return undefined;
  if (stats.count === 1) return 0;
  const m = stats.sum / stats.count;
  const variance = stats.sumSq / stats.count - m * m;
  return Math.sqrt(Math.max(0, variance));
}

function isArrayLikeNumber(x: unknown): x is ArrayLike<number> {
  return (
    !!x &&
    typeof x === "object" &&
    "length" in (x as any) &&
    typeof (x as any).length === "number" &&
    // Avoid treating strings as arrays of chars.
    typeof x !== "string"
  );
}

function isEssentiaVector(x: unknown): x is { delete(): void } {
  return !!x && typeof x === "object" && typeof (x as any).delete === "function";
}

function toNumberArray(essentia: any, x: unknown): number[] | null {
  if (!x) return null;
  if (Array.isArray(x)) return x;
  if (isArrayLikeNumber(x)) return Array.from(x);
  if (isEssentiaVector(x) && typeof essentia?.vectorToArray === "function") {
    return essentia.vectorToArray(x);
  }
  return null;
}

const hannCache = new Map<number, Float32Array>();

function getHannWindow(frameSize: number): Float32Array {
  const cached = hannCache.get(frameSize);
  if (cached) return cached;
  const win = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }
  hannCache.set(frameSize, win);
  return win;
}

function frameCountFor(audio: Float32Array, frameSize: number, hopSize: number): number {
  if (audio.length <= 0) return 0;
  if (audio.length <= frameSize) return 1;
  return 1 + Math.floor((audio.length - frameSize) / hopSize);
}

function selectFrameStarts(totalFrames: number, maxFrames: number): number[] {
  if (totalFrames <= maxFrames) {
    return Array.from({ length: totalFrames }, (_, i) => i);
  }
  const starts: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const t = (i * (totalFrames - 1)) / (maxFrames - 1);
    starts.push(Math.round(t));
  }
  // de-dup in case of rounding collisions
  return [...new Set(starts)].sort((a, b) => a - b);
}

export function extractEssentiaFrameSummaries(
  essentia: any,
  audioData: Float32Array,
  sampleRate: number = FEATURE_EXTRACTION_SAMPLE_RATE,
  buffers?: FrameExtractionBuffers
): Record<string, number> {
  const frameSize = ESSENTIA_FRAME_SIZE;
  const hopSize = ESSENTIA_HOP_SIZE;
  const window = getHannWindow(frameSize);

  const totalFrames = frameCountFor(audioData, frameSize, hopSize);
  const frameIndices = selectFrameStarts(totalFrames, ESSENTIA_MAX_FRAMES);

  const spectralCentroid = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;
  const spectralRolloff = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;
  const spectralFlatnessDb = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;
  const spectralCrest = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;
  const spectralEntropy = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;
  const spectralHfc = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;

  const mfccStats: OnlineStats[] = Array.from({ length: 5 }, () => ({ count: 0, sum: 0, sumSq: 0 }));

  const contrast = { count: 0, sum: 0, sumSq: 0 } satisfies OnlineStats;

  const frame = buffers?.frame ?? new Float32Array(frameSize);

  for (const frameIndex of frameIndices) {
    const start = frameIndex * hopSize;
    for (let i = 0; i < frameSize; i++) {
      const src = start + i;
      const sample = src < audioData.length ? audioData[src] : 0;
      frame[i] = sample * window[i];
    }

    const audioVector = essentia.arrayToVector(frame);
    try {
      const spectrumResult = essentia.Spectrum(audioVector);
      const spectrum = spectrumResult?.spectrum;
      if (!spectrum) {
        throw new Error("Essentia Spectrum() did not return a spectrum vector");
      }

      try {
        add(spectralCentroid, essentia.Centroid(spectrum)?.centroid);
        add(spectralRolloff, essentia.RollOff(spectrum)?.rollOff);
        add(spectralFlatnessDb, essentia.FlatnessDB(spectrum)?.flatnessDB);
        add(spectralCrest, essentia.Crest(spectrum)?.crest);
        add(spectralEntropy, essentia.Entropy(spectrum)?.entropy);
        add(spectralHfc, essentia.HFC(spectrum, sampleRate)?.hfc);

        const mfccRaw = essentia.MFCC(
          spectrum,
          2,
          sampleRate / 2,
          undefined,
          0,
          "dbamp",
          0,
          "unit_sum",
          40,
          13,
          sampleRate,
          1e-10,
          "power"
        )?.mfcc;

        const mfcc = toNumberArray(essentia, mfccRaw);
        if (mfcc) {
          // Ignore c0; keep c1..c5.
          // Essentia.js may return a JS array or a TypedArray depending on environment.
          for (let i = 0; i < mfccStats.length; i++) {
            add(mfccStats[i], mfcc[i + 1]);
          }
        }

        if (isEssentiaVector(mfccRaw)) {
          mfccRaw.delete();
        }

        const scRaw = essentia.SpectralContrast(
          spectrum,
          // Empirically, Essentia's default SpectralContrast parameters are stable
          // for our downsampled SID audio. Passing our analysis sampleRate causes
          // garbage outputs, and passing Nyquist can throw in some cases.
          // Keep these explicit to be deterministic across environments.
          frameSize,
          11000,
          20,
          0.4,
          6,
          22050,
          0.15
        )?.spectralContrast;

        const sc = toNumberArray(essentia, scRaw);
        if (sc) {
          // SpectralContrast can occasionally produce extreme magnitudes on some frames
          // (likely due to numerical issues on near-silent / low-energy frames). If we
          // include those, they dominate the aggregate mean/std and break station
          // similarity. Treat the whole frame as invalid if any coefficient is extreme.
          let ok = true;
          for (let i = 0; i < sc.length; i++) {
            const v = sc[i];
            if (!Number.isFinite(v) || Math.abs(v) > 1_000) {
              ok = false;
              break;
            }
          }
          if (ok) {
            for (let i = 0; i < sc.length; i++) add(contrast, sc[i]);
          }
        }

        if (isEssentiaVector(scRaw)) {
          scRaw.delete();
        }
      } finally {
        spectrum.delete();
      }
    } finally {
      audioVector.delete();
    }
  }

  const result: Record<string, number> = {
    essentiaFrameSize: frameSize,
    essentiaHopSize: hopSize,
    essentiaFrames: frameIndices.length,
  };

  const centroidMean = mean(spectralCentroid);
  if (centroidMean !== undefined) result.spectralCentroid = centroidMean;

  const rolloffMean = mean(spectralRolloff);
  if (rolloffMean !== undefined) result.spectralRolloff = rolloffMean;

  const flatnessMean = mean(spectralFlatnessDb);
  if (flatnessMean !== undefined) result.spectralFlatnessDb = flatnessMean;

  const crestMean = mean(spectralCrest);
  if (crestMean !== undefined) result.spectralCrest = crestMean;

  const entropyMean = mean(spectralEntropy);
  if (entropyMean !== undefined) result.spectralEntropy = entropyMean;

  const hfcMean = mean(spectralHfc);
  if (hfcMean !== undefined) result.spectralHfc = hfcMean;

  for (let i = 0; i < mfccStats.length; i++) {
    const m = mean(mfccStats[i]);
    const s = std(mfccStats[i]);
    if (m !== undefined) result[`mfccMean${i + 1}`] = m;
    if (s !== undefined) result[`mfccStd${i + 1}`] = s;
  }

  const contrastMean = mean(contrast);
  const contrastStd = std(contrast);
  if (contrastMean !== undefined) result.spectralContrastMean = contrastMean;
  if (contrastStd !== undefined) result.spectralContrastStd = contrastStd;

  return result;
}
