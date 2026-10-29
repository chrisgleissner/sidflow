#!/usr/bin/env bun
/** Bounded A/B CPU work for the current exact screen versus sampled screen.
 * <benchmark.json> <roms> <sample binary> <report> <limit 1..16>
 * Full native audio is retained for unresolved sets and reference repeats.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyScreen, audioSets, audioStates } from "./screen-classifier.js";
import { sampleClockScreen } from "./sample-screen.js";
import { runNativeEngine } from "./native-lanes.js";
import { loadRoms } from "./census-worker.js";
import { isExtendedSample } from "./methodology.js";
import { readVerifiedSid } from "./inputs.js";
import { screenJson, screenSha, screenIdentity } from "./screen-identity.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [benchmark,roms,binary,report,limitArg]=process.argv.slice(2),limit=Number(limitArg);
if(!benchmark||!roms||!binary||!report||!Number.isSafeInteger(limit)||limit<1||limit>16)throw new Error("Expected benchmark, ROMs, sample binary, report, limit 1..16");
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
const jobs=prior.measured.slice(0,limit).map(r=>r.job);
if(jobs.length!==limit)throw new Error("Insufficient jobs");
scopeLock(prior.corpus,true);const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(j=>!ledger.has(j)))throw new Error("Only already counted jobs allowed");
const cold=path.resolve("workspace/rom-audit-screen-residfp/render"),sourceIdentity=screenIdentity(false),rows:unknown[]=[];
const romImages=loadRoms(roms);
const binaries={sample:path.resolve(binary),audio:cold,sidlite:path.resolve("workspace/rom-audit-screen-sidlite/render")};
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([name,file])=>[name,screenSha(readFileSync(file))]));
const experimentSourceNames=["bench-sample-pipeline.ts","sample-screen.ts","register-comparison.ts","apply-sample-clock.py","build-sample-clock.sh"];
const experimentSources=Object.fromEntries(experimentSourceNames.map(name=>[name,screenSha(readFileSync(path.join(import.meta.dir,name)))]));
const assertSourcesUnchanged=():void=>{
  if(screenIdentity(false)!==sourceIdentity)throw new Error("Renderer or screen source identity changed during pipeline experiment");
  for(const [name,file]of Object.entries(binaries))if(screenSha(readFileSync(file))!==nativeHashes[name])throw new Error(`Measured executable changed: ${name}`);
  for(const name of experimentSourceNames)if(screenSha(readFileSync(path.join(import.meta.dir,name)))!==experimentSources[name])throw new Error(`Experiment source changed during pipeline: ${name}`);
};
for(const job of jobs){
  const bytes=readVerifiedSid(job.path,job.sha256),extended=isExtendedSample(job.sha256,50);
  const cpu=(usage:NodeJS.CpuUsage)=>(usage.user+usage.system)/1000000;
  const sidStarted=process.cpuUsage();
  const sidlite=await classifyScreen("sidlite",binaries.sidlite,roms,romImages,bytes,job.song,job.seconds,extended);
  const unchangedCpuSeconds=(sidlite.cpuSeconds??0)+cpu(process.cpuUsage(sidStarted));
  if(Object.values(sidlite.states).includes("unknown"))throw new Error(`Unresolved SIDLite baseline: ${job.path}`);
  const oldStarted=process.cpuUsage();
  const baseline=await classifyScreen("residfp",cold,roms,romImages,bytes,job.song,job.seconds,extended);
  const oldCpuSeconds=unchangedCpuSeconds+(baseline.cpuSeconds??0)+cpu(process.cpuUsage(oldStarted));
  const nextStarted=process.cpuUsage();
  const next=sampleClockScreen(binary,roms,bytes,job.song,job.seconds);
  const screen={...next.screen,referenceError:next.reference.terminal.error,traceComplete:next.reference.terminal.traceComplete,referenceTraceSha256:screenSha(screenJson(next.reference.packets))};
  const newSets=audioSets(screen,extended),oldSets=audioSets(baseline.screen,extended);
  const audio=newSets.length?await runNativeEngine("residfp",bytes,job.song,job.seconds,roms,cold,extended,newSets):undefined;
  const before=baseline.states,after=audio?audioStates(screen,audio,job.seconds):{none:"compatible",full:"compatible"};
  const newCpuSeconds=unchangedCpuSeconds+next.screenCpuSeconds+(audio?.cpuSeconds??0)+cpu(process.cpuUsage(nextStarted));
  if(screenJson(before)!==screenJson(after))throw new Error(`A/B classification mismatch: ${job.path}: ${screenJson({before,after})}`);
  assertSourcesUnchanged();
  rows.push({job,extended,states:after,oldScreen:baseline.screen,newScreen:next.screen,oldSets,newSets,oldCpuSeconds,newCpuSeconds,unchangedCpuSeconds});
  writeFileSync(report,screenJson({schema:"sidflow-sample-pipeline-ab-1",sourceIdentity,experimentSources,benchmarkSha256:screenSha(readFileSync(benchmark)),nativeHashes,rows})+"\n");
  console.log(`${rows.length}/${limit}: exact states matched; CPU ${oldCpuSeconds.toFixed(3)} -> ${newCpuSeconds.toFixed(3)}s`);
}

assertSourcesUnchanged();
