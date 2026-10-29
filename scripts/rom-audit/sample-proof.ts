/** Bind the completed representative experiment to the unchanged candidate
 * predicate, original classifier, exact native binaries and retained run logs.
 * Controller/adapter changes are separately source-qualified after this gate.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { screenIdentity, screenJson, screenSha } from "./screen-identity.js";
import { benchmarkSample, projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
export function verifySampleProof(directory:string,jobs:BenchmarkCandidate[]):string {
  const raw=readFileSync(path.join(directory,"report.json"));
  const report=JSON.parse(raw.toString()) as {passed:boolean;compared:number;unknown:number;errors:unknown[];changed:boolean;grantsChecked:number;binaryHash:string;oldProjection:{projectedHours:number};newProjection:{projectedHours:number}};
  if(report.passed!==true||report.compared!==320||report.unknown!==0||!Array.isArray(report.errors)||report.errors.length||report.changed!==false||
    !Number.isFinite(report.newProjection?.projectedHours)||!Number.isFinite(report.oldProjection?.projectedHours)||
    !(report.newProjection.projectedHours>0&&report.newProjection.projectedHours<report.oldProjection.projectedHours))throw new Error("Sample-clock proof is incomplete, mismatching or has no representative CPU benefit");
  const sampleHash=screenSha(readFileSync("workspace/rom-audit-sample-clock/native/render"));
  const audioHash=screenSha(readFileSync("workspace/rom-audit-screen-residfp/render"));
  if(report.binaryHash!==sampleHash)throw new Error("Sample-clock proof binary mismatch");
  const expected=new Map(benchmarkSample(jobs,320).map(j=>[`${j.sha256}#${j.song}`,j]));
  const seen=new Set<string>();let grants=0;
  const costs:{job:BenchmarkCandidate;oldCpuSeconds:number;newCpuSeconds:number}[]=[];
  for(let i=0;i<20;i++){
    const prefix=path.join(directory,`shard-${i}`);
    const pipeline=JSON.parse(readFileSync(`${prefix}-pipeline.json`,"utf8")) as {sourceIdentity:string;experimentSources:Record<string,string>;nativeHashes:{sample:string;audio:string};rows:{job:BenchmarkCandidate;states:Record<string,string>;oldCpuSeconds:number;newCpuSeconds:number}[]};
    const checked=JSON.parse(readFileSync(`${prefix}-grants.json`,"utf8")) as {sourceIdentity:string;experimentSources:Record<string,string>;nativeHashes:{sampleClock:string;audio:string};rows:{job:BenchmarkCandidate;screen:{none:boolean;full:boolean}}[]};
    if(pipeline.sourceIdentity!==screenIdentity(false)||checked.sourceIdentity!==screenIdentity(false)||pipeline.nativeHashes.sample!==sampleHash||checked.nativeHashes.sampleClock!==sampleHash||pipeline.nativeHashes.audio!==audioHash||checked.nativeHashes.audio!==audioHash||pipeline.rows.length!==16||checked.rows.length!==16)throw new Error("Representative sample sources/binaries do not match");
    for(const [sources,entry]of [[pipeline.experimentSources,"bench-sample-pipeline.ts"],[checked.experimentSources,"bench-sample-screen.ts"]] as const)for(const name of [entry,"sample-screen.ts","register-comparison.ts","apply-sample-clock.py","build-sample-clock.sh"]){
      if(screenSha(readFileSync(path.join(import.meta.dir,name)))!==sources?.[name])throw new Error(`Sample predicate changed or is missing from representative qualification: ${name}`);
    }
    if((readFileSync(`${prefix}-grants.log`,"utf8").match(/native audio verified/g)??[]).length!==16||(readFileSync(`${prefix}-pipeline.log`,"utf8").match(/exact states matched/g)??[]).length!==16)throw new Error("Missing representative execution logs");
    pipeline.rows.forEach((r,index)=>{
      const key=`${r.job.sha256}#${r.job.song}`,job=expected.get(key),other=checked.rows[index]!;
      if(!job||seen.has(key)||job.seconds!==r.job.seconds||job.kind!==r.job.kind||screenJson(r.job)!==screenJson(other.job)||
        ["none","full"].some(set=>!["compatible","incompatible"].includes(r.states?.[set]??"")||typeof other.screen?.[set as "none"]!=="boolean"))throw new Error("Invalid representative decision coverage");
      seen.add(key);grants+=Number(other.screen.none)+Number(other.screen.full);
      costs.push(r);
    });
  }
  if(seen.size!==320||grants!==report.grantsChecked)throw new Error("Incomplete representative grant accounting");
  const before=projectCensus(jobs,costs.map(r=>({job:r.job,seconds:r.oldCpuSeconds})),1).projectedHours;
  const after=projectCensus(jobs,costs.map(r=>({job:r.job,seconds:r.newCpuSeconds})),1).projectedHours;
  if(after>=before||Math.abs(before-report.oldProjection.projectedHours)>before*1e-9||Math.abs(after-report.newProjection.projectedHours)>after*1e-9)throw new Error("Representative CPU projection differs from measured rows");
  return screenSha(raw);
}
