/** Reusable, resumable grading pool: N worker processes, one subtune at a time each, so the JavaScript side
 * (PCM transfer, FFT, JSON) is parallel as well as the native renders.
 *
 *  - Checkpoint: append-only JSONL, one line per finished job keyed by "<sha256>#<song>"; the first line records the options, the
 *    methodology identity and (when given) the input binding, e.g. the HVSC corpus and Songlengths.md5 digests. On resume, finished keys are skipped; a checkpoint written with different options or identity is refused.
 *    A torn final line (the process was killed mid-write) is cut off before resuming.
 *  - Determinism: a job's output depends only on the job and options, never on scheduling; records returned in input order.
 *  - Fail fast: the first job error, failed validation or worker crash stops the pool and rejects (finished jobs stay in the checkpoint).
 *    Workers get SIGTERM first, so their handler (scripts/rom-audit/digital-screen.ts) kills the native renderers they started, and
 *    SIGKILL only if they are still alive after STOP_GRACE_MS.
 *  - Scheduling: longest horizon first, so the tail of the run is made of short jobs.
 *  - Progress: callbacks every `progressEvery` completed jobs with done/total, CPU seconds and achieved parallel efficiency. */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, createReadStream, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import type { GradeJob, GradeOptions, SubtuneGrade } from "./grade.js";

export const jobKey = (job: { sha256: string; song: number }): string => `${job.sha256}#${job.song}`;

export interface PoolRecord { key: string; grade: SubtuneGrade; jsCpuSeconds: number; wallSeconds: number }
export interface PoolStats { workers: number; jobs: number; ran: number; resumed: number; wallSeconds: number; nativeCpuSeconds: number; workerCpuSeconds: number; efficiency: number; efficiencyOf20Threads: number }
export interface PoolProgress { done: number; total: number; resumed: number; wallSeconds: number; cpuSeconds: number; workers: number; efficiency: number }
export interface PoolConfig {
  checkpoint: string;
  workers?: number;
  label?: string;
  /** methodology identity recorded in the checkpoint header; resume refuses a different one */
  identity?: string;
  /** input digests recorded in the checkpoint header (e.g. corpusId, songlengthsSha256); resume refuses different ones */
  binding?: Record<string, string>;
  /** keep every record in memory and return it (default true; the full run streams instead) */
  keepRecords?: boolean;
  workerScript?: string;
  progressEvery?: number;
  /** called for every record, resumed ones first */
  onRecord?: (record: PoolRecord, resumed: boolean) => void;
  onProgress?: (progress: PoolProgress) => void;
  /** a non-null return value fails the pool with that message */
  validate?: (record: PoolRecord) => string | null;
}

export const STOP_GRACE_MS = 3000;

/** Terminate worker processes: SIGTERM now, SIGKILL for any still running after `graceMs`. Idempotent per child. */
export function terminateChildren(children: readonly ChildProcess[], graceMs = STOP_GRACE_MS): void {
  const alive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;
  const running = children.filter(alive);
  if (!running.length) return;
  for (const c of running) c.kill("SIGTERM");
  const timer = setTimeout(() => { for (const c of running) if (alive(c)) c.kill("SIGKILL"); }, graceMs);
  let pending = running.length;
  for (const c of running) c.once("exit", () => { if (--pending === 0) clearTimeout(timer); });
}

const cpuOf = (record: PoolRecord): number => Object.values(record.grade.cpu).reduce((a, b) => a + b, 0) + record.jsCpuSeconds;

/** Cut a torn final line (no trailing newline) so appends start on a line boundary. Returns the bytes removed. */
export function repairTail(file: string): number {
  const fd = openSync(file, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return 0;
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    if (buffer[0] === 10) return 0;
    const chunk = Buffer.alloc(65536);
    let end = size, cut = 0;
    while (end > 0) {
      const start = Math.max(0, end - chunk.length);
      readSync(fd, chunk, 0, end - start, start);
      const at = chunk.subarray(0, end - start).lastIndexOf(10);
      if (at >= 0) { cut = start + at + 1; break; }
      end = start;
    }
    console.error(`pool: removing ${size - cut} bytes of a torn final line from ${file}`);
    ftruncateSync(fd, cut);
    return size - cut;
  } finally { closeSync(fd); }
}

export async function runPool(jobs: Array<GradeJob & { sha256: string }>, options: GradeOptions, config: PoolConfig): Promise<{ records: PoolRecord[]; stats: PoolStats }> {
  const { checkpoint, workers = 18, label = "grade", keepRecords = true, progressEvery = 5 } = config;
  mkdirSync(path.dirname(checkpoint), { recursive: true });
  const header = JSON.stringify(config.binding ? { options, identity: config.identity ?? null, binding: config.binding } : { options, identity: config.identity ?? null });
  const keys = new Set(jobs.map(jobKey));
  if (keys.size !== jobs.length) throw new Error("Duplicate job keys");
  const done = new Map<string, PoolRecord>(), doneKeys = new Set<string>();
  let nativeCpu = 0, workerCpu = 0;
  const accept = (record: PoolRecord, resumed: boolean): void => {
    doneKeys.add(record.key);
    if (keepRecords) done.set(record.key, record);
    if (keys.has(record.key)) { nativeCpu += Object.values(record.grade.cpu).reduce((a, b) => a + b, 0); workerCpu += record.jsCpuSeconds; }
    config.onRecord?.(record, resumed);
  };
  const wantedSeconds = new Map(jobs.map(j => [jobKey(j), j.seconds]));
  if (existsSync(checkpoint)) {
    repairTail(checkpoint);
    let first = true;
    for await (const line of createInterface({ input: createReadStream(checkpoint, { encoding: "utf8" }), crlfDelay: Infinity })) {
      if (!line) continue;
      if (first) {
        first = false;
        if (line !== header) throw new Error(`Checkpoint ${checkpoint} was written with different options or methodology identity; use a new output directory or delete it\n  have: ${line.slice(0, 200)}\n  want: ${header.slice(0, 200)}`);
        continue;
      }
      const record = JSON.parse(line) as PoolRecord;
      // A record measured over another horizon is not evidence for this job (the identity binds sources, not inputs).
      const wanted = wantedSeconds.get(record.key);
      if (wanted !== undefined && record.grade.seconds !== wanted) throw new Error(`Checkpoint ${checkpoint} record ${record.key} was measured over ${record.grade.seconds} s, but the job requests ${wanted} s; use a new output directory`);
      accept(record, true);
    }
    if (first) writeFileSync(checkpoint, header + "\n");
  } else writeFileSync(checkpoint, header + "\n");
  const todo = jobs.filter(j => !doneKeys.has(jobKey(j))).sort((a, b) => b.seconds - a.seconds || (jobKey(a) < jobKey(b) ? -1 : 1));
  const resumed = jobs.length - todo.length;
  const resumedNative = nativeCpu, resumedWorker = workerCpu;
  const started = performance.now();
  const sessionCpu = (): number => nativeCpu + workerCpu - resumedNative - resumedWorker;
  const progress = (): PoolProgress => {
    const wall = (performance.now() - started) / 1000, cpu = sessionCpu();
    return { done: jobs.length - todo.length + finished, total: jobs.length, resumed, wallSeconds: wall, cpuSeconds: cpu, workers, efficiency: wall ? cpu / (wall * workers) : 0 };
  };
  let finished = 0, lastBucket = Math.floor(resumed / progressEvery);
  const children: ChildProcess[] = [];
  let failure: Error | null = null;
  let stopped = false;
  const stop = (): void => { if (!stopped) { stopped = true; terminateChildren(children); } };
  const bunPath = process.execPath, worker = config.workerScript ?? path.join(import.meta.dir, "grade-worker.ts");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(bunPath, [worker], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ROM_GRADE_WORKERS: "3" } });
    children.push(child);
    const dispatch = (): void => {
      if (failure || next >= todo.length) { child.stdin!.end(); return; }
      const job = todo[next++]!;
      child.stdin!.write(JSON.stringify({ key: jobKey(job), job, options }) + "\n");
    };
    const fail = (error: Error): void => { failure ??= error; stop(); reject(failure); };
    createInterface({ input: child.stdout! }).on("line", line => {
      if (failure) return;
      const message = JSON.parse(line) as { key: string; ok: boolean; error?: string; grade?: SubtuneGrade; jsCpuSeconds?: number; wallSeconds?: number };
      if (!message.ok) { fail(new Error(`${label}: job ${message.key} failed: ${message.error}`)); return; }
      const record: PoolRecord = { key: message.key, grade: message.grade!, jsCpuSeconds: message.jsCpuSeconds!, wallSeconds: message.wallSeconds! };
      const problem = config.validate?.(record) ?? null;
      if (problem) { fail(new Error(`${label}: job ${record.key} rejected: ${problem}`)); return; }
      appendFileSync(checkpoint, JSON.stringify(record) + "\n");
      accept(record, false);
      finished++;
      const state = progress();
      const bucket = Math.floor(state.done / progressEvery);
      if (bucket > lastBucket || state.done === state.total) {
        lastBucket = bucket;
        console.error(`${label} ${state.done}/${state.total} wall ${state.wallSeconds.toFixed(0)} s, CPU ${state.cpuSeconds.toFixed(0)} s, efficiency ${(state.efficiency * 100).toFixed(0)}% of ${workers} workers`);
        config.onProgress?.(state);
      }
      dispatch();
    });
    child.on("error", fail);
    child.on("exit", (code, signal) => { if (failure || code === 0) resolve(); else fail(new Error(`${label}: worker exited (${code}/${signal})`)); });
    dispatch();
  }))).catch(error => { stop(); throw error; });
  if (failure) throw failure;
  const wallSeconds = (performance.now() - started) / 1000, cpu = sessionCpu();
  const records = keepRecords ? jobs.map(j => done.get(jobKey(j))!) : [];
  return { records, stats: { workers, jobs: jobs.length, ran: todo.length, resumed, wallSeconds, nativeCpuSeconds: nativeCpu - resumedNative, workerCpuSeconds: workerCpu - resumedWorker,
    efficiency: wallSeconds ? cpu / (wallSeconds * workers) : 0, efficiencyOf20Threads: wallSeconds ? cpu / (wallSeconds * 20) : 0 } };
}

export const stringifyRecords = (records: PoolRecord[]): string => stringifyDeterministic(JSON.parse(JSON.stringify(records)) as JsonValue);
export { cpuOf };
