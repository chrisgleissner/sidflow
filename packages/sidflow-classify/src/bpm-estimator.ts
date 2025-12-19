export interface BpmEstimate {
  bpm: number;
  confidence: number;
  method: "autocorr";
}

export interface EstimateBpmOptions {
  minBpm?: number;
  maxBpm?: number;
  envelopeRateHz?: number;
  smoothSec?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function movingAverageInPlace(data: Float32Array, windowSize: number): void {
  if (windowSize <= 1) {
    return;
  }

  const n = data.length;
  const w = windowSize;
  const out = new Float32Array(n);

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i];
    if (i >= w) {
      sum -= data[i - w];
    }
    out[i] = sum / Math.min(w, i + 1);
  }

  data.set(out);
}

function buildOnsetEnvelope(
  audio: Float32Array,
  sampleRate: number,
  envelopeRateHz: number,
  smoothSec: number
): Float32Array {
  const hop = Math.max(1, Math.floor(sampleRate / envelopeRateHz));
  const n = Math.max(1, Math.floor(audio.length / hop));
  const env = new Float32Array(n);

  let prev = audio[0] ?? 0;
  let acc = 0;
  let accCount = 0;
  let outIndex = 0;

  for (let i = 0; i < audio.length; i++) {
    const x = audio[i];
    acc += Math.abs(x - prev);
    accCount++;
    prev = x;

    if (accCount >= hop) {
      env[outIndex++] = acc / accCount;
      acc = 0;
      accCount = 0;
      if (outIndex >= env.length) {
        break;
      }
    }
  }

  const smoothWindow = Math.max(1, Math.round(envelopeRateHz * smoothSec));
  movingAverageInPlace(env, smoothWindow);

  // Remove DC and normalize energy a bit.
  let mean = 0;
  for (let i = 0; i < env.length; i++) {
    mean += env[i];
  }
  mean /= env.length;
  let energy = 0;
  for (let i = 0; i < env.length; i++) {
    const v = env[i] - mean;
    env[i] = v;
    energy += v * v;
  }
  const denom = Math.sqrt(energy) || 1;
  for (let i = 0; i < env.length; i++) {
    env[i] /= denom;
  }

  return env;
}

function autocorrBestLag(
  env: Float32Array,
  minLag: number,
  maxLag: number
): { bestLag: number; bestScore: number; secondScore: number; meanScore: number } {
  const n = env.length;
  const lagLo = Math.max(1, minLag);
  const lagHi = Math.min(maxLag, n - 2);

  let bestLag = lagLo;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  let sumScores = 0;
  let count = 0;

  for (let lag = lagLo; lag <= lagHi; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) {
      s += env[i] * env[i - lag];
    }
    const score = s / (n - lag);

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondScore) {
      secondScore = score;
    }

    sumScores += score;
    count++;
  }

  return { bestLag, bestScore, secondScore, meanScore: count ? sumScores / count : 0 };
}

function bpmFromLag(envelopeRateHz: number, lag: number): number {
  return (60 * envelopeRateHz) / lag;
}

function maybePreferHalfTime(
  envelopeRateHz: number,
  bestLag: number,
  bestScore: number,
  minBpm: number,
  maxBpm: number,
  scoreAtLag: (lag: number) => number
): { lag: number; score: number } {
  const bpm = bpmFromLag(envelopeRateHz, bestLag);
  // Harmonic handling:
  // - When we're near the upper bound, consider half-time (avoid double-time lock).
  // - When we're near the lower bound, consider double-time (avoid halving too much).
  if (bpm >= 160) {
    const halfBpm = bpm / 2;
    if (halfBpm >= minBpm && halfBpm <= maxBpm) {
      const halfLag = Math.round(bestLag * 2);
      const halfScore = scoreAtLag(halfLag);
      if (Number.isFinite(halfScore) && halfScore >= bestScore * 0.92) {
        return { lag: halfLag, score: halfScore };
      }
    }
  }

  if (bpm <= 80) {
    const doubleBpm = bpm * 2;
    if (doubleBpm >= minBpm && doubleBpm <= maxBpm) {
      const doubleLag = Math.max(1, Math.round(bestLag / 2));
      const doubleScore = scoreAtLag(doubleLag);
      if (Number.isFinite(doubleScore) && doubleScore >= bestScore * 0.92) {
        return { lag: doubleLag, score: doubleScore };
      }
    }
  }

  return { lag: bestLag, score: bestScore };
}

export function estimateBpmAutocorr(
  audio: Float32Array,
  sampleRate: number,
  options: EstimateBpmOptions = {}
): BpmEstimate | null {
  const minBpm = options.minBpm ?? 60;
  const maxBpm = options.maxBpm ?? 200;
  const envelopeRateHz = options.envelopeRateHz ?? 200;
  const smoothSec = options.smoothSec ?? 0.05;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || audio.length < 256) {
    return null;
  }

  const env = buildOnsetEnvelope(audio, sampleRate, envelopeRateHz, smoothSec);
  if (env.length < envelopeRateHz) {
    return null;
  }

  const minLag = Math.floor((60 * envelopeRateHz) / maxBpm);
  const maxLag = Math.ceil((60 * envelopeRateHz) / minBpm);

  // Precompute scores on-demand for harmonic check.
  const scoreCache = new Map<number, number>();
  const scoreAtLag = (lag: number) => {
    if (scoreCache.has(lag)) {
      return scoreCache.get(lag)!;
    }
    if (lag <= 0 || lag >= env.length - 1) {
      return -Infinity;
    }
    let s = 0;
    for (let i = lag; i < env.length; i++) {
      s += env[i] * env[i - lag];
    }
    const score = s / (env.length - lag);
    scoreCache.set(lag, score);
    return score;
  };

  const base = autocorrBestLag(env, minLag, maxLag);
  if (!Number.isFinite(base.bestScore)) {
    return null;
  }

  const chosen = maybePreferHalfTime(
    envelopeRateHz,
    base.bestLag,
    base.bestScore,
    minBpm,
    maxBpm,
    scoreAtLag
  );

  let bpm = bpmFromLag(envelopeRateHz, chosen.lag);
  bpm = clamp(bpm, minBpm, maxBpm);

  // Confidence: peak prominence.
  const denom = Math.max(1e-9, Math.abs(chosen.score) + Math.abs(base.meanScore));
  const peakVsMean = (chosen.score - base.meanScore) / denom;
  const peakVsSecond = (chosen.score - base.secondScore) / (Math.abs(chosen.score) + 1e-9);

  const confidence = clamp(0.5 * peakVsMean + 0.5 * peakVsSecond, 0, 1);

  return { bpm, confidence, method: "autocorr" };
}
