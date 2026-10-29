/** ROM fidelity grade of one subtune: G per engine and ROM configuration, with all evidence.
 *
 *   bun scripts/rom-grade/grade.ts <sid file> [--song N] [--seconds S] [--engine residfp|sidlite|both]
 *       [--tolerance-ms 2] [--gamma 1] [--validate-audio] [--no-shortcuts]
 *
 * Flow per engine: trace the reference (mask 7) and the "none" (mask 0) and "kernal+basic"
 * (mask 3) lanes digitally; derive trace features and the class; grade 255/254 from the trace
 * alone when it proves them; otherwise render audio and grade from the severity. CHARGEN readers
 * are not special-cased: a KERNAL+BASIC lane of a program that never reads CHARGEN is identical
 * to the reference by construction (the audit's rule), unless --no-shortcuts. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { nativeSeverity } from "./audio-severity.js";
import { gradeFromQuality, type GradeBasis } from "./grade-core.js";
import { nativePaths, traceLane, type RomMask, type TraceRun } from "./native.js";
import { sidInfo, type SidInfo } from "./sid-info.js";
import { qualityFromSummary, WINDOW_FRAMES, type SeveritySummary } from "./severity-core.js";
import {
  clockHzOf, computeTraceFeatures, toleranceCycles, traceGrade, DEFAULT_TOLERANCE_MS, type Trace, type TraceFeatures,
} from "./trace-core.js";

export type LaneName = "none" | "kernal+basic";
export const LANES: ReadonlyArray<{ name: LaneName; mask: 0 | 3 }> = [{ name: "none", mask: 0 }, { name: "kernal+basic", mask: 3 }];
export const ENGINES: readonly RomAuditEngine[] = ["residfp", "sidlite"];

export interface GradeJob { path: string; song: number; seconds: number; sha256?: string }
export interface GradeOptions {
  engines?: readonly RomAuditEngine[];
  toleranceMs?: number;
  gamma?: number;
  /** render audio for every lane that is not bit-exact, even when the trace already decides (calibration gates 2 and 3) */
  validateAudio?: boolean;
  /** disable the CHARGEN-unread and no-playback shortcuts */
  noShortcuts?: boolean;
}

export interface SeverityRecord {
  windows: number; analysed: number; skipped: number; mean: number; median: number; p95: number; max: number; aboveQuarter: number;
  q: number; firstBadWindowSeconds: number | null; producedSeconds: number; halted: boolean;
}
export interface LaneGrade {
  grade: number | null;
  basis: GradeBasis;
  traceClass: string;
  bSubclass: string | null;
  rule: string;
  features: TraceFeatures;
  /** present when audio was rendered for this lane */
  severity: SeverityRecord | null;
  /** grade the audio alone would give (null when no audio was rendered) */
  audioGrade: number | null;
}
export interface EngineGrade {
  referenceWrites: number;
  referenceError: string;
  referenceChargenReads: number;
  lanes: Record<LaneName, LaneGrade>;
}
export interface SubtuneGrade {
  path: string; song: number; seconds: number; sha256: string;
  info: SidInfo;
  toleranceMs: number; toleranceCycles: number; gamma: number;
  engines: Partial<Record<RomAuditEngine, EngineGrade>>;
  /** Process CPU seconds per engine (nondeterministic; excluded when comparing runs) */
  cpu: Record<string, number>;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

function severityRecord(summary: SeveritySummary, produced: number, halted: boolean): SeverityRecord {
  return {
    windows: summary.windows, analysed: summary.analysed, skipped: summary.skipped, mean: round6(summary.mean), median: round6(summary.median),
    p95: round6(summary.p95), max: round6(summary.max), aboveQuarter: summary.aboveQuarter, q: round6(summary.q),
    firstBadWindowSeconds: summary.firstBadWindow === null ? null : round6(summary.firstBadWindow * WINDOW_FRAMES / 48000),
    producedSeconds: round6(produced / 2 / 48000), halted,
  };
}

function roundFeatures(f: TraceFeatures): TraceFeatures {
  return { ...f, alignmentSimilarity: round6(f.alignmentSimilarity), firstValueDivergenceSeconds: f.firstValueDivergenceSeconds === null ? null : round6(f.firstValueDivergenceSeconds) };
}

/** Grade one engine; `cpu` accumulates CPU seconds. */
export async function gradeEngine(engine: RomAuditEngine, bytes: Uint8Array, job: GradeJob, info: SidInfo, options: GradeOptions): Promise<{ result: EngineGrade; cpuSeconds: number }> {
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS, gamma = options.gamma ?? 1;
  const clockHz = clockHzOf(info.clock), tolerance = toleranceCycles(clockHz, toleranceMs);
  let cpuSeconds = 0;
  const reference = await traceLane(engine, bytes, job.song, job.seconds, 7);
  cpuSeconds += reference.cpuSeconds;
  const runs = new Map<LaneName, { run: TraceRun; shortcut: boolean }>();
  for (const lane of LANES) {
    if (lane.mask === 3 && reference.chargenReads === 0 && !options.noShortcuts) { runs.set(lane.name, { run: reference, shortcut: true }); continue; }
    const run = await traceLane(engine, bytes, job.song, job.seconds, lane.mask as RomMask);
    cpuSeconds += run.cpuSeconds;
    runs.set(lane.name, { run, shortcut: false });
  }
  const features = new Map<LaneName, TraceFeatures>();
  for (const lane of LANES) features.set(lane.name, computeTraceFeatures(reference.trace, runs.get(lane.name)!.run.trace, { clockHz, horizonSeconds: job.seconds, toleranceMs }));
  // Which lanes need audio?
  const needAudio: Array<{ name: LaneName; mask: number }> = [];
  for (const lane of LANES) {
    const f = features.get(lane.name)!;
    const decided = traceGrade(f, tolerance) ?? (f.cls === "G" && !options.noShortcuts ? 0 : null);
    const bitExact = f.cls === "A";
    if (!bitExact && (decided === null || options.validateAudio)) needAudio.push({ name: lane.name, mask: lane.mask });
  }
  const audio = new Map<LaneName, SeverityRecord>();
  const audioGrades = new Map<LaneName, number>();
  if (needAudio.length) {
    const measured = await nativeSeverity(engine, bytes, job.song, job.seconds, needAudio.map(l => l.mask));
    cpuSeconds += measured.referenceCpuSeconds;
    measured.lanes.forEach((lane, i) => {
      const name = needAudio[i]!.name;
      cpuSeconds += lane.cpuSeconds;
      audio.set(name, severityRecord(lane.summary, lane.producedSamples, lane.halted));
      audioGrades.set(name, gradeFromQuality(qualityFromSummary(lane.summary, gamma)));
    });
  }
  const lanes = {} as Record<LaneName, LaneGrade>;
  for (const lane of LANES) {
    const f = features.get(lane.name)!, severity = audio.get(lane.name) ?? null, audioGrade = audioGrades.get(lane.name) ?? null;
    let grade: number | null, basis: GradeBasis;
    const byTrace = traceGrade(f, tolerance);
    if (byTrace === 255) { grade = 255; basis = "trace-bit-exact"; }
    else if (byTrace === 254) { grade = 254; basis = "trace-retimed"; }
    else if (f.cls === "G" && !options.noShortcuts) { grade = 0; basis = "trace-no-playback"; }
    else if (audioGrade !== null) { grade = audioGrade; basis = "audio"; }
    else { grade = null; basis = "unmeasurable"; }
    lanes[lane.name] = { grade, basis, traceClass: f.cls, bSubclass: f.bSubclass, rule: f.rule, features: roundFeatures(f), severity, audioGrade };
  }
  return {
    cpuSeconds,
    result: { referenceWrites: features.get("none")!.referenceWrites, referenceError: reference.trace.error, referenceChargenReads: reference.chargenReads, lanes },
  };
}

export async function gradeSubtune(job: GradeJob, options: GradeOptions = {}): Promise<SubtuneGrade> {
  const bytes = readFileSync(job.path);
  const info = sidInfo(bytes);
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS, gamma = options.gamma ?? 1;
  const engines: Partial<Record<RomAuditEngine, EngineGrade>> = {};
  const cpu: Record<string, number> = {};
  const wanted = options.engines ?? ENGINES;
  const results = await Promise.all(wanted.map(engine => gradeEngine(engine, bytes, job, info, options)));
  wanted.forEach((engine, i) => { engines[engine] = results[i]!.result; cpu[engine] = round6(results[i]!.cpuSeconds); });
  const relative = job.path.startsWith(nativePaths().hvsc) ? path.relative(nativePaths().hvsc, job.path) : job.path;
  return {
    path: relative, song: job.song, seconds: job.seconds, sha256: job.sha256 ?? createHash("sha256").update(bytes).digest("hex"), info,
    toleranceMs, toleranceCycles: toleranceCycles(clockHzOf(info.clock), toleranceMs), gamma, engines, cpu,
  };
}

/** The deterministic part of a result: everything except process CPU time. */
export function withoutCpu(grade: SubtuneGrade): Omit<SubtuneGrade, "cpu"> {
  const { cpu: _cpu, ...rest } = grade;
  return rest;
}
export function stringifyGrade(grade: unknown): string { return stringifyDeterministic(JSON.parse(JSON.stringify(grade)) as JsonValue); }

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find(a => !a.startsWith("--") && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1]!.startsWith("--")));
  if (!file) throw new Error("usage: grade.ts <sid> [--song N] [--seconds S] [--engine residfp|sidlite|both] [--tolerance-ms T] [--gamma g] [--validate-audio] [--no-shortcuts]");
  const absolute = path.resolve(file);
  const song = Number(flag("--song") ?? 1);
  let seconds = flag("--seconds") === undefined ? NaN : Number(flag("--seconds"));
  if (!Number.isFinite(seconds)) {
    const { loadInventory } = await import("./inventory.js");
    const relative = path.relative(nativePaths().hvsc, absolute);
    const tune = (await loadInventory()).tunes.find(t => t.path === relative);
    const entry = tune?.songsList.find(s => s.song === song);
    if (!entry) throw new Error("Unknown subtune: pass --seconds for files outside HVSC");
    seconds = entry.seconds;
  }
  const engine = flag("--engine");
  const grade = await gradeSubtune({ path: absolute, song, seconds }, {
    engines: engine === "residfp" || engine === "sidlite" ? [engine] : ENGINES,
    toleranceMs: flag("--tolerance-ms") === undefined ? undefined : Number(flag("--tolerance-ms")),
    gamma: flag("--gamma") === undefined ? undefined : Number(flag("--gamma")),
    validateAudio: args.includes("--validate-audio"), noShortcuts: args.includes("--no-shortcuts"),
  });
  process.stdout.write(stringifyGrade(grade));
}
