/** Streaming per-window audio severity of one or more ROM-variant lanes against the reference lane
 * of the same engine. The reference runs once; every variant is consumed in lock-step, one 2,048-frame
 * window at a time, so memory stays at a few windows regardless of horizon (the full PCM of a
 * five-minute stereo render, 57 MB, is never held). The metric itself lives in severity-core.ts.
 *
 * Drift alignment: a variant given per-window frame offsets o_w (derived from the write traces, see
 * trace-core.ts driftOffsetFrames) is compared at reference window w against its own frames
 * [w*N + o_w, (w+1)*N + o_w), zero outside the frames it produced. It keeps only the samples later windows
 * can still read (from the smallest remaining window start), so its buffer is bounded by the spread of the
 * offsets plus one window and one chunk, not by the horizon. */
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { NativeLane } from "../rom-audit/native-lanes.js";
import { SAMPLE_RATE } from "../rom-audit/wasm-lanes.js";
import { nativePaths, withSlots } from "./native.js";
import {
  SeverityStats, WINDOW_FRAMES, WindowAssembler, windowSpectrum, windowSeverityFromSpectra, type SeveritySummary, type WindowSpectrum,
} from "./severity-core.js";

export { SAMPLE_RATE };
export const WINDOW_SECONDS = WINDOW_FRAMES / SAMPLE_RATE;

/** A source of interleaved stereo Int16 PCM. `next` returns null at the end; after the end the
 * stream is treated as digital silence (a diagnosed CPU halt leaves the player silent). */
export interface PcmSource {
  next(): Promise<Int16Array | null>;
  /** true once the source ended early because the emulated CPU halted */
  readonly halted: boolean;
  /** Consume the rest of the source and validate its terminal evidence; rejects on any failure. */
  finish?(): Promise<void>;
}

export interface LaneSeverity {
  summary: SeveritySummary;
  /** "trace-drift" when the variant was read at trace-derived per-window offsets, "lock-step" otherwise */
  alignment: "lock-step" | "trace-drift";
  perWindow: Array<number | null>;
  /** interleaved samples actually produced by the source before it ended */
  producedSamples: number;
  halted: boolean;
}

class Stream {
  readonly assembler = new WindowAssembler();
  produced = 0;
  ended = false;
  constructor(readonly source: PcmSource, readonly wanted: number) {}
  /** Next full window. A source that ended early (a diagnosed CPU halt) contributes the PCM it produced, with only the
   * missing tail zero-padded, then silence; an early end without a halt is an infrastructure fault and rejects. */
  async window(): Promise<Int16Array> {
    while (!this.assembler.available && !this.ended) {
      const chunk = this.produced < this.wanted ? await this.source.next() : null;
      if (!chunk) {
        this.ended = true;
        if (this.produced < this.wanted && !this.source.halted) throw new Error(`PCM source ended after ${this.produced} of ${this.wanted} samples without a CPU halt`);
        break;
      }
      const take = Math.min(chunk.length, this.wanted - this.produced);
      this.assembler.push(chunk.subarray(0, take));
      this.produced += take;
    }
    return this.assembler.take() ?? this.assembler.takePadded() ?? new Int16Array(WINDOW_FRAMES * 2);
  }
}

/** A variant read at per-window frame offsets (drift alignment). */
class AlignedStream {
  produced = 0;
  ended = false;
  private chunks: Array<{ start: number; data: Int16Array }> = [];
  /** keep[w]: smallest interleaved start of windows w.. (samples before it are never read again) */
  private readonly keep: Float64Array;
  constructor(readonly source: PcmSource, readonly wanted: number, readonly offsets: Int32Array) {
    const need = WINDOW_FRAMES * 2;
    this.keep = new Float64Array(offsets.length + 1);
    this.keep[offsets.length] = Number.POSITIVE_INFINITY;
    for (let w = offsets.length - 1; w >= 0; w--) this.keep[w] = Math.min(this.keep[w + 1]!, w * need + 2 * offsets[w]!);
  }
  /** Pull until `until` interleaved samples were produced (capped at `wanted`) or the source ended. */
  private async fill(until: number, store: boolean): Promise<void> {
    const target = Math.min(until, this.wanted);
    while (this.produced < target && !this.ended) {
      const chunk = await this.source.next();
      if (!chunk) {
        this.ended = true;
        if (this.produced < this.wanted && !this.source.halted) throw new Error(`PCM source ended after ${this.produced} of ${this.wanted} samples without a CPU halt`);
        break;
      }
      const take = Math.min(chunk.length, this.wanted - this.produced);
      if (store && take) this.chunks.push({ start: this.produced, data: chunk.subarray(0, take) });
      this.produced += take;
    }
  }
  async window(w: number): Promise<Int16Array> {
    const need = WINDOW_FRAMES * 2, start = w * need + 2 * this.offsets[w]!, end = start + need;
    await this.fill(end, true);
    const out = new Int16Array(need);
    for (const chunk of this.chunks) {
      const lo = Math.max(start, chunk.start), hi = Math.min(end, chunk.start + chunk.data.length);
      if (lo < hi) out.set(chunk.data.subarray(lo - chunk.start, hi - chunk.start), lo - start);
    }
    const keep = this.keep[w + 1]!;
    while (this.chunks.length && this.chunks[0]!.start + this.chunks[0]!.data.length <= keep) this.chunks.shift();
    return out;
  }
  /** Read the rest of the horizon (so producedSamples means the same as in lock-step) without keeping it. */
  async drain(): Promise<void> { this.chunks = []; await this.fill(this.wanted, false); }
  /** interleaved samples currently held (memory bound diagnostics) */
  get held(): number { return this.chunks.reduce((n, c) => n + c.data.length, 0); }
}

/** Optional per-window observer (diagnostics and candidate evaluation; never affects the result). */
export type WindowObserver = (variant: number, window: number, reference: WindowSpectrum, compared: WindowSpectrum) => void;

/** Compare every variant source with the reference source over `seconds` of 48 kHz audio. `alignments[i]`, when given, holds the
 * per-window frame offsets of variant i (drift alignment); a missing or null entry compares that variant in lock-step. */
export async function severityFromSources(reference: PcmSource, variants: PcmSource[], seconds: number,
  alignments: ReadonlyArray<Int32Array | null> = [], observe?: WindowObserver): Promise<LaneSeverity[]> {
  const wanted = Math.round(seconds * SAMPLE_RATE) * 2;
  const windows = Math.floor(wanted / (WINDOW_FRAMES * 2));
  const ref = new Stream(reference, wanted);
  const vars = variants.map((source, i) => {
    const offsets = alignments[i] ?? null;
    if (offsets && offsets.length !== windows) throw new Error(`Drift alignment has ${offsets.length} offsets for ${windows} windows`);
    return offsets ? new AlignedStream(source, wanted, offsets) : new Stream(source, wanted);
  });
  const stats = variants.map(() => new SeverityStats());
  for (let w = 0; w < windows; w++) {
    const spectrum = windowSpectrum(await ref.window());
    for (let i = 0; i < vars.length; i++) {
      const stream = vars[i]!;
      const compared = windowSpectrum(stream instanceof AlignedStream ? await stream.window(w) : await stream.window());
      stats[i]!.add(windowSeverityFromSpectra(spectrum, compared));
      observe?.(i, w, spectrum, compared);
    }
  }
  for (const stream of vars) if (stream instanceof AlignedStream) await stream.drain();
  // A failure after the last analysed window must still reject the measurement, so every source is drained to its end.
  for (const stream of [ref, ...vars]) await stream.source.finish?.();
  return vars.map((stream, i) => ({
    summary: stats[i]!.summary(), alignment: stream instanceof AlignedStream ? "trace-drift" as const : "lock-step" as const,
    perWindow: stats[i]!.perWindow, producedSamples: stream.produced, halted: stream.source.halted,
  }));
}

class NativeSource implements PcmSource {
  constructor(readonly lane: NativeLane) {}
  get halted(): boolean { return this.lane.cpuHalted; }
  async next(): Promise<Int16Array | null> {
    const chunk = await this.lane.pull();
    return chunk ? chunk.pcm : null;
  }
  /** Read to the terminal packet; NativeLane.pull rejects on missing or failed terminal evidence. */
  async finish(): Promise<void> {
    while (await this.lane.pull());
  }
}

export interface NativeSeverity {
  lanes: Array<LaneSeverity & { mask: number; cpuSeconds: number }>;
  referenceCpuSeconds: number;
  referenceHalted: boolean;
}

/** Render the reference (mask 7) and each variant mask natively and compare them. Any native failure
 * other than a diagnosed CPU halt rejects: infrastructure faults must not read as silence. */
export function nativeSeverity(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, masks: number[],
  alignments: ReadonlyArray<Int32Array | null> = [], observe?: WindowObserver): Promise<NativeSeverity> {
  return withSlots(1 + masks.length, () => nativeSeverityUnqueued(engine, bytes, song, seconds, masks, alignments, observe));
}
async function nativeSeverityUnqueued(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, masks: number[],
  alignments: ReadonlyArray<Int32Array | null>, observe?: WindowObserver): Promise<NativeSeverity> {
  const paths = nativePaths();
  const binary = paths.renderer[engine];
  const referenceLane = NativeLane.open(binary, paths.roms, bytes, song, seconds, 7);
  const variantLanes: NativeLane[] = [];
  try {
    for (const mask of masks) variantLanes.push(NativeLane.open(binary, paths.roms, bytes, song, seconds, mask));
    const results = await severityFromSources(new NativeSource(referenceLane), variantLanes.map(lane => new NativeSource(lane)), seconds, alignments, observe);
    return {
      lanes: results.map((result, i) => ({ ...result, mask: masks[i]!, cpuSeconds: variantLanes[i]!.cpuSeconds })),
      referenceCpuSeconds: referenceLane.cpuSeconds, referenceHalted: referenceLane.cpuHalted,
    };
  } finally {
    referenceLane.close();
    for (const lane of variantLanes) lane.close();
  }
}

if (import.meta.main) {
  const [file, songText, secondsText, engineText, ...maskTexts] = process.argv.slice(2);
  if (!file || !songText || !secondsText || !engineText) throw new Error("usage: audio-severity.ts <sid> <song> <seconds> <residfp|sidlite> [mask...]");
  const { readFileSync } = await import("node:fs");
  const masks = maskTexts.length ? maskTexts.map(Number) : [0, 3];
  const result = await nativeSeverity(engineText as RomAuditEngine, readFileSync(file), Number(songText), Number(secondsText), masks);
  const { stringifyDeterministic } = await import("../../packages/sidflow-common/src/json.js");
  console.log(stringifyDeterministic(JSON.parse(JSON.stringify({ ...result, lanes: result.lanes.map(l => ({ ...l, perWindow: undefined })) }))));
}
