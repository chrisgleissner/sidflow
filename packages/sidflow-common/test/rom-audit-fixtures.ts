import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { stringifyDeterministic,type JsonValue } from "../src/json.js";
import type { Execution,Measurement } from "../../../scripts/rom-audit/analysis.js";
import { AUDIT_PROTOCOL,METHODOLOGY,observationHorizon } from "../../../scripts/rom-audit/methodology.js";
import { RELEASE_DOCUMENTS } from "../../../scripts/rom-audit/inputs.js";
import { sha } from "../../../scripts/rom-audit/publish-production.js";
export const fixtureHash="a".repeat(64);
export const stable=(v:unknown):string=>stringifyDeterministic(v as JsonValue,0);
export function measurement(overrides:Partial<Measurement>={}):Measurement{
 return {error:"",errorKind:"",sidReadbackReads:0,samples:240000,hash:"abc",acRms:0,equal:true,differingSamples:0,peakDifference:0,differenceRms:0,
 firstDifferenceSec:null,sidWrites:1,matchingWritePrefix:1,startupOffsetCycles:0,maxRelativeWriteDriftCycles:0,
 traceComplete:true,traceHash:"def",firstWriteDivergence:null,kernalReads:0,basicReads:0,chargenReads:0,...overrides};
}
export function execution(root:string):Execution{
 const matrix=Array.from({length:8},()=>measurement());
 return {path:path.join(root,"silent.sid"),song:1,seconds:15,both:measurement(),repeat:measurement(),matrix,
 neither:matrix[4]!,kernal:matrix[5]!,basic:matrix[6]!};
}
/** One shipping-engine confirmation record for the fixture subtune (all eight masks). */
export function confirmationLine(seconds:number,outcome:string,overrides:Record<string,unknown>={},row:Execution=execution("")):string{
 return stable({schema:"sidflow-rom-wasm-confirmation-1",sha256:fixtureHash,song:1,seconds,sampleRate:48000,powerOnDelay:5000,
  results:Array.from({length:8},(_,mask)=>({mask,outcome,samples:seconds*48000*2,writes:1,firstDifferenceSample:null,message:"",pcmSha256:"p".repeat(64),traceSha256:"t".repeat(64),measurementSha256:sha(stable(row.matrix![mask])),referenceSha256:sha(stable(row.both)),...overrides}))});
}
export async function publicationFixture(dir:string,measured=false):Promise<{
 manifest:Record<string,unknown>;row:Execution;headers:Record<string,unknown>[];horizons:Record<string,ReturnType<typeof observationHorizon>[]>}>{
 const root=path.join(dir,"corpus");await mkdir(path.join(root,"DOCUMENTS"),{recursive:true});
 const headers=[{path:"silent.sid",sha256:fixtureHash,md5:"a".repeat(32),songs:2,basicFlag:true,header:{magic:"RSID"}}];
 const horizons={"silent.sid":[observationHorizon("0:10"),observationHorizon("0:00")]};
 const documents:Record<string,string>={};
 for(const name of RELEASE_DOCUMENTS){
  const bytes=name==="Songlengths.md5"?`[Database]\n; /silent.sid\n${"a".repeat(32)}=0:10 0:00\n`:`Synthetic ${name}\n`;
  await writeFile(path.join(root,"DOCUMENTS",name),bytes);documents[name]=sha(bytes);
 }
 const headerText=stable(headers),horizonText=stable(horizons);
 const manifest={schema:3,methodology:METHODOLOGY,protocol:AUDIT_PROTOCOL,files:1,songs:2,hvscRoot:root,seconds:10,
 nativeSha256:sha("native"),sourceSha256:sha("source"),wasmSha256:sha("wasm"),roms:{},documents,
 headersSha256:sha(headerText),horizonsSha256:sha(horizonText),corpusSha256:sha(`silent.sid\t${fixtureHash}\n`)};
 await writeFile(path.join(dir,"manifest.json"),stable(manifest));await writeFile(path.join(dir,"headers.json"),headerText);
 await writeFile(path.join(dir,"horizons.json"),horizonText);
 const row=execution(root);
 if(measured){
  await writeFile(path.join(dir,"execution.jsonl"),stable(row));
  await writeFile(path.join(dir,"confirmation.jsonl"),confirmationLine(row.seconds,"identical")+"\n");
 }
 return {manifest,row,headers,horizons};
}
