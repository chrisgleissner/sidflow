import { describe,expect,it } from "bun:test";
import { createRomEligibilityLookup,romEngineId,romMask,romSetId,REFERENCE_ROM_SHA256,ROM_CONSUMER_PROFILE,type RomDenyList,type RomSelection } from "../src/rom-eligibility.js";
import { assess,screen,exactWrites,observationHorizon,ROM_MASKS } from "../../../scripts/rom-audit/methodology.js";
import { delayedRomFixture } from "../../../scripts/rom-audit/fixtures.js";
import { SYSTEM_ROMS } from "../../sidflow-classify/src/render/system-roms-fetch.js";
import type { Measurement } from "../../../scripts/rom-audit/analysis.js";
const engine={sourceSha256:"1".repeat(64),wasmSha256:"2".repeat(64)};
const expected={...engine,profile:ROM_CONSUMER_PROFILE,methodology:"rom-audit-3"};
const hash="a".repeat(64);
const selection=(mask:number):RomSelection=>({kernal:mask&1?REFERENCE_ROM_SHA256.kernal:null,basic:mask&2?REFERENCE_ROM_SHA256.basic:null,chargen:mask&4?REFERENCE_ROM_SHA256.chargen:null});
function data():RomDenyList{return {schema:"sidflow-rom-deny-3",engineId:romEngineId(engine),romSetId:romSetId(),methodology:"rom-audit-3",
 entries:{[hash]:[[128,1,15000,10000],[0,255,0,0]]}};}
const reference=():Measurement=>({error:"",errorKind:"",sidReadbackReads:0,samples:240000,hash:"x",acRms:0,equal:true,differingSamples:0,peakDifference:0,
 differenceRms:0,firstDifferenceSec:null,sidWrites:1,matchingWritePrefix:1,startupOffsetCycles:0,maxRelativeWriteDriftCycles:0,
 traceComplete:true,firstWriteDivergence:null});
describe("production ROM eligibility",()=>{
 it("evaluates all eight masks per subtune and denies unknown/absent inputs",()=>{
  const lookup=createRomEligibilityLookup(data(),expected);
  for(const mask of ROM_MASKS)expect(lookup(hash,1,selection(mask)).state).toBe(mask===7?"compatible":mask===0?"incompatible":"unknown");
  expect(lookup(hash,2,selection(7)).eligible).toBe(false);expect(lookup("b".repeat(64),1,selection(7)).reason).toBe("missing-entry");
  expect(lookup(hash,3,selection(7)).eligible).toBe(false);
  for(const song of [0,1.1,NaN])expect(lookup(hash,song,selection(7)).eligible).toBe(false);
  const ok=lookup(hash,1,selection(7));
  expect(ok.maxPlaybackSeconds).toBe(15);expect(ok.documentedSeconds).toBe(10);
 });
 it("derives the mask from ROM image hashes and denies any non-reference image",()=>{
  const lookup=createRomEligibilityLookup(data(),expected);
  for(const slot of ["kernal","basic","chargen"] as const){
   const roms={...selection(7),[slot]:"0".repeat(64)};
   expect(romMask(roms)).toBeNull();
   const result=lookup(hash,1,roms);expect(result.eligible).toBe(false);expect(result.reason).toBe("non-reference-rom-image");
  }
  expect(lookup(hash,1,{kernal:undefined,basic:null,chargen:null} as unknown as RomSelection).eligible).toBe(false);
  expect(lookup(hash,1,null as unknown as RomSelection).eligible).toBe(false);
  expect(romMask(selection(5))).toBe(5);
 });
 it("pins the reference ROM hashes to the fetcher's table",()=>{
  const byName=Object.fromEntries(SYSTEM_ROMS.map(s=>[s.localName,s.sha256]));
  expect(REFERENCE_ROM_SHA256).toEqual({kernal:byName["kernal.901227-03.bin"],basic:byName["basic.901226-01.bin"],chargen:byName["characters.901225-01.bin"]});
 });
 it("rejects engine, profile, methodology and overlapping decisions",()=>{
  for(const field of ["sourceSha256","wasmSha256"] as const)
   expect(createRomEligibilityLookup(data(),{...expected,[field]:"3".repeat(64)})(hash,1,selection(7)).eligible).toBe(false);
  expect(createRomEligibilityLookup(data(),{...expected,methodology:"different"})(hash,1,selection(7)).eligible).toBe(false);
  for(const change of [{sampleRate:44100},{powerOnDelay:8192},{stereo:false},{engine:"reSIDfp"}]) {
   const profile={...ROM_CONSUMER_PROFILE,...change} as unknown as typeof ROM_CONSUMER_PROFILE;
   expect(createRomEligibilityLookup(data(),{...expected,profile})(hash,1,selection(7)).reason).toBe("catalogue-provenance-or-schema-mismatch");
  }
  const d=data();d.entries[hash]=[[128,128,15000,10000]];
  expect(createRomEligibilityLookup(d,expected)(hash,1,selection(7)).eligible).toBe(false);
 });
 it("schedules the whole documented composition including an ending margin",()=>{
  expect(observationHorizon("3:00").seconds).toBe(185);
  expect(observationHorizon("1:01.385").seconds).toBe(66.385);
  expect(observationHorizon("2:04.491").seconds).toBe(129.491);
  expect(observationHorizon("0:01.250").seconds).toBe(10);
  expect(observationHorizon("75:00").seconds).toBe(4505); // never silently clamp
  expect(observationHorizon("1:60").documentedSeconds).toBeNull();
  for(const token of [undefined,"0:00","?","0:30(loop)"]) {
   const h=observationHorizon(token);expect(h.seconds).toBe(300);expect(h.documentedSeconds).toBeNull();
  }
 });
 it("does not hide one write or one cycle behind the historical tolerances",()=>{
  const r=reference();expect(exactWrites(r,r)).toBe(true);
  for(const delta of [{sidWrites:2},{startupOffsetCycles:1},{maxRelativeWriteDriftCycles:1},{traceComplete:false},
   {firstWriteDivergence:{index:0,actual:[0,0,2,1],reference:[0,0,1,1]}}])expect(exactWrites({...r,...delta},r)).toBe(false);
 });
 it("keeps short, unstable, unknown-duration and unconfirmed results unknown",()=>{
  const r=reference(),h=observationHorizon("0:10");
  expect(assess(r,r,r,15,h,true).state).toBe("compatible"); // silence and sparse writes are valid equality
  expect(assess(r,r,r,15,h,false).reason).toBe("shipping-engine-confirmation-pending");
  expect(assess(r,r,r,15,h,"mismatch").reason).toBe("shipping-engine-disagrees-with-native-screen");
  expect(screen(r,r,r,15,h).state).toBe("compatible");   // a screen result is only a candidate
  expect(assess({...r,equal:false,differenceRms:1},r,r,15,h,true).state).toBe("unknown");
  expect(assess(r,r,r,15,observationHorizon(undefined),true).state).toBe("unknown");
  expect(assess(r,r,{...r,equal:false},15,h,true).state).toBe("unknown");
  expect(assess(undefined,r,r,15,h,true).reason).toBe("experiment-pending");
  expect(assess(r,r,r,15,observationHorizon("3:00"),true).state).toBe("unknown");
 });
 it("grants incompatible only for a confirmed CPU halt, never for infrastructure errors",()=>{
  const r=reference(),h=observationHorizon("0:10");
  const halt={...r,error:"Illegal instruction $02 at address $bf54",errorKind:"cpu-halt",equal:false,samples:1000};
  expect(assess(halt,r,r,15,h,true).state).toBe("incompatible");
  expect(assess(halt,r,r,15,h,false).state).toBe("unknown");      // not yet reproduced on the shipping engine
  for(const errorKind of ["resource","engine",""]) {
   const anomaly={...halt,error:errorKind==="resource"?"allocation failure: std::bad_alloc":"64 consecutive empty renders",errorKind};
   expect(assess(anomaly,r,r,15,h,true).state).toBe("unknown");
  }
  expect(assess({...r,samples:r.samples-2},r,r,15,h,true).reason).toBe("invalid-evidence-length");
  expect(assess(halt,{...r,error:"Illegal instruction $02 at address $1000",errorKind:"cpu-halt"},r,15,h,true).state).toBe("unknown");   // reference itself halts
 });
 it("creates original delayed fixtures for individual and combined dependencies without a BASIC declaration",()=>{
  for(const mask of [1,2,4,7]) {
   const bytes=delayedRomFixture(mask);expect(bytes.toString("ascii",0,4)).toBe("PSID");
   expect(bytes.readUInt16BE(0x76)&2).toBe(0);
   expect(bytes.includes(Buffer.from([0xc9,44]))).toBe(true);
  }
 });
 it("parameterizes the trigger frame, subtune count and dependent subtune",()=>{
  const late=delayedRomFixture(2,{frames:3500,songs:2,dependentSong:2});
  expect(late.readUInt16BE(0x0e)).toBe(2);
  expect(late.includes(Buffer.from([0xc9,0x0d]))).toBe(true);        // high byte of 3500
  expect(late.includes(Buffer.from([0xc9,0xac]))).toBe(true);        // low byte of 3500
  expect(late.includes(Buffer.from([0xc9,0x01]))).toBe(true);        // subtune index compare
  for(const bad of [{frames:0},{frames:65536},{songs:0},{songs:2,dependentSong:3},{songs:1.5}])
   expect(()=>delayedRomFixture(1,bad)).toThrow();
 });
});

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCheckpoint } from "../../../scripts/rom-audit/checkpoint.js";
import { publishProduction,sha } from "../../../scripts/rom-audit/publish-production.js";
import { gunzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { publicationFixture } from "./rom-audit-fixtures.js";
it("recovers only complete checkpoint records and preserves a torn UTF8 tail",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-checkpoint-")),file=path.join(dir,"execution.jsonl");
 try {
  const row=JSON.stringify({path:"song.sid",song:1,seconds:15,matrix:Array(8).fill(reference())})+"\n";
  const torn=Buffer.from([123,34,0xc3]);await writeFile(file,Buffer.concat([Buffer.from(row),torn]));
  expect(readCheckpoint(file).size).toBe(1);expect(await readFile(file+".interrupted-tail")).toEqual(torn);
  expect(readCheckpoint(file).size).toBe(1);await writeFile(file,row+row);
  expect(()=>readCheckpoint(file)).toThrow("Duplicate");
 }finally{await rm(dir,{recursive:true,force:true});}
});
it("publishes every subtune deterministically and keeps unmeasured experiments unknown",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-publication-"));
 try{
  await publicationFixture(dir);
  await publishProduction(dir);const first=await readFile(path.join(dir,"published/research.jsonl.gz"));
  await publishProduction(dir);expect(await readFile(path.join(dir,"published/research.jsonl.gz"))).toEqual(first);
  const records=gunzipSync(first).toString().trim().split("\n").map(line=>JSON.parse(line));
  expect(records.length).toBe(2);expect(records[0].declared.basic).toBe(true);
  for(const r of records)for(const e of r.experiments)expect(e.assessment.state).toBe("unknown");
  await writeFile(path.join(dir,"execution.jsonl"),'{}');
  await expect(publishProduction(dir)).rejects.toThrow("Truncated");
 }finally{await rm(dir,{recursive:true,force:true});}
});
// Once present, validate ALL published research/production decisions, without
// skipping individual cases or using a sampled subset of the corpus.
it("exhaustively agrees with every maintained research decision",async()=>{
 const dir=path.resolve(import.meta.dir,"../../../doc/research/hvsc-rom-catalogue/v3");
 if(!existsSync(path.join(dir,"manifest.json")))throw new Error("Maintained ROM publication is missing");
 const manifest=JSON.parse(await readFile(path.join(dir,"manifest.json"),"utf8"));
 const raw=await readFile(path.join(dir,"deny-list.json"),"utf8");
 const compressed=await readFile(path.join(dir,"research.jsonl.gz"));
 expect(sha(raw)).toBe(manifest.artifacts["deny-list.json"]);expect(sha(compressed)).toBe(manifest.artifacts["research.jsonl.gz"]);
 const d=JSON.parse(raw) as RomDenyList,lookup=createRomEligibilityLookup(d,{sourceSha256:manifest.engine.sourceSha256,wasmSha256:manifest.engine.wasmSha256,profile:ROM_CONSUMER_PROFILE,methodology:manifest.methodology}),seen=new Set<string>();
 let decisions=0;
 for(const line of gunzipSync(compressed).toString().trim().split("\n")) {
  const r=JSON.parse(line),key=`${r.sha256}#${r.song}`;
  if(seen.has(key))throw new Error(`Duplicate research record ${key}`);seen.add(key);
  for(const e of r.experiments) {
   const actual=lookup(r.sha256,r.song,selection(e.mask));
   if(actual.state!==e.assessment.state||actual.eligible!==(e.assessment.state==="compatible"))throw new Error(`Projection differs ${key}/${e.mask}`);
   decisions++;
  }
 }
 expect(seen.size).toBe(manifest.subtunes);expect(decisions).toBe(manifest.subtunes*8);
 expect(Object.values(d.entries).reduce((n,songs)=>n+songs.length,0)).toBe(manifest.subtunes);
});
