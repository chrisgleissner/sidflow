#!/usr/bin/env bun
/** Bounded A/B CPU work for the current exact screen versus sampled screen.
 * <benchmark.json> <roms> <sample binary> <report> <limit 1..16>
 * Full native audio is retained for unresolved sets and reference repeats.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adaptiveScreens } from "./adaptive-screen.js";
import { screenLane, screenEquivalent } from "./digital-screen.js";
import { sampleClockScreen } from "./sample-screen.js";
import { runNativeEngine } from "./native-lanes.js";
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
scopeLock(prior.corpus);const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(j=>!ledger.has(j)))throw new Error("Only already counted jobs allowed");
const cold=path.resolve("workspace/rom-audit-screen-residfp/render"),sourceIdentity=screenIdentity(),rows:unknown[]=[];
const experimentSourceNames=["bench-sample-pipeline.ts","sample-screen.ts","register-comparison.ts","apply-sample-clock.py","build-sample-clock.sh"];
const experimentSources=Object.fromEntries(experimentSourceNames.map(name=>[name,screenSha(readFileSync(path.join(import.meta.dir,name)))]));
const assertSourcesUnchanged=():void=>{
  if(screenIdentity()!==sourceIdentity)throw new Error("Renderer or screen source identity changed during pipeline experiment");
  for(const name of experimentSourceNames)if(screenSha(readFileSync(path.join(import.meta.dir,name)))!==experimentSources[name])throw new Error(`Experiment source changed during pipeline: ${name}`);
};
for(const job of jobs){
  const bytes=readVerifiedSid(job.path,job.sha256),extended=isExtendedSample(job.sha256,50);
  const legacy=await adaptiveScreens((mask,mode)=>screenLane(cold,roms,bytes,job.song,job.seconds,mask,mode==="bus",mode==="warmup"),false);
  const ref=legacy.filter(a=>a.mask===7).at(-1)!.result;
  const variant=(mask:number)=>legacy.filter(a=>a.mask===mask).at(-1)?.result;
  const exact=(mask:number)=>{const v=variant(mask);return !ref.error&&ref.traceComplete&&!!v&&!v.error&&v.traceComplete&&v.writes.length===ref.writes.length&&ref.writes.every((value,i)=>value===v.writes[i]);};
  // Conservatively use audio for exact dense streams too. This benchmark's
  // baseline is the corrected exact-write screen, never the old tolerant one.
  const old={none:exact(0)&&screenEquivalent(ref,variant(0)!),full:!ref.error&&ref.traceComplete&&(ref.chargenReads===0||exact(3)&&screenEquivalent(ref,variant(3)!))};
  const next=sampleClockScreen(binary,roms,bytes,job.song,job.seconds);
  const sets=(proof:typeof old)=>(["none","full"] as const).filter(set=>extended||!proof[set]);
  const oldSets=sets(old),newSets=sets(next.screen);
  const oldAudio=oldSets.length?await runNativeEngine("residfp",bytes,job.song,job.seconds,roms,cold,extended,oldSets):undefined;
  const newAudio=newSets.length?(screenJson(newSets)===screenJson(oldSets)?oldAudio:await runNativeEngine("residfp",bytes,job.song,job.seconds,roms,cold,extended,newSets)):undefined;
  const states=(proof:typeof old,audio:typeof oldAudio)=>{
    const validReference=!audio||(audio.reference.outcome==="clean"&&audio.reference.samples===Math.round(job.seconds*48000)*2&&audio.reference.repeat===(extended?"identical":"not-run"));
    return Object.fromEntries((["none","full"] as const).map(set=>{
    if(audio&&!validReference)return [set,"unknown"];
    const lane=audio?.lanes.find(l=>l.set===set);
    return [set,lane?(audio!.reference.outcome!=="clean"?"unknown":lane.outcome==="equivalent"?"compatible":lane.outcome==="audible-difference"||lane.outcome==="stopped"?"incompatible":"unknown"):proof[set]?"compatible":"unknown"];
  }));};
  const before=states(old,oldAudio),after=states(next.screen,newAudio);
  if(screenJson(before)!==screenJson(after))throw new Error(`A/B classification mismatch: ${job.path}: ${screenJson({before,after})}`);
  const oldCpuSeconds=legacy.reduce((n,a)=>n+(a.result.cpuSeconds??0),0)+(oldAudio?.cpuSeconds??0),newCpuSeconds=next.screenCpuSeconds+(newAudio?.cpuSeconds??0);
  assertSourcesUnchanged();
  rows.push({job,extended,states:after,oldScreen:old,newScreen:next.screen,oldSets,newSets,oldCpuSeconds,newCpuSeconds});
  writeFileSync(report,screenJson({schema:"sidflow-sample-pipeline-ab-1",sourceIdentity,experimentSources,benchmarkSha256:screenSha(readFileSync(benchmark)),nativeHashes:{sample:screenSha(readFileSync(binary)),audio:screenSha(readFileSync(cold))},rows})+"\n");
  console.log(`${rows.length}/${limit}: exact states matched; CPU ${oldCpuSeconds.toFixed(3)} -> ${newCpuSeconds.toFixed(3)}s`);
}
