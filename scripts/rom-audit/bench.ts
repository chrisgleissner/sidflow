#!/usr/bin/env bun
/**
 * Throughput benchmark and projection for the full census on THIS machine, in a few minutes, before committing days to it.
 * It renders a deterministic sample of the reviewed pilot selection (already counted by the rollout ledger) with the same workers,
 * lanes and cross-check sampling as the census, then projects the corpus total from the measured horizon-seconds per second.
 *   bun scripts/rom-audit/bench.ts <C64Music> <roms> <selection.json> [--workers N] [--count 60] [--extended-every 50] [--max-hours H]
 */
import { availableParallelism, cpus, tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { observationHorizon, isExtendedSample, validateRecord } from "./methodology.js";
import { readVerifiedSid, releaseLengths } from "./inputs.js";
import { WorkerProcess, jobTimeoutMs } from "./audit.js";

const CORPUS_HORIZON_SECONDS = 10_176_145.245;   // verified HVSC 85 total (see doc/research/hvsc-rom-full-run.md)
const [hvsc, roms, selectionFile, ...rest] = process.argv.slice(2);
if (!hvsc || !roms || !selectionFile) throw new Error("Usage: bench.ts <C64Music> <roms> <selection.json> [--workers N] [--count N] [--extended-every N]");
const option = (name: string, fallback: number): number => { const i = rest.indexOf(name); return i >= 0 ? Number(rest[i + 1]) : fallback; };
const maxHours = option("--max-hours", 0), workers = option("--workers", Math.max(1, availableParallelism() - 1)), count = option("--count", 60), every = option("--extended-every", 50);
const index = releaseLengths((await readFile(path.join(hvsc, "DOCUMENTS/Songlengths.md5"), "utf8")).replace(/\r/g, ""));
const selection = JSON.parse(await readFile(selectionFile, "utf8")) as { path: string; song: number }[];
const jobs = selection.map(s => {
  const bytes = readFileSync(path.join(hvsc, s.path)), sha256 = createHash("sha256").update(bytes).digest("hex");
  return { path: path.join(hvsc, s.path), song: s.song, sha256, seconds: observationHorizon(index.get(s.path)?.tokens[s.song - 1], 10).seconds };
}).sort((a, b) => a.seconds - b.seconds || a.path.localeCompare(b.path));
// Evenly spaced quantiles of the horizon distribution: the same mix of short and long tunes as the selection.
const sample = Array.from({ length: Math.min(count, jobs.length) }, (_, i) => jobs[Math.floor((i + 0.5) * jobs.length / Math.min(count, jobs.length))]!);
const runtime = await mkdtemp(path.join(tmpdir(), "sidflow-rom-bench-"));
for (const name of ["kernal.901227-03.bin", "basic.901226-01.bin", "characters.901225-01.bin"]) await writeFile(path.join(runtime, name), await readFile(path.join(roms, name)));
let next = 0, horizon = 0, extended = 0;
const started = Date.now();
try {
  await Promise.all(Array.from({ length: workers }, async () => {
    const worker = new WorkerProcess(runtime);
    try {
      for (let job = sample[next++]; job; job = sample[next++]) {
        const isExtended = isExtendedSample(job.sha256, every);
        const record = await worker.request({ sha256: job.sha256, song: job.song, seconds: job.seconds, engines: ["sidlite"], extended: isExtended,
          hex: readVerifiedSid(job.path, job.sha256).toString("hex") }, jobTimeoutMs(job.seconds, ["sidlite"]));
        if (record.failure) throw new Error(`benchmark job failed: ${record.failure.message}`);
        validateRecord(record, ["sidlite"]);
        horizon += job.seconds; if (isExtended) extended++;
      }
    } finally { worker.close(); }
  }));
} finally { await rm(runtime, { recursive: true, force: true }); }
const elapsed = (Date.now() - started) / 1000, rate = horizon / elapsed;
console.log(`${cpus()[0]?.model ?? "unknown CPU"}; ${availableParallelism()} threads; ${workers} workers`);
console.log(`${sample.length} subtunes (${extended} cross-checked), ${horizon.toFixed(0)} horizon-seconds in ${elapsed.toFixed(1)} s: ${rate.toFixed(1)} horizon-seconds per second`);
const projected = CORPUS_HORIZON_SECONDS / rate / 3600;
console.log(`Projected full census (${CORPUS_HORIZON_SECONDS.toFixed(0)} horizon-seconds): ${projected.toFixed(1)} hours. Other load on this machine inflates this figure.`);
if (maxHours > 0 && projected > maxHours) { console.error(`Projection exceeds the ${maxHours} h budget.`); process.exitCode = 3; }
