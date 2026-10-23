import { describe,expect,it } from "bun:test";
import { existsSync,readFileSync,statSync } from "node:fs";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createRomEligibilityLookup,romEngineId,romMask,romSetId,romConsumerProfile,REFERENCE_ROM_SHA256,ROM_AUDIT_ENGINES,type RomDenyList,type RomSelection } from "../src/rom-eligibility.js";
import { assessMask,crossCheckDisagreements,headerFixesSidModels,isExtendedSample,observationHorizon,validateRecord,CENSUS_SCHEMA,LANE_FILLS,type EngineRun } from "../../../scripts/rom-audit/methodology.js";
import { delayedRomFixture,syntheticFixture,type SyntheticKind } from "../../../scripts/rom-audit/fixtures.js";
import { readCensus } from "../../../scripts/rom-audit/checkpoint.js";
import { publishProduction,sha } from "../../../scripts/rom-audit/publish-production.js";
import { SYSTEM_ROMS } from "../../sidflow-classify/src/render/system-roms-fetch.js";
import { engineRun,lane,censusRecord,publicationFixture,fakeEngine,fixtureHash,stable,SAMPLE_RATE,CENSUS_ENGINES } from "./rom-audit-fixtures.js";

const engine=fakeEngine("sidlite"),profile=romConsumerProfile("sidlite");
const expected={...engine,profile,methodology:"rom-audit-4",fallbackSidModel:"MOS8580" as const};
const hash="b".repeat(64);
const selection=(mask:number):RomSelection=>({kernal:mask&1?REFERENCE_ROM_SHA256.kernal:null,basic:mask&2?REFERENCE_ROM_SHA256.basic:null,chargen:mask&4?REFERENCE_ROM_SHA256.chargen:null});
function data():RomDenyList{return {schema:"sidflow-rom-deny-4",engineId:romEngineId(engine,profile),romSetId:romSetId(),methodology:"rom-audit-4",
 entries:{[hash]:[[0b00001000,0b00000001,15000,10000,1],[0,0,0,0,0]]}};}
describe("production ROM eligibility",()=>{
 it("evaluates the Commander ROM sets and denies every other set",()=>{
  const lookup=createRomEligibilityLookup(data(),expected);
  expect(lookup(hash,1,selection(3)).state).toBe("compatible");
  expect(lookup(hash,1,selection(7)).reason).toBe("not-a-supported-rom-set");   // all three images is not a set Commander creates
  expect(lookup(hash,1,selection(0)).state).toBe("incompatible");
  for(const mask of [1,2,4,5,6]){const answer=lookup(hash,1,selection(mask));expect(answer.eligible).toBe(false);expect(answer.reason).toBe("not-a-supported-rom-set");}
  expect(lookup(hash,2,selection(3)).eligible).toBe(false);expect(lookup("c".repeat(64),1,selection(3)).reason).toBe("missing-entry");
  expect(lookup(hash,3,selection(3)).eligible).toBe(false);
  for(const song of [0,1.1,NaN])expect(lookup(hash,song,selection(3)).eligible).toBe(false);
  const ok=lookup(hash,1,selection(3));
  expect(ok.maxPlaybackSeconds).toBe(15);expect(ok.documentedSeconds).toBe(10);
 });
 it("derives the ROM set from image hashes and denies any non-reference image",()=>{
  const lookup=createRomEligibilityLookup(data(),expected);
  for(const slot of ["kernal","basic","chargen"] as const){
   const roms={...selection(3),[slot]:"0".repeat(64)};
   expect(romMask(roms)).toBeNull();
   expect(lookup(hash,1,roms).reason).toBe("not-a-supported-rom-set");
  }
  expect(lookup(hash,1,{kernal:undefined,basic:null,chargen:null} as unknown as RomSelection).eligible).toBe(false);
  expect(lookup(hash,1,null as unknown as RomSelection).eligible).toBe(false);
  expect([romMask(selection(0)),romMask(selection(3)),romMask(selection(7)),romMask(selection(1)),romMask(selection(5))]).toEqual([0,3,null,null,null]);
 });
 it("pins the reference ROM hashes to the fetcher's table",()=>{
  const byName=Object.fromEntries(SYSTEM_ROMS.map(s=>[s.localName,s.sha256]));
  expect(REFERENCE_ROM_SHA256).toEqual({kernal:byName["kernal.901227-03.bin"],basic:byName["basic.901226-01.bin"],chargen:byName["characters.901225-01.bin"]});
 });
 it("derives different engine identities per renderer and per profile field",()=>{
  const ids=new Set(ROM_AUDIT_ENGINES.map(e=>romEngineId(engine,romConsumerProfile(e))));
  expect(ids.size).toBe(ROM_AUDIT_ENGINES.length);
  expect(romConsumerProfile("sidlite").pullCycles).toBe(100000);
  expect(romEngineId(engine,{...profile,sampleRate:44100} as unknown as typeof profile)).not.toBe(romEngineId(engine,profile));
 });
 it("rejects engine, profile, methodology and malformed tables",()=>{
  for(const field of ["sourceSha256","wasmSha256"] as const)
   expect(createRomEligibilityLookup(data(),{...expected,[field]:"3".repeat(64)})(hash,1,selection(3)).eligible).toBe(false);
  expect(createRomEligibilityLookup(data(),{...expected,methodology:"different"})(hash,1,selection(3)).eligible).toBe(false);
  for(const change of [{sampleRate:44100},{stereo:false},{engine:"residfp"},{powerOnDelay:"5000"},{package:"libsidplayfp-wasm@1.0.1"}]) {
   const changed={...profile,...change} as unknown as typeof profile;
   expect(createRomEligibilityLookup(data(),{...expected,profile:changed})(hash,1,selection(3)).reason).toBe("catalogue-provenance-or-schema-mismatch");
  }
  const mutations:((d:RomDenyList)=>void)[]=[d=>{d.entries[hash]=[[8,8,15000,10000,0]];},d=>{d.entries[hash]=[[0b10000000,0,15000,10000,0]];},d=>{d.entries[hash]=[[0,0,0,0,1]];},d=>{d.entries[hash]=[[8,0,15000,10000,2]];},   // bit outside {0,3}
   d=>{d.entries[hash]=[[8,0,0,0,0]];},d=>{d.entries[hash]=[[8,0,15000,15000,0]];},d=>{d.entries[hash]=[[8,0,Infinity,1,0]];},d=>{d.entries[hash]=[[8,0,15000,10000] as never];},
   d=>{d.schema="sidflow-rom-deny-3" as never;},d=>{d.engineId="";}];
  for(const mutate of mutations){const d=data();mutate(d);expect(createRomEligibilityLookup(d,expected)(hash,1,selection(3)).eligible).toBe(false);}
  const d=data(),lookup=createRomEligibilityLookup(d,expected);d.entries[hash]![0]![0]=0;
  expect(lookup(hash,1,selection(3)).eligible).toBe(true);   // validated snapshot cannot be altered afterwards
 });
 it("applies a decision measured with the MOS8580 fallback to a MOS6581 consumer only where the header fixes the model",()=>{
  const table=data();table.entries[hash]=[[0b00001000,0,15000,10000,1],[0b00001000,0,15000,10000,0]];
  const lookup=createRomEligibilityLookup(table,{...expected,fallbackSidModel:"MOS6581"});
  expect(lookup(hash,1,selection(3)).eligible).toBe(true);
  expect(lookup(hash,2,selection(3)).reason).toBe("depends-on-fallback-sid-model");
  expect(createRomEligibilityLookup(table,expected)(hash,2,selection(3)).eligible).toBe(true);
  expect(createRomEligibilityLookup(table,{...expected,fallbackSidModel:"MOS6502" as never})(hash,1,selection(3)).eligible).toBe(false);
 });
 it("never turns finite equality into permission beyond the recorded deadline",()=>{
  const lookup=createRomEligibilityLookup(data(),expected);
  expect(lookup(hash,1,selection(3),14.999).eligible).toBe(true);
  expect(lookup(hash,1,selection(3),15).reason).toBe("observation-horizon-exhausted");
  expect(lookup(hash,1,selection(3),Infinity).eligible).toBe(false);
  expect(lookup(hash,1,selection(3),-1).eligible).toBe(false);
 });
});
describe("observation horizons",()=>{
 it("schedules the whole documented composition including an ending margin",()=>{
  expect(observationHorizon("3:00").seconds).toBe(185);
  expect(observationHorizon("1:01.385").seconds).toBe(66.385);
  expect(observationHorizon("2:04.491").seconds).toBe(129.491);
  expect(observationHorizon("0:01.250").seconds).toBe(10);
  expect(observationHorizon("75:00").seconds).toBe(4505);   // never silently clamp
  expect(observationHorizon("1:60").documentedSeconds).toBeNull();
  for(const token of [undefined,"0:00","?","0:30(loop)"]){const h=observationHorizon(token);expect(h.seconds).toBe(300);expect(h.documentedSeconds).toBeNull();}
 });
});
describe("assessMask",()=>{
 const h=observationHorizon("0:10"),state=(run:EngineRun|undefined,mask:number,observed=15,horizon=h)=>assessMask(run,horizon,observed,SAMPLE_RATE,mask);
 it("grants the reference and both Commander sets only for complete, matching evidence",()=>{
  const run=engineRun("sidlite");
  expect(state(run,3).state).toBe("compatible");expect(state(engineRun("sidlite",15,{},true),3).state).toBe("compatible");
  expect(state(run,0).state).toBe("unknown");
  for(const mask of [1,2,4,5,6,7])expect(state(run,mask).reason).toBe("not-a-consumer-rom-set");
 });
 it("needs EVERY fill of the null banks to match",()=>{
  for(const fill of ["inverse","zero","ff","random"] as const){
   const run=engineRun("sidlite",15,{},true);run.lanes=run.lanes.map(l=>l.set==="full"&&l.fill===fill?{...l,outcome:"different" as const,samples:10}:l);
   expect(state(run,3).reason).toBe("depends-on-null-bank-content");
  }
  const stale=engineRun("sidlite");stale.lanes=stale.lanes.map(l=>l.set==="none"&&l.fill==="stale-basic"?{...l,outcome:"identical" as const,samples:l.samples}:l);
  expect(state(stale,0).state).toBe("unknown");                    // the other none fills still differ
  const both=engineRun("sidlite");both.lanes=both.lanes.map(l=>l.set==="full"?{...l,outcome:"different" as const}:l);
  expect(state(both,3).reason).toBe("output-diverges");
 });
 it("never grants incompatible: a stopped variant and engine anomalies are unknown with their own reasons",()=>{
  const stopped=engineRun("sidlite");stopped.lanes=[...stopped.lanes.filter(l=>l.set==="full"),...LANE_FILLS.none.map(f=>lane("none",f,{outcome:"stopped",samples:100}))];
  expect(state(stopped,0)).toEqual({state:"unknown",reason:"variant-stopped"});
  const full=engineRun("sidlite",15,{},true);full.lanes=full.lanes.map(l=>l.set==="full"&&l.fill==="ff"?{...l,outcome:"stopped" as const,samples:5}:l);
  expect(state(full,3).reason).toBe("depends-on-null-bank-content");
  for(const outcome of ["trace-dropped","reference-failed"] as const){
   const anomaly=engineRun("sidlite");anomaly.lanes=[...anomaly.lanes.filter(l=>l.set==="full"),...LANE_FILLS.none.map(f=>lane("none",f,{outcome}))];
   expect(state(anomaly,0).reason).toBe("non-tune-error");
  }
  for(const mask of [0,3])for(const run of [engineRun("sidlite"),stopped])expect(state(run,mask).state).not.toBe("incompatible");
 });
 it("keeps unreproducible, failed, short, unknown-length and pending evidence unknown",()=>{
  const unstable=engineRun("sidlite",15,{},true);unstable.reference.repeat="different";
  for(const mask of [0,3])expect(state(unstable,mask).reason).toBe("reference-unstable");
  const unrun=engineRun("sidlite",15,{},true);unrun.reference.repeat="not-run";expect(state(unrun,3).reason).toBe("reference-unstable");   // an extended record must have its repeat
  const spurious=engineRun("sidlite");spurious.reference.repeat="identical";expect(state(spurious,3).reason).toBe("reference-unstable");   // a core record has none
  const failed=engineRun("sidlite");failed.reference.outcome="failed";expect(state(failed,3).reason).toBe("reference-failed");
  const truncated=engineRun("sidlite");truncated.reference.samples-=2;expect(state(truncated,3).reason).toBe("reference-failed");
  expect(state(engineRun("sidlite",10),3,10).reason).toBe("observation-horizon-incomplete");
  const unknownLength=observationHorizon(undefined);
  expect(state(engineRun("sidlite",300),3,300,unknownLength).reason).toBe("observation-horizon-incomplete");
  expect(state(undefined,3).reason).toBe("experiment-pending");
  for(const bad of [{...h,seconds:NaN},{...h,seconds:2},{...h,documentedSeconds:1},{...h,source:"invented" as typeof h.source},{...h,seconds:15.000000001}])
   expect(state(engineRun("sidlite"),3,15,bad).reason).toBe("invalid-observation-horizon");
  const short=engineRun("sidlite");short.lanes=short.lanes.map(l=>({...l,samples:l.samples-2}));expect(state(short,3).state).toBe("unknown");
  expect(state(engineRun("sidlite"),3,NaN).state).toBe("unknown");
 });
});
describe("SID model fallback",()=>{
 it("recognises headers that name the model of every chip",()=>{
  const flags=(...models:number[]):number=>models.reduce((n,m,i)=>n|m<<(4+2*i),0);
  expect(headerFixesSidModels({version:2,flags:flags(1)})).toBe(true);
  expect(headerFixesSidModels({version:3,flags:flags(2,1),secondSidAddress:0x42})).toBe(true);
  expect(headerFixesSidModels({version:3,flags:flags(2,0),secondSidAddress:0x42})).toBe(false);          // second chip unknown
  expect(headerFixesSidModels({version:3,flags:flags(3)})).toBe(false);                                   // "either"
  expect(headerFixesSidModels({version:3,flags:flags(1,1,2),secondSidAddress:0x42,thirdSidAddress:0x44})).toBe(true);
  expect(headerFixesSidModels({version:1,flags:flags(1)})).toBe(false);                                   // v1 has no flags
  expect(headerFixesSidModels(undefined)).toBe(false);
 });
});
describe("cross-check sample",()=>{
 it("selects a deterministic fraction by content hash",()=>{
  expect(isExtendedSample("00000000"+"a".repeat(56),50)).toBe(true);
  expect(isExtendedSample("00000001"+"a".repeat(56),50)).toBe(false);
  expect(isExtendedSample("00000032"+"a".repeat(56),50)).toBe(true);   // 0x32 = 50
  expect(isExtendedSample("00000000"+"a".repeat(56),0)).toBe(false);
 });
 it("flags a core lane that is more permissive than the full set of fills",()=>{
  const h=observationHorizon("0:10"),agree=engineRun("sidlite",15,{},true);
  expect(crossCheckDisagreements(agree,h,15,SAMPLE_RATE)).toEqual([]);
  const bad=engineRun("sidlite",15,{},true);bad.lanes=bad.lanes.map(l=>l.set==="full"&&l.fill==="random"?{...l,outcome:"different" as const,samples:5}:l);
  expect(crossCheckDisagreements(bad,h,15,SAMPLE_RATE)).toEqual([3]);   // the inverse lane alone would have granted mask 3
  expect(assessMask(bad,h,15,SAMPLE_RATE,3).reason).toBe("depends-on-null-bank-content");
  expect(crossCheckDisagreements(engineRun("sidlite"),h,15,SAMPLE_RATE)).toEqual([]);   // only the sample is cross-checked
 });
});
describe("census records",()=>{
 const engines=[...CENSUS_ENGINES];
 it("accepts a well-formed core and extended record and rejects contradictions",()=>{
  expect(()=>validateRecord(censusRecord(),engines)).not.toThrow();
  expect(()=>validateRecord(censusRecord(15,1,fixtureHash,true),engines)).not.toThrow();
  const mutate=(f:(r:ReturnType<typeof censusRecord>)=>void)=>()=>{const r=structuredClone(censusRecord());f(r);validateRecord(r,engines);};
  expect(mutate(r=>{r.runs[0]!.lanes[0]!.pcmSha256="9".repeat(64);})).toThrow("Invalid census lane");
  expect(mutate(r=>{r.runs[0]!.lanes[0]!.fill="stale-basic";})).toThrow("Invalid census lane");   // stale-basic belongs to the none set          // identical lane must carry the reference hashes
  expect(mutate(r=>{r.runs[0]!.lanes[0]!.samples-=2;})).toThrow("Invalid census lane");
  expect(mutate(r=>{r.runs[0]!.lanes.pop();})).toThrow("Invalid census lanes");
  expect(mutate(r=>{r.runs[0]!.extended=true;})).toThrow();                        // an extended run needs its repeat and extra fills
  expect(mutate(r=>{r.runs[0]!.lanes[1]=r.runs[0]!.lanes[0]!;})).toThrow("Invalid census lane");              // duplicate lane key
  expect(mutate(r=>{r.runs[0]!.lanes[2]!.outcome="halt" as never;})).toThrow("Invalid census lane");                  // retired outcome
  expect(mutate(r=>{r.runs[0]!.engine="residfp";})).toThrow("engine order");
  expect(mutate(r=>{r.runs[0]!.reference.samples-=2;})).toThrow("Invalid census reference");
  expect(mutate(r=>{r.runs[0]!.reference.repeat="identical";r.runs[0]!.reference.outcome="failed";})).toThrow();
  expect(mutate(r=>{r.song=0;})).toThrow("header");
  expect(mutate(r=>{r.seconds=3601;})).toThrow("header");
  expect(mutate(r=>{r.schema="x" as never;})).toThrow("header");
 });
 it("accepts a failure record only with no runs",()=>{
  const failure={schema:CENSUS_SCHEMA,sha256:fixtureHash,song:1,seconds:15,sampleRate:SAMPLE_RATE,runs:[],failure:{reason:"timeout" as const,message:"x"}};
  expect(()=>validateRecord(failure,engines)).not.toThrow();
  expect(()=>validateRecord({...failure,runs:censusRecord().runs},engines)).toThrow("failure");
  expect(()=>validateRecord({...failure,failure:{reason:"other" as never,message:"x"}},engines)).toThrow("failure");
 });
});
describe("synthetic programs",()=>{
 it("builds original delayed fixtures for individual and combined dependencies without a BASIC declaration",()=>{
  for(const mask of [1,2,4,7]){
   const bytes=delayedRomFixture(mask);expect(bytes.toString("ascii",0,4)).toBe("PSID");
   expect(bytes.readUInt16BE(0x76)&2).toBe(0);expect(bytes.includes(Buffer.from([0xc9,44]))).toBe(true);
  }
 });
 it("parameterizes the trigger frame, subtune count and dependent subtune",()=>{
  const late=delayedRomFixture(2,{frames:3500,songs:2,dependentSong:2});
  expect(late.readUInt16BE(0x0e)).toBe(2);
  for(const byte of [0x0d,0xac,0x01])expect(late.includes(Buffer.from([0xc9,byte]))).toBe(true);
  for(const bad of [{frames:0},{frames:65536},{songs:0},{songs:2,dependentSong:3},{songs:1.5}])expect(()=>delayedRomFixture(1,bad)).toThrow();
 });
 it("assembles every synthetic kind into a valid SID image",()=>{
  const kinds:SyntheticKind[]=["silent-tail","silent-divergence","sparse-sfx","silence","halt-without-basic","busy-writes","osc3-reader","second-sid-late","third-sid-late"];
  for(const kind of kinds){
   const bytes=syntheticFixture(kind,{frames:100,mask:2});
   expect(bytes.toString("ascii",1,4)).toBe("SID");expect(bytes.readUInt16BE(6)).toBe(0x7c);expect(bytes.length).toBeGreaterThan(0x7c);
   expect(bytes.toString("ascii",0,4)).toBe(kind==="busy-writes"?"RSID":"PSID");
  }
  const halt=syntheticFixture("halt-without-basic");
  expect(halt[0x7c+0x1000]).toBe(0x02);expect(halt[0x7c+0x10ff]).toBe(0x02);expect(halt[0x7c+0x1094]).toBe(0x60);   // illegal opcodes for 0x00 and 0xFF fills, RTS for the authentic byte
  expect(syntheticFixture("third-sid-late")[0x7b]).toBe(0x44);
 });
});
describe("checkpoint recovery",()=>{
 const engines=[...CENSUS_ENGINES];
 it("preserves a torn tail only for the lock holder and never merges or hides interior damage",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-checkpoint-")),file=path.join(dir,"census.jsonl");
  try{
   const line=stable(censusRecord()).trimEnd()+"\n",torn=Buffer.from([123,34,0xc3]);
   await writeFile(file,Buffer.concat([Buffer.from(line),torn]));
   expect(readCensus(file,engines,{repair:false}).size).toBe(1);
   expect(statSync(file).size).toBe(line.length+3);                          // a reader does not modify the file
   expect(readCensus(file,engines,{repair:true}).size).toBe(1);
   expect(statSync(file).size).toBe(line.length);
   expect(readdirTail(dir)).toHaveLength(1);
   await writeFile(file,line+line);expect(()=>readCensus(file,engines,{repair:true})).toThrow("Duplicate");
   await writeFile(file,line+"not json\n"+line.replace(fixtureHash,"b".repeat(64)));expect(()=>readCensus(file,engines,{repair:true})).toThrow();
   const failure={...censusRecord(),runs:[],failure:{reason:"timeout",message:"x"}};
   await writeFile(file,stable(failure).trimEnd()+"\n"+line);                 // a retried failure supersedes the earlier failure
   expect(readCensus(file,engines,{repair:true}).get(`${fixtureHash}#1`)!.failure).toBeUndefined();
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
function readdirTail(dir:string):string[]{return require("node:fs").readdirSync(dir).filter((n:string)=>n.includes(".interrupted-tail."));}
describe("publication",()=>{
 it("publishes every subtune deterministically, per renderer, and keeps unmeasured work unknown",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-publication-"));
  try{
   await publicationFixture(dir);
   await publishProduction(dir);const first=await readFile(path.join(dir,"published/research.jsonl.gz"));
   await publishProduction(dir);expect(await readFile(path.join(dir,"published/research.jsonl.gz"))).toEqual(first);
   const records=gunzipSync(first).toString().trim().split("\n").map(line=>JSON.parse(line));
   expect(records.length).toBe(2);expect(records[0].declared.basic).toBe(true);
   for(const r of records)for(const e of CENSUS_ENGINES)for(const a of r.engines[e].assessments)expect(a.state).toBe("unknown");
   await writeFile(path.join(dir,"census.jsonl"),'{}');
   await expect(publishProduction(dir)).rejects.toThrow("Truncated");
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it("publishes decisions from measured lanes and a failed job as unknown",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-publication-"));
  try{
   await publicationFixture(dir,true);
   await publishProduction(dir);
   const m=JSON.parse(await readFile(path.join(dir,"published/manifest.json"),"utf8"));
   for(const e of CENSUS_ENGINES){
    const d=JSON.parse(await readFile(path.join(dir,`published/deny-list.${e}.json`),"utf8")) as RomDenyList;
    const lookup=createRomEligibilityLookup(d,{...m.engines[e],profile:romConsumerProfile(e),methodology:m.methodology,fallbackSidModel:"MOS8580"});
    expect(lookup(fixtureHash,1,selection(3)).maxPlaybackSeconds).toBe(15);
    expect(lookup(fixtureHash,1,selection(0)).eligible).toBe(false);
    expect(lookup(fixtureHash,2,selection(3)).reason).toBe("compatibility-unresolved");
    expect(d.entries[fixtureHash]![0]![4]).toBe(1);   // the fixture header names the SID model, so a MOS6581 consumer is covered too
    expect(createRomEligibilityLookup(d,{...m.engines[e],profile:romConsumerProfile(e),methodology:m.methodology,fallbackSidModel:"MOS6581"})(fixtureHash,1,selection(3)).eligible).toBe(true);
   }
   const failed={...censusRecord(),runs:[],failure:{reason:"timeout",message:"x"}};
   await writeFile(path.join(dir,"census.jsonl"),stable(failed).trimEnd()+"\n");
   await publishProduction(dir);
   const d=JSON.parse(await readFile(path.join(dir,"published/deny-list.sidlite.json"),"utf8")) as RomDenyList;
   expect(d.entries[fixtureHash]![0]).toEqual([0,0,0,0,0]);
   expect(JSON.parse(await readFile(path.join(dir,"published/manifest.json"),"utf8")).failedSubtunes).toBe(1);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
// Once present, validate ALL maintained research/production decisions, without skipping cases or sampling.
it("exhaustively agrees with every maintained research decision",async()=>{
 const dir=path.resolve(import.meta.dir,"../../../doc/research/hvsc-rom-catalogue/v4");
 if(!existsSync(path.join(dir,"manifest.json")))throw new Error("Maintained ROM publication is missing");
 const manifest=JSON.parse(await readFile(path.join(dir,"manifest.json"),"utf8"));
 const compressed=await readFile(path.join(dir,"research.jsonl.gz"));
 expect(sha(compressed)).toBe(manifest.artifacts["research.jsonl.gz"]);
 const records=gunzipSync(compressed).toString().trim().split("\n").map(line=>JSON.parse(line));
 expect(records.length).toBe(manifest.subtunes);
 for(const e of Object.keys(manifest.engines) as ("sidlite"|"residfp")[]){
  const raw=await readFile(path.join(dir,`deny-list.${e}.json`),"utf8");
  expect(sha(raw)).toBe(manifest.artifacts[`deny-list.${e}.json`]);
  const lookup=createRomEligibilityLookup(JSON.parse(raw) as RomDenyList,{sourceSha256:manifest.engines[e].sourceSha256,wasmSha256:manifest.engines[e].wasmSha256,profile:romConsumerProfile(e),methodology:manifest.methodology,fallbackSidModel:"MOS8580"});
  const seen=new Set<string>();
  for(const r of records){
   const key=`${r.sha256}#${r.song}`;if(seen.has(key)&&e===Object.keys(manifest.engines)[0])throw new Error(`Duplicate research record ${key}`);seen.add(key);
   for(const a of r.engines[e].assessments.map((x:{state:string},mask:number)=>({mask,state:x.state}))){
    const actual=lookup(r.sha256,r.song,selection(a.mask));
    const supported=[0,3].includes(a.mask);
    expect(actual.state).toBe(supported?a.state:"unknown");
    expect(actual.eligible).toBe(supported&&a.state==="compatible");
   }
  }
 }
});
void readFileSync;
