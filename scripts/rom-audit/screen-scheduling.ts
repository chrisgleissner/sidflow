/** Longest estimated CPU work first, after the caller has bounded the scope.
 * This changes dispatch order only; every input, horizon and measurement stays
 * independent. A stratum's CPU-per-second rate predicts unseen jobs; exact
 * benchmark costs take precedence. Without observations, use horizon length.
 */
import { benchmarkStratum, type BenchmarkCandidate } from "./benchmark-model.js";
export interface ScreenCost { job: BenchmarkCandidate; cpuSeconds: number }
export function orderScreenJobs<T extends BenchmarkCandidate>(jobs: readonly T[], measured: readonly ScreenCost[] = []): T[] {
  const exact = new Map<string, number>();
  const groups = new Map<string, { cpu: number; seconds: number }>();
  for (const row of measured) {
    if (!Number.isFinite(row.cpuSeconds) || row.cpuSeconds <= 0 || !Number.isFinite(row.job.seconds) || row.job.seconds <= 0) throw new Error("Invalid scheduling cost");
    exact.set(`${row.job.sha256}#${row.job.song}`,row.cpuSeconds);
    const key=benchmarkStratum(row.job),group=groups.get(key)??{cpu:0,seconds:0};
    group.cpu+=row.cpuSeconds;group.seconds+=row.job.seconds;groups.set(key,group);
  }
  const cost=(job:T):number=>{
    const group=groups.get(benchmarkStratum(job));
    return exact.get(`${job.sha256}#${job.song}`)??job.seconds*(group?group.cpu/group.seconds:1);
  };
  return [...jobs].sort((a,b)=>cost(b)-cost(a));
}
