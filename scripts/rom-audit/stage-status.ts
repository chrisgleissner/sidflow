#!/usr/bin/env bun
/**
 * Is a run-full.sh stage already complete? Prints "done" or "todo: <reason>" so a rerun can skip finished
 * stages instead of repeating hours of work (or tripping the pilot ceiling after the full run has started).
 *   bun scripts/rom-audit/stage-status.ts pilot|harden|full <run or evidence directory>
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROM_AUDIT_ENGINES } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { engineHashes } from "./wasm-lanes.js";
import { toolHash } from "./inputs.js";
import { hardeningIdentity, validateHardening, verifyHardeningEvidence, type HardeningCertificate } from "./rollout.js";

const [stage, directory] = process.argv.slice(2);
const todo = (reason: string): never => { console.log(`todo: ${reason}`); process.exit(0); };
if (!stage || !directory) throw new Error("Usage: stage-status.ts pilot|harden|full <directory>");
if (stage === "harden") {
  const file = path.join(directory, "certificate.json");
  if (!existsSync(file)) todo("no certificate");
  const identity = await hardeningIdentity(), certificate = JSON.parse(readFileSync(file, "utf8")) as HardeningCertificate;
  if (!validateHardening(certificate, identity)) todo("certificate does not match the current sources");
  if (!verifyHardeningEvidence(certificate, path.join(directory, identity.slice(0, 16)))) todo("certificate evidence does not verify");
  console.log("done");
} else if (stage === "pilot" || stage === "full") {
  const coverage = path.join(directory, "coverage.json"), manifest = path.join(directory, "manifest.json");
  if (!existsSync(coverage) || !existsSync(manifest)) todo("no completed run");
  const c = JSON.parse(readFileSync(coverage, "utf8")) as { pending: number; failed: number }, m = JSON.parse(readFileSync(manifest, "utf8")) as { toolSha256: string; engines: Record<string, { sourceSha256: string; wasmSha256: string }> };
  if (c.pending !== 0) todo(`${c.pending} subtunes pending`);
  if (c.failed !== 0) todo(`${c.failed} failed jobs`);
  if (m.toolSha256 !== toolHash()) todo("produced by different census tooling");
  for (const engine of ROM_AUDIT_ENGINES) if (m.engines[engine] && (m.engines[engine]!.wasmSha256 !== engineHashes(engine).wasmSha256 || m.engines[engine]!.sourceSha256 !== engineHashes(engine).sourceSha256)) todo(`${engine} engine changed`);
  console.log("done");
} else throw new Error("Unknown stage");
