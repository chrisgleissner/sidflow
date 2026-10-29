/** Running summary of a full grading run: lane grade buckets, trace classes, strata and a time projection.
 * Used for progress.jsonl during the run and by summarize.ts on a checkpoint at any time. */
import { benchmarkStratum } from "../rom-audit/benchmark-model.js";
import type { PoolRecord } from "./pool.js";

export const LANE_FIELDS = ["sidliteNone", "sidliteKernalBasic", "residfpNone", "residfpKernalBasic"] as const;
export type LaneField = (typeof LANE_FIELDS)[number];
export const BUCKETS = ["0", "1-127", "128-191", "192-249", "250-253", "254", "255", "unmeasured"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Consumer boundary: a lane graded below this is skipped by the player. */
export const RECOMMENDED_BOUNDARY = 128;

export function bucketOf(grade: number | null): Bucket {
  if (grade === null) return "unmeasured";
  if (grade === 0) return "0";
  if (grade <= 127) return "1-127";
  if (grade <= 191) return "128-191";
  if (grade <= 249) return "192-249";
  if (grade <= 253) return "250-253";
  return grade === 254 ? "254" : "255";
}

export function laneGrades(record: PoolRecord): Record<LaneField, number | null> {
  const e = record.grade.engines;
  return {
    sidliteNone: e.sidlite?.lanes.none.grade ?? null, sidliteKernalBasic: e.sidlite?.lanes["kernal+basic"].grade ?? null,
    residfpNone: e.residfp?.lanes.none.grade ?? null, residfpKernalBasic: e.residfp?.lanes["kernal+basic"].grade ?? null,
  };
}
const classOf = (record: PoolRecord, lane: LaneField): string => {
  const engine = lane.startsWith("sidlite") ? "sidlite" : "residfp", l = lane.endsWith("None") ? "none" : "kernal+basic";
  const x = record.grade.engines[engine]!.lanes[l];
  return x.traceClass === "B" ? `B${x.bSubclass}` : x.traceClass === "X" ? `X(${x.rule})` : x.traceClass;
};

export interface Totals { subtunes: number; secondsByKind: Record<string, number>; subtunesByStratum: Record<string, number> }
export interface StratumCount { done: number; below128: number }
export interface Snapshot {
  done: number; total: number;
  lanes: Record<LaneField, Record<Bucket, number>>;
  classes: Record<LaneField, Record<string, number>>;
  strata: Record<string, StratumCount>;
  errors: number;
}

const emptyBuckets = (): Record<Bucket, number> => Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;

export class Accumulator {
  done = 0;
  errors = 0;
  readonly lanes = Object.fromEntries(LANE_FIELDS.map(l => [l, emptyBuckets()])) as Record<LaneField, Record<Bucket, number>>;
  readonly classes = Object.fromEntries(LANE_FIELDS.map(l => [l, {}])) as unknown as Record<LaneField, Record<string, number>>;
  readonly strata: Record<string, StratumCount> = {};
  /** CPU and horizon seconds of finished jobs per kind, for the projection */
  readonly byKind: Record<string, { cpu: number; seconds: number }> = {};
  constructor(readonly totals: Totals) {}
  add(record: PoolRecord): void {
    this.done++;
    const grades = laneGrades(record);
    let below = false;
    for (const lane of LANE_FIELDS) {
      const grade = grades[lane];
      this.lanes[lane][bucketOf(grade)]++;
      const c = classOf(record, lane), counts = this.classes[lane];
      counts[c] = (counts[c] ?? 0) + 1;
      if (grade === null) this.errors++;
      else if (grade < RECOMMENDED_BOUNDARY) below = true;
    }
    for (const engine of Object.values(record.grade.engines)) for (const lane of Object.values(engine!.lanes)) if (lane.audioError) this.errors++;
    const stratum = benchmarkStratum({ path: record.grade.path, song: record.grade.song, sha256: record.grade.sha256, seconds: record.grade.seconds, kind: record.grade.info.kind });
    const s = this.strata[stratum] ??= { done: 0, below128: 0 };
    s.done++; if (below) s.below128++;
    const k = this.byKind[record.grade.info.kind] ??= { cpu: 0, seconds: 0 };
    k.cpu += Object.values(record.grade.cpu).reduce((a, b) => a + b, 0) + record.jsCpuSeconds; k.seconds += record.grade.seconds;
  }
  snapshot(): Snapshot { return { done: this.done, total: this.totals.subtunes, lanes: this.lanes, classes: this.classes, strata: this.strata, errors: this.errors }; }
  /** Hours still needed at the observed parallel efficiency, from CPU per horizon second of each kind. */
  projectedRemainingHours(workers: number, efficiency: number): number | null {
    let cpu = 0, seconds = 0;
    for (const k of Object.values(this.byKind)) { cpu += k.cpu; seconds += k.seconds; }
    if (!seconds || !efficiency) return null;
    let remaining = 0;
    for (const [kind, total] of Object.entries(this.totals.secondsByKind)) {
      const done = this.byKind[kind], rate = done && done.seconds ? done.cpu / done.seconds : cpu / seconds;
      remaining += Math.max(0, total - (done?.seconds ?? 0)) * rate;
    }
    return remaining / (workers * efficiency) / 3600;
  }
}

export function totalsOf(jobs: Array<{ seconds: number; kind: string; sha256: string; song: number; path: string }>): Totals {
  const secondsByKind: Record<string, number> = {}, subtunesByStratum: Record<string, number> = {};
  for (const j of jobs) {
    secondsByKind[j.kind] = (secondsByKind[j.kind] ?? 0) + j.seconds;
    const s = benchmarkStratum(j);
    subtunesByStratum[s] = (subtunesByStratum[s] ?? 0) + 1;
  }
  return { subtunes: jobs.length, secondsByKind, subtunesByStratum };
}

export interface ProgressLine extends Snapshot { time: string; elapsedSeconds: number; cpuSeconds: number; workers: number; efficiency: number; projectedRemainingHours: number | null }

export function formatSnapshot(s: Snapshot): string {
  const rows = [`done ${s.done}/${s.total} (${(100 * s.done / s.total).toFixed(1)}%), errors ${s.errors}`, "", `${"lane".padEnd(20)}${BUCKETS.map(b => b.padStart(9)).join("")}`];
  for (const lane of LANE_FIELDS) rows.push(`${lane.padEnd(20)}${BUCKETS.map(b => String(s.lanes[lane][b]).padStart(9)).join("")}`);
  rows.push("", "trace classes (lane: class=count)");
  for (const lane of LANE_FIELDS) rows.push(`  ${lane}: ${Object.entries(s.classes[lane]).sort().map(([k, v]) => `${k}=${v}`).join(" ")}`);
  rows.push("", `${"stratum".padEnd(20)}${"done".padStart(8)}${"<128".padStart(8)}${"share".padStart(8)}`);
  for (const [k, v] of Object.entries(s.strata).sort()) rows.push(`${k.padEnd(20)}${String(v.done).padStart(8)}${String(v.below128).padStart(8)}${(100 * v.below128 / v.done).toFixed(1).padStart(7)}%`);
  return rows.join("\n");
}

export interface Benchmark { strata: Record<string, { n: number; below128: number }> }

/** Anomalies of a partial or complete run against the calibration benchmark. */
export function anomalies(s: Snapshot, bench: Benchmark | null, efficiency: number | null): string[] {
  const out: string[] = [];
  if (s.errors) out.push(`${s.errors} lane errors or unmeasured lanes`);
  if (s.lanes.sidliteNone.unmeasured || s.lanes.residfpNone.unmeasured) out.push("unmeasured none-lane grades present");
  if (efficiency !== null && efficiency < 0.7) out.push(`parallel efficiency ${(efficiency * 100).toFixed(0)}% is below 70%`);
  if (bench) {
    for (const [stratum, v] of Object.entries(s.strata)) {
      const b = bench.strata[stratum];
      if (!b || v.done < 50) continue;
      const share = v.below128 / v.done, reference = b.below128 / b.n;
      // 3x of the benchmark, with the benchmark's own resolution (one job in n) as the floor of the reference
      if (share > 3 * Math.max(reference, 1 / b.n) || (reference >= 0.1 && share < reference / 3))
        out.push(`stratum ${stratum}: ${(100 * share).toFixed(1)}% of ${v.done} below 128 vs ${(100 * reference).toFixed(1)}% of ${b.n} in the benchmark (outside 3x)`);
    }
  }
  return out;
}
