import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySampleProof } from "../../../scripts/rom-audit/sample-proof.js";
import { screenIdentity, screenJson, screenSha } from "../../../scripts/rom-audit/screen-identity.js";
import { projectCensus, type BenchmarkCandidate } from "../../../scripts/rom-audit/benchmark-model.js";
test("incomplete or forged proof metadata cannot authorize the accelerated backend",()=>{
  const directory=mkdtempSync(join(tmpdir(),"sidflow-sample-proof-"));
  const base={schema:"sidflow-sample-screen-qualification-1",passed:true,compared:320,unknown:0,errors:[],changed:false,oldProjection:{projectedHours:2},newProjection:{projectedHours:1}};
  try{
    for(const patch of [{passed:"yes"},{compared:319},{unknown:1},{errors:{length:0}},{errors:["failed"]},{changed:true},{oldProjection:{projectedHours:null}},{newProjection:{projectedHours:"1"}},{newProjection:{projectedHours:3}}]){
      writeFileSync(join(directory,"report.json"),JSON.stringify({...base,...patch}));
      expect(()=>verifySampleProof(directory,[])).toThrow("incomplete");
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test("proof rejects contradictory audio and changed SIDLite; digest binds every retained evidence file",()=>{
  const directory=mkdtempSync(join(tmpdir(),"sidflow-complete-proof-"));
  const jobs:BenchmarkCandidate[]=Array.from({length:320},(_,i)=>({sha256:screenSha(String(i)),song:1,path:`fixture-${i}.sid`,kind:"PSID",seconds:10}));
  const binaries={sample:"a".repeat(64),audio:"b".repeat(64),sidlite:"c".repeat(64)},sourceIdentity=screenIdentity(false),digest="e".repeat(64);
  const sources=(entry:string)=>Object.fromEntries([entry,"sample-screen.ts","register-comparison.ts","apply-sample-clock.py","build-sample-clock.sh"].map(name=>[name,screenSha(readFileSync(new URL(`../../../scripts/rom-audit/${name}`,import.meta.url)))]));
  const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),screenJson(value)+"\n");
  try{
    for(let i=0;i<20;i++){
      const selected=jobs.slice(i*16,(i+1)*16),prefix=`shard-${i}`;
      write(`${prefix}-input.json`,{measured:selected.map(job=>({job}))});
      const benchmarkSha256=screenSha(readFileSync(join(directory,`${prefix}-input.json`)));
      write(`${prefix}-pipeline.json`,{sourceIdentity,benchmarkSha256,experimentSources:sources("bench-sample-pipeline.ts"),nativeHashes:binaries,
        rows:selected.map(job=>({job,states:{none:"compatible",full:"compatible"},newScreen:{none:true,full:true},oldCpuSeconds:1,newCpuSeconds:0.5}))});
      const observation={error:"",traceComplete:true,frames:480000,chargenReads:0};
      write(`${prefix}-grants.json`,{sourceIdentity,benchmarkSha256,experimentSources:sources("bench-sample-screen.ts"),nativeHashes:{sampleClock:binaries.sample,audio:binaries.audio},rows:selected.map(job=>({job,screen:{none:true,full:true},observations:{reference:observation,none:observation,full:observation},
        audioReferenceOutcome:"clean",audioReferenceSamples:960000,audioReferenceRepeat:"not-run",audioReferencePcmSha256:digest,audioReferenceTraceSha256:digest,
        audio:["none","full"].map(set=>({set,outcome:"equivalent",method:"register-equivalent",samples:960000,pcmSha256:digest,traceSha256:digest}))}))});
      writeFileSync(join(directory,`${prefix}-grants.log`),"native audio verified\n".repeat(16));
      writeFileSync(join(directory,`${prefix}-pipeline.log`),"exact states matched\n".repeat(16));
    }
    write("report.json",{schema:"sidflow-sample-screen-qualification-1",passed:true,compared:320,unknown:0,errors:[],changed:false,grantsChecked:640,binaryHash:binaries.sample,nativeHashes:binaries,
      oldProjection:projectCensus(jobs,jobs.map(job=>({job,seconds:1})),1),newProjection:projectCensus(jobs,jobs.map(job=>({job,seconds:0.5})),1)});
    const verify=()=>verifySampleProof(directory,jobs,binaries),originalDigest=verify();
    expect(originalDigest).toMatch(/^[a-f0-9]{64}$/);
    const grantFile=join(directory,"shard-0-grants.json"),original=readFileSync(grantFile,"utf8");
    writeFileSync(grantFile,original.replace('"audioReferenceOutcome":"clean"','"audioReferenceOutcome":"failed"'));
    expect(verify).toThrow("reference");
    writeFileSync(grantFile,original.replace('"outcome":"equivalent"','"outcome":"audible-difference"'));
    expect(verify).toThrow("contradicts");
    writeFileSync(grantFile,original.replace('"samples":960000','"samples":0'));
    expect(verify).toThrow("contradicts");
    writeFileSync(grantFile,original.replace('"error":""','"error":"truncated"'));
    expect(verify).toThrow("grant");
    const diagnostic=JSON.parse(original) as Record<string,unknown>;diagnostic.note="diagnostic mutation";write("shard-0-grants.json",diagnostic);
    expect(verify()).not.toBe(originalDigest);
    writeFileSync(grantFile,original);
    const log=join(directory,"shard-0-grants.log"),logOriginal=readFileSync(log,"utf8");writeFileSync(log,`diagnostic note\n${logOriginal}`);
    expect(verify()).not.toBe(originalDigest);writeFileSync(log,logOriginal);
    expect(()=>verifySampleProof(directory,jobs,{...binaries,sidlite:"d".repeat(64)})).toThrow("binary mismatch");
    const pipeline=join(directory,"shard-0-pipeline.json"),pipelineOriginal=readFileSync(pipeline,"utf8");
    writeFileSync(pipeline,pipelineOriginal.replace(binaries.sidlite,"d".repeat(64)));expect(verify).toThrow("binaries");
    writeFileSync(pipeline,pipelineOriginal);expect(verify()).toBe(originalDigest);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
