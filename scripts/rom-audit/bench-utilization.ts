#!/usr/bin/env bun
/** Bounded sustained native classifier profiling, never publishes eligibility.
 * <benchmark.json> <roms> <output.json> <workers 1..32> <unique 1..32> <repeats 1..8>
 * Reuses only ledger-counted jobs; records 250ms host utilization and frequency.
 */
import { cpus } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { orderScreenJobs } from "./screen-scheduling.js";
import { ScreenWorker } from "./screen-worker.js";
import { readVerifiedSid } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import { screenSha, screenJson, screenIdentity } from "./screen-identity.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [benchmark,roms,output,workerArg,uniqueArg,repeatArg,order="fifo"] = process.argv.slice(2);
const workers=Number(workerArg), unique=Number(uniqueArg), repeats=Number(repeatArg);
if (!benchmark || !roms || !output || !Number.isSafeInteger(workers) || workers<1 || workers>32 || !Number.isSafeInteger(unique) || unique<1 || unique>32 || !Number.isSafeInteger(repeats) || repeats<1 || repeats>8 || !["fifo","cost"].includes(order)) throw new Error("Expected benchmark, ROMs, output, workers 1..32, unique 1..32, repeats 1..8");
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate;cpuSeconds:number}[]};
const jobs=prior.measured.slice(0,unique).map(row=>row.job);
if(jobs.length!==unique)throw new Error("Insufficient jobs");
scopeLock(prior.corpus);
const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(job=>!ledger.has(job)))throw new Error("Only already counted jobs may be profiled");
const bytes=jobs.map(job=>readVerifiedSid(job.path,job.sha256));
const queue=Array.from({length:repeats},()=>jobs.map((job,index)=>({job,index}))).flat();
if(order === "cost")queue.splice(0,queue.length,...orderScreenJobs(queue.map(e=>e.job),prior.measured).map(job=>({job,index:jobs.indexOf(job)})));
const binaries={sidlite:path.resolve("workspace/rom-audit-screen-sidlite/render"),residfp:path.resolve("workspace/rom-audit-screen-residfp/render")};
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([e,f])=>[e,screenSha(readFileSync(f))]));
const sourceIdentity=screenIdentity(), evidence=new Map<number,string>();
const samples: {seconds:number;busy:number[];mhz:number[];activeJobs:number;completed:number}[]=[];
const rows: {index:number;wallSeconds:number;cpuSeconds:number;sha256:string}[]=[];
let last=cpus(), next=0, activeJobs=0;
const start=performance.now();
const sample=()=>{
  const current=cpus();
  const busy=current.map((cpu,i)=>{
    const prev=last[i]!.times;
    const total=Object.values(cpu.times).reduce((a,b)=>a+b,0)-Object.values(prev).reduce((a,b)=>a+b,0);
    return total>0?1-(cpu.times.idle-prev.idle)/total:0;
  });
  samples.push({seconds:(performance.now()-start)/1000,busy,mhz:current.map(c=>c.speed),activeJobs,completed:rows.length});last=current;
};
const pool=new Set<ScreenWorker>();
const timer=setInterval(sample,250);
const watchdog=setTimeout(()=>{console.error("Profiling exceeded ten-minute bound");for(const worker of pool)worker.close();},600000);
try {
  await Promise.all(Array.from({length:workers},async()=>{
    const worker=new ScreenWorker(path.resolve(roms),binaries.sidlite,binaries.residfp);pool.add(worker);
    try {
      for(let entry=queue[next++];entry;entry=queue[next++]){
        const began=performance.now();activeJobs++;
        const result=await worker.request({sha256:entry.job.sha256,hex:bytes[entry.index]!.toString("hex"),song:entry.job.song,seconds:entry.job.seconds,repeat:false});
        activeJobs--;
        if(result.failure)throw new Error(result.failure);
        // Cost is nondeterministic; every other returned measurement must repeat.
        const sha256=screenSha(JSON.stringify(result,(key,value)=>key==="cpuSeconds"?undefined:value));
        if(evidence.has(entry.index)&&evidence.get(entry.index)!==sha256)throw new Error(`Classification changed under load for job ${entry.index}`);
        evidence.set(entry.index,sha256);
        rows.push({index:entry.index,wallSeconds:(performance.now()-began)/1000,cpuSeconds:result.cpuSeconds??0,sha256});
      }
    } finally {worker.close();pool.delete(worker);}
  }));
} finally {clearInterval(timer);clearTimeout(watchdog);for(const worker of pool)worker.close();sample();}
const elapsedSeconds=(performance.now()-start)/1000;
writeFileSync(output,screenJson({schema:"sidflow-native-utilization-1",cpu:cpus()[0]?.model,sourceIdentity,nativeHashes,benchmarkSha256:screenSha(readFileSync(benchmark)),workers,unique,repeats,order,elapsedSeconds,processCpuSeconds:rows.reduce((n,row)=>n+row.cpuSeconds,0),jobs,rows,samples})+"\n");
console.log(`${rows.length} full-horizon dual-engine comparisons in ${elapsedSeconds.toFixed(3)}s; all repeated evidence matched`);
