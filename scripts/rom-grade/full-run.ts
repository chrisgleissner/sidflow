/** Full-HVSC grading driver (called by run-full.sh): every subtune, both engines x none/KERNAL+BASIC, longest first, fail fast.
 *
 *   bun scripts/rom-grade/full-run.ts <output dir>
 *
 * Environment: ROM_GRADE_WORKERS (pool size, default 18), ROM_GRADE_MAX_JOBS (deterministic hash-ordered subset for validation;
 * the run is then bounded and not publishable), ROM_GRADE_KEYS (a file of `<sha256>#<song>` keys, one per line: grade exactly
 * those subtunes, for example to re-grade a subset under a revised methodology and compare; also bounded and not publishable),
 * ROM_GRADE_PROGRESS_EVERY (default 1000).
 * Output directory: checkpoint.jsonl (append-only, resumable), progress.jsonl, scope.json, methodology.json, and on completion
 * grading-results.jsonl + research-export.jsonl.gz (see finalize.ts). */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { candidateKey } from "./candidates.js";
import { finalize } from "./finalize.js";
import { fullScope } from "./full-scope.js";
import { methodologyIdentity } from "./methodology-id.js";
import { jobKey, runPool } from "./pool.js";
import { Accumulator, LANE_FIELDS, laneGrades, totalsOf, type ProgressLine } from "./summary.js";

const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: full-run.ts <output dir>");
const workers = Number(process.env.ROM_GRADE_WORKERS ?? 18);
const progressEvery = Number(process.env.ROM_GRADE_PROGRESS_EVERY ?? 1000);
const maxJobs = process.env.ROM_GRADE_MAX_JOBS ? Number(process.env.ROM_GRADE_MAX_JOBS) : null;
const keysFile = process.env.ROM_GRADE_KEYS || null;
if (keysFile && maxJobs !== null) throw new Error("ROM_GRADE_KEYS and ROM_GRADE_MAX_JOBS are mutually exclusive");
const bounded = maxJobs !== null || keysFile !== null;
if (!Number.isSafeInteger(workers) || workers < 1 || (maxJobs !== null && (!Number.isSafeInteger(maxJobs) || maxJobs < 1))) throw new Error("Invalid ROM_GRADE_WORKERS or ROM_GRADE_MAX_JOBS");

mkdirSync(out, { recursive: true });
const identity = await methodologyIdentity();
console.error(`methodology identity ${identity.id}`);
const scope = await fullScope();
console.error(`scope: ${scope.files} files, ${scope.subtunes} subtunes, corpus ${scope.corpusId.slice(0, 12)}`);
/** Validation subset: hash-ordered subtunes, or with ROM_GRADE_WHOLE_FILES=1 hash-ordered whole files until at least maxJobs subtunes
 * (a subset the consumer parser accepts as a complete grading when finalized with --declare-scope). */
function subset(): typeof scope.jobs {
  if (keysFile) {
    const wanted = new Set(readFileSync(keysFile, "utf8").split("\n").map(k => k.trim()).filter(Boolean));
    const chosen = scope.jobs.filter(job => wanted.has(jobKey(job)));
    if (chosen.length !== wanted.size) throw new Error(`ROM_GRADE_KEYS: ${wanted.size - chosen.length} of ${wanted.size} keys are not in the HVSC scope`);
    return chosen;
  }
  if (maxJobs === null) return scope.jobs;
  if (process.env.ROM_GRADE_WHOLE_FILES !== "1") return [...scope.jobs].sort((a, b) => candidateKey(a) < candidateKey(b) ? -1 : 1).slice(0, maxJobs);
  const byFile = new Map<string, typeof scope.jobs>();
  for (const job of scope.jobs) byFile.set(job.sha256, [...(byFile.get(job.sha256) ?? []), job]);
  const files = [...byFile.values()].sort((a, b) => candidateKey({ sha256: a[0]!.sha256, song: 0 }) < candidateKey({ sha256: b[0]!.sha256, song: 0 }) ? -1 : 1);
  const chosen: typeof scope.jobs = [];
  for (const file of files) { if (chosen.length >= maxJobs) break; chosen.push(...file); }
  return chosen;
}
const selected = subset();
const totals = totalsOf(selected);
writeFileSync(path.join(out, "methodology.json"), stringifyDeterministic(identity as unknown as JsonValue));
writeFileSync(path.join(out, "scope.json"), stringifyDeterministic({ files: scope.files, subtunes: scope.subtunes, corpusId: scope.corpusId, songlengthsSha256: scope.songlengthsSha256, maxJobs, keysFile, selected: selected.length, totals } as unknown as JsonValue));

const accumulator = new Accumulator(totals);
const progressFile = path.join(out, "progress.jsonl");
const result = await runPool(selected, { validateAudio: false }, {
  checkpoint: path.join(out, "checkpoint.jsonl"), workers, label: "full", identity: identity.id, keepRecords: false, progressEvery,
  onRecord: record => accumulator.add(record),
  // A lane without a grade, or a failed audio render, is an error: the run stops and can be resumed after the cause is fixed.
  validate: record => {
    const grades = laneGrades(record);
    const missing = LANE_FIELDS.filter(l => grades[l] === null);
    if (missing.length) return `unmeasured lanes ${missing.join(",")}`;
    for (const e of Object.values(record.grade.engines)) for (const l of Object.values(e!.lanes)) if (l.audioError) return `audio error: ${l.audioError}`;
    return null;
  },
  onProgress: p => {
    const line: ProgressLine = {
      ...accumulator.snapshot(), time: new Date().toISOString(), elapsedSeconds: Math.round(p.wallSeconds), cpuSeconds: Math.round(p.cpuSeconds), workers: p.workers,
      efficiency: Math.round(p.efficiency * 1000) / 1000, projectedRemainingHours: (() => { const h = accumulator.projectedRemainingHours(p.workers, p.efficiency); return h === null ? null : Math.round(h * 100) / 100; })(),
    };
    appendFileSync(progressFile, JSON.stringify(line) + "\n");
  },
});
console.error(`pool finished: ran ${result.stats.ran}, resumed ${result.stats.resumed}, wall ${result.stats.wallSeconds.toFixed(0)} s, efficiency ${(result.stats.efficiency * 100).toFixed(0)}%`);
if (!bounded) await finalize(out, { allowPartial: false, declareScope: false });
else console.error("Bounded run (ROM_GRADE_MAX_JOBS or ROM_GRADE_KEYS): checkpoint saved; no consumer results file is produced.");
