#!/usr/bin/env bun
/**
 * HVSC ROM census (methodology 3): every subtune is rendered in lockstep on the shipping
 * WASM engines under the C64 Commander profile (see wasm-lanes.ts), in parallel worker
 * processes, with a durable checkpoint, a durable 5% rollout ledger and a kernel scope lock.
 *
 *   bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms --out workspace/rom-audit-v3 \
 *     --rollout pilot --selection selection.json [--workers N] [--limit N] [--budget-seconds S] [--retry-failures] [--engines sidlite[,residfp]]
 *   bun scripts/rom-audit/audit.ts ... --rollout full --hardening workspace/rom-audit-hardening/certificate.json
 *
 * Re-run the identical command to resume; a changed manifest is refused. A job that times
 * out or throws is recorded as a failure (all its decisions are unknown) and the census
 * continues; --retry-failures re-runs such jobs.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, openSync, closeSync, fsyncSync, writeFileSync as writeFileSyncNode } from "node:fs";
import { mkdir, mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { RELEASE_DOCUMENTS, releaseLengths, readVerifiedSid, toolHash } from "./inputs.js";
import { scopeLock, validateHardening, verifyHardeningEvidence, hardeningIdentity, type HardeningCertificate } from "./rollout.js";
import { RolloutLedger, ceilings } from "./ledger.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { ROM_AUDIT_ENGINES, REFERENCE_ROM_SHA256, romConsumerProfile, romEngineId, type RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { readCensus, censusKey } from "./checkpoint.js";
import { SYSTEM_ROMS } from "../../packages/sidflow-classify/src/render/system-roms-fetch.js";
import { observationHorizon, METHODOLOGY, CENSUS_SCHEMA, validateRecord, type CensusRecord } from "./methodology.js";
import { engineHashes, SAMPLE_RATE } from "./wasm-lanes.js";
import { publishProduction } from "./publish-production.js";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";

interface Tune { path: string; md5: string; sha256: string; songs: number; magic: string; flags: number; header: NonNullable<ReturnType<typeof checkSidHeader>["fields"]>; title: string; author: string; released: string; basicFlag: boolean }
interface Job { path: string; song: number; seconds: number; sha256: string }
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const digest = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const json = (v: unknown): string => stringifyDeterministic(v as JsonValue, 0);

function args(): { hvsc: string; roms: string; out: string; workers: number; seconds: number; limit: number; selection?: string; budget: number; rollout: string; hardening?: string; retryFailures: boolean; engines: RomAuditEngine[] } {
  const values: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i]!;
    if (key === "--retry-failures") { values["retry-failures"] = "1"; continue; }
    const value = process.argv[++i];
    if (!["--hvsc", "--roms", "--out", "--workers", "--seconds", "--limit", "--selection", "--budget-seconds", "--rollout", "--hardening", "--engines"].includes(key) || !value)
      throw new Error(`Invalid option ${key}; see script usage comment`);
    values[key.slice(2)] = value;
  }
  for (const key of ["hvsc", "roms", "out"]) if (!values[key]) throw new Error(`--${key} is required`);
  const workers = Number(values.workers ?? Math.max(1, availableParallelism() - 1));
  const seconds = Number(values.seconds ?? 10), limit = Number(values.limit ?? Number.MAX_SAFE_INTEGER), budget = Number(values["budget-seconds"] ?? 0);
  if (![workers, limit].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600 || !Number.isFinite(budget) || budget < 0)
    throw new Error("Invalid workers, limit, seconds or budget");
  const rollout = values.rollout ?? "pilot";
  if (!["pilot", "full"].includes(rollout)) throw new Error("Invalid rollout (pilot/full)");
  // A pilot without a reviewed selection would take the shortest tunes first and say nothing about long horizons.
  if (rollout === "pilot" && !values.selection) throw new Error("--rollout pilot requires --selection (see select-pilot.ts)");
  const engines = (values.engines ?? "sidlite").split(",") as RomAuditEngine[];
  if (!engines.length || engines.some(e => !(ROM_AUDIT_ENGINES as readonly string[]).includes(e)) || new Set(engines).size !== engines.length) throw new Error("Invalid --engines");
  // reSIDfp is refused: a second player in one reSIDfp instance renders different PCM for identical input (see
  // residfp-instance-state.ts), and C64 Commander plays every tune in one shared instance, so fresh-instance lanes would
  // describe a state Commander never produces. It also costs about six times as much per lane.
  if (engines.includes("residfp")) throw new Error("reSIDfp lanes are not supported until its per-instance PCM state is understood; see doc/research/hvsc-rom-production.md");
  return { rollout, budget, workers, seconds, limit, engines, retryFailures: !!values["retry-failures"],
    ...(values.hardening ? { hardening: path.resolve(values.hardening) } : {}), hvsc: path.resolve(values.hvsc!), roms: path.resolve(values.roms!), out: path.resolve(values.out!),
    ...(values.selection ? { selection: path.resolve(values.selection) } : {}) };
}
async function census(root: string): Promise<Tune[]> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".sid"))
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const results: Tune[] = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < files.length) {
      const index = next++, relative = files[index]!;
      if (/[\t\r\n]/.test(relative)) throw new Error(`Path unsupported by the protocol: ${relative}`);
      const bytes = await readFile(path.join(root, relative));
      const check = checkSidHeader(bytes);
      if (!check.fields || check.findings.some(f => f.severity === "violation")) throw new Error(`Invalid SID header ${relative}: ${JSON.stringify(check.findings)}`);
      const f = check.fields;
      const string = (offset: number): string => new TextDecoder("windows-1252").decode(bytes.subarray(offset, offset + 32)).split("\0")[0]!.trim();
      results[index] = { path: relative, md5: createHash("md5").update(bytes).digest("hex"), sha256: digest(bytes), songs: f.songs, magic: f.magic, flags: f.flags ?? 0,
        title: string(0x16), author: string(0x36), released: string(0x56), header: f, basicFlag: f.magic === "RSID" && !!((f.flags ?? 0) & 2) };
    }
  }));
  return results;
}

/** One worker process. A timeout or a crash rejects only the active job; the caller records it and respawns. */
class WorkerProcess {
  private readonly child;
  private pending: { resolve: (r: CensusRecord) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  private stderrTail = "";
  jobs = 0;
  constructor(runtime: string) {
    this.child = spawn(process.execPath, [path.join(scriptDir, "census-worker.ts"), runtime], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000); process.stderr.write(chunk); });
    createInterface({ input: this.child.stdout }).on("line", line => {
      const pending = this.pending;
      if (!pending || !line.trim()) return;
      this.pending = undefined; clearTimeout(pending.timer);
      try { pending.resolve(JSON.parse(line) as CensusRecord); } catch (error) { pending.reject(error as Error); }
    });
    this.child.on("exit", code => {
      const pending = this.pending;
      if (pending) { this.pending = undefined; clearTimeout(pending.timer); pending.reject(new Error(`worker exited ${code}: ${this.stderrTail.trim().split("\n").pop() ?? ""}`)); }
    });
  }
  request(message: unknown, timeoutMs: number): Promise<CensusRecord> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = undefined; this.child.kill("SIGKILL"); reject(Object.assign(new Error(`timed out after ${timeoutMs} ms`), { timeout: true })); }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify(message) + "\n", error => { if (error) { clearTimeout(timer); this.pending = undefined; reject(error); } });
    });
  }
  /** Peak resident set of the worker so far, in MB (0 where /proc is unavailable). */
  peakRssMb(): number {
    try { return Number(/VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${this.child.pid}/status`, "utf8"))?.[1] ?? 0) / 1024; } catch (error) { console.debug(`Cannot read worker memory: ${(error as Error).message}`); return 0; }
  }
  close(): void { this.child.stdin.end(); this.child.kill("SIGKILL"); }
}
/**
 * Generous hang detector, not a performance target. A job renders six lanes per engine; the pilot
 * measured at least ~5x realtime per lane, i.e. 1.2 s of wall time per horizon second and engine.
 * Allow ten times that (and never less than five minutes) before declaring the job hung.
 */
export const jobTimeoutMs = (seconds: number, engines: readonly RomAuditEngine[]): number =>
  Math.max(300000, Math.ceil(seconds * engines.reduce((n, engine) => n + (engine === "residfp" ? 60 : 12), 0) * 1000));

async function main(): Promise<void> {
  const a = args();
  await mkdir(a.out, { recursive: true });
  const tunes = await census(a.hvsc);
  const allSongs = tunes.reduce((n, t) => n + t.songs, 0);
  const documents: Record<string, string> = {};
  for (const name of RELEASE_DOCUMENTS) documents[name] = digest(await readFile(path.join(a.hvsc, "DOCUMENTS", name)));
  // Independently verify every path and raw file MD5 against the release index.
  const index = releaseLengths((await readFile(path.join(a.hvsc, "DOCUMENTS/Songlengths.md5"), "utf8")).replace(/\r/g, ""));
  if (index.size !== tunes.length) throw new Error(`Population mismatch: ${index.size} index entries, ${tunes.length} files`);
  for (const tune of tunes) {
    const entry = index.get(tune.path);
    if (!entry || entry.md5 !== tune.md5 || entry.tokens.length !== tune.songs) throw new Error(`Release index mismatch: ${tune.path}`);
  }
  const romBytes: Record<string, Buffer> = {}, roms: Record<string, string> = {};
  for (const name of ["kernal.901227-03.bin", "basic.901226-01.bin", "characters.901225-01.bin"]) { romBytes[name] = await readFile(path.join(a.roms, name)); roms[name] = digest(romBytes[name]!); }
  for (const spec of SYSTEM_ROMS) if (roms[spec.localName] !== spec.sha256) throw new Error(`Non-reference ROM: ${spec.localName}`);
  if (roms["kernal.901227-03.bin"] !== REFERENCE_ROM_SHA256.kernal || roms["basic.901226-01.bin"] !== REFERENCE_ROM_SHA256.basic || roms["characters.901225-01.bin"] !== REFERENCE_ROM_SHA256.chargen)
    throw new Error("ROM images differ from the lookup's reference hashes");
  const lengths = new Map([...index].map(([name, entry]) => [name, entry.tokens]));
  const horizons = Object.fromEntries(tunes.map(t => [t.path, Array.from({ length: t.songs }, (_, i) => observationHorizon(lengths.get(t.path)?.[i], a.seconds))]));
  const headersText = json(tunes), horizonsText = json(horizons);
  // Serialize audit parents sharing a corpus BEFORE any shared output is touched.
  const corpusSha256 = digest(tunes.map(t => `${t.path}\t${t.sha256}\n`).join(""));
  scopeLock(corpusSha256);
  const engines = a.engines;
  const engineIdentity = Object.fromEntries(engines.map(engine => {
    const hashes = engineHashes(engine), profile = romConsumerProfile(engine);
    return [engine, { ...hashes, profile, engineId: romEngineId(hashes, profile) }];
  }));
  const manifest = { schema: 4, methodology: METHODOLOGY, censusSchema: CENSUS_SCHEMA, hvscRoot: a.hvsc, files: tunes.length, songs: allSongs, seconds: a.seconds, sampleRate: SAMPLE_RATE,
    engines: engineIdentity, toolSha256: toolHash(), headersSha256: digest(headersText), horizonsSha256: digest(horizonsText), corpusSha256, documents, roms,
    ...(a.selection ? { selectionSha256: digest(await readFile(a.selection)) } : {}) };
  if (a.rollout === "full") {
    const cert = a.hardening ? JSON.parse(await readFile(a.hardening, "utf8")) as HardeningCertificate : undefined;
    const identity = await hardeningIdentity();
    if (!cert || !validateHardening(cert, identity) || !verifyHardeningEvidence(cert, path.join(path.dirname(a.hardening!), identity.slice(0, 16))))
      throw new Error("Full rollout requires a matching completed hardening certificate with intact evidence; pilot is limited to 5%");
  }
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  const manifestPath = path.join(a.out, "manifest.json");
  if (existsSync(manifestPath) && readFileSync(manifestPath, "utf8") !== manifestText) throw new Error("Existing audit manifest differs; use a different --out");
  await writeFile(manifestPath, manifestText);
  await writeFile(path.join(a.out, "headers.json"), headersText);
  await writeFile(path.join(a.out, "horizons.json"), horizonsText);
  const checkpoint = path.join(a.out, "census.jsonl");
  const rows = readCensus(checkpoint, engines, { repair: true });   // the scope lock is held
  let jobs: Job[] = tunes.flatMap(t => Array.from({ length: t.songs }, (_, i) => ({ path: path.join(a.hvsc, t.path), song: i + 1, sha256: t.sha256, seconds: observationHorizon(lengths.get(t.path)?.[i], a.seconds).seconds })));
  if (a.selection) {
    const selection = JSON.parse(await readFile(a.selection, "utf8")) as { path: string; song: number }[];
    const keys = new Set(selection.map(s => `${path.resolve(a.hvsc, s.path)}\t${s.song}`));
    jobs = jobs.filter(j => keys.has(`${j.path}\t${j.song}`));
    if (jobs.length !== keys.size) throw new Error("Selection contains unknown paths or subtunes");
  }
  jobs = jobs.slice(0, a.limit);
  const expected = new Map(jobs.map(j => [censusKey(j), j.seconds]));
  for (const [key, row] of rows) if (!expected.has(key) || row.seconds !== expected.get(key)) throw new Error(`Unexpected checkpoint row ${key}`);
  const done = (job: Job): boolean => { const row = rows.get(censusKey(job)); return !!row && (!row.failure || !a.retryFailures); };
  const pending = jobs.filter(j => !done(j));
  const runnable = pending.filter(j => j.seconds <= 3600).sort((x, y) => x.seconds - y.seconds || Buffer.compare(Buffer.from(x.path), Buffer.from(y.path)) || x.song - y.song);
  const started = Date.now();
  const ledger = RolloutLedger.open(corpusSha256);
  const imported = ledger.importHistory(a.hvsc, corpusSha256);
  const limit = a.rollout === "pilot" ? ceilings(tunes.length, allSongs) : undefined;
  if (limit && (ledger.subtunes > limit.maxSongs || ledger.distinctFiles > limit.maxFiles))
    throw new Error(`Existing scope (${ledger.subtunes} subtunes / ${ledger.distinctFiles} files) exceeds the 5% pilot ceiling (${limit.maxSongs} / ${limit.maxFiles}); hardened full-rollout certificate required`);
  console.log(`Ledger: ${ledger.subtunes} distinct subtunes / ${ledger.distinctFiles} files already rendered (${imported} newly imported)${limit ? `; pilot ceiling ${limit.maxSongs} / ${limit.maxFiles}` : ""}.`);
  console.log(`Verified release index: ${tunes.length} files / ${allSongs} subtunes; ${jobs.length} in scope; ${pending.length} pending; ${engines.join("+")}; ${a.workers} workers.`);
  let next = 0, ceilingSkipped = 0, added = 0, failures = 0, doneHorizon = 0;
  const totalHorizon = runnable.reduce((n, j) => n + j.seconds, 0);
  const takeJob = (): Job | undefined => {
    if (a.budget && Date.now() - started >= a.budget * 1000) return undefined;
    while (next < runnable.length) {
      const job = runnable[next++]!;
      // Reserve durably BEFORE dispatch so a crash cannot leave a rendered identity uncounted.
      if (ledger.reserve([{ sha256: job.sha256, path: path.relative(a.hvsc, job.path), song: job.song }], `audit:${a.out}`, limit)) return job;
      ceilingSkipped++;
    }
    return undefined;
  };
  const runtime = await mkdtemp(path.join(tmpdir(), "sidflow-rom-audit-runtime-"));
  for (const [name, bytes] of Object.entries(romBytes)) await writeFile(path.join(runtime, name), bytes, { mode: 0o400 });
  const save = (candidate: CensusRecord): void => {
    let record = candidate;
    try { validateRecord(record, engines); } catch (error) {
      // An invalid record is a defect in that job's evidence, not a reason to stop the census.
      console.error(`Invalid census record ${record.sha256.slice(0, 12)}#${record.song}: ${(error as Error).message}`);
      record = { schema: CENSUS_SCHEMA, sha256: record.sha256, song: record.song, seconds: record.seconds, sampleRate: record.sampleRate, runs: [], failure: { reason: "exception", message: `invalid record: ${(error as Error).message}` } };
    }
    const fd = openSync(checkpoint, "a");
    try { appendFileSync(fd, json(record).trimEnd() + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    rows.set(censusKey(record), record); added++; if (record.failure) failures++;
  };
  const progress = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000, rate = doneHorizon / Math.max(1, elapsed);
    console.log(`${rows.size}/${jobs.length} done; ${added} this run (${failures} failed); ${elapsed.toFixed(0)}s; peak worker RSS ${peakRss.toFixed(0)} MB; ${rate.toFixed(1)} horizon-s/s; ETA ${rate > 0 ? (((totalHorizon - doneHorizon) / rate) / 3600).toFixed(1) : "?"} h`);
  }, 30000);
  let peakRss = 0;
  const WORKER_JOBS = 200;
  const slot = async (): Promise<void> => {
    let worker = new WorkerProcess(runtime);
    try {
      for (let job = takeJob(); job; job = takeJob()) {
        const message = { sha256: job.sha256, song: job.song, seconds: job.seconds, engines, hex: readVerifiedSid(job.path, job.sha256).toString("hex") };
        // Recycle the worker periodically: each job instantiates many WASM modules.
        if (worker.jobs >= WORKER_JOBS) { peakRss = Math.max(peakRss, worker.peakRssMb()); worker.close(); worker = new WorkerProcess(runtime); }
        worker.jobs++;
        let record: CensusRecord;
        try { record = await worker.request(message, jobTimeoutMs(job.seconds, engines)); } catch (error) {
          // Isolate the failure: record it, replace the worker and carry on with the census.
          const timeout = (error as { timeout?: boolean }).timeout === true;
          console.error(`Job ${path.relative(a.hvsc, job.path)}#${job.song} failed (${timeout ? "timeout" : "exception"}): ${(error as Error).message}`);
          worker.close(); worker = new WorkerProcess(runtime);
          record = { schema: CENSUS_SCHEMA, sha256: job.sha256, song: job.song, seconds: job.seconds, sampleRate: SAMPLE_RATE, runs: [], failure: { reason: timeout ? "timeout" : "exception", message: (error as Error).message } };
        }
        if (record.sha256 !== job.sha256 || record.song !== job.song || record.seconds !== job.seconds) throw new Error("Worker result identity mismatch");
        if (rows.has(censusKey(record))) rows.delete(censusKey(record));   // a retried failure replaces its earlier record in memory only
        save(record); doneHorizon += job.seconds;
      }
    } finally { peakRss = Math.max(peakRss, worker.peakRssMb()); worker.close(); }
  };
  try { await Promise.all(Array.from({ length: a.workers }, slot)); } finally { clearInterval(progress); await rm(runtime, { recursive: true, force: true }); }
  const elapsedSec = (Date.now() - started) / 1000;
  writeFileSyncNode(path.join(a.out, "coverage.json"), JSON.stringify({ total: jobs.length, completed: rows.size, failed: [...rows.values()].filter(r => r.failure).length, pending: jobs.length - rows.size,
    unsupportedDuration: pending.filter(j => j.seconds > 3600).length, ceilingSkipped, ledgerSubtunes: ledger.subtunes, ledgerFiles: ledger.distinctFiles, elapsedSec, added,
    horizonSecondsPerSecond: doneHorizon / Math.max(1, elapsedSec) }, null, 2) + "\n");
  await publishProduction(a.out);
  if (rows.size !== jobs.length) console.log(`Coverage-limited publication; ${jobs.length - rows.size} subtunes pending.`);
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
