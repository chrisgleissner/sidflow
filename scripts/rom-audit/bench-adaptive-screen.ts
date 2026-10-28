#!/usr/bin/env bun
/** Bounded A/B experiment on ALREADY COUNTED benchmark jobs. Never publishes
 * eligibility; compares every final timed write, error and completion flag.
 * Usage: <benchmark.json> <roms> <output.json> <limit 1..32>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adaptiveScreens, type ScreenAttempt } from "./adaptive-screen.js";
import { screenLane } from "./digital-screen.js";
import { screenJson, screenSha, screenIdentity } from "./screen-identity.js";
import { readVerifiedSid } from "./inputs.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
const [benchmark, roms, output, limitArg] = process.argv.slice(2);
const limit = Number(limitArg);
if (!benchmark || !roms || !output || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error("Expected benchmark, roms, output, limit 1..32");
const prior = JSON.parse(readFileSync(benchmark,"utf8")) as {corpus: string; measured: {job: BenchmarkCandidate}[]};
const jobs = prior.measured.slice(0,limit).map(row => row.job);
if (jobs.length !== limit) throw new Error("Insufficient benchmark jobs");
scopeLock(prior.corpus);
const ledger = RolloutLedger.open(prior.corpus);
if (jobs.some(job => !ledger.has(job))) throw new Error("Experiment may only reuse already counted jobs");
const rows: unknown[] = [];
const binaries = Object.fromEntries(["sidlite","residfp"].map(engine => [engine,path.resolve(`workspace/rom-audit-screen-${engine}/render`)]));
const identity = screenIdentity();
const experimentHashes = Object.fromEntries(["adaptive-screen.ts","bench-adaptive-screen.ts"].map(name => [name,screenSha(readFileSync(new URL(name,import.meta.url)))]));
const romHashes = Object.fromEntries(["kernal.901227-03.bin","basic.901226-01.bin","characters.901225-01.bin"].map(name => [name,screenSha(readFileSync(path.join(roms,name)))]));
function finalEvidence(attempts: ScreenAttempt[]) {
  return [7,0,3].map(mask => {
    const result = attempts.filter(a => a.mask === mask).at(-1)?.result;
    return result && {error:result.error, traceComplete:result.traceComplete, chargenReads:result.chargenReads, writes:result.writes};
  });
}
for (const [index, job] of jobs.entries()) for (const engine of ["sidlite","residfp"] as const) {
  const bytes = readVerifiedSid(job.path,job.sha256), binary = binaries[engine]!;
  const run = (mask: number, mode: "bus" | "warmup" | "detailed") => screenLane(binary,roms,bytes,job.song,job.seconds,mask,mode === "bus",mode === "warmup");
  // Alternate order to reduce systematic thermal/cache ordering effects.
  const results = new Map<boolean, {attempts: ScreenAttempt[]; wallSeconds: number}>();
  for (const adaptive of index % 2 ? [true,false] : [false,true]) {
    const start = performance.now(), attempts = await adaptiveScreens(run,adaptive);
    results.set(adaptive,{attempts,wallSeconds:(performance.now()-start)/1000});
  }
  const baseline = results.get(false)!, adaptive = results.get(true)!;
  if (screenJson(finalEvidence(baseline.attempts)) !== screenJson(finalEvidence(adaptive.attempts))) throw new Error(`A/B execution mismatch: ${job.path}#${job.song} ${engine}`);
  const summary = (value: typeof baseline) => ({wallSeconds:value.wallSeconds,cpuSeconds:value.attempts.reduce((sum,a)=>sum+(a.result.cpuSeconds??0),0),attempts:value.attempts.map(a=>({mask:a.mask,mode:a.mode,error:a.result.error}))});
  rows.push({job,engine,baseline:summary(baseline),adaptive:summary(adaptive),evidenceSha256:screenSha(screenJson(finalEvidence(baseline.attempts)))});
  writeFileSync(output,screenJson({schema:"sidflow-adaptive-screen-experiment-1",sourceIdentity:identity,experimentHashes,romHashes,benchmarkSha256:screenSha(readFileSync(benchmark)),nativeHashes:Object.fromEntries(Object.entries(binaries).map(([e,f])=>[e,screenSha(readFileSync(f))])),limit,rows})+"\n");
  console.log(`${index+1}/${limit} ${engine}: ${baseline.wallSeconds.toFixed(3)} -> ${adaptive.wallSeconds.toFixed(3)}s, exact evidence matched`);
}
