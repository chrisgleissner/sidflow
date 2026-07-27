/**
 * Shared measurement code for engine non-degradation checks.
 *
 * Used by both `test/engine-parity.test.ts` (the fast gate that runs on every CI
 * run) and `scripts/native-parity.mjs` (the formal comparison against a native
 * build of the same library). Keeping one implementation means the CI gate and
 * the deep analysis cannot drift apart in how they measure.
 *
 * The metric set is not arbitrary — each entry exists because a real defect
 * would have been caught by it:
 *
 *   dc        the SIDLite artifact carried +0.17 full-scale DC; no C64 audio
 *             path emits DC at all
 *   peak      that same artifact peaked at 0.95 where the hardware peaks at 0.40
 *   rms       an ~8 dB level deficit
 *   bands     the heap-use-after-free showed up as +10 dB from 3-10 kHz while
 *             leaving level and timing intact — only a spectral check sees it
 *   envelope  catches a tune that stops advancing (the no-ROM drone case) or
 *             loops, which a spectrum-only check would miss
 */

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;

/** Band edges in Hz. The 3-10 kHz bands are where the use-after-free showed up. */
export const BANDS = [
  [30, 100],
  [100, 300],
  [300, 1000],
  [1000, 3000],
  [3000, 6000],
  [6000, 10000],
  [10000, 16000],
];

/** RMS in 100 ms blocks: a coarse, compact fingerprint of how the tune evolves. */
const ENVELOPE_BLOCK_MS = 100;

function toMono(samples) {
  const frames = Math.floor(samples.length / CHANNELS);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < CHANNELS; c++) sum += samples[i * CHANNELS + c];
    mono[i] = sum / CHANNELS / 32768;
  }
  return mono;
}

/**
 * Goertzel-style band energy via a naive DFT over a Hann-windowed decimated
 * signal. Deliberately dependency-free: this has to run inside `bun test` with
 * no numeric stack available.
 */
function bandEnergies(mono) {
  const size = 4096;
  const hop = size;
  const energies = new Float64Array(BANDS.length);
  let frames = 0;

  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));

  for (let start = 0; start + size <= mono.length; start += hop) {
    frames++;
    // Accumulate power per band by summing |X(k)|^2 over the band's bins.
    for (let b = 0; b < BANDS.length; b++) {
      const [lo, hi] = BANDS[b];
      const kLo = Math.max(1, Math.ceil((lo * size) / SAMPLE_RATE));
      const kHi = Math.min(size / 2 - 1, Math.floor((hi * size) / SAMPLE_RATE));
      let power = 0;
      // Sub-sample the bins for speed; the band totals stay representative.
      const step = Math.max(1, Math.floor((kHi - kLo) / 24));
      let counted = 0;
      for (let k = kLo; k <= kHi; k += step) {
        let re = 0;
        let im = 0;
        const w = (2 * Math.PI * k) / size;
        for (let n = 0; n < size; n += 2) {
          const v = mono[start + n] * window[n];
          re += v * Math.cos(w * n);
          im -= v * Math.sin(w * n);
        }
        power += re * re + im * im;
        counted++;
      }
      energies[b] += counted > 0 ? power / counted : 0;
    }
  }

  return Array.from(energies, (value) => value / Math.max(1, frames));
}

function envelope(mono) {
  const block = Math.floor((SAMPLE_RATE * ENVELOPE_BLOCK_MS) / 1000);
  const out = [];
  for (let start = 0; start + block <= mono.length; start += block) {
    let sumSquares = 0;
    for (let i = 0; i < block; i++) sumSquares += mono[start + i] * mono[start + i];
    out.push(Math.sqrt(sumSquares / block));
  }
  return out;
}

/** Full metric set for one render. */
export function measure(samples) {
  const mono = toMono(samples);
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    sum += mono[i];
    sumSquares += mono[i] * mono[i];
    if (Math.abs(mono[i]) > peak) peak = Math.abs(mono[i]);
  }
  return {
    frames: mono.length,
    dc: sum / mono.length,
    rms: Math.sqrt(sumSquares / mono.length),
    peak,
    bandsDb: bandEnergies(mono).map((value) => 10 * Math.log10(value + 1e-30)),
    envelope: envelope(mono),
  };
}

/** Pearson correlation, used for the envelope shape and for waveform parity. */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Number.NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-30);
}

/** Sample-wise difference between two renders, reported in dBFS. */
export function differenceDbfs(a, b) {
  const n = Math.min(a.length, b.length);
  let sumSquares = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sumSquares += d * d;
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
  }
  return {
    samples: n,
    rmsDbfs: 20 * Math.log10(Math.sqrt(sumSquares / n) / 32768 + 1e-30),
    maxAbsLsb: maxAbs,
  };
}
