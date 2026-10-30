/** Pure per-window audio severity for the ROM fidelity grade (see
 * doc/research/hvsc-rom-fidelity-grading.md). Input is interleaved stereo Int16 PCM.
 *
 * Window: 2,048 frames (the design's "46.4 ms" is 2,048 frames at 44.1 kHz; at the audit's
 * 48 kHz it is 42.7 ms). Preprocessing follows listener-v1: per channel, 2:1 downsample by
 * averaging adjacent frames, DC removal, Hann window, 1,024-point FFT (bins 1..511, 23.4 Hz
 * each).
 *
 * Distance D (frozen form). For channel c and band b (about third-octave bands as in listener-v1:
 * start = 1; end = max(start + 1, ceil(1.26 * start)) FFT bins, so the lowest bands are single bins):
 *   R = sum |X_ref|^2, Q = sum |X_var|^2 over the band's bins,
 *   floor = bins * QUIET^2 * N * 3/8     (energy of white noise at -60 dBFS RMS over those bins),
 *   L_R = 10 log10(max(R, floor) / floor), L_Q likewise                      band level above the floor, dB,
 *   ramp(x) = clamp((x - DEAD_ZONE_DB) / (SATURATION_DB - DEAD_ZONE_DB), 0, 1),
 *   e_cb      = ramp(|L_R - L_Q|)        distance of the variant's band level from the reference,
 *   e_full_cb = ramp(L_R)                distance of silence (level 0) from the reference.
 * The active set U holds the (channel, band) pairs whose louder side clears the floor by a margin:
 * max(L_R, L_Q) >= BAND_ACTIVE_DB. A window with an empty U is skipped like a quiet window.
 *   D_w = mean over U of e_cb, D_full = mean over U of e_full_cb, s_w = min(1, D_w / D_full).
 * Why band energies and not bin magnitudes (the listener-v1 form): bin magnitudes in the upper
 * bands are dominated by the resampler's aliasing products, whose per-bin realisation changes
 * with the sample phase; a 13-cycle shift of the same music then reads as 30-90% different.
 * Band energies average that out; the dead zone absorbs the residual few-dB band fluctuation,
 * which is far below what a listener can compare window by window.
 * Why the margin: near the floor, the band energy of noise-like content (a noise or oscillator
 * phase changed by a few cycles of re-timing) fluctuates by several dB between two renders of the
 * same music, and the ratio to the small e_full of such a band saturates s_w (independent white
 * noise scores about 0.2 at -50 dBFS and 1 at -55 dBFS without it). A band whose louder side is
 * at least BAND_ACTIVE_DB (the ramp's saturation level) above the floor has e_full = 1 whenever the
 * reference is the louder side, so a fluctuation of a few dB there stays a small fraction.
 * Each active band counts equally (log frequency), so a loud bass cannot hide a missing quiet
 * voice. A window is analysed only when either player has an AC RMS >= QUIET (-60 dBFS) on some
 * channel; otherwise it is skipped and does not count.
 */

export const WINDOW_FRAMES = 2048;
export const FFT_SIZE = WINDOW_FRAMES / 2;
export const QUIET = 0.001;
export const BAND_RATIO = 1.26;
export const DEAD_ZONE_DB = 3;
export const SATURATION_DB = 15;
/** A (channel, band) pair is compared only when its louder side is at least this far above the band floor, dB. */
export const BAND_ACTIVE_DB = 15;
const ramp = (db: number): number => Math.min(1, Math.max(0, (db - DEAD_ZONE_DB) / (SATURATION_DB - DEAD_ZONE_DB)));
const FLOOR_PER_BIN = QUIET * QUIET * FFT_SIZE * 3 / 8;

const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
const cosTable = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / FFT_SIZE));
const sinTable = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / FFT_SIZE));
const reversal = (() => {
  const table = new Uint16Array(FFT_SIZE);
  for (let i = 1, j = 0; i < FFT_SIZE; i++) {
    let bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit; table[i] = j;
  }
  return table;
})();

/** Band edges [start, end) in FFT bins, covering bins 1..FFT_SIZE/2-1. */
export const BANDS: ReadonlyArray<readonly [number, number]> = (() => {
  const bands: Array<readonly [number, number]> = [];
  const top = FFT_SIZE / 2;
  for (let start = 1; start < top;) {
    const end = Math.min(top, Math.max(start + 1, Math.ceil(start * BAND_RATIO)));
    bands.push([start, end]); start = end;
  }
  return bands;
})();

export interface WindowSpectrum {
  /** Magnitude |X| for bins 0..FFT_SIZE/2-1 per channel */
  magnitude: [Float64Array, Float64Array];
  /** AC RMS per channel on the [-1, 1] scale */
  rms: [number, number];
}

const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE), scratch = new Float64Array(FFT_SIZE);

function channelSpectrum(pcm: Int16Array, offset: number, channel: number): { magnitude: Float64Array; rms: number } {
  let mean = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    const at = offset + 4 * i + channel;
    const value = (pcm[at]! + pcm[at + 2]!) / 65536;
    scratch[i] = value; mean += value;
  }
  mean /= FFT_SIZE;
  let energy = 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    const value = scratch[i]! - mean;
    energy += value * value;
    real[reversal[i]!] = value * hann[i]!; imaginary[reversal[i]!] = 0;
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2, step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half, c = j * step;
        const re = real[b]! * cosTable[c]! - imaginary[b]! * sinTable[c]!;
        const im = real[b]! * sinTable[c]! + imaginary[b]! * cosTable[c]!;
        real[b] = real[a]! - re; imaginary[b] = imaginary[a]! - im;
        real[a] = real[a]! + re; imaginary[a] = imaginary[a]! + im;
      }
    }
  }
  const magnitude = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < magnitude.length; i++) magnitude[i] = Math.hypot(real[i]!, imaginary[i]!);
  return { magnitude, rms: Math.sqrt(energy / FFT_SIZE) };
}

/** Spectrum of one window of WINDOW_FRAMES stereo frames starting at Int16 index `offset`. */
export function windowSpectrum(pcm: Int16Array, offset = 0): WindowSpectrum {
  if (pcm.length < offset + WINDOW_FRAMES * 2) throw new Error("Incomplete window");
  const left = channelSpectrum(pcm, offset, 0), right = channelSpectrum(pcm, offset, 1);
  return { magnitude: [left.magnitude, right.magnitude], rms: [left.rms, right.rms] };
}

/** Severity of one window in [0, 1], or null when the window is below -60 dBFS for both players. */
export function windowSeverityFromSpectra(ref: WindowSpectrum, variant: WindowSpectrum): number | null {
  if (Math.max(ref.rms[0], ref.rms[1], variant.rms[0], variant.rms[1]) < QUIET) return null;
  let active = 0, distance = 0, full = 0;
  for (let channel = 0; channel < 2; channel++) {
    const x = ref.magnitude[channel]!, y = variant.magnitude[channel]!;
    for (const [start, end] of BANDS) {
      let r = 0, q = 0;
      for (let i = start; i < end; i++) { r += x[i]! * x[i]!; q += y[i]! * y[i]!; }
      const floor = (end - start) * FLOOR_PER_BIN;
      const levelR = 10 * Math.log10(Math.max(r, floor) / floor), levelQ = 10 * Math.log10(Math.max(q, floor) / floor);
      if (Math.max(levelR, levelQ) < BAND_ACTIVE_DB) continue;
      active++;
      distance += ramp(Math.abs(levelR - levelQ));
      full += ramp(levelR);
    }
  }
  if (active === 0) return null;
  if (full <= 0) return distance > 0 ? 1 : 0;
  return Math.min(1, distance / full);
}

export function windowSeverity(ref: Int16Array, variant: Int16Array, offset = 0): number | null {
  return windowSeverityFromSpectra(windowSpectrum(ref, offset), windowSpectrum(variant, offset));
}

export interface SeveritySummary {
  /** windows compared, analysed (>= -60 dBFS on either side), skipped */
  windows: number;
  analysed: number;
  skipped: number;
  mean: number;
  median: number;
  p95: number;
  max: number;
  /** analysed windows with s_w > 0.25 */
  aboveQuarter: number;
  /** Q = 1 - mean severity (1 when no window was analysed) */
  q: number;
  /** index (window number) of the first window with s_w > 0.25, null if none */
  firstBadWindow: number | null;
}

function quantile(sorted: Float64Array, fraction: number): number {
  if (!sorted.length) return 0;
  const position = fraction * (sorted.length - 1), lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (position - lo);
}

export class SeverityStats {
  private readonly values: number[] = [];
  private total = 0;
  private skippedWindows = 0;
  private bad = 0;
  private first: number | null = null;
  /** s_w per window, null for skipped windows (kept for excerpt selection and diagnostics) */
  readonly perWindow: Array<number | null> = [];
  add(severity: number | null): void {
    const index = this.perWindow.length;
    this.perWindow.push(severity);
    if (severity === null) { this.skippedWindows++; return; }
    this.values.push(severity); this.total += severity;
    if (severity > 0.25) { this.bad++; this.first ??= index; }
  }
  summary(): SeveritySummary {
    const sorted = Float64Array.from(this.values).sort();
    const mean = sorted.length ? this.total / sorted.length : 0;
    return {
      windows: this.perWindow.length, analysed: sorted.length, skipped: this.skippedWindows, mean,
      median: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), max: sorted.length ? sorted[sorted.length - 1]! : 0,
      aboveQuarter: this.bad, q: 1 - mean, firstBadWindow: this.first,
    };
  }
}

/** Incremental window assembler for a stereo Int16 stream. */
export class WindowAssembler {
  private pending: Int16Array[] = [];
  private size = 0;
  push(pcm: Int16Array): void { if (pcm.length) { this.pending.push(pcm); this.size += pcm.length; } }
  get available(): number { return Math.floor(this.size / (WINDOW_FRAMES * 2)); }
  /** Remove and return the next full window, or null. */
  take(): Int16Array | null {
    const need = WINDOW_FRAMES * 2;
    if (this.size < need) return null;
    const out = new Int16Array(need);
    let filled = 0;
    while (filled < need) {
      const head = this.pending[0]!, count = Math.min(need - filled, head.length);
      out.set(head.subarray(0, count), filled); filled += count;
      if (count === head.length) this.pending.shift(); else this.pending[0] = head.subarray(count);
    }
    this.size -= need;
    return out;
  }
  /** Remove and return the buffered remainder (less than a window) zero-padded to a full window, or null when empty. */
  takePadded(): Int16Array | null {
    if (!this.size) return null;
    const out = new Int16Array(WINDOW_FRAMES * 2);
    let filled = 0;
    for (const chunk of this.pending) { out.set(chunk.subarray(0, out.length - filled), filled); filled = Math.min(out.length, filled + chunk.length); }
    this.pending = []; this.size = 0;
    return out;
  }
}

/** Grade-quality Q from the mean severity with the optional perceptual exponent gamma (Q' = Q^gamma). */
export function qualityFromSummary(summary: SeveritySummary, gamma = 1): number {
  return Math.pow(Math.max(0, Math.min(1, summary.q)), gamma);
}
