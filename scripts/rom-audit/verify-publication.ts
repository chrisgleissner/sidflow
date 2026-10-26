#!/usr/bin/env bun
/** Verify the complete local Commander bundle before distributing it.
 * bun scripts/rom-audit/verify-publication.ts <published-directory>
 * Checksums detect damage/mixed runs; consumers must pin a trusted manifest hash.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { screenJson, screenSha, SCREEN_METHODOLOGY } from "./screen-identity.js";
import { commanderExceptions } from "./screen-publication.js";
import type { ScreenTune } from "./screen-inventory.js";
import type { ScreenRow } from "./screen-publication.js";

export function verifyPublication(directory:string):string {
  const read=(name:string)=>readFileSync(path.join(directory,name));
  const manifestBytes=read("manifest.json");
  const manifest=JSON.parse(manifestBytes.toString()) as {
    schema:string;methodology:string;complete:boolean;releaseReady:boolean;files:number;subtunes:number;
    measuredSubtunes:number;pendingSubtunes:number;failedSubtunes:number;unknownSubtunes:number;exceptionSubtunes:number;
    engineIds:{sidlite:string;residfp:string};romSetId:string;sourceIdentity:string;nativeHashes:Record<string,string>;
    artifacts:Record<string,string>;counts:unknown;
  };
  const require=(valid:unknown,message:string):void=>{if(!valid)throw new Error(`Invalid Commander publication: ${message}`);};
  const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
  require(manifest.schema==="sidflow-dual-rom-manifest-1"&&manifest.methodology===SCREEN_METHODOLOGY,"schema/methodology");
  require(manifest.complete===true&&manifest.releaseReady===true&&manifest.files===61157&&manifest.subtunes===87868&&manifest.measuredSubtunes===87868&&
    manifest.pendingSubtunes===0&&manifest.failedSubtunes===0&&manifest.unknownSubtunes===0,"incomplete or unqualified census");
  require(hash(manifest.sourceIdentity)&&hash(manifest.romSetId)&&["sidlite","residfp"].every(e=>hash(manifest.engineIds[e as "sidlite"])),"provenance identities");
  const names=["commander-exceptions.json","commander-exceptions.bin","unknown.json","sha256-to-md5.json","playback-horizons.json","qualification.json","benchmark.json"];
  require(screenJson(Object.keys(manifest.artifacts).sort())===screenJson([...names].sort()),"artifact set");
  for(const name of names)require(hash(manifest.artifacts[name])&&screenSha(read(name))===manifest.artifacts[name],`checksum ${name}`);
  const parse=(name:string)=>JSON.parse(read(name).toString());
  const qualification=parse("qualification.json") as {schema:string;measurementIdentity:string;sourceIdentity:string;passed:boolean;nativeHashes:unknown;logs:Record<string,string>;fullRuns:{pass:number;fail:number;skip:number}[]};
  require(qualification.schema==="sidflow-screen-qualification-1"&&qualification.passed===true&&qualification.measurementIdentity===manifest.sourceIdentity&&hash(qualification.sourceIdentity)&&
    screenJson(qualification.nativeHashes)===screenJson(manifest.nativeHashes)&&qualification.fullRuns.length===3&&qualification.fullRuns.every(r=>Number.isSafeInteger(r.pass)&&r.pass>0&&r.fail===0&&r.skip===0)&&
    ["build.log","typecheck.log","parity.log","transport.log","full-1.log","full-2.log","full-3.log"].every(name=>hash(qualification.logs[name])),"qualification");
  const benchmark=parse("benchmark.json") as {sourceIdentity:string;passed:boolean};
  require(benchmark.passed===true&&benchmark.sourceIdentity===manifest.sourceIdentity,"benchmark");
  require(screenJson(parse("unknown.json"))==="{}","unknown decisions");
  const identities=parse("sha256-to-md5.json") as Record<string,string>;
  const horizons=parse("playback-horizons.json") as Record<string,{modelFixed:boolean;fallbackSidModel:string;milliseconds:number[]}>;
  require(Object.keys(identities).length===manifest.files&&Object.keys(horizons).length===manifest.files,"file inventory");
  const md5s=new Set(Object.values(identities));
  require(md5s.size===manifest.files&&Object.entries(identities).every(([sha,md5])=>hash(sha)&&/^[a-f0-9]{32}$/.test(md5)&&Object.hasOwn(horizons,md5)),"file identities");
  const exceptions=parse("commander-exceptions.json") as {schema:string;methodology:string;complete:boolean;engineIds:unknown;romSetId:string;bits:unknown;entries:Record<string,Record<string,number>>};
  require(exceptions.schema==="sidflow-commander-rom-exceptions-1"&&exceptions.methodology===manifest.methodology&&exceptions.complete===true&&
    screenJson(exceptions.engineIds)===screenJson(manifest.engineIds)&&exceptions.romSetId===manifest.romSetId&&
    screenJson(exceptions.bits)===screenJson({sidliteNone:1,sidliteKernalBasic:2,residfpNone:4,residfpKernalBasic:8}),"exception provenance");
  const tunes:ScreenTune[]=[],rows=new Map<string,ScreenRow>();
  for(const [sha256,md5] of Object.entries(identities)){
    const scope=horizons[md5]!;
    require(typeof scope.modelFixed==="boolean"&&scope.fallbackSidModel==="MOS8580"&&Array.isArray(scope.milliseconds)&&scope.milliseconds.length>0&&scope.milliseconds.length<=256&&
      scope.milliseconds.every(ms=>Number.isSafeInteger(ms)&&ms>=10000&&ms<=3600000),"model/horizon scope");
    const jobs=scope.milliseconds.map((ms,i)=>({path:"",sha256,song:i+1,seconds:ms/1000,kind:"PSID"}));
    tunes.push({path:"",sha256,md5,modelFixed:scope.modelFixed,jobs});
    for(const job of jobs){
      const bits=exceptions.entries[md5]?.[String(job.song)]??0;
      require(Number.isInteger(bits)&&bits>=0&&bits<=15,"exception bits");
      rows.set(`${sha256}#${job.song}`,{sha256,song:job.song,seconds:job.seconds,workerSeconds:1,result:{engines:(["sidlite","residfp"] as const).map((engine,i)=>({engine,screen:null,
        states:{none:bits&(1<<(i*2))?"incompatible":"compatible",full:bits&(1<<(i*2+1))?"incompatible":"compatible"}}))}});
    }
  }
  require(rows.size===manifest.subtunes,"subtune inventory");
  for(const [md5,songs]of Object.entries(exceptions.entries))require(md5s.has(md5)&&Object.entries(songs).length>0&&Object.entries(songs).every(([song,bits])=>/^[1-9][0-9]*$/.test(song)&&Number(song)<=horizons[md5]!.milliseconds.length&&Number.isInteger(bits)&&bits>0&&bits<=15),"exception domain");
  // Re-encode JSON independently of the packed file: checks the binary header,
  // sorting, prefix collisions, subtunes, bits, record count and trailing bytes.
  const rebuilt=commanderExceptions(tunes,rows);
  require(rebuilt.packed.equals(read("commander-exceptions.bin"))&&rebuilt.exceptionSubtunes===manifest.exceptionSubtunes&&screenJson(rebuilt.counts)===screenJson(manifest.counts),"packed/JSON/count agreement");
  return screenSha(manifestBytes);
}
if(import.meta.main){
  const directory=process.argv[2];if(!directory)throw new Error("Usage: verify-publication.ts <published-directory>");
  console.log(`Verified complete qualified Commander bundle. Pin manifest SHA-256: ${verifyPublication(directory)}`);
}
