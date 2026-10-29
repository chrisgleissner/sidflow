/** Streaming per-window audio severity of one or more ROM-variant lanes against the reference lane
 * of the same engine. The reference runs once; every variant is consumed in lock-step, one 2,048-frame
 * window at a time, so memory stays at a few windows regardless of horizon (the full PCM of a
 * five-minute stereo render, 57 MB, is never held). The metric itself lives in severity-core.ts. */
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { NativeLane } from "../rom-audit/native-lanes.js";
import { SAMPLE_RATE } from "../rom-audit/wasm-lanes.js";
import { nativePaths, withSlots } from "./native.js";
import {
  SeverityStats, WINDOW_FRAMES, WindowAssembler, windowSpectrum, windowSeverityFromSpectra, type SeveritySummary,
} from "./severity-core.js";

export { SAMPLE_RATE };
export const WINDOW_SECONDS = WINDOW_FRAMES / SAMPLE_RATE;

/** A source of interleaved stereo Int16 PCM. `next` returns null at the end; after the end the
 * stream is treated as digital silence (a diagnosed CPU halt leaves the player silent). */
export interface PcmSource {
  next(): Promise<Int16Array | null>;
  /** true once the source ended early because the emulated CPU halted */
  readonly halted: boolean;
}

export interface LaneSeverity {
  summary: SeveritySummary;
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
  /** Next full window; silence once the source has ended. */
  async window(): Promise<Int16Array> {
    while (!this.assembler.available && !this.ended) {
      const chunk = this.produced < this.wanted ? await this.source.next() : null;
      if (!chunk) { this.ended = true; break; }
      const take = Math.min(chunk.length, this.wanted - this.produced);
      this.assembler.push(chunk.subarray(0, take));
      this.produced += take;
    }
    return this.assembler.take() ?? new Int16Array(WINDOW_FRAMES * 2);
  }
}

/** Compare every variant source with the reference source over `seconds` of 48 kHz audio. */
export async function severityFromSources(reference: PcmSource, variants: PcmSource[], seconds: number): Promise<LaneSeverity[]> {
  const wanted = Math.round(seconds * SAMPLE_RATE) * 2;
  const windows = Math.floor(wanted / (WINDOW_FRAMES * 2));
  const ref = new Stream(reference, wanted), vars = variants.map(source => new Stream(source, wanted));
  const stats = variants.map(() => new SeverityStats());
  for (let w = 0; w < windows; w++) {
    const spectrum = windowSpectrum(await ref.window());
    for (let i = 0; i < vars.length; i++) stats[i]!.add(windowSeverityFromSpectra(spectrum, windowSpectrum(await vars[i]!.window())));
  }
  return vars.map((stream, i) => ({ summary: stats[i]!.summary(), perWindow: stats[i]!.perWindow, producedSamples: stream.produced, halted: stream.source.halted }));
}

class NativeSource implements PcmSource {
  constructor(readonly lane: NativeLane) {}
  get halted(): boolean { return this.lane.cpuHalted; }
  async next(): Promise<Int16Array | null> {
    const chunk = await this.lane.pull();
    return chunk ? chunk.pcm : null;
  }
}

export interface NativeSeverity {
  lanes: Array<LaneSeverity & { mask: number; cpuSeconds: number }>;
  referenceCpuSeconds: number;
  referenceHalted: boolean;
}

/** Render the reference (mask 7) and each variant mask natively and compare them. Any native failure
 * other than a diagnosed CPU halt rejects: infrastructure faults must not read as silence. */
export function nativeSeverity(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, masks: number[]): Promise<NativeSeverity> {
  return withSlots(1 + masks.length, () => nativeSeverityUnqueued(engine, bytes, song, seconds, masks));
}
async function nativeSeverityUnqueued(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, masks: number[]): Promise<NativeSeverity> {
  const paths = nativePaths();
  const binary = paths.renderer[engine];
  const referenceLane = NativeLane.open(binary, paths.roms, bytes, song, seconds, 7);
  const variantLanes: NativeLane[] = [];
  try {
    for (const mask of masks) variantLanes.push(NativeLane.open(binary, paths.roms, bytes, song, seconds, mask));
    const results = await severityFromSources(new NativeSource(referenceLane), variantLanes.map(lane => new NativeSource(lane)), seconds);
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
