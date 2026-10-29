/** Reusable, resumable grading pool: N worker processes, one subtune at a time each, so the JavaScript side
 * (PCM transfer, FFT, JSON) is parallel as well as the native renders.
 *
 *  - Checkpoint: append-only JSONL, one line per finished job keyed by "<sha256>#<song>"; the first line records the options.
 *    On resume, finished keys are skipped; a checkpoint written with different options is refused.
 *  - Determinism: a job's output depends only on the job and options, never on scheduling; results are returned in input order.
 *  - Fail fast: the first job error or worker crash kills the pool and rejects (finished jobs stay in the checkpoint).
 *  - Scheduling: longest horizon first, so the tail of the run is made of short jobs.
 *  - Progress: done/total, accumulated CPU seconds and achieved parallel efficiency. */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import type { GradeJob, GradeOptions, SubtuneGrade } from "./grade.js";

export const jobKey = (job: GradeJob & { sha256: string }): string => `${job.sha256}#${job.song}`;

export interface PoolRecord { key: string; grade: SubtuneGrade; jsCpuSeconds: number; wallSeconds: number }
export interface PoolStats { workers: number; jobs: number; ran: number; resumed: number; wallSeconds: number; nativeCpuSeconds: number; workerCpuSeconds: number; efficiency: number; efficiencyOf20Threads: number }

export async function runPool(jobs: Array<GradeJob & { sha256: string }>, options: GradeOptions, checkpoint: string, workers = 18, label = "grade"): Promise<{ records: PoolRecord[]; stats: PoolStats }> {
  mkdirSync(path.dirname(checkpoint), { recursive: true });
  const optionsLine = JSON.stringify({ options });
  const done = new Map<string, PoolRecord>();
  if (existsSync(checkpoint)) {
    const lines = readFileSync(checkpoint, "utf8").split("\n").filter(Boolean);
    if (lines[0] !== optionsLine) throw new Error(`Checkpoint ${checkpoint} was written with different options; delete it to start over`);
    for (const line of lines.slice(1)) { const record = JSON.parse(line) as PoolRecord; done.set(record.key, record); }
  } else writeFileSync(checkpoint, optionsLine + "\n");
  const keys = new Set(jobs.map(jobKey));
  if (keys.size !== jobs.length) throw new Error("Duplicate job keys");
  const todo = jobs.filter(j => !done.has(jobKey(j))).sort((a, b) => b.seconds - a.seconds || (jobKey(a) < jobKey(b) ? -1 : 1));
  const resumed = jobs.length - todo.length;
  const started = performance.now();
  let nativeCpu = 0, workerCpu = 0, finished = 0;
  for (const r of done.values()) if (keys.has(r.key)) { nativeCpu += Object.values(r.grade.cpu).reduce((a, b) => a + b, 0); workerCpu += r.jsCpuSeconds; }
  const resumedNative = nativeCpu, resumedWorker = workerCpu;
  const children: ChildProcess[] = [];
  let failure: Error | null = null;
  const stop = (): void => { for (const c of children) c.kill("SIGKILL"); };
  const bunPath = process.execPath, worker = path.join(import.meta.dir, "grade-worker.ts");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(bunPath, [worker], { stdio: ["pipe", "pipe", "inherit"] });
    children.push(child);
    const dispatch = (): void => {
      if (failure || next >= todo.length) { child.stdin!.end(); return; }
      const job = todo[next++]!;
      child.stdin!.write(JSON.stringify({ key: jobKey(job), job, options }) + "\n");
    };
    const fail = (error: Error): void => { failure ??= error; stop(); reject(failure); };
    createInterface({ input: child.stdout! }).on("line", line => {
      const message = JSON.parse(line) as { key: string; ok: boolean; error?: string; grade?: SubtuneGrade; jsCpuSeconds?: number; wallSeconds?: number };
      if (!message.ok) { fail(new Error(`${label}: job ${message.key} failed: ${message.error}`)); return; }
      const record: PoolRecord = { key: message.key, grade: message.grade!, jsCpuSeconds: message.jsCpuSeconds!, wallSeconds: message.wallSeconds! };
      appendFileSync(checkpoint, JSON.stringify(record) + "\n");
      done.set(record.key, record);
      nativeCpu += Object.values(record.grade.cpu).reduce((a, b) => a + b, 0); workerCpu += record.jsCpuSeconds;
      finished++;
      if (finished % 5 === 0 || finished === todo.length) {
        const wall = (performance.now() - started) / 1000, cpu = nativeCpu + workerCpu - resumedNative - resumedWorker;
        console.error(`${label} ${finished + resumed}/${jobs.length} wall ${wall.toFixed(0)} s, CPU ${cpu.toFixed(0)} s, efficiency ${(cpu / (wall * workers) * 100).toFixed(0)}% of ${workers} workers`);
      }
      dispatch();
    });
    child.on("error", fail);
    child.on("exit", (code, signal) => { if (failure) resolve(); else if (code === 0) resolve(); else fail(new Error(`${label}: worker exited (${code}/${signal})`)); });
    dispatch();
  }))).catch(error => { stop(); throw error; });
  if (failure) throw failure;
  const wallSeconds = (performance.now() - started) / 1000, cpu = nativeCpu + workerCpu - resumedNative - resumedWorker;
  const records = jobs.map(j => done.get(jobKey(j))!);
  return { records, stats: { workers, jobs: jobs.length, ran: todo.length, resumed, wallSeconds, nativeCpuSeconds: nativeCpu - resumedNative, workerCpuSeconds: workerCpu - resumedWorker,
    efficiency: wallSeconds ? cpu / (wallSeconds * workers) : 0, efficiencyOf20Threads: wallSeconds ? cpu / (wallSeconds * 20) : 0 } };
}

export const stringifyRecords = (records: PoolRecord[]): string => stringifyDeterministic(JSON.parse(JSON.stringify(records)) as JsonValue);
