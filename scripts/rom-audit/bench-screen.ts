#!/usr/bin/env bun
import { screenJson } from "./screen-identity.js";
/** Reuse the already-counted stratified v4 sample to measure both engine paths.
 * bench-screen.ts <HVSC> <roms> <v4-benchmark.json> <out.json> <workers> [limit]
 * Experimental profiling only, never publishes eligibility.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { ScreenWorker } from "./screen-worker.js";
import { corpusIdentity, readVerifiedSid } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import { projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
const [hvsc,romsFile,previous,out,workerArg,limitArg] = process.argv.slice(2);
if (!hvsc || !romsFile || !previous || !out || !workerArg) throw new Error("Expected HVSC, ROMs, prior benchmark, output, workers [limit]");
const workers=Number(workerArg), limit=Number(limitArg??80);
if (!Number.isSafeInteger(workers)||workers<1||!Number.isSafeInteger(limit)||limit<1) throw new Error("Invalid benchmark dimensions");
const prior=JSON.parse(readFileSync(previous,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
const corpus=await corpusIdentity(hvsc);
if (corpus!==prior.corpus)throw new Error("Prior benchmark corpus differs");
scopeLock(corpus);
const ledger=RolloutLedger.open(corpus), sample=prior.measured.slice(0,limit).map(v=>v.job);
for(const job of sample)if(!ledger.has(job))throw new Error("Benchmark input was not already counted");
const measured: {job:BenchmarkCandidate;seconds:number;engines:unknown[]}[]=[];
let next=0; const start=performance.now();
await Promise.all(Array.from({length:workers},async()=>{
  const worker = new ScreenWorker(path.resolve(romsFile),path.resolve("workspace/rom-audit-screen-sidlite/render"),path.resolve("workspace/rom-audit-screen-residfp/render"));
  try {for(let job=sample[next++];job;job=sample[next++]){
    const began=performance.now(), bytes=readVerifiedSid(job.path,job.sha256);
    const result = await worker.request({sha256:job.sha256,hex:bytes.toString("hex"),song:job.song,seconds:job.seconds,repeat:false});
    if(result.failure)throw new Error(result.failure);
    const engines = result.engines.map(r=>({engine:r.engine,states:r.states,screen:r.screen,audio:!!r.audio}));
    measured.push({job,seconds:(performance.now()-began)/1000,engines});
    writeFileSync(out,screenJson({schema:"sidflow-screen-profile-1",cpu:cpus()[0]?.model,workers,corpus,elapsed:(performance.now()-start)/1000,measured})+"\n");
    console.log(`${measured.length}/${sample.length}: ${job.path}#${job.song} ${measured.at(-1)!.seconds.toFixed(2)}s`);
  }} finally {worker.close();}
}));
console.log(`Measured ${measured.length} dual-engine jobs in ${((performance.now()-start)/1000).toFixed(2)}s. Profile only; no corpus projection from a partial stratum sample.`);
