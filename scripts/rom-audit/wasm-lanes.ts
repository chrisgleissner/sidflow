/**
 * Lockstep WASM renders of one subtune, configured as C64 Commander configures its
 * players (read from its source, which is not modified): `libsidplayfp-wasm` 1.1.0,
 * 48 kHz stereo, the engine's default power-on delay, start-song header rewrite, ROMs
 * supplied before the tune, a reset after load, and 256-cycle pulls for SIDLite (the
 * engine's default for reSIDfp).
 *
 * The reference has all three authentic ROMs. Commander can only create two ROM sets:
 * KERNAL and BASIC together with CHARGEN left `null`, or nothing supplied. A `null` bank
 * is uninitialised memory in the consumer, so each set is rendered twice, with every
 * unsupplied bank filled with zeros and with 0xFF. Output that is identical in both
 * does not depend on the content of those banks.
 *
 * Every pull of a lane is compared exactly with the reference's pull: sample count, every
 * PCM sample and every packed SID write including its cycle. The engine hands out views
 * into WASM memory that the next call overwrites, so each chunk is copied immediately.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import type { EngineRun, LaneOutcome, LaneResult, ReferenceResult } from "./methodology.js";

export const AUDIT_PACKAGE = "libsidplayfp-wasm-audit";
export const SAMPLE_RATE = 48000;
export const PULL_CYCLES: Record<RomAuditEngine, number> = { sidlite: 256, residfp: 100000 };
/** Emulated seconds a diverged lane keeps running to see whether it executes an illegal opcode. */
export const HALT_PROBE_SECONDS = 30;
export interface RomImages { kernal: Uint8Array; basic: Uint8Array; chargen: Uint8Array }

const require = createRequire(import.meta.url);
const packageDirectory = (): string => path.dirname(require.resolve(`${AUDIT_PACKAGE}/package.json`));
/** SHA-256 of the files that define the engine build: the engine's WASM and the complete source archive. */
export function engineHashes(engine: RomAuditEngine): { sourceSha256: string; wasmSha256: string } {
  const base = path.join(packageDirectory(), "dist");
  const sha = (file: string): string => createHash("sha256").update(readFileSync(path.join(base, file))).digest("hex");
  return { sourceSha256: sha("complete-source.tar.gz"), wasmSha256: sha(engine === "sidlite" ? "sidlite/libsidplayfp.wasm" : "libsidplayfp.wasm") };
}

interface Context {
  configure(rate: number, stereo: boolean): boolean; setSystemROMs(k: Uint8Array | null, b: Uint8Array | null, c: Uint8Array | null): boolean;
  loadSidBuffer(b: Uint8Array): boolean; reset(): boolean; setSidWriteTraceEnabled(on: boolean): void;
  render(cycles: number): Int16Array | null | undefined; getAndClearSidWriteTracesPacked(): Float64Array;
  getDroppedSidWriteTraceCount(): number; getLastError(): string; delete(): void;
}
type ModuleFactory = (options: { engine: string; print: () => void; printErr: () => void }) => Promise<{ SidPlayerContext: new () => Context }>;
let factory: ModuleFactory | undefined;
/**
 * Every lane gets its own WASM instance. Two players created in one reSIDfp instance produce different PCM for
 * identical input (the write traces are equal), so lanes sharing an instance could never be compared exactly.
 * Fresh instances are bit-reproducible, which is what the repeat lane verifies for every subtune.
 */
async function loadModule(engine: RomAuditEngine): Promise<{ SidPlayerContext: new () => Context }> {
  factory ??= (await import(require.resolve(`${AUDIT_PACKAGE}/dist/index.js`))).default as ModuleFactory;
  return factory({ engine, print: () => {}, printErr: () => {} });
}

/** A bank in the consumer's terms: authentic image, `null` (never supplied) or a fill that stands for its unknown content. */
export type Bank = "authentic" | "null" | "zero" | "ff";
export interface RomConfig { kernal: Bank; basic: Bank; chargen: Bank }
/** Commander's "nothing supplied": setSystemROMs(null, null, null), which SidAudioEngine turns into no ROM call at all. */
export const UNTOUCHED: RomConfig = { kernal: "null", basic: "null", chargen: "null" };
const bankBytes = (bank: Bank, authentic: Uint8Array, size: number): Uint8Array | null =>
  bank === "authentic" ? authentic : bank === "null" ? null : new Uint8Array(size).fill(bank === "ff" ? 0xff : 0);

class Lane {
  readonly pcm = createHash("sha256"); readonly trace = createHash("sha256");
  samples = 0; writes = 0; dropped = false; message = "";
  private constructor(private readonly ctx: Context, private readonly pullCycles: number) {}
  static async open(engine: RomAuditEngine, bytes: Uint8Array, song: number, config: RomConfig, roms: RomImages): Promise<Lane> {
    const module = await loadModule(engine), ctx = new module.SidPlayerContext();
    // Same order as SidAudioEngine: configure, trace, ROMs (only when any is supplied), load, reset.
    const fail = (what: string): never => { const message = ctx.getLastError(); ctx.delete(); throw new Error(`${what}: ${message}`); };
    if (!ctx.configure(SAMPLE_RATE, true)) fail("configure");
    ctx.setSidWriteTraceEnabled(true);
    const kernal = bankBytes(config.kernal, roms.kernal, 8192), basic = bankBytes(config.basic, roms.basic, 8192), chargen = bankBytes(config.chargen, roms.chargen, 4096);
    if (kernal || basic || chargen) { if (!ctx.setSystemROMs(kernal, basic, chargen)) fail("setSystemROMs"); }
    const patched = Buffer.from(bytes);
    if (patched.length < 0x12) { ctx.delete(); throw new Error("SID buffer too small"); }
    const songs = patched.readUInt16BE(0x0e);
    patched.writeUInt16BE(Math.min(Math.max(1, song), Math.max(1, songs)), 0x10);
    if (!ctx.loadSidBuffer(new Uint8Array(patched))) fail("loadSidBuffer");
    if (!ctx.reset()) fail("reset");
    return new Lane(ctx, PULL_CYCLES[engine]);
  }
  /** One pull, copied out of WASM memory; null when the engine stopped (message holds why). */
  pull(): { pcm: Int16Array; writes: Float64Array } | null {
    let chunk: Int16Array | null | undefined;
    try { chunk = this.ctx.render(this.pullCycles); } catch (error) {
      // A CPU halt can surface as a thrown C++ exception; the engine still records the reason.
      this.message = this.ctx.getLastError() || `engine exception: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
    if (!chunk?.length) { this.message = this.ctx.getLastError() || "engine returned no samples"; return null; }
    const pcm = Int16Array.from(chunk);
    const writes = Float64Array.from(this.ctx.getAndClearSidWriteTracesPacked());
    if (this.ctx.getDroppedSidWriteTraceCount() || writes.length % 4) this.dropped = true;
    return { pcm, writes };
  }
  absorb(chunk: { pcm: Int16Array; writes: Float64Array }, take: number): void {
    this.pcm.update(new Uint8Array(chunk.pcm.buffer, 0, take * 2));
    this.trace.update(new Uint8Array(chunk.writes.buffer, 0, chunk.writes.byteLength));
    this.samples += take; this.writes += chunk.writes.length / 4;
  }
  close(): void { this.ctx.delete(); }
}
const samePull = (a: { pcm: Int16Array; writes: Float64Array }, b: { pcm: Int16Array; writes: Float64Array }): boolean => {
  if (a.pcm.length !== b.pcm.length || a.writes.length !== b.writes.length) return false;
  for (let i = 0; i < a.pcm.length; i++) if (a.pcm[i] !== b.pcm[i]) return false;
  for (let i = 0; i < a.writes.length; i++) if (a.writes[i] !== b.writes[i]) return false;
  return true;
};
const firstPcmDifference = (a: Int16Array, b: Int16Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
};
const isHalt = (message: string): boolean => message.startsWith("Illegal instruction $");

/** The four variant lanes: the two Commander ROM sets, each with its null banks filled twice. */
export const LANES: { set: "full" | "none"; fill: "zero" | "ff"; config: RomConfig }[] = [
  { set: "full", fill: "zero", config: { kernal: "authentic", basic: "authentic", chargen: "zero" } },
  { set: "full", fill: "ff", config: { kernal: "authentic", basic: "authentic", chargen: "ff" } },
  { set: "none", fill: "zero", config: { kernal: "null", basic: "zero", chargen: "zero" } },
  { set: "none", fill: "ff", config: { kernal: "null", basic: "ff", chargen: "ff" } },
];

/** Render one subtune on one engine: reference, a repeat of the reference, and the four variant lanes. */
export async function runEngine(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, roms: RomImages): Promise<EngineRun> {
  const wanted = Math.round(seconds * SAMPLE_RATE) * 2;
  const reference = await Lane.open(engine, bytes, song, { kernal: "authentic", basic: "authentic", chargen: "authentic" }, roms);
  const lanes: Lane[] = [];
  const outcomes = new Map<Lane, LaneResult & { halfway?: never }>();
  const labels = new Map<Lane, { set: "full" | "none"; fill: "zero" | "ff" }>();
  let repeat: ReferenceResult["repeat"] = "failed";
  let referenceOutcome: ReferenceResult["outcome"] = "clean", referenceMessage = "";
  try {
    const again = await Lane.open(engine, bytes, song, { kernal: "authentic", basic: "authentic", chargen: "authentic" }, roms);
    lanes.push(again);
    for (const spec of LANES) { const lane = await Lane.open(engine, bytes, song, spec.config, roms); lanes.push(lane); labels.set(lane, { set: spec.set, fill: spec.fill }); }
    const [repeatLane] = lanes;
    const result = (lane: Lane, outcome: LaneOutcome, first: number | null, message = ""): void => {
      const label = labels.get(lane) ?? { set: "full" as const, fill: "zero" as const };
      outcomes.set(lane, { ...label, outcome, samples: lane.samples, writes: lane.writes, firstDifferenceSample: first, message,
        pcmSha256: lane.pcm.digest("hex"), traceSha256: lane.trace.digest("hex") });
    };
    const active = new Set(lanes);
    const diverged: Lane[] = [];
    while (active.size) {
      if (reference.samples >= wanted) { for (const lane of active) result(lane, "identical", null); break; }
      const ref = reference.pull();
      if (!ref) { referenceOutcome = "failed"; referenceMessage = reference.message; for (const lane of active) result(lane, "reference-failed", null, reference.message); break; }
      if (reference.dropped) { referenceOutcome = "trace-dropped"; for (const lane of active) result(lane, "trace-dropped", null); break; }
      const take = Math.min(ref.pcm.length, wanted - reference.samples);
      for (const lane of [...active]) {
        const chunk = lane.pull();
        if (!chunk) { result(lane, isHalt(lane.message) ? "halt" : "error", null, lane.message); active.delete(lane); continue; }
        if (lane.dropped) { result(lane, "trace-dropped", null); active.delete(lane); continue; }
        if (!samePull(chunk, ref)) {
          // Divergence. The repeat of the reference must never diverge; a variant is probed for a halt below.
          result(lane, "different", reference.samples + firstPcmDifference(chunk.pcm, ref.pcm));
          lane.samples = reference.samples + chunk.pcm.length;
          active.delete(lane); if (lane !== repeatLane) diverged.push(lane);
          continue;
        }
        lane.absorb(chunk, take);
      }
      reference.absorb(ref, take);
    }
    // A diverged variant keeps running for a bounded time: executing an illegal opcode is evidence about the program.
    for (const lane of diverged) {
      const limit = Math.min(wanted, lane.samples + HALT_PROBE_SECONDS * SAMPLE_RATE * 2);
      while (lane.samples < limit) {
        const chunk = lane.pull();
        if (!chunk) { if (isHalt(lane.message)) { const first = outcomes.get(lane)!; outcomes.set(lane, { ...first, outcome: "halt", message: lane.message }); } break; }
        if (lane.dropped) break;
        lane.samples += chunk.pcm.length;
      }
    }
    repeat = outcomes.get(repeatLane!)?.outcome === "identical" ? "identical" : outcomes.get(repeatLane!)?.outcome === "different" ? "different" : "failed";
    const referenceResult: ReferenceResult = { outcome: referenceOutcome, samples: reference.samples, writes: reference.writes, message: referenceMessage,
      pcmSha256: reference.pcm.digest("hex"), traceSha256: reference.trace.digest("hex"), repeat };
    return { engine, reference: referenceResult, lanes: lanes.filter(l => l !== repeatLane).map(l => outcomes.get(l)!) };
  } finally {
    for (const lane of lanes) lane.close();
    reference.close();
  }
}

/** Render one lane on its own and return what it produced. Used to show that two ROM configurations are equivalent. */
export async function renderDigest(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, config: RomConfig, roms: RomImages):
  Promise<{ samples: number; writes: number; pcmSha256: string; traceSha256: string; ended: string }> {
  const wanted = Math.round(seconds * SAMPLE_RATE) * 2;
  const lane = await Lane.open(engine, bytes, song, config, roms);
  try {
    let ended = "horizon";
    while (lane.samples < wanted) {
      const chunk = lane.pull();
      if (!chunk) { ended = lane.message; break; }
      lane.absorb(chunk, Math.min(chunk.pcm.length, wanted - lane.samples));
    }
    return { samples: lane.samples, writes: lane.writes, pcmSha256: lane.pcm.digest("hex"), traceSha256: lane.trace.digest("hex"), ended };
  } finally { lane.close(); }
}
