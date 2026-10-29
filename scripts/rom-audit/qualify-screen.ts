#!/usr/bin/env bun
/** Source-bound qualification. Logs are retained and checked before reuse. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { screenJson, screenIdentity, screenQualificationIdentity, screenSha, sampleClockEnabled } from "./screen-identity.js";
import { verifySampleProof } from "./sample-proof.js";
import { screenInventory } from "./screen-inventory.js";
import { suiteTotals } from "./rollout.js";
const [roms="workspace/roms",hvsc="workspace/hvsc/C64Music"]=process.argv.slice(2),sample=sampleClockEnabled(),directory=sample?"workspace/rom-audit-sample-qualification":"workspace/rom-audit-screen-qualification";
mkdirSync(directory,{recursive:true});
const sourceIdentity=screenQualificationIdentity(),measurementIdentity=screenIdentity(),file=path.join(directory,"certificate.json");
const binaries={sidlite:"workspace/rom-audit-screen-sidlite/render",residfp:"workspace/rom-audit-screen-residfp/render",...(sample?{sample:"workspace/rom-audit-sample-clock/native/render"}:{})};
const sampleProofSha256=sample?verifySampleProof(process.env.ROM_AUDIT_SAMPLE_PROOF??"workspace/sample-clock-320-qualification",(await screenInventory(hvsc)).jobs):undefined;
const nativeHashes=Object.fromEntries(Object.entries(binaries).map(([e,f])=>[e,screenSha(readFileSync(f))]));
interface Certificate{sourceIdentity:string;measurementIdentity:string;passed:boolean;nativeHashes:Record<string,string>;logs:Record<string,string>;fullRuns:{pass:number;fail:number;skip:number}[];sampleProofSha256?:string}
if(existsSync(file)){
  const prior=JSON.parse(readFileSync(file,"utf8")) as Certificate;
  if(prior.sourceIdentity===sourceIdentity&&prior.measurementIdentity===measurementIdentity&&prior.sampleProofSha256===sampleProofSha256&&prior.passed&&Object.entries(nativeHashes).every(([e,sha])=>prior.nativeHashes?.[e]===sha)&&prior.fullRuns.length===3&&prior.fullRuns.every(r=>r.pass>0&&!r.fail&&!r.skip)&&Object.entries(prior.logs).length===(sample?9:7)&&Object.entries(prior.logs).every(([name,sha])=>path.basename(name)===name&&existsSync(path.join(directory,name))&&screenSha(readFileSync(path.join(directory,name)))===sha)){
    console.log("Matching qualification and logs already passed.");process.exit(0);
  }
}
const logs:Record<string,string>={}, fullRuns:Certificate["fullRuns"]=[];
const bunRunner=["node","scripts/run-bun.mjs"];
function run(name:string,command:string[],extraEnv:NodeJS.ProcessEnv={}):string{
  console.log(`Qualification: ${name}`);
  const logFile=path.join(directory,name);
  if(existsSync(logFile)){
    const prior=readFileSync(logFile),archive=`${logFile}.previous-${screenSha(prior).slice(0,16)}`;
    if(!existsSync(archive))writeFileSync(archive,prior);
  }
  writeFileSync(logFile,`Running ${name} for qualification ${sourceIdentity}\n`);
  const result=spawnSync(command[0]!,command.slice(1),{encoding:"utf8",maxBuffer:256*1024*1024,env:{...process.env,...extraEnv,ROM_DECISION_ONLY:""}});
  const text=result.stdout+result.stderr;writeFileSync(path.join(directory,name),text);logs[name]=screenSha(text);
  if(result.status!==0)throw new Error(`${name} failed (${result.status}): ${text.slice(-5000)}`);
  return text;
}
run("build.log",[...bunRunner,"run","build"]);
const scripts=readdirSync("scripts/rom-audit").filter(f=>f.endsWith(".ts")).map(f=>`scripts/rom-audit/${f}`);
run("typecheck.log",[...bunRunner,"x","tsc","--noEmit","--strict","--module","ESNext","--moduleResolution","bundler","--target","ES2022","--types","bun-types","--skipLibCheck","--allowImportingTsExtensions",...scripts]);
run("parity.log",[...bunRunner,"scripts/rom-audit/verify-screen.ts",roms,"workspace/rom-audit-screen-sidlite/render","workspace/rom-audit-screen-residfp/render",path.join(directory,"parity.json"),hvsc]);
run("transport.log",[...bunRunner,"scripts/rom-audit/transport-regression.ts",roms,hvsc]);
if(sample){
  run("sample.log",[...bunRunner,"scripts/rom-audit/verify-sample-clock.ts",roms,binaries.sample!,path.join(directory,"sample-parity.json")]);
  run("sample-worker.log",[...bunRunner,"scripts/rom-audit/sample-worker-regression.ts",roms,hvsc]);
}
for(let i=1;i<=3;i++){
  const text=run(`full-${i}.log`,[...bunRunner,"run","test"],{SIDFLOW_CONFIG:".sidflow.test.json"}),totals=suiteTotals(text);
  if(!totals.pass||totals.fail||totals.skip)throw new Error(`Full run ${i} was not entirely clean: ${screenJson(totals)}`);
  fullRuns.push(totals);console.log(`Full run ${i}: ${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip`);
}
if(screenQualificationIdentity()!==sourceIdentity||screenIdentity()!==measurementIdentity||Object.entries(binaries).some(([e,f])=>screenSha(readFileSync(f))!==nativeHashes[e]))throw new Error("Qualification sources/binaries changed during validation");
writeFileSync(file,screenJson({schema:"sidflow-screen-qualification-1",sourceIdentity,measurementIdentity,passed:true,nativeHashes,logs,fullRuns,sampleProofSha256})+"\n");
console.log(`Qualified ${sourceIdentity}; certificate ${file}`);
