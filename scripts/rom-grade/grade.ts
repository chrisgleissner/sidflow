/** ROM fidelity grade of one subtune: G per engine and ROM configuration, with all evidence.
 *
 *   bun scripts/rom-grade/grade.ts <sid file> [--song N] [--seconds S] [--engine residfp|sidlite|both]
 *       [--tolerance-ms 2] [--gamma 1] [--validate-audio] [--no-shortcuts]
 *
 * Flow per engine: trace the reference (mask 7) and the "none" (mask 0) and "kernal+basic"
 * (mask 3) lanes digitally; derive trace features and the class; grade 255/254 from the trace
 * alone when it proves them; otherwise render audio and grade from the severity. A lane whose trace
 * proves the same notes in the same order (class B or I) but not the grade is compared drift-aligned:
 * each audio window is read at the trace-measured re-timing offset. CHARGEN readers are not
 * special-cased: a KERNAL+BASIC lane of a program that never reads CHARGEN is identical to the
 * reference by construction (the audit's rule), provided the reference ran to its end (no error
 * other than a diagnosed CPU halt), unless --no-shortcuts. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { nativeSeverity, SAMPLE_RATE, type NativeSeverity } from "./audio-severity.js";
import { DEFAULT_GAMMA, gradeFromQuality, type GradeBasis } from "./grade-core.js";
import { nativePaths, traceLane, type RomMask, type TraceRun } from "./native.js";
import { sidInfo, type SidInfo } from "./sid-info.js";
import { qualityFromSummary, WINDOW_FRAMES, type SeveritySummary } from "./severity-core.js";
import {
  clockHzOf, computeTraceFeatures, driftAligned, driftOffsetFrames, toleranceCycles, traceGrade, DEFAULT_TOLERANCE_MS, type TraceFeatures,
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
  /** "trace-drift": the variant was read at the trace-measured per-window offsets; "lock-step" otherwise */
  alignment: "lock-step" | "trace-drift";
  /** smallest and largest variant read offset in seconds (drift-aligned lanes only) */
  offsetRangeSeconds: [number, number] | null;
}

/** Native access, injectable for tests. */
export interface GradeDeps {
  traceLane: (engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, mask: RomMask) => Promise<TraceRun>;
  measure: (engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, masks: number[], alignments: ReadonlyArray<Int32Array | null>) => Promise<NativeSeverity>;
}
export const NATIVE_DEPS: GradeDeps = { traceLane, measure: (engine, bytes, song, seconds, masks, alignments) => nativeSeverity(engine, bytes, song, seconds, masks, alignments) };
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
  /** set when the audio render failed (infrastructure fault); the grade is then null unless the trace decided */
  audioError: string | null;
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

function severityRecord(summary: SeveritySummary, produced: number, halted: boolean, offsets: Int32Array | null): SeverityRecord {
  let lo = 0, hi = 0;
  if (offsets) for (const o of offsets) { if (o < lo) lo = o; if (o > hi) hi = o; }
  return {
    alignment: offsets ? "trace-drift" : "lock-step", offsetRangeSeconds: offsets ? [round6(lo / SAMPLE_RATE), round6(hi / SAMPLE_RATE)] : null,
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
export async function gradeEngine(engine: RomAuditEngine, bytes: Uint8Array, job: GradeJob, info: SidInfo, options: GradeOptions,
  deps: GradeDeps = NATIVE_DEPS): Promise<{ result: EngineGrade; cpuSeconds: number }> {
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS, gamma = options.gamma ?? DEFAULT_GAMMA;
  const clockHz = clockHzOf(info.clock), tolerance = toleranceCycles(clockHz, toleranceMs);
  let cpuSeconds = 0;
  const reference = await deps.traceLane(engine, bytes, job.song, job.seconds, 7);
  cpuSeconds += reference.cpuSeconds;
  // The CHARGEN counter is evidence only when the reference ran to its end: no error, or a diagnosed CPU halt (a truncated trace
  // buffer does not matter, the counter keeps counting).
  const chargenUnread = reference.chargenReads === 0 && (!reference.trace.error || reference.trace.errorKind === "cpu-halt");
  const runs = new Map<LaneName, { run: TraceRun; shortcut: boolean }>();
  for (const lane of LANES) {
    if (lane.mask === 3 && chargenUnread && !options.noShortcuts) { runs.set(lane.name, { run: reference, shortcut: true }); continue; }
    const run = await deps.traceLane(engine, bytes, job.song, job.seconds, lane.mask as RomMask);
    cpuSeconds += run.cpuSeconds;
    runs.set(lane.name, { run, shortcut: false });
  }
  const features = new Map<LaneName, TraceFeatures>();
  for (const lane of LANES) features.set(lane.name, computeTraceFeatures(reference.trace, runs.get(lane.name)!.run.trace, { clockHz, horizonSeconds: job.seconds, toleranceMs }));
  // Which lanes need audio, and which of them are compared drift-aligned?
  const needAudio: Array<{ name: LaneName; mask: number; offsets: Int32Array | null }> = [];
  const windows = Math.floor(Math.round(job.seconds * SAMPLE_RATE) / WINDOW_FRAMES);
  for (const lane of LANES) {
    if (runs.get(lane.name)!.shortcut) continue; // identical by construction, no render
    const f = features.get(lane.name)!;
    const decided = traceGrade(f, tolerance) ?? (f.cls === "G" && !options.noShortcuts ? 0 : null);
    const bitExact = f.cls === "A";
    if (bitExact || (decided !== null && !options.validateAudio)) continue;
    const offsets = driftAligned(f, tolerance)
      ? driftOffsetFrames(reference.trace, runs.get(lane.name)!.run.trace, f.matchingValuePrefix, { clockHz, sampleRate: SAMPLE_RATE, windowFrames: WINDOW_FRAMES, windows })
      : null;
    needAudio.push({ name: lane.name, mask: lane.mask, offsets });
  }
  const audio = new Map<LaneName, SeverityRecord>();
  const audioGrades = new Map<LaneName, number>();
  let audioError: string | null = null;
  if (needAudio.length) {
    try {
      const measured = await deps.measure(engine, bytes, job.song, job.seconds, needAudio.map(l => l.mask), needAudio.map(l => l.offsets));
      cpuSeconds += measured.referenceCpuSeconds;
      measured.lanes.forEach((lane, i) => {
        const name = needAudio[i]!.name;
        cpuSeconds += lane.cpuSeconds;
        audio.set(name, severityRecord(lane.summary, lane.producedSamples, lane.halted, needAudio[i]!.offsets));
        audioGrades.set(name, gradeFromQuality(qualityFromSummary(lane.summary, gamma)));
      });
    } catch (error) {
      audioError = error instanceof Error ? error.message.slice(0, 300) : String(error);
      console.error(`audio render failed for ${job.path}#${job.song} (${engine}): ${audioError}`);
    }
  }
  const lanes = {} as Record<LaneName, LaneGrade>;
  for (const lane of LANES) {
    const f = features.get(lane.name)!, severity = audio.get(lane.name) ?? null, audioGrade = audioGrades.get(lane.name) ?? null;
    let grade: number | null, basis: GradeBasis;
    const byTrace = traceGrade(f, tolerance);
    if (runs.get(lane.name)!.shortcut) {
      // CHARGEN never read by the reference: the KERNAL+BASIC program path is the reference's own, whatever the trace cap kept.
      lanes[lane.name] = { grade: 255, basis: "chargen-unread", traceClass: "A", bSubclass: null, rule: "chargen-never-read", features: roundFeatures({ ...f, bitExact: true, cls: "A", rule: "chargen-never-read" }), severity: null, audioGrade: null, audioError: null };
      continue;
    }
    if (byTrace === 255) { grade = 255; basis = "trace-bit-exact"; }
    else if (byTrace === 254) { grade = 254; basis = "trace-retimed"; }
    else if (f.cls === "G" && !options.noShortcuts) { grade = 0; basis = "trace-no-playback"; }
    else if (audioGrade !== null) { grade = audioGrade; basis = "audio"; }
    else { grade = null; basis = "unmeasurable"; }
    lanes[lane.name] = { grade, basis, traceClass: f.cls, bSubclass: f.bSubclass, rule: f.rule, features: roundFeatures(f), severity, audioGrade, audioError: audioGrade === null && needAudio.some(l => l.name === lane.name) ? audioError : null };
  }
  return {
    cpuSeconds,
    result: { referenceWrites: features.get("none")!.referenceWrites, referenceError: reference.trace.error, referenceChargenReads: reference.chargenReads, lanes },
  };
}

export async function gradeSubtune(job: GradeJob, options: GradeOptions = {}, deps: GradeDeps = NATIVE_DEPS): Promise<SubtuneGrade> {
  const bytes = readFileSync(job.path);
  // Attribute the measurement only to the bytes actually rendered: a SID changed after scheduling is refused.
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (job.sha256 !== undefined && job.sha256 !== sha256) throw new Error(`SID input ${job.path} changed after scheduling: SHA-256 ${sha256}, scheduled ${job.sha256}`);
  const info = sidInfo(bytes);
  const toleranceMs = options.toleranceMs ?? DEFAULT_TOLERANCE_MS, gamma = options.gamma ?? DEFAULT_GAMMA;
  const engines: Partial<Record<RomAuditEngine, EngineGrade>> = {};
  const cpu: Record<string, number> = {};
  const wanted = options.engines ?? ENGINES;
  const results = await Promise.all(wanted.map(engine => gradeEngine(engine, bytes, job, info, options, deps)));
  wanted.forEach((engine, i) => { engines[engine] = results[i]!.result; cpu[engine] = round6(results[i]!.cpuSeconds); });
  const relative = job.path.startsWith(nativePaths().hvsc) ? path.relative(nativePaths().hvsc, job.path) : job.path;
  return {
    path: relative, song: job.song, seconds: job.seconds, sha256, info,
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
