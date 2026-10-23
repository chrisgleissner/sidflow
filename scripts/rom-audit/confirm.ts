#!/usr/bin/env bun
/**
 * Shipping-engine confirmation of native screening results.
 *
 * The native renderer screens: it can deny, and it nominates candidates. Allow
 * evidence must come from the engine that ships (libsidplayfp-wasm SIDLite)
 * under CONSUMER_PROFILE. For each measured subtune, the reference (all three
 * ROMs) and every candidate mask run in lockstep, from fresh modules, through
 * the whole horizon. Per 256-event pull the PCM and the timed SID writes of each
 * variant must equal the reference exactly, or the variant must halt on an
 * illegal opcode while the reference keeps running. Nothing is buffered: memory
 * is independent of the horizon.
 *
 *   bun scripts/rom-audit/confirm.ts <run dir> <roms> [--workers N]
 *
 * Results append to <run dir>/confirmation.jsonl (fsynced); a rerun resumes.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { CONSUMER_PROFILE, screen, type Horizon } from "./methodology.js";
import { readCheckpoint } from "./checkpoint.js";
import { readVerifiedSid } from "./inputs.js";
import type { Execution } from "./analysis.js";

const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const json = (v: unknown): string => stringifyDeterministic(v as JsonValue, 0);
export const CONFIRMATION_SCHEMA = "sidflow-rom-wasm-confirmation-1";
export type Outcome = "identical" | "different" | "variant-halt" | "variant-error" | "reference-failed" | "trace-dropped";
export interface MaskResult {
  mask: number; outcome: Outcome; samples: number; writes: number;
  firstDifferenceSample: number | null; message: string; pcmSha256: string; traceSha256: string;
  /** Bind the confirmation to the exact native rows it screened; set by the coordinator. */
  measurementSha256?: string; referenceSha256?: string;
}
export interface JobResult {
  schema: typeof CONFIRMATION_SCHEMA; sha256: string; song: number; seconds: number; sampleRate: number; powerOnDelay: number;
  results: MaskResult[];
}
export interface RomImages { kernal: Uint8Array; basic: Uint8Array; chargen: Uint8Array }

const require = createRequire(new URL("../../packages/sidflow-classify/package.json", import.meta.url));
interface Context {
  configure(rate: number, stereo: boolean): boolean; setEmulationConfig(c: { powerOnDelay: number }): boolean;
  setSystemROMs(k: Uint8Array | null, b: Uint8Array, c: Uint8Array): boolean; loadSidBuffer(b: Uint8Array): boolean;
  setSidWriteTraceEnabled(on: boolean): void; render(n: number): Int16Array | null | undefined;
  getAndClearSidWriteTracesPacked(): Uint32Array | number[]; getDroppedSidWriteTraceCount(): number;
  getLastError(): string; delete(): void;
}
type Loader = (o: { engine: string; print: () => void }) => Promise<{ SidPlayerContext: new () => Context }>;
let loader: Loader | undefined;
async function loadModule(): Promise<{ SidPlayerContext: new () => Context }> {
  loader ??= (await import(require.resolve("libsidplayfp-wasm/dist/index.js"))).default as Loader;
  return loader({ engine: "sidlite", print: () => {} });
}

/** Render a ROM configuration exactly as the consumer profile specifies. */
class Lane {
  readonly pcm = createHash("sha256"); readonly trace = createHash("sha256");
  samples = 0; writes = 0; dropped = false; diverged = false; ended = ""; message = "";
  private constructor(readonly ctx: Context, readonly mask: number) {}
  static async open(bytes: Uint8Array, song: number, mask: number, roms: RomImages): Promise<Lane> {
    const module = await loadModule(), ctx = new module.SidPlayerContext(), lane = new Lane(ctx, mask);
    const patched = Buffer.from(bytes);
    patched.writeUInt16BE(song, 0x10);
    if (!ctx.configure(CONSUMER_PROFILE.sampleRate, CONSUMER_PROFILE.stereo) || !ctx.setEmulationConfig({ powerOnDelay: CONSUMER_PROFILE.powerOnDelay }) ||
      !ctx.setSystemROMs(mask & 1 ? roms.kernal : null, mask & 2 ? roms.basic : new Uint8Array(8192), mask & 4 ? roms.chargen : new Uint8Array(4096)) ||
      !ctx.loadSidBuffer(new Uint8Array(patched))) { const message = ctx.getLastError(); ctx.delete(); throw new Error(`WASM setup failed: ${message}`); }
    ctx.setSidWriteTraceEnabled(true);
    return lane;
  }
  /** One pull. Returns the PCM chunk and packed write scalars, or null when the engine stopped. */
  pull(): { pcm: Int16Array; writes: Uint32Array } | null {
    let chunk: Int16Array | null | undefined;
    try { chunk = this.ctx.render(256); } catch (error) {
      // The engine can surface a CPU halt as a thrown C++ exception instead of an empty render.
      this.message = this.ctx.getLastError() || `engine exception: ${error instanceof Error ? error.message : String(error)}`;
      this.ended = "threw";
      return null;
    }
    if (!chunk?.length) { this.message = this.ctx.getLastError(); this.ended = "stopped"; return null; }
    const packed = Uint32Array.from(this.ctx.getAndClearSidWriteTracesPacked());
    if (this.ctx.getDroppedSidWriteTraceCount() || packed.length % 4) this.dropped = true;
    return { pcm: chunk, writes: packed };
  }
  absorb(chunk: { pcm: Int16Array; writes: Uint32Array }, take: number): void {
    this.pcm.update(new Uint8Array(chunk.pcm.buffer, chunk.pcm.byteOffset, take * 2));
    this.trace.update(new Uint8Array(chunk.writes.buffer, chunk.writes.byteOffset, chunk.writes.byteLength));
    this.samples += take; this.writes += chunk.writes.length / 4;
  }
  close(): void { this.ctx.delete(); }
}
/** Everything the reference has produced, addressable by absolute index and trimmed behind the slowest lane. */
class History {
  private chunks: { start: number; data: ArrayLike<number> }[] = [];
  end = 0;
  push(data: ArrayLike<number>): void { this.chunks.push({ start: this.end, data }); this.end += data.length; }
  /** Does the history hold exactly `data` at [from, from + data.length)? Requires that range to be present. */
  equals(from: number, data: ArrayLike<number>): boolean {
    let position = from;
    for (const chunk of this.chunks) {
      const stop = chunk.start + chunk.data.length;
      if (stop <= position) continue;
      for (; position < stop && position - from < data.length; position++) if (chunk.data[position - chunk.start] !== data[position - from]) return false;
      if (position - from >= data.length) return true;
    }
    return position - from >= data.length;
  }
  firstDifference(from: number, data: ArrayLike<number>): number {
    for (let i = 0; i < data.length; i++) if (!this.equals(from + i, [data[i]!])) return from + i;
    return -1;
  }
  trim(before: number): void { while (this.chunks.length > 1 && this.chunks[0]!.start + this.chunks[0]!.data.length <= before) this.chunks.shift(); }
}

/**
 * The reference and every candidate run from fresh modules. The engine pulls 256 scheduler
 * events at a time, so two runs with identical output can pull different sample counts per
 * call; streams are therefore compared by absolute sample and write index, never chunk by chunk.
 * Event counts beyond the horizon may legitimately differ (each stream stops in the pull that
 * crosses it); every event inside the horizon is part of a compared prefix.
 */
export type Candidate = { mask: number; state: "compatible" | "incompatible" };
export async function confirmMasks(bytes: Uint8Array, song: number, seconds: number, candidates: Candidate[], roms: RomImages): Promise<JobResult["results"]> {
  const wanted = Math.round(seconds * CONSUMER_PROFILE.sampleRate) * 2;
  const masks = candidates.map(c => c.mask);
  const expectHalt = new Set(candidates.filter(c => c.state === "incompatible").map(c => c.mask));
  const reference = await Lane.open(bytes, song, 7, roms);
  const variants: Lane[] = [];
  const state = new Map<number, MaskResult>();
  const refPcm = new History(), refWrites = new History();
  let referenceFailure = "";
  const extendReference = (samples: number, scalars: number): boolean => {
    while (refPcm.end < samples || refWrites.end < scalars) {
      const chunk = reference.pull();
      if (!chunk) { referenceFailure = reference.message || "reference stopped"; return false; }
      if (reference.dropped) { referenceFailure = "trace-dropped"; return false; }
      refPcm.push(chunk.pcm); refWrites.push(chunk.writes);
    }
    return true;
  };
  try {
    for (const mask of masks) variants.push(await Lane.open(bytes, song, mask, roms));
    const active = new Set(variants);
    const scalars = new Map<Lane, number>(variants.map(v => [v, 0]));
    const finish = (lane: Lane, outcome: Outcome, first: number | null, message = ""): void => {
      state.set(lane.mask, { mask: lane.mask, outcome, samples: lane.samples, writes: lane.writes, firstDifferenceSample: first, message,
        pcmSha256: lane.pcm.digest("hex"), traceSha256: lane.trace.digest("hex") });
      active.delete(lane);
    };
    while (active.size) {
      for (const lane of [...active]) {
        if (lane.samples >= wanted) { finish(lane, lane.diverged ? "different" : "identical", null); continue; }
        const chunk = lane.pull();
        if (!chunk) {
          // Only an illegal opcode is evidence about the program; anything else is an anomaly.
          finish(lane, lane.message.startsWith("Illegal instruction $") ? "variant-halt" : "variant-error", null, lane.message);
          continue;
        }
        if (lane.dropped) { finish(lane, "trace-dropped", null); continue; }
        const take = Math.min(chunk.pcm.length, wanted - lane.samples);
        const writeStart = scalars.get(lane)!;
        if (!extendReference(lane.samples + take, writeStart + chunk.writes.length)) {
          for (const other of [...active]) finish(other, referenceFailure === "trace-dropped" ? "trace-dropped" : "reference-failed", null, referenceFailure);
          break;
        }
        const pcmEqual = refPcm.equals(lane.samples, chunk.pcm.subarray(0, take));
        const writesEqual = refWrites.equals(writeStart, chunk.writes);
        // A nominated CPU halt may follow earlier output differences: keep running to see it.
        if (expectHalt.has(lane.mask)) { if (!pcmEqual || !writesEqual) lane.diverged = true; scalars.set(lane, writeStart + chunk.writes.length); lane.samples += take; continue; }
        if (!pcmEqual || !writesEqual) {
          finish(lane, "different", pcmEqual ? null : refPcm.firstDifference(lane.samples, chunk.pcm.subarray(0, take)));
          continue;
        }
        lane.absorb(chunk, take); scalars.set(lane, writeStart + chunk.writes.length);
      }
      const slowest = Math.min(...[...active].map(l => l.samples), wanted);
      refPcm.trim(slowest); refWrites.trim(Math.min(...[...active].map(l => scalars.get(l)!), Number.MAX_SAFE_INTEGER));
    }
    for (const lane of variants) if (!state.has(lane.mask)) finish(lane, "variant-error", null, "confirmation ended without a result");
    return masks.map(mask => state.get(mask)!);
  } finally {
    for (const lane of variants) lane.close();
    reference.close();
  }
}

/** Bind confirmation results to the exact native rows they screened. */
export function bindConfirmation(results: MaskResult[], row: Execution): void {
  for (const r of results) { r.measurementSha256 = sha(json(row.matrix![r.mask])); r.referenceSha256 = sha(json(row.both)); }
}

/** Does the shipping-engine result reproduce what native screening nominated? */
export function verdictFromConfirmation(candidate: "compatible" | "incompatible" | "unknown", result: MaskResult | undefined,
  row: Execution, mask: number): boolean | "mismatch" | undefined {
  if (candidate === "unknown" || !result) return undefined;
  // A confirmation of different native rows (re-measured since) does not apply.
  if (result.measurementSha256 !== sha(json(row.matrix?.[mask])) || result.referenceSha256 !== sha(json(row.both))) return undefined;
  if (candidate === "compatible" && result.outcome === "identical" && result.samples === Math.round(row.seconds * CONSUMER_PROFILE.sampleRate) * 2) return true;
  if (candidate === "incompatible" && result.outcome === "variant-halt") return true;
  return "mismatch";
}

/** Candidate masks for a measured row, according to native screening. */
export function candidateMasks(row: Execution, horizon: Horizon): Candidate[] {
  const out: Candidate[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const verdict = screen(row.matrix?.[mask], row.both, row.repeat, row.seconds, horizon);
    if (verdict.state !== "unknown") out.push({ mask, state: verdict.state });
  }
  return out;
}

async function worker(romDirectory: string): Promise<void> {
  const rom = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(romDirectory, name)));
  const roms: RomImages = { kernal: rom("kernal.901227-03.bin"), basic: rom("basic.901226-01.bin"), chargen: rom("characters.901225-01.bin") };
  for await (const line of createInterface({ input: process.stdin })) {
    const job = JSON.parse(line) as { sha256: string; song: number; seconds: number; masks: Candidate[]; hex: string };
    const bytes = Buffer.from(job.hex, "hex");
    if (sha(bytes) !== job.sha256) throw new Error("Confirmation input checksum mismatch");
    const results = await confirmMasks(bytes, job.song, job.seconds, job.masks, roms);
    const result: JobResult = { schema: CONFIRMATION_SCHEMA, sha256: job.sha256, song: job.song, seconds: job.seconds,
      sampleRate: CONSUMER_PROFILE.sampleRate, powerOnDelay: CONSUMER_PROFILE.powerOnDelay, results };
    process.stdout.write(json(result).trimEnd() + "\n");
  }
}

async function coordinate(run: string, roms: string, workers: number): Promise<void> {
  const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8")) as { hvscRoot: string };
  const headers = JSON.parse(readFileSync(path.join(run, "headers.json"), "utf8")) as { path: string; sha256: string }[];
  const horizons = JSON.parse(readFileSync(path.join(run, "horizons.json"), "utf8")) as Record<string, Horizon[]>;
  const shaByPath = new Map(headers.map(h => [h.path, h.sha256]));
  const rows = readCheckpoint(path.join(run, "execution.jsonl"));
  const file = path.join(run, "confirmation.jsonl");
  const done = new Set<string>();
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    if (text && !text.endsWith("\n")) throw new Error("Truncated confirmation log; repair before resuming");
    for (const line of text.split("\n").filter(Boolean)) { const r = JSON.parse(line) as JobResult; done.add(`${r.sha256}#${r.song}#${r.seconds}`); }
  }
  const jobs: { sha256: string; song: number; seconds: number; masks: Candidate[]; file: string; row: Execution }[] = [];
  for (const row of rows.values()) {
    const relative = path.relative(manifest.hvscRoot, row.path), sha256 = shaByPath.get(relative), horizon = horizons[relative]?.[row.song - 1];
    if (!sha256 || !horizon) throw new Error(`Row without header or horizon: ${relative}#${row.song}`);
    const masks = candidateMasks(row, horizon);
    if (masks.length && !done.has(`${sha256}#${row.song}#${row.seconds}`)) jobs.push({ sha256, song: row.song, seconds: row.seconds, masks, file: row.path, row });
  }
  jobs.sort((a, b) => a.seconds - b.seconds || a.sha256.localeCompare(b.sha256) || a.song - b.song);
  console.log(`Confirming ${jobs.length} subtunes (${done.size} already confirmed) with ${workers} workers.`);
  const started = Date.now(); let next = 0, finished = 0;
  const progress = setInterval(() => console.log(`${finished}/${jobs.length} confirmed; ${((Date.now() - started) / 1000).toFixed(0)}s`), 30000);
  const slots = Array.from({ length: workers }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [import.meta.path, "--worker", roms], { stdio: ["pipe", "pipe", "inherit"] });
    let active: (typeof jobs)[number] | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error): void => { clearTimeout(timer); child.kill("SIGKILL"); reject(error); };
    const send = (): void => {
      clearTimeout(timer);
      active = jobs[next++];
      if (!active) { child.stdin.end(); return; }
      const job = active;
      timer = setTimeout(() => fail(new Error(`Confirmation timed out: ${job.file}#${job.song}`)), Math.max(180000, job.seconds * (1 + job.masks.length) * 400));
      try { child.stdin.write(JSON.stringify({ sha256: job.sha256, song: job.song, seconds: job.seconds, masks: job.masks, hex: readVerifiedSid(job.file, job.sha256).toString("hex") }) + "\n"); } catch (error) { fail(error as Error); }
    };
    createInterface({ input: child.stdout }).on("line", line => {
      try {
        if (!line.trim()) return;
        const result = JSON.parse(line) as JobResult;
        if (!active || result.sha256 !== active.sha256 || result.song !== active.song || result.seconds !== active.seconds) throw new Error("Confirmation result identity mismatch");
        bindConfirmation(result.results, active.row);
        const fd = openSync(file, "a");
        try { appendFileSync(fd, json(result).trimEnd() + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
        finished++; send();
      } catch (error) { fail(error as Error); }
    });
    child.on("error", fail);
    child.on("exit", code => { clearTimeout(timer); if (code !== 0 || active) reject(new Error(`Confirmation worker exited ${code} with active job`)); else resolve(); });
    send();
  }));
  try { await Promise.all(slots); } finally { clearInterval(progress); }
  console.log(`Confirmed ${finished} subtunes in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const main = args[0] === "--worker" ? worker(args[1]!) : (() => {
    const [run, roms] = args;
    if (!run || !roms) throw new Error("Usage: confirm.ts <run dir> <roms> [--workers N]");
    const flag = args.indexOf("--workers");
    return coordinate(path.resolve(run), path.resolve(roms), flag >= 0 ? Number(args[flag + 1]) : Math.max(1, availableParallelism() - 1));
  })();
  main.catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
