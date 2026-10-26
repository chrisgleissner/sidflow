/** Corpus-weighted timing model. The deliberately adversarial pilot is not a
 * throughput sample: it overrepresents BASIC, multi-SID and unusually long songs.
 */
import { createHash } from "node:crypto";

export interface BenchmarkCandidate { path: string; song: number; sha256: string; seconds: number; kind: string }
export function benchmarkStratum(job: BenchmarkCandidate): string {
  return `${job.kind}/${job.seconds <= 30 ? "0-30" : job.seconds <= 120 ? "30-120" : job.seconds <= 300 ? "120-300" : "300+"}`;
}
export function benchmarkSample(jobs: readonly BenchmarkCandidate[], count: number): BenchmarkCandidate[] {
  if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Invalid benchmark sample count");
  const groups = new Map<string, BenchmarkCandidate[]>();
  for (const job of jobs) {
    const key = benchmarkStratum(job), group = groups.get(key) ?? [];
    group.push(job); groups.set(key, group);
  }
  if (count < groups.size * 2) throw new Error(`Need at least ${groups.size * 2} benchmark jobs to cover every stratum twice`);
  const keys = new Map(jobs.map(job => [job, createHash("sha256").update(`${job.sha256}#${job.song}`).digest("hex")]));
  const ordered = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) =>
    group.sort((a, b) => keys.get(a)! < keys.get(b)! ? -1 : keys.get(a)! > keys.get(b)! ? 1 : 0));
  const selected: BenchmarkCandidate[] = [];
  // Round robin covers all strata; population weights are applied in projection.
  for (let n = 0; selected.length < Math.min(count, jobs.length); n++) for (const group of ordered) {
    if (group[n]) selected.push(group[n]!);
    if (selected.length >= count) break;
  }
  return selected;
}
export function projectCensus(jobs: readonly BenchmarkCandidate[], measured: readonly { job: BenchmarkCandidate; seconds: number }[], workers: number, margin = 1.15) {
  if (!Number.isSafeInteger(workers) || workers <= 0 || !Number.isFinite(margin) || margin < 1) throw new Error("Invalid projection parameters");
  const strata = new Map<string, { population: number; measured: number; workerSeconds: number }>();
  for (const job of jobs) {
    const key = benchmarkStratum(job), group = strata.get(key) ?? { population: 0, measured: 0, workerSeconds: 0 };
    group.population++; strata.set(key, group);
  }
  for (const result of measured) {
    const group = strata.get(benchmarkStratum(result.job));
    if (!group || !Number.isFinite(result.seconds) || result.seconds <= 0) throw new Error("Invalid benchmark measurement");
    group.measured++; group.workerSeconds += result.seconds;
  }
  let total = 0;
  for (const group of strata.values()) {
    if (!group.measured) throw new Error("Unmeasured benchmark stratum");
    total += group.population * group.workerSeconds / group.measured;
  }
  return { projectedHours: total / workers / 3600, budgetHours: total / workers / 3600 * margin, margin,
    strata: Object.fromEntries(strata) };
}
