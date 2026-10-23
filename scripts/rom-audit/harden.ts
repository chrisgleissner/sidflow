#!/usr/bin/env bun
/**
 * Hardening qualification for the ROM audit. A certificate is written only after
 * every step below has actually run against one source identity:
 *
 *   1. strict TypeScript check of scripts/rom-audit
 *   2. clean release and AddressSanitizer+UBSan native builds (build-native.sh)
 *   3. native regression suite on both binaries, sanitizer faults fatal
 *   4. decision-path regression (synthetic programs through screening, shipping-engine
 *      confirmation, assess() and the lookup) on both binaries; digests must be identical
 *   5. exact native/WASM parity controls (consistency control, not allow evidence)
 *   6. a completed pilot: native rows valid, every nominated candidate confirmed on the
 *      shipping engine, publication and exhaustive lookup consistency pass
 *   7. fresh-process re-render equality on pilot rows
 *   8. three consecutive focused test runs and three complete repository suites, 0 fail / 0 skip
 *   9. an architect approval bound to the exact source identity
 *
 *   bun scripts/rom-audit/harden.ts --identity
 *   bun scripts/rom-audit/harden.ts --hvsc workspace/hvsc/C64Music --roms workspace/roms \
 *     --pilot workspace/rom-audit-v3 --review doc/research/hvsc-rom-adversarial-review.md
 *   (add --dry-run to skip the repository suites and the certificate)
 *
 * The scope lock is held throughout, so no audit can start while qualification runs.
 * Source identity (every file under scripts/rom-audit, the engine package, the lock
 * file and git HEAD) and the native hashes are compared before and after.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { METHODOLOGY, validateMatrix } from "./methodology.js";
import { corpusIdentity, freshNativeRenderer, readVerifiedSid } from "./inputs.js";
import { hardeningIdentity, scopeLock, HARDENING_CERTIFICATE_SCHEMA, type HardeningCertificate, type SuiteTotals } from "./rollout.js";
import { publishProduction } from "./publish-production.js";
import { readCheckpoint } from "./checkpoint.js";
import { candidateMasks, verdictFromConfirmation, type JobResult } from "./confirm.js";
import { screen, type Horizon } from "./methodology.js";
import type { Execution } from "./analysis.js";

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

/** Sum the per-batch summaries printed by bun test / run-unit-coverage-batches. */
export function suiteTotals(output: string): SuiteTotals {
  const total = { pass: 0, fail: 0, skip: 0 };
  for (const match of output.matchAll(/^\s*(\d+) (pass|fail|skip)\s*$/gm)) total[match[2] as keyof SuiteTotals] += Number(match[1]);
  return total;
}
const digestOf = (log: string): string => {
  const found = /^DIGEST ([a-f0-9]{64})$/m.exec(readFileSync(log, "utf8"))?.[1];
  if (!found) throw new Error(`No decision digest in ${log}`);
  return found;
};

async function main(): Promise<void> {
  const o = options();
  if (o.identity) { console.log(await hardeningIdentity()); return; }
  for (const key of ["hvsc", "roms", "pilot", "review"]) if (!o[key]) throw new Error(`--${key} is required`);
  const hvsc = path.resolve(o.hvsc!), roms = path.resolve(o.roms!), pilot = path.resolve(o.pilot!), review = path.resolve(o.review!);
  scopeLock(await corpusIdentity(hvsc));   // held until this process exits
  const identity = await hardeningIdentity();
  const evidence = path.resolve(o.out ?? path.join(root, "workspace/rom-audit-hardening"), identity.slice(0, 16));
  mkdirSync(evidence, { recursive: true });
  const engine = (): Record<string, string> => {
    const base = path.join(root, "packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist");
    return { sourceSha256: sha(readFileSync(path.join(base, "complete-source.tar.gz"))), wasmSha256: sha(readFileSync(path.join(base, "sidlite/libsidplayfp.wasm"))) };
  };
  const engineBefore = engine();
  const logs: Record<string, string> = {};
  const record = (step: Step, environment?: Record<string, string>): string => {
    const log = run(step, evidence, environment);
    logs[step.log] = sha(readFileSync(log));
    return log;
  };
  const sanitizerEnvironment = { ASAN_OPTIONS: "detect_leaks=0:halt_on_error=1", UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" };

  // 1. type check every script in the directory
  const scripts = readdirSync(path.join(root, "scripts/rom-audit")).filter(n => n.endsWith(".ts")).map(n => `scripts/rom-audit/${n}`);
  record({ name: "strict type check", log: "typecheck.log", command: ["bunx", "tsc", "--noEmit", "--strict", "--module", "ESNext",
    "--moduleResolution", "bundler", "--target", "ES2022", "--types", "bun-types", "--skipLibCheck", "--allowImportingTsExtensions", ...scripts] });

  // 2. clean builds; the hashes are what the certificate binds to
  console.log("[harden] building native renderers");
  const native = freshNativeRenderer(false), asan = freshNativeRenderer(true);
  const nativeSha256 = sha(readFileSync(native)), asanSha256 = sha(readFileSync(asan));
  const compiler = spawnSync("g++", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
  writeFileSync(path.join(evidence, "toolchain.log"), `${compiler}\nnative ${nativeSha256}\nsanitizer ${asanSha256}\n`);
  logs["toolchain.log"] = sha(readFileSync(path.join(evidence, "toolchain.log")));

  // 3. regressions on both binaries
  record({ name: "native regression (release build)", log: "native-regression.log", command: ["bun", "scripts/rom-audit/native-regression.ts", native, roms, hvsc] });
  record({ name: "native regression (ASan+UBSan)", log: "native-regression-sanitizer.log", command: ["bun", "scripts/rom-audit/native-regression.ts", asan, roms, hvsc] }, sanitizerEnvironment);

  // 4. decision-path regression: identical digests from both binaries
  const releaseDigest = digestOf(record({ name: "decision regression (release build)", log: "decision-release.log", command: ["bun", "scripts/rom-audit/decision-regression.ts", native, roms] }));
  const sanitizerDigest = digestOf(record({ name: "decision regression (ASan+UBSan)", log: "decision-sanitizer.log", command: ["bun", "scripts/rom-audit/decision-regression.ts", asan, roms] }, sanitizerEnvironment));
  if (releaseDigest !== sanitizerDigest) throw new Error("Release and sanitizer binaries decided differently");

  // 5. exact native/WASM parity (consistency control)
  const parityFile = path.join(evidence, "parity.json");
  record({ name: "exact native/WASM parity", log: "parity.log", command: ["bun", "scripts/rom-audit/verify-native.ts", hvsc, roms, parityFile] });
  const parity = JSON.parse(readFileSync(parityFile, "utf8")) as { cases: unknown[]; nativeSha256: string };
  if (parity.nativeSha256 !== nativeSha256) throw new Error("Parity certificate was produced by a different native renderer");
  const parityCases = parity.cases.length;
  if (parityCases < 100) throw new Error(`Parity certificate has only ${parityCases} cases`);

  // 6. pilot rows, shipping-engine confirmation and publication
  const manifest = JSON.parse(readFileSync(path.join(pilot, "manifest.json"), "utf8")) as { nativeSha256: string; sourceSha256: string; wasmSha256: string; hvscRoot: string };
  if (manifest.nativeSha256 !== nativeSha256) throw new Error("Pilot was measured with a different native renderer; re-run the pilot");
  if (manifest.sourceSha256 !== engineBefore.sourceSha256 || manifest.wasmSha256 !== engineBefore.wasmSha256) throw new Error("Pilot engine differs from the installed engine");
  const rows = readCheckpoint(path.join(pilot, "execution.jsonl"));
  if (rows.size < 50) throw new Error(`Pilot has only ${rows.size} measured subtunes`);
  for (const row of rows.values()) validateMatrix(row);
  const headers = JSON.parse(readFileSync(path.join(pilot, "headers.json"), "utf8")) as { path: string; sha256: string }[];
  const shaByPath = new Map(headers.map(h => [h.path, h.sha256]));
  const horizons = JSON.parse(readFileSync(path.join(pilot, "horizons.json"), "utf8")) as Record<string, Horizon[]>;
  const confirmations = new Map<string, JobResult>();
  for (const line of readFileSync(path.join(pilot, "confirmation.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const c = JSON.parse(line) as JobResult; confirmations.set(`${c.sha256}#${c.song}#${c.seconds}`, c);
  }
  let confirmedSubtunes = 0, mismatches = 0;
  for (const row of rows.values()) {
    const relative = path.relative(manifest.hvscRoot, row.path), horizon = horizons[relative]![row.song - 1]!, sha256 = shaByPath.get(relative)!;
    const candidates = candidateMasks(row, horizon);
    if (!candidates.length) continue;
    const job = confirmations.get(`${sha256}#${row.song}#${row.seconds}`);
    if (!job) throw new Error(`Candidate subtune without shipping-engine confirmation: ${relative}#${row.song}`);
    confirmedSubtunes++;
    for (const c of candidates) {
      const verdict = verdictFromConfirmation(screen(row.matrix![c.mask], row.both, row.repeat, row.seconds, horizon).state, job.results.find(r => r.mask === c.mask), row, c.mask);
      if (verdict === undefined) throw new Error(`Unbound or missing confirmation: ${relative}#${row.song} mask ${c.mask}`);
      if (verdict === "mismatch") mismatches++;
    }
  }
  await publishProduction(pilot, path.join(evidence, "pilot-publication"));

  // 7. fresh-process re-render equality on evenly spaced pilot rows
  const sample = [...rows.values()].filter((_, index) => index % Math.max(1, Math.floor(rows.size / 6)) === 0).slice(0, 6);
  const reproducible = spawnSync(native, [roms], {
    input: sample.map(r => `${r.path}\t${r.song}\t${r.seconds}\thex:${readVerifiedSid(r.path, shaByPath.get(path.relative(manifest.hvscRoot, r.path))!).toString("hex")}\n`).join(""),
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 3 * 3600 * 1000 });
  if (reproducible.status !== 0) throw new Error(`Reproducibility render failed: ${reproducible.stderr}`);
  const again = reproducible.stdout.trim().split("\n").map(line => JSON.parse(line) as Execution);
  sample.forEach((r, i) => {
    if (stringifyDeterministic(again[i]!.matrix as unknown as JsonValue, 0) !== stringifyDeterministic(r.matrix as unknown as JsonValue, 0))
      throw new Error(`Fresh-process re-render differs: ${r.path}#${r.song}`);
  });

  // 8. focused tests, three consecutive runs; then complete repository suites
  const focused = ["packages/sidflow-common/test/rom-audit.test.ts", "packages/sidflow-common/test/rom-eligibility.test.ts",
    "packages/sidflow-common/test/rom-audit-adversarial.test.ts", "packages/sidflow-common/test/rom-audit-ledger.test.ts"];
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

  // 9. nothing may have changed while the checks ran
  if ((await hardeningIdentity()) !== identity) throw new Error("Hardening sources changed during qualification; certificate refused");
  if (sha(readFileSync(native)) !== nativeSha256 || sha(readFileSync(asan)) !== asanSha256) throw new Error("Native renderer changed during qualification");
  if (stringifyDeterministic(engine() as unknown as JsonValue, 0) !== stringifyDeterministic(engineBefore as unknown as JsonValue, 0)) throw new Error("Engine package changed during qualification");

  // Architect approval bound to this exact source identity.
  const reviewText = readFileSync(review, "utf8");
  const approved = /^Approved-source-identity: ([a-f0-9]{64})$/m.exec(reviewText)?.[1];
  const reviewer = /^Reviewer-model: (\S+)$/m.exec(reviewText)?.[1];
  if (approved !== identity || reviewer !== "claude-opus-5-5")
    throw new Error(`Architect approval missing or bound to another source identity. Required line: "Approved-source-identity: ${identity}" with "Reviewer-model: claude-opus-5-5"`);
  if (o["dry-run"]) return;

  const certificate: HardeningCertificate = {
    schema: HARDENING_CERTIFICATE_SCHEMA, methodology: METHODOLOGY, sourceIdentity: identity, nativeSha256, asanSha256,
    engine: engineBefore as { sourceSha256: string; wasmSha256: string }, passed: true,
    checks: {
      typecheck: true, nativeRegression: true, sanitizer: true, exactParity: true, parityCases,
      focusedRuns: REQUIRED_RUNS, focusedTotals, fullSuiteRuns: REQUIRED_RUNS, fullSuiteTotals: suites,
      pilot: { manifestSha256: sha(readFileSync(path.join(pilot, "manifest.json"))), subtunes: rows.size, files: new Set([...rows.values()].map(r => r.path)).size },
      decisionRegression: { digest: releaseDigest, sanitizerDigest },
      reproducibility: { rows: sample.length },
      shippingEngine: { confirmedSubtunes, mismatches },
      adversarialReview: { file: path.relative(root, review), sha256: sha(reviewText), sourceIdentity: approved },
    },
    logs,
  };
  const text = stringifyDeterministic(certificate as unknown as JsonValue);
  writeFileSync(path.join(evidence, "certificate.json"), text);
  writeFileSync(path.join(path.dirname(evidence), "certificate.json"), text);
  console.log(`[harden] certificate written: ${path.join(evidence, "certificate.json")}`);
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
