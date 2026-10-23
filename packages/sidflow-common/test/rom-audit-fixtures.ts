import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { stringifyDeterministic,type JsonValue } from "../src/json.js";
import { romConsumerProfile,romEngineId,type RomAuditEngine } from "../src/rom-eligibility.js";
import { CENSUS_SCHEMA,EXTENDED_FULL_FILLS,LANE_FILLS,METHODOLOGY,observationHorizon,type CensusRecord,type EngineRun,type LaneFill,type LaneResult } from "../../../scripts/rom-audit/methodology.js";
import { RELEASE_DOCUMENTS } from "../../../scripts/rom-audit/inputs.js";
import { sha } from "../../../scripts/rom-audit/publish-production.js";
export const fixtureHash="a".repeat(64);
export const stable=(v:unknown):string=>stringifyDeterministic(v as JsonValue,0);
export const SAMPLE_RATE=48000;
/** Engines of the fixture census; reSIDfp is opt-in. */
export const CENSUS_ENGINES:RomAuditEngine[]=["sidlite"];
const PCM="1".repeat(64),TRACE="2".repeat(64);
/** A lane that matched the reference through the whole horizon. */
export function lane(set:"full"|"none",fill:LaneFill,overrides:Partial<LaneResult>={},seconds=15):LaneResult{
 return {set,fill,outcome:"identical",samples:seconds*SAMPLE_RATE*2,writes:7,firstDifferenceSample:null,message:"",pcmSha256:PCM,traceSha256:TRACE,...overrides};
}
const DIFFERENT={outcome:"different" as const,samples:2812,writes:1,firstDifferenceSample:38,pcmSha256:"3".repeat(64),traceSha256:"4".repeat(64)};
/** A core run (every ordinary subtune) or, with `extended`, a cross-check sample run. */
export function engineRun(engine:RomAuditEngine,seconds=15,overrides:Partial<EngineRun>={},extended=false):EngineRun{
 return {engine,extended,reference:{outcome:"clean",samples:seconds*SAMPLE_RATE*2,writes:7,message:"",pcmSha256:PCM,traceSha256:TRACE,repeat:extended?"identical":"not-run"},
  lanes:[...(extended?EXTENDED_FULL_FILLS:LANE_FILLS.full).map(f=>lane("full",f,{},seconds)),...LANE_FILLS.none.map(f=>lane("none",f,DIFFERENT,seconds))],...overrides};
}
export function censusRecord(seconds=15,song=1,sha256=fixtureHash,extended=false):CensusRecord{
 return {schema:CENSUS_SCHEMA,sha256,song,seconds,sampleRate:SAMPLE_RATE,runs:CENSUS_ENGINES.map(e=>engineRun(e,seconds,{},extended))};
}
export const fakeEngine=(engine:RomAuditEngine)=>({sourceSha256:sha(`source-${engine}`),wasmSha256:sha(`wasm-${engine}`)});
export async function publicationFixture(dir:string,measured=false):Promise<{manifest:Record<string,unknown>;record:CensusRecord;horizons:Record<string,ReturnType<typeof observationHorizon>[]>}>{
 const root=path.join(dir,"corpus");await mkdir(path.join(root,"DOCUMENTS"),{recursive:true});
 const headers=[{path:"silent.sid",sha256:fixtureHash,md5:"a".repeat(32),songs:2,basicFlag:true,header:{magic:"RSID",version:2,flags:0x20,secondSidAddress:0,thirdSidAddress:0}}];
 const horizons={"silent.sid":[observationHorizon("0:10"),observationHorizon("0:00")]};
 const documents:Record<string,string>={};
 for(const name of RELEASE_DOCUMENTS){
  const bytes=name==="Songlengths.md5"?`[Database]\n; /silent.sid\n${"a".repeat(32)}=0:10 0:00\n`:`Synthetic ${name}\n`;
  await writeFile(path.join(root,"DOCUMENTS",name),bytes);documents[name]=sha(bytes);
 }
 const headerText=stable(headers),horizonText=stable(horizons);
 const engines=Object.fromEntries(CENSUS_ENGINES.map(e=>{const hashes=fakeEngine(e);return [e,{...hashes,profile:romConsumerProfile(e),engineId:romEngineId(hashes,romConsumerProfile(e))}];}));
 const manifest={schema:4,methodology:METHODOLOGY,censusSchema:CENSUS_SCHEMA,hvscRoot:root,files:1,songs:2,seconds:10,sampleRate:SAMPLE_RATE,engines,roms:{},documents,
  headersSha256:sha(headerText),horizonsSha256:sha(horizonText),corpusSha256:sha(`silent.sid\t${fixtureHash}\n`)};
 await writeFile(path.join(dir,"manifest.json"),stable(manifest));await writeFile(path.join(dir,"headers.json"),headerText);
 await writeFile(path.join(dir,"horizons.json"),horizonText);
 const record=censusRecord(15);
 if(measured)await writeFile(path.join(dir,"census.jsonl"),stable(record).trimEnd()+"\n");
 return {manifest,record,horizons};
}
