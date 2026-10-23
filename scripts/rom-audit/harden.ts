#!/usr/bin/env bun
/**
 * Hardening qualification for the ROM census. A certificate is written only after every step
 * below has actually run against one source identity:
 *
 *   1. strict TypeScript check of scripts/rom-audit
 *   2. decision-path regression on both engines (comparator regressions on real subtunes,
 *      synthetic programs through lanes, assess, deny tuple and lookup)
 *   3. a completed pilot: no failed jobs, engine hashes equal to the installed engine,
 *      publication and exhaustive lookup consistency pass
 *   4. fresh-process re-run equality on pilot subtunes
 *   5. three consecutive focused test runs and three complete repository suites, 0 fail / 0 skip
 *   6. an architect approval bound to the exact source identity
 *
 *   bun scripts/rom-audit/harden.ts --identity
 *   bun scripts/rom-audit/harden.ts --hvsc workspace/hvsc/C64Music --roms workspace/roms \
 *     --pilot workspace/rom-audit-v3 --review doc/research/hvsc-rom-adversarial-review.md
 *   (add --dry-run to skip the repository suites and the certificate)
 *
 * The scope lock is held throughout, so no audit can start while qualification runs. The source
 * identity (every file under scripts/rom-audit, the engine package, the lock file) is compared
 * before and after. The approval line is checked first, so a missing approval fails in seconds.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { ROM_AUDIT_ENGINES } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { METHODOLOGY, validateRecord } from "./methodology.js";
import { corpusIdentity, readVerifiedSid } from "./inputs.js";
import { hardeningIdentity, scopeLock, suiteTotals, HARDENING_CERTIFICATE_SCHEMA, type HardeningCertificate, type SuiteTotals } from "./rollout.js";
import { publishProduction } from "./publish-production.js";
import { readCensus } from "./checkpoint.js";
import { engineHashes } from "./wasm-lanes.js";

const root = path.resolve(import.meta.dir, "../..");
const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const REQUIRED_RUNS = 3;

function options(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i]!;
    if (key === "--identity" || key === "--dry-run") { values[key.slice(2)] = "1"; continue; }
    const value = process.argv[++i];
    if (!["--hvsc", "--roms", "--pilot", "--review", "--out"].includes(key) || !value) throw new Error(`Invalid option ${key}`);
    values[key.slice(2)] = value;
  }
  return values;
}

interface Step { name: string; command: string[]; log: string }
function run(step: Step, evidence: string, environment: Record<string, string> = {}): string {
  const log = path.join(evidence, step.log);
  const fd = openSync(log, "w");
  console.log(`[harden] ${step.name}`);
  try {
    const result = spawnSync(step.command[0]!, step.command.slice(1), {
      cwd: root, stdio: ["ignore", fd, fd], env: { ...process.env, ...environment }, timeout: 3 * 3600 * 1000,
    });
    if (result.status !== 0) throw new Error(`${step.name} failed (${result.status}/${result.signal}); see ${log}`);
  } finally { closeSync(fd); }
  return log;
}

async function main(): Promise<void> {
  const o = options();
  if (o.identity) { console.log(await hardeningIdentity()); return; }
  for (const key of ["hvsc", "roms", "pilot", "review"]) if (!o[key]) throw new Error(`--${key} is required`);
  const hvsc = path.resolve(o.hvsc!), roms = path.resolve(o.roms!), pilot = path.resolve(o.pilot!), review = path.resolve(o.review!);
  const identity = await hardeningIdentity();
  // The architect approval is checked first: without it nothing below could produce a certificate.
  const reviewText = readFileSync(review, "utf8");
  const approved = /^Approved-source-identity: ([a-f0-9]{64})$/m.exec(reviewText)?.[1];
  const reviewer = /^Reviewer-model: (\S+)$/m.exec(reviewText)?.[1];
  if (!o["dry-run"] && (approved !== identity || reviewer !== "claude-opus-5-5"))
    throw new Error(`Architect approval missing or bound to another source identity. Required line: "Approved-source-identity: ${identity}" with "Reviewer-model: claude-opus-5-5"`);
  scopeLock(await corpusIdentity(hvsc));   // held until this process exits
  const evidence = path.resolve(o.out ?? path.join(root, "workspace/rom-audit-hardening"), identity.slice(0, 16));
  mkdirSync(evidence, { recursive: true });
  const censusEngines = ROM_AUDIT_ENGINES.filter(e => Object.hasOwn(JSON.parse(readFileSync(path.join(pilot, "manifest.json"), "utf8")).engines, e));
  const engines = Object.fromEntries(censusEngines.map(e => [e, engineHashes(e)]));
  const logs: Record<string, string> = {};
  const record = (step: Step, environment?: Record<string, string>): string => {
    const log = run(step, evidence, environment);
    logs[step.log] = sha(readFileSync(log));
    return log;
  };

  // 1. type check every script in the directory
  const scripts = readdirSync(path.join(root, "scripts/rom-audit")).filter(n => n.endsWith(".ts")).map(n => `scripts/rom-audit/${n}`);
  record({ name: "strict type check", log: "typecheck.log", command: ["bunx", "tsc", "--noEmit", "--strict", "--module", "ESNext",
    "--moduleResolution", "bundler", "--target", "ES2022", "--types", "bun-types", "--skipLibCheck", "--allowImportingTsExtensions", ...scripts] });

  // 2. decision-path regression (both engines)
  const decisionLog = record({ name: "decision-path regression", log: "decision-regression.log", command: ["bun", "scripts/rom-audit/decision-regression.ts", roms, censusEngines.join(",")] });
  const decisionDigest = /^DIGEST ([a-f0-9]{64})$/m.exec(readFileSync(decisionLog, "utf8"))?.[1];
  if (!decisionDigest) throw new Error("No decision digest");

  // 3. pilot: provenance, completeness and publication
  const manifest = JSON.parse(readFileSync(path.join(pilot, "manifest.json"), "utf8")) as { toolSha256: string; engines: Record<string, { sourceSha256: string; wasmSha256: string }>; hvscRoot: string };
  const tool = sha(Buffer.concat(["wasm-lanes.ts", "census-worker.ts", "methodology.ts", "checkpoint.ts", "inputs.ts", "audit.ts"].map(f => readFileSync(path.join(root, "scripts/rom-audit", f)))));
  if (manifest.toolSha256 !== tool) throw new Error("The pilot was produced by different census tooling; re-run the pilot");
  for (const engine of censusEngines)
    if (manifest.engines[engine]?.sourceSha256 !== engines[engine]!.sourceSha256 || manifest.engines[engine]?.wasmSha256 !== engines[engine]!.wasmSha256)
      throw new Error(`Pilot ${engine} engine differs from the installed engine; re-run the pilot`);
  const rows = readCensus(path.join(pilot, "census.jsonl"), censusEngines, { repair: false });
  if (rows.size < 50) throw new Error(`Pilot has only ${rows.size} measured subtunes`);
  const failed = [...rows.values()].filter(r => r.failure).length;
  if (failed) throw new Error(`Pilot has ${failed} failed jobs; investigate each before qualifying`);
  await publishProduction(pilot, path.join(evidence, "pilot-publication"));

  // 4. fresh-process re-run equality on evenly spaced pilot subtunes
  const headers = JSON.parse(readFileSync(path.join(pilot, "headers.json"), "utf8")) as { path: string; sha256: string }[];
  const pathBySha = new Map(headers.map(h => [h.sha256, h.path]));
  const sample = [...rows.values()].filter(r => r.seconds <= 200).filter((_, index) => index % Math.max(1, Math.floor(rows.size / 6)) === 0).slice(0, 6);
  if (sample.length < 5) throw new Error("Too few short pilot subtunes for the reproducibility check");
  const input = sample.map(r => JSON.stringify({ sha256: r.sha256, song: r.song, seconds: r.seconds, engines: censusEngines,
    hex: readVerifiedSid(path.join(manifest.hvscRoot, pathBySha.get(r.sha256)!), r.sha256).toString("hex") }) + "\n").join("");
  const again = spawnSync(process.execPath, [path.join(root, "scripts/rom-audit/census-worker.ts"), roms], { input, encoding: "utf8", maxBuffer: 1 << 28, timeout: 3 * 3600 * 1000 });
  if (again.status !== 0) throw new Error(`Reproducibility run failed: ${again.stderr}`);
  again.stdout.trim().split("\n").forEach((line, i) => {
    const fresh = JSON.parse(line);
    validateRecord(fresh, censusEngines);
    if (stringifyDeterministic(fresh as JsonValue, 0) !== stringifyDeterministic(sample[i] as unknown as JsonValue, 0)) throw new Error(`Fresh-process re-run differs: ${sample[i]!.sha256.slice(0, 12)}#${sample[i]!.song}`);
  });

  // 5. focused tests, three consecutive runs; then complete repository suites
  const focused = readdirSync(path.join(root, "packages/sidflow-common/test")).filter(n => /^rom-.*\.test\.ts$/.test(n)).map(n => `packages/sidflow-common/test/${n}`);
  const focusedTotals: SuiteTotals[] = [];
  for (let n = 1; n <= REQUIRED_RUNS; n++) {
    const log = `focused-${n}.log`;
    record({ name: `focused ROM audit tests, run ${n}`, log, command: ["bun", "test", ...focused] });
    const totals = suiteTotals(readFileSync(path.join(evidence, log), "utf8"));
    if (totals.fail !== 0 || totals.pass === 0) throw new Error(`Focused run ${n}: ${JSON.stringify(totals)}`);
    focusedTotals.push(totals);
  }
  const suites: SuiteTotals[] = [];
  if (o["dry-run"]) console.log("[harden] dry run: repository suites skipped; no certificate will be written");
  else for (let n = 1; n <= REQUIRED_RUNS; n++) {
    const log = `full-suite-${n}.log`;
    record({ name: `complete repository suite, run ${n}`, log, command: ["bun", "run", "test"] });
    const totals = suiteTotals(readFileSync(path.join(evidence, log), "utf8"));
    if (totals.fail !== 0 || totals.skip !== 0 || totals.pass === 0) throw new Error(`Full suite run ${n}: ${JSON.stringify(totals)}`);
    suites.push(totals);
  }

  // 6. nothing may have changed while the checks ran
  if ((await hardeningIdentity()) !== identity) throw new Error("Hardening sources changed during qualification; certificate refused");
  if (stringifyDeterministic(Object.fromEntries(censusEngines.map(e => [e, engineHashes(e)])) as JsonValue, 0) !== stringifyDeterministic(engines as JsonValue, 0)) throw new Error("Engine package changed during qualification");
  if (o["dry-run"]) return;

  const certificate: HardeningCertificate = {
    schema: HARDENING_CERTIFICATE_SCHEMA, methodology: METHODOLOGY, sourceIdentity: identity, engines, passed: true,
    checks: {
      typecheck: true, focusedRuns: REQUIRED_RUNS, focusedTotals, fullSuiteRuns: REQUIRED_RUNS, fullSuiteTotals: suites,
      pilot: { manifestSha256: sha(readFileSync(path.join(pilot, "manifest.json"))), subtunes: rows.size, files: new Set([...rows.values()].map(r => r.sha256)).size, failed },
      decisionRegression: { digest: decisionDigest }, reproducibility: { rows: sample.length },
      adversarialReview: { file: path.relative(root, review), sha256: sha(reviewText), sourceIdentity: approved! },
    },
    logs,
  };
  const text = stringifyDeterministic(certificate as unknown as JsonValue);
  writeFileSync(path.join(evidence, "certificate.json"), text);
  writeFileSync(path.join(path.dirname(evidence), "certificate.json"), text);
  console.log(`[harden] certificate written: ${path.join(evidence, "certificate.json")}`);
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
