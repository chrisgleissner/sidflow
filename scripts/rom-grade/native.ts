/** Native renderer access for the ROM fidelity grade. Reuses the ROM audit's process protocol:
 * the same renderer binaries, 48 kHz, power-on delay 8191, 256-event pulls. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { screenLane } from "../rom-audit/digital-screen.js";
import { traceFromFlat, type Trace } from "./trace-core.js";

export const repositoryRoot = path.resolve(import.meta.dir, "../..");

/** The directory holding workspace/ (the main checkout when running from a git worktree). */
export function workspaceRoot(): string {
  const fromEnv = process.env.SIDFLOW_WORKSPACE;
  if (fromEnv) return path.resolve(fromEnv);
  const local = path.join(repositoryRoot, "workspace");
  if (existsSync(path.join(local, "roms"))) return local;
  const common = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
  return path.join(path.dirname(common), "workspace");
}

export interface NativePaths { roms: string; hvsc: string; renderer: Record<RomAuditEngine, string>; output: string }
export function nativePaths(): NativePaths {
  const root = workspaceRoot();
  return {
    roms: path.join(root, "roms"), hvsc: path.join(root, "hvsc/C64Music"),
    renderer: { residfp: path.join(root, "rom-audit-screen-residfp/render"), sidlite: path.join(root, "rom-audit-screen-sidlite/render") },
    // ROM_GRADE_CALIBRATION_OUT: a separate calibration directory, e.g. to re-run the gates under a revised methodology
    output: process.env.ROM_GRADE_CALIBRATION_OUT ? path.resolve(process.env.ROM_GRADE_CALIBRATION_OUT) : path.join(root, "rom-grade-calibration"),
  };
}

/** Counting semaphore bounding concurrent native renderer processes (ROM_GRADE_WORKERS, default 16).
 * Requests are served in order and acquire all their slots at once, so mixed requests cannot deadlock. */
const capacity = Number(process.env.ROM_GRADE_WORKERS ?? 16);
let freeSlots = capacity;
const waiting: Array<{ count: number; resolve: () => void }> = [];
export async function withSlots<T>(count: number, work: () => Promise<T>): Promise<T> {
  const need = Math.min(count, capacity);
  if (waiting.length || freeSlots < need) await new Promise<void>(resolve => { waiting.push({ count: need, resolve }); });
  else freeSlots -= need;
  try { return await work(); } finally {
    freeSlots += need;
    while (waiting.length && waiting[0]!.count <= freeSlots) { const next = waiting.shift()!; freeSlots -= next.count; next.resolve(); }
  }
}

export type RomMask = 0 | 3 | 7;
export interface TraceRun { trace: Trace; chargenReads: number; cpuSeconds: number }

/** Digital (write-trace only) render of one lane. Follows the audit's screen order: bus-only first,
 * then warmup/detailed when the program reads stateful SID registers. */
export function traceLane(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, mask: RomMask): Promise<TraceRun> {
  return withSlots(1, () => traceLaneUnqueued(engine, bytes, song, seconds, mask));
}
async function traceLaneUnqueued(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, mask: RomMask): Promise<TraceRun> {
  const paths = nativePaths();
  let cpuSeconds = 0;
  let result = await screenLane(paths.renderer[engine], paths.roms, bytes, song, seconds, mask, true);
  cpuSeconds += result.cpuSeconds ?? 0;
  if (result.error === "stateful SID read requires detailed screen") {
    result = await screenLane(paths.renderer[engine], paths.roms, bytes, song, seconds, mask, false, true);
    cpuSeconds += result.cpuSeconds ?? 0;
  }
  if (result.error === "stateful SID read requires detailed screen") {
    result = await screenLane(paths.renderer[engine], paths.roms, bytes, song, seconds, mask, false);
    cpuSeconds += result.cpuSeconds ?? 0;
  }
  return { trace: traceFromFlat(result.writes, result.traceComplete, result.error), chargenReads: result.chargenReads, cpuSeconds };
}

export function readSid(file: string): Uint8Array { return readFileSync(file); }
