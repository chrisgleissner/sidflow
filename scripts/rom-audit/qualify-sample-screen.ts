#!/usr/bin/env bun
/** Re-run the entire stratified benchmark, with forced audio validation of
 * every sample-screen grant and independent A/B pipeline decisions. Never
 * writes eligibility data or modifies an existing census/checkpoint.
 * <benchmark.json> <HVSC> <roms> <sample binary> <output> [parallelism=6]
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { screenInventory } from "./screen-inventory.js";
import { benchmarkSample, benchmarkStratum, projectCensus, type BenchmarkCandidate } from "./benchmark-model.js";
import { screenJson, screenSha, screenQualificationIdentity } from "./screen-identity.js";
import { scopeLock } from "./rollout.js";

const [benchmark,hvsc,roms,binary,output,parallelArg="6"]=process.argv.slice(2);
const parallelism=Number(parallelArg);
if(!benchmark||!hvsc||!roms||!binary||!output||!Number.isSafeInteger(parallelism)||parallelism<1||parallelism>24)throw new Error("Expected benchmark HVSC ROMs sample-binary output [parallelism 1..24]");
if(existsSync(output))throw new Error("Choose a fresh qualification output directory; prior evidence is preserved");
const inventory=await screenInventory(hvsc);
scopeLock(inventory.corpus,true);
const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;sampleSize:number;benchmarkFailures:number;measured:{job:BenchmarkCandidate}[]};
const jobs=prior.measured.map(r=>r.job),key=(j:BenchmarkCandidate)=>`${j.sha256}#${j.song}`;
const expected=benchmarkSample(inventory.jobs,320), expectedByKey=new Map(expected.map(j=>[key(j),j]));
if(prior.corpus!==inventory.corpus||prior.sampleSize!==320||jobs.length!==320||prior.benchmarkFailures!==0||new Set(jobs.map(key)).size!==320||jobs.some(j=>{
  const e=expectedByKey.get(key(j));return !e||e.seconds!==j.seconds||e.kind!==j.kind;
}))throw new Error("Require the complete zero-failure 320-job stratified HVSC benchmark");
// Resolve paths in this checkout; the original input hash remains in the report.
const local=new Map(inventory.jobs.map(j=>[key(j),j]));
const resolved=jobs.map(j=>local.get(key(j))!);
mkdirSync(output,{recursive:true});
const identity=screenQualificationIdentity(),binaryHash=screenSha(readFileSync(binary)),benchmarkHash=screenSha(readFileSync(benchmark));
const binaries={sample:path.resolve(binary),audio:path.resolve("workspace/rom-audit-screen-residfp/render"),sidlite:path.resolve("workspace/rom-audit-screen-sidlite/render")};
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([name,file])=>[name,screenSha(readFileSync(file))]));
const started=performance.now(),errors:{shard:number;message:string}[]=[],rows:{job:BenchmarkCandidate;oldCpuSeconds:number;newCpuSeconds:number;states:Record<string,string>}[]=[];
let next=0,grantsChecked=0;
const shards=Array.from({length:20},(_,i)=>resolved.slice(i*16,(i+1)*16));
async function run(script:string,args:string[],log:string):Promise<void>{
  const child=spawn(process.execPath,[path.join(import.meta.dir,script),...args],{stdio:["ignore","pipe","pipe"]});
  let text="";
  child.stdout.on("data",(b:Buffer)=>{text+=b.toString();});child.stderr.on("data",(b:Buffer)=>{text+=b.toString();});
  try{await new Promise<void>((resolve,reject)=>{child.on("error",reject);child.on("close",(code,signal)=>code===0?resolve():reject(new Error(`${script} exited ${code}/${signal}: ${text.slice(-2000)}`)));});}
  finally{writeFileSync(log,text);}
}
await Promise.all(Array.from({length:parallelism},async()=>{
  for(let index=next++;index<shards.length;index=next++){
    const prefix=path.join(output,`shard-${index}`),selection=`${prefix}-input.json`;
    writeFileSync(selection,screenJson({corpus:inventory.corpus,measured:shards[index]!.map(job=>({job}))})+"\n");
    try{
      await run("bench-sample-screen.ts",[selection,roms,binary,`${prefix}-grants.json`,"16"],`${prefix}-grants.log`);
      const grants=JSON.parse(readFileSync(`${prefix}-grants.json`,"utf8")) as {rows:{screen:{none:boolean;full:boolean}}[]};
      if(grants.rows.length!==16)throw new Error("Incomplete forced-audio validation");
      grantsChecked+=grants.rows.reduce((n,r)=>n+Number(r.screen.none)+Number(r.screen.full),0);
      await run("bench-sample-pipeline.ts",[selection,roms,binary,`${prefix}-pipeline.json`,"16"],`${prefix}-pipeline.log`);
      const pipeline=JSON.parse(readFileSync(`${prefix}-pipeline.json`,"utf8")) as {rows:typeof rows};
      if(pipeline.rows.length!==16)throw new Error("Incomplete pipeline comparison");
      rows.push(...pipeline.rows);
      console.log(`Shard ${index+1}/20 passed; ${rows.length}/320 decisions compared; ${grantsChecked} grants audio-verified`);
    }catch(error){console.error("Sample qualification shard failed",error);errors.push({shard:index,message:error instanceof Error?error.message:String(error)});}
  }
}));
const changed=screenQualificationIdentity()!==identity||Object.entries(binaries).some(([name,file])=>screenSha(readFileSync(file))!==nativeHashes[name]);
const unknown=rows.filter(r=>Object.values(r.states).includes("unknown")).length;
const complete=rows.length===320&&!errors.length&&!changed&&!unknown;
const oldProjection=complete?projectCensus(inventory.jobs,rows.map(r=>({job:r.job,seconds:r.oldCpuSeconds})),1):undefined;
const newProjection=complete?projectCensus(inventory.jobs,rows.map(r=>({job:r.job,seconds:r.newCpuSeconds})),1):undefined;
const report={schema:"sidflow-sample-screen-qualification-1",sourceIdentity:identity,binaryHash,nativeHashes,benchmarkHash,parallelism,elapsedSeconds:(performance.now()-started)/1000,
  passed:complete,unknown,errors,changed,grantsChecked,compared:rows.length,strata:Object.fromEntries([...new Set(resolved.map(benchmarkStratum))].map(s=>[s,rows.filter(r=>benchmarkStratum(r.job)===s).length])),
  costScope:"dual-engine native CPU plus per-job coordinator CPU; unchanged SIDLite work reused in both totals; no wall-time projection",oldProjection,newProjection,rows};
writeFileSync(path.join(output,"report.json"),screenJson(report)+"\n");
console.log(screenJson({...report,rows:undefined}));
if(!complete)process.exitCode=1;
