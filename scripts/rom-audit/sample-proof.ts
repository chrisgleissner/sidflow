/** Validate actual retained decisions and bind every evidence byte to the proof.
 * Controller/adapter changes are separately source-qualified after this gate.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { screenIdentity, screenJson, screenSha } from "./screen-identity.js";
import { benchmarkSample, projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
export interface SampleProofBinaries { sample:string; audio:string; sidlite:string }
interface Observation { error:string; traceComplete:boolean; frames:number; chargenReads:number }
interface GrantRow {
  job:BenchmarkCandidate; screen:{none:boolean;full:boolean}; observations:{reference:Observation;none:Observation;full:Observation};
  audioReferenceOutcome:string; audioReferenceSamples:number; audioReferenceRepeat:string; audioReferencePcmSha256:string; audioReferenceTraceSha256:string;
  audio:{set:string;outcome:string;method:string;samples:number;pcmSha256:string;traceSha256:string}[];
}
const hash=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
export function verifySampleProof(directory:string,jobs:BenchmarkCandidate[],expectedBinaries?:SampleProofBinaries):string {
  const files:Record<string,string>={},bytes=new Map<string,Buffer>();
  const read=(name:string):Buffer=>{
    let data=bytes.get(name);
    if(!data){data=readFileSync(path.join(directory,name));bytes.set(name,data);files[name]=screenSha(data);}
    return data;
  };
  const report=JSON.parse(read("report.json").toString()) as {schema:string;passed:boolean;compared:number;unknown:number;errors:unknown[];changed:boolean;grantsChecked:number;binaryHash:string;nativeHashes:SampleProofBinaries;oldProjection:{projectedHours:number};newProjection:{projectedHours:number}};
  if(report.schema!=="sidflow-sample-screen-qualification-1"||report.passed!==true||report.compared!==320||report.unknown!==0||!Array.isArray(report.errors)||report.errors.length||report.changed!==false||
    !Number.isFinite(report.newProjection?.projectedHours)||!Number.isFinite(report.oldProjection?.projectedHours)||
    !(report.newProjection.projectedHours>0&&report.newProjection.projectedHours<report.oldProjection.projectedHours))throw new Error("Sample-clock proof is incomplete, mismatching or has no representative CPU benefit");
  const binaries=expectedBinaries??{
    sample:screenSha(readFileSync("workspace/rom-audit-sample-clock/native/render")),
    audio:screenSha(readFileSync("workspace/rom-audit-screen-residfp/render")),
    sidlite:screenSha(readFileSync("workspace/rom-audit-screen-sidlite/render")),
  };
  if(report.binaryHash!==binaries.sample||screenJson(report.nativeHashes)!==screenJson(binaries))throw new Error("Sample-clock proof binary mismatch");
  const baseline=screenIdentity(false),expected=new Map(benchmarkSample(jobs,320).map(j=>[`${j.sha256}#${j.song}`,j]));
  const seen=new Set<string>();let grants=0;
  const costs:{job:BenchmarkCandidate;oldCpuSeconds:number;newCpuSeconds:number}[]=[];
  for(let i=0;i<20;i++){
    const prefix=`shard-${i}`;
    const input=JSON.parse(read(`${prefix}-input.json`).toString()) as {measured:{job:BenchmarkCandidate}[]};
    const pipeline=JSON.parse(read(`${prefix}-pipeline.json`).toString()) as {sourceIdentity:string;benchmarkSha256:string;experimentSources:Record<string,string>;nativeHashes:SampleProofBinaries;rows:{job:BenchmarkCandidate;states:Record<string,string>;newScreen:GrantRow["screen"];oldCpuSeconds:number;newCpuSeconds:number}[]};
    const checked=JSON.parse(read(`${prefix}-grants.json`).toString()) as {sourceIdentity:string;benchmarkSha256:string;experimentSources:Record<string,string>;nativeHashes:{sampleClock:string;audio:string};rows:GrantRow[]};
    if(pipeline.sourceIdentity!==baseline||checked.sourceIdentity!==baseline||screenJson(pipeline.nativeHashes)!==screenJson(binaries)||checked.nativeHashes.sampleClock!==binaries.sample||checked.nativeHashes.audio!==binaries.audio||pipeline.rows.length!==16||checked.rows.length!==16||input.measured.length!==16||pipeline.benchmarkSha256!==files[`${prefix}-input.json`]||checked.benchmarkSha256!==files[`${prefix}-input.json`])throw new Error("Representative sample sources/binaries do not match");
    for(const [sources,entry]of [[pipeline.experimentSources,"bench-sample-pipeline.ts"],[checked.experimentSources,"bench-sample-screen.ts"]] as const)for(const name of [entry,"sample-screen.ts","register-comparison.ts","apply-sample-clock.py","build-sample-clock.sh"]){
      if(screenSha(readFileSync(path.join(import.meta.dir,name)))!==sources?.[name])throw new Error(`Sample predicate changed or is missing from representative qualification: ${name}`);
    }
    if((read(`${prefix}-grants.log`).toString().match(/native audio verified/g)??[]).length!==16||(read(`${prefix}-pipeline.log`).toString().match(/exact states matched/g)??[]).length!==16)throw new Error("Missing representative execution logs");
    pipeline.rows.forEach((r,index)=>{
      const key=`${r.job.sha256}#${r.job.song}`,job=expected.get(key),other=checked.rows[index]!;
      if(!job||seen.has(key)||job.seconds!==r.job.seconds||job.kind!==r.job.kind||screenJson(r.job)!==screenJson(other.job)||screenJson(r.job)!==screenJson(input.measured[index]?.job)||screenJson(r.newScreen)!==screenJson(other.screen)||
        (["none","full"] as const).some(set=>!["compatible","incompatible"].includes(r.states?.[set]??"")||typeof other.screen?.[set]!=="boolean"))throw new Error("Invalid representative decision coverage");
      const frames=Math.round(job.seconds*48000);
      if(other.audioReferenceOutcome!=="clean"||other.audioReferenceSamples!==frames*2||other.audioReferenceRepeat!=="not-run"||!hash(other.audioReferencePcmSha256)||!hash(other.audioReferenceTraceSha256)||!Array.isArray(other.audio)||other.audio.length!==2)throw new Error("Invalid retained audio reference evidence");
      for(const set of ["none","full"] as const){
        const lanes=other.audio.filter(l=>l.set===set),lane=lanes[0];
        if(lanes.length!==1||!lane||!["equivalent","audible-difference"].includes(lane.outcome)||!["register-equivalent","spectral"].includes(lane.method)||!Number.isSafeInteger(lane.samples)||lane.samples<0||lane.samples>frames*2||(lane.outcome==="equivalent"&&lane.samples!==frames*2)||!hash(lane.pcmSha256)||!hash(lane.traceSha256)||r.states[set]!== (lane.outcome==="equivalent"?"compatible":"incompatible"))throw new Error("Retained lane evidence contradicts classification");
        if(!other.screen[set])continue;
        const valid=(o:Observation|undefined)=>o?.error===""&&o.traceComplete===true&&o.frames===frames&&Number.isSafeInteger(o.chargenReads)&&o.chargenReads>=0;
        const reference=other.observations?.reference,variant=other.observations?.[set];
        if(!valid(reference)||!valid(variant)||lane.outcome!=="equivalent"||lane.samples!==frames*2||
          (lane.method!=="register-equivalent"&&!(set==="full"&&reference.chargenReads===0&&lane.method==="spectral")))throw new Error("Retained grant contradicts measured reference/lane evidence");
        grants++;
      }
      seen.add(key);costs.push(r);
    });
  }
  if(seen.size!==320||grants!==report.grantsChecked)throw new Error("Incomplete representative grant accounting");
  const before=projectCensus(jobs,costs.map(r=>({job:r.job,seconds:r.oldCpuSeconds})),1).projectedHours;
  const after=projectCensus(jobs,costs.map(r=>({job:r.job,seconds:r.newCpuSeconds})),1).projectedHours;
  if(after>=before||Math.abs(before-report.oldProjection.projectedHours)>before*1e-9||Math.abs(after-report.newProjection.projectedHours)>after*1e-9)throw new Error("Representative CPU projection differs from measured rows");
  return screenSha(screenJson({schema:"sidflow-sample-proof-2",files}));
}
