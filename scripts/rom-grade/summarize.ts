/** Summary of a full grading run, from its checkpoint, at any time.
 *
 *   bun scripts/rom-grade/summarize.ts <output dir>
 *
 * Prints done/total, per-lane grade buckets, trace classes, per-stratum shares below 128, the projected remaining time, and
 * anomalies against the calibration benchmark (any error, efficiency below 70%, a stratum's share below 128 outside 3x of the benchmark). */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { benchmarkStratum } from "../rom-audit/benchmark-model.js";
import { nativePaths } from "./native.js";
import type { PoolRecord } from "./pool.js";
import { Accumulator, LANE_FIELDS, RECOMMENDED_BOUNDARY, anomalies, formatSnapshot, laneGrades, type Benchmark, type ProgressLine, type Totals } from "./summary.js";

export function loadBenchmark(): Benchmark | null {
  const file = path.join(nativePaths().output, "benchmark-run.json");
  if (!existsSync(file)) return null;
  const grades = (JSON.parse(readFileSync(file, "utf8")) as { grades: PoolRecord["grade"][] }).grades;
  const strata: Benchmark["strata"] = {};
  for (const g of grades) {
    const s = strata[benchmarkStratum({ path: g.path, song: g.song, sha256: g.sha256, seconds: g.seconds, kind: g.info.kind })] ??= { n: 0, below128: 0 };
    s.n++;
    const lanes = laneGrades({ key: "", grade: g, jsCpuSeconds: 0, wallSeconds: 0 });
    if (LANE_FIELDS.some(l => (lanes[l] ?? 0) < RECOMMENDED_BOUNDARY)) s.below128++;
  }
  return { strata };
}

export function lastProgress(out: string): ProgressLine | null {
  const file = path.join(out, "progress.jsonl");
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]!) as ProgressLine : null;
}

export async function summarizeCheckpoint(out: string): Promise<{ accumulator: Accumulator; identity: string | null }> {
  const scope = JSON.parse(readFileSync(path.join(out, "scope.json"), "utf8")) as { totals: Totals };
  const accumulator = new Accumulator(scope.totals);
  let identity: string | null = null, first = true;
  for await (const line of createInterface({ input: createReadStream(path.join(out, "checkpoint.jsonl"), { encoding: "utf8" }), crlfDelay: Infinity })) {
    if (!line) continue;
    if (first) { first = false; identity = (JSON.parse(line) as { identity: string | null }).identity; continue; }
    try { accumulator.add(JSON.parse(line) as PoolRecord); } catch (error) { console.error("summarize: unparseable checkpoint line (a torn final line of a running pool?)", error); }
  }
  return { accumulator, identity };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: summarize.ts <output dir>");
  const { accumulator, identity } = await summarizeCheckpoint(path.resolve(out));
  const progress = lastProgress(path.resolve(out));
  console.log(`methodology ${identity}`);
  console.log(formatSnapshot(accumulator.snapshot()));
  if (progress) console.log(`\nlast progress line ${progress.time}: efficiency ${(progress.efficiency * 100).toFixed(0)}%, projected remaining ${progress.projectedRemainingHours?.toFixed(2) ?? "?"} h`);
  // Efficiency counts CPU only when a job finishes, so the first half hour of a run under-reports it; do not flag that.
  const found = anomalies(accumulator.snapshot(), loadBenchmark(), progress && progress.elapsedSeconds >= 1800 ? progress.efficiency : null);
  console.log(found.length ? `\nANOMALIES\n${found.map(a => `  - ${a}`).join("\n")}` : "\nno anomalies");
  process.exitCode = found.length ? 2 : 0;
}
