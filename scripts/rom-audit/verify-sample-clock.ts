#!/usr/bin/env bun
/** Check measured frame-count/write packets against real native audio packets.
 * <roms> <sample-clock binary> <report> [benchmark.json limit 1..16]
 * Frame counts are NOT PCM; no eligibility or spectral judgement is produced.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NativeLane, runNativeEngine } from "./native-lanes.js";
import { delayedRomFixture, seedReadRomFixture, syntheticFixture } from "./fixtures.js";
import { sampleClockScreen } from "./sample-screen.js";
import { screenJson, screenSha } from "./screen-identity.js";
import { readVerifiedSid } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import { scopeLock } from "./rollout.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
const [roms,binary,report,benchmark,limitArg]=process.argv.slice(2);
if(!roms||!binary||!report)throw new Error("Expected ROMs, sample-clock binary and report");
const cases:{name:string;bytes:Buffer;song:number;seconds:number;masks:number[]}[]=[
  {name:"late-kernal",bytes:delayedRomFixture(1,{frames:50}),song:1,seconds:3.123,masks:[7,0,3]},
  {name:"late-basic",bytes:delayedRomFixture(2,{frames:50}),song:1,seconds:3.123,masks:[7,0,3]},
  {name:"late-chargen",bytes:delayedRomFixture(4,{frames:50}),song:1,seconds:3.123,masks:[7,0,3]},
  {name:"early-osc3",bytes:seedReadRomFixture(0x1b),song:1,seconds:3.123,masks:[7,0,3]},
  {name:"late-env3",bytes:seedReadRomFixture(0x1c,100),song:1,seconds:3.123,masks:[7,0,3]},
];
for(const kind of ["silence","silent-tail","silent-divergence","osc3-reader","second-sid-late","third-sid-late","busy-writes"] as const)
  cases.push({name:kind,bytes:syntheticFixture(kind,{frames:100}),song:1,seconds:3.123,masks:[7,0,3]});
for(const mask of [1,2,4])cases.push({name:`delayed-${mask}-after-4s`,bytes:delayedRomFixture(mask,{frames:200,songs:2,dependentSong:2}),song:2,seconds:6.123,masks:[7,0,3]});
for(const item of [...cases])for(const model of [0x10,0x20])for(const clock of [4,8]){
  const bytes=Buffer.from(item.bytes);
  bytes.writeUInt16BE((bytes.readUInt16BE(0x76)&~0x3c)|model|clock,0x76);
  cases.push({...item,name:`${item.name}-${model===0x10?"6581":"8580"}-${clock===4?"PAL":"NTSC"}`,bytes});
}
if(benchmark){
  const limit=Number(limitArg);
  if(!Number.isSafeInteger(limit)||limit<1||limit>16)throw new Error("Limit must be 1..16");
  const prior=JSON.parse(readFileSync(benchmark,"utf8")) as {corpus:string;measured:{job:BenchmarkCandidate}[]};
  scopeLock(prior.corpus);const ledger=RolloutLedger.open(prior.corpus);
  const jobs=prior.measured.slice(0,limit).map(r=>r.job);
  if(jobs.length!==limit||jobs.some(j=>!ledger.has(j)))throw new Error("Only existing counted jobs allowed");
  cases.push(...jobs.map(j=>({name:j.path,bytes:readVerifiedSid(j.path,j.sha256),song:j.song,seconds:j.seconds,masks:[7]})));
}
// Diagnosed halts must not become a register-only compatibility grant. Check
// these and the synthetic PCM/trace controls against actual listener decisions.
const grantCases=[...cases.filter(c=>!c.name.includes("/")),...["halt-without-basic","silent-halt"].map(kind=>({name:kind,bytes:syntheticFixture(kind as "halt-without-basic"|"silent-halt"),song:1,seconds:3.123,masks:[7,0,3]}))];
for(const item of grantCases){
  const sampled=sampleClockScreen(binary,roms,item.bytes,item.song,item.seconds);
  const audio=await runNativeEngine("residfp",item.bytes,item.song,item.seconds,roms,path.resolve("workspace/rom-audit-screen-residfp/render"),true,["none","full"]);
  for(const set of ["none","full"] as const)if(sampled.screen[set]&&(audio.reference.outcome!=="clean"||audio.reference.repeat!=="identical"||audio.lanes.find(l=>l.set===set)?.outcome!=="equivalent"))throw new Error(`Synthetic false grant: ${item.name} ${set}`);
}
const rows:unknown[]=[];
for(const item of cases)for(const mask of item.masks){
  const expected:{sampleClockFrames:number;writes:number[]}[]=[];
  const native=NativeLane.open(path.resolve("workspace/rom-audit-screen-residfp/render"),roms,item.bytes,item.song,item.seconds,mask);
  try {
    for(let chunk=await native.pull();chunk;chunk=await native.pull()){
      native.absorb(chunk,chunk.pcm.length);expected.push({sampleClockFrames:chunk.pcm.length/2,writes:Array.from(chunk.writes)});
    }
    if(native.message||native.dropped||native.samples!==Math.round(item.seconds*48000)*2)throw new Error(`Incomplete native control: ${native.message}`);
  } finally {native.close();}
  for(const busOnly of [false,true]){
    const bytes=Buffer.from(item.bytes);bytes.writeUInt16BE(item.song,0x10);
    const started=performance.now(),run=spawnSync(binary,[roms],{encoding:"utf8",input:`immutable\t${item.song}\t${item.seconds}\thex:${bytes.toString("hex")}\n`,timeout:120000,maxBuffer:64*1024*1024,
      env:{...process.env,ROM_AUDIT_DIGITAL_ONLY:"1",ROM_AUDIT_SCREEN_MASK:String(mask),ROM_AUDIT_SAMPLE_RATE:"48000",ROM_AUDIT_POWER_ON_DELAY:"8191",ROM_AUDIT_PULL_EVENTS:"256",ROM_AUDIT_BUS_ONLY:busOnly?"1":undefined,ROM_AUDIT_WARMUP:undefined,ROM_AUDIT_STREAM_AUDIO:undefined}});
    if(run.status!==0)throw new Error(`Sample clock failed: ${run.error?.message??run.stderr}`);
    const records=run.stdout.trim().split("\n").map(line=>JSON.parse(line) as {sampleClockFrames?:number;writes:number[];error?:string;traceComplete?:boolean;sampleClockComplete?:boolean;cpuSeconds?:number});
    const terminal=records.pop();
    if(busOnly&&terminal?.error==="stateful SID read requires detailed screen"){
      rows.push({name:item.name,mask,busOnly,abortedForStatefulRead:true});continue;
    }
    if(terminal?.sampleClockComplete!==true||terminal.error||terminal.traceComplete!==true||screenJson(records)!==screenJson(expected))throw new Error(`Frame count / timed write mismatch: ${item.name}, mask ${mask}, bus ${busOnly}`);
    rows.push({name:item.name,mask,busOnly,frames:records.reduce((n,r)=>n+r.sampleClockFrames!,0),packets:records.length,evidenceSha256:screenSha(screenJson(records)),nativeCpuSeconds:native.cpuSeconds,clockCpuSeconds:terminal.cpuSeconds,clockWallSeconds:(performance.now()-started)/1000});
    console.log(`${item.name} mask ${mask} bus=${busOnly}: exact frame counts and timed writes matched`);
  }
  writeFileSync(report,screenJson({schema:"sidflow-sample-clock-parity-1",binarySha256:screenSha(readFileSync(binary)),rows})+"\n");
}

console.log(`${rows.length} packet/trace controls and ${grantCases.length} forced-audio synthetic grant controls passed.`);
