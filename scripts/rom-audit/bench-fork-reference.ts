#!/usr/bin/env bun
/** Exact cold/forked full-reference comparison on <=16 already counted jobs.
 * <benchmark.json> <roms> <fork binary> <report.json> <limit 1..16>
 * No variants, eligibility publication, or corpus expansion.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readVerifiedSid } from "./inputs.js";
import { screenSha, screenJson } from "./screen-identity.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [benchmark,roms,forkBinary,report,limitArg]=process.argv.slice(2),limit=Number(limitArg);
if(!benchmark||!roms||!forkBinary||!report||!Number.isSafeInteger(limit)||limit<1||limit>16)throw new Error("Expected benchmark, ROMs, fork binary, report, limit 1..16");
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
const jobs=prior.measured.slice(0,limit).map(r=>r.job);
if(jobs.length!==limit)throw new Error("Insufficient jobs");
scopeLock(prior.corpus);const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(j=>!ledger.has(j)))throw new Error("Only already counted jobs may be probed");
const cold=path.resolve("workspace/rom-audit-screen-residfp/render"),temp=mkdtempSync(path.join(tmpdir(),"sidflow-fork-"));
const inputs=jobs.map(job=>`immutable\t${job.song}\t${job.seconds}\thex:${readVerifiedSid(job.path,job.sha256).toString("hex")}\n`);
try {
  const began=performance.now(),forked=spawnSync(forkBinary,[roms,path.join(temp,"fork")],{input:inputs.join(""),encoding:"utf8",timeout:180000,maxBuffer:1048576});
  const forkWallSeconds=(performance.now()-began)/1000;
  if(forked.status!==0)throw new Error(`Fork probe failed: ${forked.error?.message??forked.stderr}`);
  const evidence=forked.stdout.trim().split("\n").map(line=>JSON.parse(line) as {error:string});
  if(evidence.length!==limit||evidence.some(e=>e.error))throw new Error("Incomplete fork reference");
  const rows:unknown[]=[];let coldWallSeconds=0;
  for(const [i,input] of inputs.entries()){
    const directory=path.join(temp,`cold-${i}`);mkdirSync(directory);
    const started=performance.now(),reference=spawnSync(cold,[roms],{input,encoding:"utf8",timeout:120000,maxBuffer:1048576,env:{...process.env,ROM_AUDIT_REFERENCE_ONLY:"1",ROM_AUDIT_CONTROL_DIR:directory,ROM_AUDIT_SAMPLE_RATE:"48000",ROM_AUDIT_POWER_ON_DELAY:"8191",ROM_AUDIT_PULL_EVENTS:"256",ROM_AUDIT_SCREEN_MASK:undefined,ROM_AUDIT_STREAM_AUDIO:undefined,ROM_AUDIT_DIGITAL_ONLY:undefined,ROM_AUDIT_BUS_ONLY:undefined,ROM_AUDIT_WARMUP:undefined}});
    coldWallSeconds+=(performance.now()-started)/1000;
    if(reference.status!==0||screenJson(JSON.parse(reference.stdout))!==screenJson(evidence[i]))throw new Error(`Cold/fork reference summary mismatch at ${i}`);
    const hashes:Record<string,string>={};
    for(const ext of ["pcm","trace"]){
      const expected=readFileSync(path.join(directory,`0-7.${ext}`)),actual=readFileSync(path.join(temp,"fork",String(i+1),`0-7.${ext}`));
      if(!expected.equals(actual))throw new Error(`Cold/fork exact ${ext} mismatch at ${i}`);
      hashes[ext]=screenSha(actual);
    }
    rows.push({job:jobs[i],hashes});
  }
  writeFileSync(report,screenJson({schema:"sidflow-fork-reference-experiment-1",coldWallSeconds,forkWallSeconds,benchmarkSha256:screenSha(readFileSync(benchmark)),nativeHashes:{cold:screenSha(readFileSync(cold)),fork:screenSha(readFileSync(forkBinary))},resourceUsage:forked.stderr,rows})+"\n");
  console.log(`${limit} cold/fork references: exact PCM, traces and counters matched; ${coldWallSeconds.toFixed(3)} -> ${forkWallSeconds.toFixed(3)}s including prewarm`);
} finally {rmSync(temp,{recursive:true,force:true});}
