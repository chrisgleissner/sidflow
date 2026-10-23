#!/usr/bin/env bun
/** Measure the actual census workload on THIS machine. Sample the complete
 * verified HVSC population, reserve through the rollout ledger, and weight each
 * duration/format stratum by its corpus population. No cross-CPU extrapolation.
 * bun scripts/rom-audit/bench.ts <C64Music> <roms> <selection.json> [--workers N]
 *   [--count 80] [--extended-every 50] [--max-hours 15] [--out report.json]
 * selection.json is retained as a positional argument for run-full compatibility;
 * it is deliberately not used as the performance population.
 */
import { availableParallelism, cpus, tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { observationHorizon, isExtendedSample, validateRecord } from "./methodology.js";
import { readVerifiedSid, releaseLengths, corpusIdentity, toolHash } from "./inputs.js";
import { WorkerProcess, jobTimeoutMs } from "./audit.js";
import { RolloutLedger, ceilings } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";
import { benchmarkSample, projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { engineHashes } from "./wasm-lanes.js";

const [hvsc, roms, selectionFile, ...rest] = process.argv.slice(2);
if (!hvsc || !roms || !selectionFile) throw new Error("Usage: bench.ts <C64Music> <roms> <selection.json> [--workers N] [--count N] [--extended-every N] [--max-hours H] [--out file]");
const options: Record<string, string> = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!["--workers", "--count", "--extended-every", "--max-hours", "--out"].includes(rest[i]!) || !rest[i + 1]) throw new Error(`Invalid benchmark option ${rest[i]}`);
  options[rest[i]!.slice(2)] = rest[i + 1]!;
}
const maxHours = Number(options["max-hours"] ?? 0), workers = Number(options.workers ?? Math.max(1, availableParallelism() - 1));
const count = Number(options.count ?? 80), every = Number(options["extended-every"] ?? 50);
if (!Number.isSafeInteger(workers) || workers < 1 || !Number.isSafeInteger(every) || every < 0 || !Number.isFinite(maxHours) || maxHours < 0) throw new Error("Invalid benchmark parameters");
const index = releaseLengths(await readFile(path.join(hvsc, "DOCUMENTS/Songlengths.md5"), "utf8"));
const jobs: BenchmarkCandidate[] = [];
const files = (await readdir(hvsc, { recursive: true, withFileTypes: true })).filter(e => e.isFile() && e.name.toLowerCase().endsWith(".sid"));
if (files.length !== index.size) throw new Error("Benchmark corpus population differs from release metadata");
for (const file of files) {
  const relative = path.relative(hvsc, path.join(file.parentPath, file.name)), bytes = readFileSync(path.join(hvsc, relative));
  const entry = index.get(relative), fields = checkSidHeader(bytes).fields;
  if (!entry || !fields || fields.songs !== entry.tokens.length || createHash("md5").update(bytes).digest("hex") !== entry.md5) throw new Error(`Benchmark corpus identity mismatch ${relative}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const kind = fields.magic === "RSID" ? (fields.flags ?? 0) & 2 ? "BASIC" : "RSID" : fields.secondSidAddress ? "multiSID" : "PSID";
  for (let song = 1; song <= fields.songs; song++) jobs.push({ path: path.join(hvsc, relative), song, sha256, kind, seconds: observationHorizon(entry.tokens[song - 1], 10).seconds });
}
if (jobs.some(j => j.seconds > 3600)) throw new Error("Benchmark corpus contains unsupported horizons");
const sample = benchmarkSample(jobs, count), corpus = await corpusIdentity(hvsc);
scopeLock(corpus);
const ledger = RolloutLedger.open(corpus); ledger.importHistory(path.resolve(hvsc), corpus);
if (!ledger.reserve(sample.map(j => ({ sha256: j.sha256, path: path.relative(hvsc, j.path), song: j.song })), "benchmark", ceilings(files.length, jobs.length)))
  throw new Error("Benchmark would exceed the pilot ceiling");
const runtime = await mkdtemp(path.join(tmpdir(), "sidflow-rom-bench-"));
for (const name of ["kernal.901227-03.bin", "basic.901226-01.bin", "characters.901225-01.bin"]) await writeFile(path.join(runtime, name), await readFile(path.join(roms, name)));
let next = 0, horizon = 0, extended = 0;
const measured: { job: BenchmarkCandidate; seconds: number }[] = [];
const sourceHash = toolHash(), engine = engineHashes("sidlite");
const started = Date.now();
console.log(`Benchmark: ${sample.length} subtunes stratified from ${jobs.length}; ${workers} workers; listener-v1.`);
try {
  await Promise.all(Array.from({ length: workers }, async () => {
    const worker = new WorkerProcess(runtime);
    try {
      for (let job = sample[next++]; job; job = sample[next++]) {
        const isExtended = isExtendedSample(job.sha256, every), start = performance.now();
        const record = await worker.request({ sha256: job.sha256, song: job.song, seconds: job.seconds, engines: ["sidlite"], extended: isExtended,
          hex: readVerifiedSid(job.path, job.sha256).toString("hex") }, jobTimeoutMs(job.seconds, ["sidlite"]));
        if (record.failure) throw new Error(`benchmark job failed: ${record.failure.message}`);
        validateRecord(record, ["sidlite"]);
        measured.push({ job, seconds: (performance.now() - start) / 1000 });
        horizon += job.seconds; if (isExtended) extended++;
        console.log(`Benchmark ${measured.length}/${sample.length}: ${path.relative(hvsc, job.path)}#${job.song}`);
      }
    } finally { worker.close(); }
  }));
} finally { await rm(runtime, { recursive: true, force: true }); }
if (toolHash() !== sourceHash || JSON.stringify(engineHashes("sidlite")) !== JSON.stringify(engine)) throw new Error("Census sources/engine changed during benchmark");
const elapsed = (Date.now() - started) / 1000, rate = horizon / elapsed;
const projection = projectCensus(jobs, measured, workers);
const report = { schema: "sidflow-rom-benchmark-1", cpu: cpus()[0]?.model ?? "unknown", logicalCpus: availableParallelism(), workers,
  sourceHash, engine, corpus, sampleSubtunes: sample.length, extended, elapsed, horizonSeconds: horizon,
  aggregateHorizonSecondsPerSecond: rate, ...projection, measured };
await writeFile(options.out ?? "workspace/rom-audit-benchmark.json", stringifyDeterministic(report as unknown as JsonValue));
console.log(`${report.cpu}; ${workers} workers; ${rate.toFixed(1)} aggregate horizon-seconds/second.`);
console.log(`Corpus-weighted census: ${projection.projectedHours.toFixed(2)} h; with 15% margin: ${projection.budgetHours.toFixed(2)} h. This predicts only this machine under the measured load.`);
if (maxHours > 0 && projection.budgetHours > maxHours) { console.error(`Projection exceeds the ${maxHours} h budget.`); process.exitCode = 3; }
