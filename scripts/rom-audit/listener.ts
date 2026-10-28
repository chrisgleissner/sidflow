/** Listener policy v1. Register-equivalent playbacks avoid spectral work. If a
 * register/value/timing changes, compare short-time spectra, ignoring waveform
 * phase and DC. Evidence is bounded in memory and never averaged over a song:
 * a missing passage near the end counts just as much as one at the beginning.
 * Thresholds are engineering choices validated with audible/silent controls,
 * not a claim of a calibrated human hearing model.
 */
import { createHash } from "node:crypto";
import { RegisterComparator, REGISTER_RETAIN_WINDOWS } from "./register-comparison.js";

export const LISTENER_POLICY = "listener-v1";
export const LISTENER_WINDOW = 1024; // 21.3 ms at 48 kHz, stereo
const RETAIN_WINDOWS = REGISTER_RETAIN_WINDOWS; // 256 ms retained before a trace mismatch
const QUIET = 0.001; // -60 dBFS
const SPECTRAL_DISTANCE = 0.15;
export interface ListenerEvidence {
  policy: typeof LISTENER_POLICY;
  method: "register-equivalent" | "spectral";
  windows: number;
  differentWindows: number;
  firstDifferenceSample: number | null;
  maxDistance: number;
  maxAbsoluteDifference: number;
  audible: boolean;
}

/** Coalesce tiny WASM pulls before hashing. The byte stream and digest are unchanged. */
export class BufferedDigest {
  private readonly hash = createHash("sha256");
  private readonly buffer = new Uint8Array(65536);
  private used = 0;
  update(bytes: Uint8Array): void {
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(this.buffer.length - this.used, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + take), this.used);
      this.used += take; offset += take;
      if (this.used === this.buffer.length) { this.hash.update(this.buffer); this.used = 0; }
    }
  }
  digest(): string { this.hash.update(this.buffer.subarray(0, this.used)); return this.hash.digest("hex"); }
}

// Magnitudes of a Hann-windowed 512-point FFT after 2:1 downsampling, per
// channel. This keeps stereo, transients and frequency content through 12 kHz.
const FFT_SIZE = LISTENER_WINDOW / 2;
const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
const cos = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / FFT_SIZE));
const sin = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / FFT_SIZE));
function spectrum(pcm: Int16Array, channel: number): { magnitude: Float64Array; rms: number } {
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
  let mean = 0, energy = 0;
  for (let i = 0; i < FFT_SIZE; i++) { const value = (pcm[4 * i + channel]! + pcm[4 * i + 2 + channel]!) / 65536; real[i] = value; mean += value; }
  mean /= FFT_SIZE;
  for (let i = 0; i < FFT_SIZE; i++) { const value = real[i]! - mean; energy += value * value; real[i] = value * hann[i]!; }
  for (let i = 1, j = 0; i < FFT_SIZE; i++) {
    let bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const value = real[i]!; real[i] = real[j]!; real[j] = value; }
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) for (let start = 0; start < FFT_SIZE; start += size) {
    for (let j = 0; j < size / 2; j++) {
      const angle = j * FFT_SIZE / size, a = start + j, b = a + size / 2;
      const re = real[b]! * cos[angle]! - imaginary[b]! * sin[angle]!;
      const im = real[b]! * sin[angle]! + imaginary[b]! * cos[angle]!;
      real[b] = real[a]! - re; imaginary[b] = imaginary[a]! - im;
      real[a] = real[a]! + re; imaginary[a] = imaginary[a]! + im;
    }
  }
  return { magnitude: Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.hypot(real[i]!, imaginary[i]!)), rms: Math.sqrt(energy / FFT_SIZE) };
}
function spectralMetrics(a: Int16Array, b: Int16Array): { distance: number; absolute: number } {
  let worst = 0, absolute = 0;
  for (const channel of [0, 1]) {
    const x = spectrum(a, channel), y = spectrum(b, channel), level = Math.max(x.rms, y.rms);
    if (level < QUIET) continue;
    let difference = 0, energyA = 0, energyB = 0;
    for (let i = 1; i < x.magnitude.length; i++) {
      difference += (x.magnitude[i]! - y.magnitude[i]!) ** 2;
      energyA += x.magnitude[i]! ** 2; energyB += y.magnitude[i]! ** 2;
    }
    const distance = Math.sqrt(difference / Math.max(1e-20, energyA, energyB));
    if (distance * level >= QUIET) { worst = Math.max(worst, distance); absolute = Math.max(absolute, distance * level); }
    // A loud bass must not hide a missing quiet melody. Compare approximately
    // third-octave bands independently as well; local distance uses a 30%
    // threshold (scaled by 0.5 against the global 15% threshold).
    for (let start = 1; start < x.magnitude.length;) {
      const end = Math.min(x.magnitude.length, Math.max(start + 1, Math.ceil(start * 1.26)));
      let delta = 0, powerA = 0, powerB = 0;
      for (let i = start; i < end; i++) {
        delta += (x.magnitude[i]! - y.magnitude[i]!) ** 2;
        powerA += x.magnitude[i]! ** 2; powerB += y.magnitude[i]! ** 2;
      }
      const bandAbsolute = Math.sqrt(delta) / FFT_SIZE * Math.sqrt(8 / 3);
      if (bandAbsolute >= Math.max(QUIET, level * 0.03)) {
        worst = Math.max(worst, 0.5 * Math.sqrt(delta / Math.max(1e-20, powerA, powerB)));
        absolute = Math.max(absolute, bandAbsolute);
      }
      start = end;
    }
  }
  return { distance: worst, absolute };
}
export function spectralDifference(a: Int16Array, b: Int16Array): number { return spectralMetrics(a, b).distance; }

class AudioFrames {
  private partial = new Int16Array(LISTENER_WINDOW * 2);
  private used = 0;
  readonly ready: Int16Array[] = [];
  append(pcm: Int16Array): void {
    let offset = 0;
    while (offset < pcm.length) {
      const take = Math.min(this.partial.length - this.used, pcm.length - offset);
      this.partial.set(pcm.subarray(offset, offset + take), this.used);
      this.used += take; offset += take;
      if (this.used === this.partial.length) { this.ready.push(this.partial); this.partial = new Int16Array(LISTENER_WINDOW * 2); this.used = 0; }
    }
  }
  finish(): void {
    if (!this.used) return;
    // Preserve each channel's measured mean when padding the final FFT window.
    // Zero padding before DC removal would invent a click from a DC offset.
    const means = [0, 0];
    for (let i = 0; i < this.used; i++) means[i % 2]! += this.partial[i]!;
    for (let i = this.used; i < this.partial.length; i++) this.partial[i] = Math.round(means[i % 2]! / (this.used / 2));
    this.ready.push(this.partial); this.used = 0;
  }
}

/** Packed writes are [chip,address,value,PHI1 cycle]. Chunks need not have the
 * same lengths or end at the same write: compare continuous streams instead.
 */
export class ListenerComparator {
  private readonly register = new RegisterComparator();
  private readonly audio = [new AudioFrames(), new AudioFrames()] as const;
  private spectral = false;
  private readonly retained: { a: Int16Array; b: Int16Array; index: number }[] = [];
  private windows = 0;
  private bad = 0;
  private consecutive = 0;
  private first: number | null = null;
  private max = 0;
  private maxAbsolute = 0;
  private audible = false;
  append(side: 0 | 1, pcm: Int16Array, writes: Float64Array): void {
    this.audio[side].append(pcm);
    if (!this.spectral) this.register.append(side, writes);
  }
  compare(): boolean {
    if (!this.spectral) this.compareWrites();
    const [a, b] = this.audio;
    while (a.ready.length && b.ready.length) {
      const frame = { a: a.ready.shift()!, b: b.ready.shift()!, index: this.windows++ };
      if (this.spectral) this.measure(frame);
      else { this.retained.push(frame); if (this.retained.length > RETAIN_WINDOWS) this.retained.shift(); }
    }
    return this.audible;
  }
  private compareWrites(): void {
    this.register.compare(this.windows);
    if (this.register.needsAudio) this.useSpectra();
  }
  /** A stopped decoder emits silence even if no later SID writes expose it. */
  forceAudio(): void { if (!this.spectral) this.useSpectra(); }
  private useSpectra(): void {
    this.spectral = true;
    for (const frame of this.retained) this.measure(frame);
    this.retained.length = 0; this.register.clear();
  }
  private measure(frame: { a: Int16Array; b: Int16Array; index: number }): void {
    if (this.audible) return;
    const metrics = spectralMetrics(frame.a, frame.b), distance = metrics.distance;
    this.maxAbsolute = Math.max(this.maxAbsolute, metrics.absolute);
    this.max = Math.max(this.max, distance);
    if (distance > SPECTRAL_DISTANCE) {
      this.bad++; this.consecutive++; this.first ??= frame.index * LISTENER_WINDOW * 2;
      if (this.consecutive >= 2 || this.bad >= 3 || (distance > 0.8 && metrics.absolute > 0.03)) this.audible = true;
    } else this.consecutive = 0;
  }
  finish(): ListenerEvidence {
    if (!this.spectral && !this.register.complete()) this.useSpectra();
    this.audio[0].finish(); this.audio[1].finish(); this.compare();
    return { policy: LISTENER_POLICY, method: this.spectral ? "spectral" : "register-equivalent", windows: this.windows,
      differentWindows: this.bad, firstDifferenceSample: this.audible ? this.first : null, maxDistance: this.max, maxAbsoluteDifference: this.maxAbsolute, audible: this.audible };
  }
}
