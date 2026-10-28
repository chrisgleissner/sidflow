#!/usr/bin/env bun
/** Resumable, source-bound dual-engine census. No full run is started by tests.
 * screen-census.ts bench|full <HVSC> <roms> <output> <workers> [maxHours]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, truncateSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { cpus } from "node:os";
import { screenInventory } from "./screen-inventory.js";
import { orderScreenJobs, type ScreenCost } from "./screen-scheduling.js";
import { ScreenWorker } from "./screen-worker.js";
import { screenJson, screenIdentity, screenQualificationIdentity, screenSha, SCREEN_METHODOLOGY, screenEngineIdentity } from "./screen-identity.js";
import { publishScreen, resolvedScreenRow, type ScreenRow } from "./screen-publication.js";
import { benchmarkSample, projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
import { readVerifiedSid } from "./inputs.js";
import { RolloutLedger, ceilings, ProcessLock } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import { validateRecord, CENSUS_SCHEMA, assessMask, observationHorizon, isExtendedSample } from "./methodology.js";
import { engineHashes } from "./wasm-lanes.js";
import {audioSets,audioStates}from"./screen-classifier.js";
const [mode,hvsc,roms,directory,workerArg,maxArg]=process.argv.slice(2);
if(!["bench","full"].includes(mode??"")||!hvsc||!roms||!directory||!workerArg)throw new Error("Expected bench|full HVSC roms output workers [maxHours]");
const workers=Number(workerArg),maxHours=Number(maxArg??15);
const benchmarkJobs=Number(process.env.ROM_AUDIT_BENCHMARK_JOBS??320);
if(!Number.isSafeInteger(benchmarkJobs)||benchmarkJobs<80||benchmarkJobs>512)throw new Error("ROM_AUDIT_BENCHMARK_JOBS must be an integer from 80 to 512");
const maxJobs=process.env.ROM_AUDIT_MAX_JOBS===undefined?undefined:Number(process.env.ROM_AUDIT_MAX_JOBS);
if(maxJobs!==undefined&&(!Number.isSafeInteger(maxJobs)||maxJobs<1))throw new Error("ROM_AUDIT_MAX_JOBS must be a positive integer");
if(!Number.isSafeInteger(workers)||workers<1||!Number.isFinite(maxHours)||maxHours<=0||maxHours>16)throw new Error("Invalid workers/budget (maximum 16h)");
const identity=screenIdentity(), binaries={sidlite:path.resolve("workspace/rom-audit-screen-sidlite/render"),residfp:path.resolve("workspace/rom-audit-screen-residfp/render")};
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([e,f])=>[e,screenSha(readFileSync(f))]));
const inventory=await screenInventory(hvsc);
await mkdir(directory,{recursive:true});
const lock=new ProcessLock(path.join(directory,"run.lock"),"dual census");lock.acquire();scopeLock(inventory.corpus);
const ledger=RolloutLedger.open(inventory.corpus);ledger.importHistory(path.resolve(hvsc),inventory.corpus);
const plan={schema:"sidflow-dual-rom-plan-1",methodology:SCREEN_METHODOLOGY,sourceIdentity:identity,corpus:inventory.corpus,documents:inventory.documents,nativeHashes,engines:{sidlite:{...engineHashes("sidlite"),engineId:screenEngineIdentity("sidlite")},residfp:{...engineHashes("residfp"),engineId:screenEngineIdentity("residfp")}}};
const planFile=path.join(directory,"plan.json");
if(existsSync(planFile)){
  const existingText=readFileSync(planFile,"utf8");
  if(existingText!==screenJson(plan)+"\n"){
    let existing:Partial<typeof plan>={};
    try{existing=JSON.parse(existingText) as Partial<typeof plan>;}catch(error){console.error("Could not parse existing census plan; preserving it.",error);}
    const differences:string[]=[];
    if(existing.sourceIdentity!==plan.sourceIdentity)differences.push("classifier source identity");
    if(existing.corpus!==plan.corpus)differences.push("HVSC corpus");
    if(screenJson(existing.documents??{})!==screenJson(plan.documents))differences.push("HVSC documents");
    if(screenJson(existing.nativeHashes??{})!==screenJson(plan.nativeHashes))differences.push("native renderer binaries");
    if(screenJson(existing.engines??{})!==screenJson(plan.engines))differences.push("engine identities");
    throw new Error(`Existing census plan does not match current ${differences.length?differences.join(", "):"plan"}; its checkpoint was preserved. Choose a new ROM_AUDIT_OUT (current: ${directory}) to start a census for these sources.`);
  }
}
writeFileSync(planFile,screenJson(plan)+"\n");
const jobsByKey=new Map(inventory.jobs.map(j=>[`${j.sha256}#${j.song}`,j]));
const rows=new Map<string,ScreenRow>(), checkpoint=path.join(directory,"census.jsonl");
function validate(row:ScreenRow):void{
  const job=jobsByKey.get(`${row.sha256}#${row.song}`);
  if(!job||row.seconds!==job.seconds||!Number.isFinite(row.workerSeconds)||row.workerSeconds<=0||!row.result||!Array.isArray(row.result.engines))throw new Error("Invalid census row identity");
  if(row.result.failure){if(row.result.engines.length||typeof row.result.failure!=="string")throw new Error("Invalid failure evidence");return;}
  if(row.result.engines.length!==2)throw new Error("Missing engine result");
  row.result.engines.forEach((r,i)=>{
    if(r.engine!==(["sidlite","residfp"] as const)[i])throw new Error("Engine order mismatch");
    if(r.screen&&(typeof r.screen.none!=="boolean"||typeof r.screen.full!=="boolean"||typeof r.screen.referenceError!=="string"||typeof r.screen.traceComplete!=="boolean"||! /^[a-f0-9]{64}$/.test(r.screen.referenceTraceSha256)||
      ((r.screen.none||r.screen.full)&&(r.screen.referenceError!==""||r.screen.traceComplete!==true))))throw new Error("Invalid screen evidence");
    if(r.audio){
      if(r.audioBackend!=="native")throw new Error("Unbound audio backend");
      if(r.audio.extended!==isExtendedSample(row.sha256,50))throw new Error("Reference repeat sampling mismatch");
      validateRecord({schema:CENSUS_SCHEMA,sha256:row.sha256,song:row.song,seconds:row.seconds,sampleRate:48000,runs:[r.audio]},[r.engine],audioSets(r.screen,r.audio.extended));
      const expected=audioStates(r.screen,r.audio,row.seconds);
      for(const set of ["none","full"]as const)if(r.states[set]!==expected[set])throw new Error("Audio state differs from evidence");
    }else if(isExtendedSample(row.sha256,50)||!r.screen?.none||!r.screen.full||r.screen.referenceError||!r.screen.traceComplete||! /^[a-f0-9]{64}$/.test(r.screen.referenceTraceSha256)||r.states.none!=="compatible"||r.states.full!=="compatible")throw new Error("Invalid screening grant");
  });
}
if(existsSync(checkpoint)){
  const bytes=readFileSync(checkpoint),end=bytes.length&&bytes.at(-1)!==10?bytes.lastIndexOf(10)+1:bytes.length;
  if(end<bytes.length){writeFileSync(`${checkpoint}.interrupted-${screenSha(bytes.subarray(end)).slice(0,16)}`,bytes.subarray(end));truncateSync(checkpoint,end);}
  for(const line of bytes.subarray(0,end).toString().split("\n").filter(Boolean)){
    const envelope=JSON.parse(line) as {row:ScreenRow;sha256:string};
    if(screenSha(screenJson(envelope.row))!==envelope.sha256)throw new Error("Checkpoint checksum mismatch");validate(envelope.row);
    const key=`${envelope.row.sha256}#${envelope.row.song}`;
    if(resolvedScreenRow(rows.get(key)))throw new Error("Duplicate successful census result");rows.set(key,envelope.row);
  }
}
const sample=benchmarkSample(inventory.jobs,benchmarkJobs), selected=mode==="bench"?sample:inventory.jobs;
let schedulingCosts: ScreenCost[] = [];
let publicationEvidence:{qualification:string;benchmark:string}|undefined;
if(mode==="full"){
  const evidence="workspace/rom-audit-screen-qualification";
  const qualification=JSON.parse(readFileSync(path.join(evidence,"certificate.json"),"utf8")) as {sourceIdentity:string;measurementIdentity:string;passed:boolean;nativeHashes:Record<string,string>;logs:Record<string,string>;fullRuns:{pass:number;fail:number;skip:number}[]};
  if(qualification.measurementIdentity!==identity||qualification.sourceIdentity!==screenQualificationIdentity()||!qualification.passed||qualification.fullRuns.length!==3||qualification.fullRuns.some(r=>!r.pass||r.fail||r.skip)||
    Object.entries(nativeHashes).some(([e,sha])=>qualification.nativeHashes?.[e]!==sha)||
    ["build.log","typecheck.log","parity.log","transport.log","full-1.log","full-2.log","full-3.log"].some(name=>screenSha(readFileSync(path.join(evidence,name)))!==qualification.logs?.[name]))throw new Error("Missing source-bound three-suite qualification");
  const benchmark=JSON.parse(readFileSync(path.join(directory,"benchmark.json"),"utf8")) as {sourceIdentity:string;cpu:string;workers:number;budgetHours:number;sampleSize:number;passed:boolean;measured:ScreenCost[];benchmarkFailures:number};
  if(benchmark.sourceIdentity!==identity||benchmark.cpu!==cpus()[0]?.model||benchmark.workers!==workers||benchmark.sampleSize!==benchmarkJobs||
    (maxJobs===undefined&&(!benchmark.passed||benchmark.budgetHours>maxHours))||
    (maxJobs!==undefined&&(benchmark.measured.length!==benchmark.sampleSize||benchmark.benchmarkFailures!==0)))throw new Error("Missing matching target-machine budget benchmark; bounded checkpoints require a complete zero-failure sample, and full censuses also require the budget projection to pass");
  schedulingCosts=benchmark.measured;
  publicationEvidence={qualification:readFileSync(path.join(evidence,"certificate.json"),"utf8"),benchmark:readFileSync(path.join(directory,"benchmark.json"),"utf8")};
}
const pending=mode==="bench"?selected:selected.filter(j=>!resolvedScreenRow(rows.get(`${j.sha256}#${j.song}`)));
const bounded=mode==="full"&&maxJobs!==undefined?pending.slice(0,maxJobs):pending;
const todo=orderScreenJobs(bounded,schedulingCosts);
if(mode==="full"&&maxJobs!==undefined)console.log(`Bounded census: processing at most ${todo.length} pending subtunes; rerun without ROM_AUDIT_MAX_JOBS to continue the full inventory.`);
const reservations=todo.map(j=>({sha256:j.sha256,song:j.song,path:path.relative(hvsc,j.path)}));
if(!ledger.reserve(reservations,`dual-${mode}`,mode==="bench"?ceilings(61157,87868):undefined))throw new Error("Benchmark would exceed pilot ceiling");
let next=0,completed=0,benchmarkFailures=0;const start=performance.now(),measured:{job:BenchmarkCandidate;seconds:number;cpuSeconds:number}[]=[], active=new Set<ScreenWorker>();
const fd=openSync(checkpoint,"a"),deadline=Date.now()+maxHours*3600000;
let interrupted=false;
const stop=():void=>{interrupted=true;for(const worker of active)worker.close();};
process.once("SIGINT",stop);process.once("SIGTERM",stop);
const deadlineTimer=setTimeout(stop,maxHours*3600000);
try{
  await Promise.all(Array.from({length:workers},async()=>{
    let worker:ScreenWorker|undefined,used=0;
    try{for(let job=todo[next++];job&&!interrupted&&Date.now()<deadline;job=todo[next++]){
      if(!worker||used>=20){if(worker){active.delete(worker);worker.close();}worker=new ScreenWorker(path.resolve(roms),binaries.sidlite,binaries.residfp);active.add(worker);used=0;}
      const began=performance.now();let result:ScreenRow["result"];
      try{const bytes=readVerifiedSid(job.path,job.sha256);result=await worker.request({sha256:job.sha256,song:job.song,seconds:job.seconds,hex:bytes.toString("hex"),repeat:isExtendedSample(job.sha256,50)});used++;}
      catch(error){console.error("Dual census job failed",error);result={engines:[],failure:error instanceof Error?error.message:String(error)};active.delete(worker);worker.close();worker=undefined;}
      const row:ScreenRow={sha256:job.sha256,song:job.song,seconds:job.seconds,result,workerSeconds:(performance.now()-began)/1000};validate(row);
      if(result.failure||result.engines.some(e=>e.states.none==="unknown"||e.states.full==="unknown"))benchmarkFailures++;
      measured.push({job,seconds:row.workerSeconds,cpuSeconds:result.cpuSeconds??0});
      const key=`${job.sha256}#${job.song}`,previous=rows.get(key);
      if(!resolvedScreenRow(previous)){appendFileSync(fd,screenJson({row,sha256:screenSha(screenJson(row))})+"\n");fsyncSync(fd);rows.set(key,row);}
      completed++;if(completed%10===0||completed===todo.length)console.log(`${mode}: ${completed}/${todo.length}; ${rows.size}/87868 checkpointed; ${((performance.now()-start)/1000).toFixed(1)}s elapsed`);
    }}finally{if(worker){active.delete(worker);worker.close();}}
  }));
}finally{clearTimeout(deadlineTimer);closeSync(fd);for(const worker of active)worker.close();}
if(screenIdentity()!==identity||Object.entries(binaries).some(([e,f])=>screenSha(readFileSync(f))!==nativeHashes[e]))throw new Error("Sources/binaries changed during measurement");
if(mode==="bench"){
  const projection=projectCensus(inventory.jobs,measured,workers,1.25),bad=measured.length!==benchmarkJobs||benchmarkFailures!==0;
  const coreProjection=measured.every(m=>m.cpuSeconds>0)?projectCensus(inventory.jobs,measured.map(m=>({job:m.job,seconds:m.cpuSeconds})),1,1.25):undefined;
  const elapsedSeconds=(performance.now()-start)/1000,totalCpuSeconds=measured.reduce((n,m)=>n+m.cpuSeconds,0);
  const effectiveCpuCores=totalCpuSeconds/elapsedSeconds;
  // Native audio uses several child processes per job. Weighting contended job
  // wall times by population would charge the deliberately oversampled BASIC/
  // multi-SID neighbours to ordinary jobs again. Model actual process CPU work,
  // divided by the aggregate capacity delivered during this complete sample.
  // Capacity includes startup, scheduling and checkpoint waits in elapsed time.
  const projectedHours=coreProjection&&effectiveCpuCores>0?coreProjection.projectedHours/effectiveCpuCores:projection.projectedHours;
  const budgetHours=projectedHours*1.25;
  const report={schema:"sidflow-dual-rom-benchmark-1",sourceIdentity:identity,sampleSize:benchmarkJobs,cpu:cpus()[0]?.model,workers,corpus:inventory.corpus,elapsedSeconds,totalCpuSeconds,effectiveCpuCores,cpuCoreHours:coreProjection?.projectedHours??null,benchmarkFailures,
    ...projection,wallWeightedHours:projection.projectedHours,projectedHours,budgetHours,projectionMethod:"population-weighted process CPU / measured aggregate CPU capacity",passed:!bad&&!!coreProjection&&budgetHours<=maxHours,measured};
  writeFileSync(path.join(directory,"benchmark.json"),screenJson(report)+"\n");
  console.log(`Dual-engine census projection on THIS CPU: ${projectedHours.toFixed(2)}h; ${budgetHours.toFixed(2)}h with 25% margin; budget ${maxHours}h. CPU work ${coreProjection?.projectedHours.toFixed(2)??"unavailable"} core-hours; measured capacity ${effectiveCpuCores.toFixed(2)} cores.`);
  if(!report.passed)process.exitCode=3;
}
const publication=await publishScreen(path.join(directory,"published"),inventory.tunes,rows,plan,publicationEvidence);
console.log(`Publication: complete=${publication.complete}, measured=${rows.size}, pending=${publication.pendingSubtunes}, failed=${publication.failedSubtunes}, unknown=${publication.unknownSubtunes}`);
if(mode==="full"&&!publication.complete&&maxJobs===undefined)process.exitCode=4;
lock.release();
