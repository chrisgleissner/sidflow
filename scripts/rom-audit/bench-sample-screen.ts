#!/usr/bin/env bun
/** Sample-aligned register screen versus actual native audio decisions.
 * <benchmark.json> <roms> <sample-clock binary> <report> <limit 1..16>
 * Experimental reSIDfp only; no eligibility publication or corpus expansion.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sampleClockScreen } from "./sample-screen.js";
import { runNativeEngine } from "./native-lanes.js";
import { readVerifiedSid } from "./inputs.js";
import { screenJson, screenSha, screenIdentity } from "./screen-identity.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [benchmark,roms,binary,report,limitArg]=process.argv.slice(2),limit=Number(limitArg);
if(!benchmark||!roms||!binary||!report||!Number.isSafeInteger(limit)||limit<1||limit>16)throw new Error("Expected benchmark, ROMs, binary, report, limit 1..16");
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
const jobs=prior.measured.slice(0,limit).map(r=>r.job);
if(jobs.length!==limit)throw new Error("Insufficient jobs");
scopeLock(prior.corpus,true);const ledger=RolloutLedger.open(prior.corpus);
if(jobs.some(j=>!ledger.has(j)))throw new Error("Only already counted jobs allowed");
const sourceIdentity=screenIdentity(false),benchmarkSha256=screenSha(readFileSync(benchmark));
const experimentSources=Object.fromEntries(["apply-sample-clock.py","build-sample-clock.sh","bench-sample-screen.ts","register-comparison.ts","sample-screen.ts"].map(name=>[name,screenSha(readFileSync(new URL(name,import.meta.url)))]));

const binaries={sampleClock:path.resolve(binary),audio:path.resolve("workspace/rom-audit-screen-residfp/render")};
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([name,file])=>[name,screenSha(readFileSync(file))]));
const unchanged=():void=>{
  if(screenIdentity(false)!==sourceIdentity)throw new Error("Source changed during grant validation");
  for(const [name,file]of Object.entries(binaries))if(screenSha(readFileSync(file))!==nativeHashes[name])throw new Error(`Measured executable changed: ${name}`);
  for(const [name,hash]of Object.entries(experimentSources))if(screenSha(readFileSync(new URL(name,import.meta.url)))!==hash)throw new Error(`Grant predicate changed: ${name}`);
};
const observation=(lane:ReturnType<typeof sampleClockScreen>["reference"])=>({error:lane.terminal.error,traceComplete:lane.terminal.traceComplete,chargenReads:lane.terminal.chargenReads,frames:lane.packets.reduce((n,p)=>n+p.sampleClockFrames,0)});
const rows:unknown[]=[];
for(const job of jobs){
  const bytes=readVerifiedSid(job.path,job.sha256);bytes.writeUInt16BE(job.song,0x10);
  const {screen,screenCpuSeconds,reference,none,full}=sampleClockScreen(binary,roms,bytes,job.song,job.seconds);
  const audio=await runNativeEngine("residfp",bytes,job.song,job.seconds,roms,path.resolve("workspace/rom-audit-screen-residfp/render"),false,["none","full"]);
  if(audio.reference.outcome!=="clean"&&(screen.none||screen.full))throw new Error("A failed reference must not grant compatibility");
  for(const set of ["none","full"] as const){
    const measured=audio.lanes.find(l=>l.set===set);
    if(screen[set]&&(measured?.outcome!=="equivalent"||(!(set==="full"&&reference.terminal.chargenReads===0)&&measured.listener?.method!=="register-equivalent")))throw new Error(`Unsound register grant: ${job.path} ${set}`);
  }
  unchanged();
  rows.push({job,screen,observations:{reference:observation(reference),none:observation(none),full:observation(full)},screenCpuSeconds,audioCpuSeconds:audio.cpuSeconds,audioReferenceOutcome:audio.reference.outcome,audioReferenceSamples:audio.reference.samples,audioReferenceRepeat:audio.reference.repeat,audioReferencePcmSha256:audio.reference.pcmSha256,audioReferenceTraceSha256:audio.reference.traceSha256,audio:audio.lanes.map(l=>({set:l.set,outcome:l.outcome,method:l.listener?.method,samples:l.samples,pcmSha256:l.pcmSha256,traceSha256:l.traceSha256})),referenceError:reference.terminal.error,noneError:none.terminal.error,referenceEvidenceSha256:screenSha(screenJson(reference.packets))});
  writeFileSync(report,screenJson({schema:"sidflow-sample-screen-experiment-1",sourceIdentity,benchmarkSha256,experimentSources,nativeHashes,rows})+"\n");
  console.log(`${rows.length}/${limit}: sample screen ${screen.none}/${screen.full}, native audio verified`);
}

unchanged();
