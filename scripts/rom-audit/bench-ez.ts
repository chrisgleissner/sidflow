#!/usr/bin/env bun
/** Native upstream EZ versus pinned native reSIDfp, research only.
 * <benchmark.json> <roms> <ez binary> <report.json> <limit 1..16>
 * All masks execute full horizons. No classification is published.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NativeLane } from "./native-lanes.js";
import { ListenerComparator } from "./listener.js";
import { screenSha, screenJson, screenIdentity } from "./screen-identity.js";
import { readVerifiedSid } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [benchmark,roms,ez,report,limitArg] = process.argv.slice(2), limit=Number(limitArg);
if(!benchmark||!roms||!ez||!report||!Number.isSafeInteger(limit)||limit<1||limit>16)throw new Error("Expected benchmark, ROMs, EZ binary, report, limit 1..16");
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
const jobs=prior.measured.slice(0,limit).map(r=>r.job);
if(jobs.length!==limit||jobs.some(j=>j.seconds>300))throw new Error("Probe requires enough jobs, at most 300s per horizon");
scopeLock(prior.corpus);
const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(j=>!ledger.has(j)))throw new Error("Only already counted jobs may be probed");
const binary=path.resolve("workspace/rom-audit-screen-residfp/render"),temp=mkdtempSync(path.join(tmpdir(),"sidflow-ez-"));
const rows:unknown[]=[];
const compare=(a:Int16Array,b:Int16Array)=>{
  const listener=new ListenerComparator();listener.forceAudio();
  listener.append(0,a,new Float64Array());listener.append(1,b,new Float64Array());listener.compare();return listener.finish();
};
try {
  for(const job of jobs){
    const bytes=readVerifiedSid(job.path,job.sha256),sid=path.join(temp,"input.sid"),pcmFile=path.join(temp,"output.pcm");writeFileSync(sid,bytes);
    const lanes=new Map<string,Int16Array>(), measurements:unknown[]=[];
    for(const mask of [7,0,3,7]) for(const backend of ["residfp","ez"] as const){
      const started=performance.now();
      try {
        let pcm:Int16Array,cpuSeconds:number;
        let ezTiming:{loadCpuSeconds:number;renderCpuSeconds:number}|undefined;
        if(backend==="residfp"){
          const lane=NativeLane.open(binary,roms,bytes,job.song,job.seconds,mask),wanted=Math.round(job.seconds*48000)*2;
          pcm=new Int16Array(wanted);
          try {
            while(lane.samples<wanted){
              const chunk=await lane.pull();
              if(!chunk)throw new Error(`Native output stopped: ${lane.message}`);
              const take=Math.min(chunk.pcm.length,wanted-lane.samples);pcm.set(chunk.pcm.subarray(0,take),lane.samples);lane.absorb(chunk,take);
            }
            if(await lane.pull())throw new Error("Extra native samples");
            cpuSeconds=lane.cpuSeconds;
          } finally {lane.close();}
        }else{
          const run=spawnSync(ez,[sid,String(job.song),String(job.seconds),roms,String(mask),pcmFile],{encoding:"utf8",timeout:120000,maxBuffer:1048576});
          if(run.status!==0)throw new Error(`EZ failed (${run.status}): ${run.error?.message??run.stderr}`);
          const result=JSON.parse(run.stdout) as {frames:number;loadCpuSeconds:number;renderCpuSeconds:number};
          const raw=Uint8Array.from(readFileSync(pcmFile));pcm=new Int16Array(raw.buffer);
          if(result.frames!==Math.round(job.seconds*48000)||pcm.length!==result.frames*2)throw new Error("Truncated EZ PCM");
          ezTiming=result;
          cpuSeconds=result.loadCpuSeconds+result.renderCpuSeconds;
        }
        const key=`${backend}-${mask}`,sha256=screenSha(new Uint8Array(pcm.buffer));
        if(lanes.has(key)&&screenSha(new Uint8Array(lanes.get(key)!.buffer))!==sha256)throw new Error("Reference PCM did not repeat exactly");
        lanes.set(key,pcm);
        measurements.push({backend,mask,wallSeconds:(performance.now()-started)/1000,cpuSeconds,sha256,...(ezTiming?{ezTiming}:{})});
      } catch(error){console.error(`${job.path} ${backend} mask ${mask}`,error);measurements.push({backend,mask,error:String(error)});}
    }
    const comparisons:unknown[]=[];
    for(const backend of ["residfp","ez"])for(const mask of [0,3]){
      const reference=lanes.get(`${backend}-7`),variant=lanes.get(`${backend}-${mask}`);
      if(reference&&variant)comparisons.push({backend,mask,evidence:compare(reference,variant)});
    }
    rows.push({job,measurements,comparisons});
    writeFileSync(report,screenJson({schema:"sidflow-ez-research-1",sourceIdentity:screenIdentity(),benchmarkSha256:screenSha(readFileSync(benchmark)),nativeHashes:{residfp:screenSha(readFileSync(binary)),ez:screenSha(readFileSync(ez))},rows})+"\n");
    console.log(`${rows.length}/${limit} measured; experimental results only`);
  }
} finally {rmSync(temp,{recursive:true,force:true});}
