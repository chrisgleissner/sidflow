#!/usr/bin/env bun
/** Full-horizon controls for reference halts and timing-shifted screen tails.
 * Uses only already inventoried HVSC inputs; does not start a census.
 * ending-regression.ts [rom-directory] [HVSC-root]
 */
import {readFileSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {classifyScreen} from "./screen-classifier.js";
import {NativeLane} from "./native-lanes.js";
import {pcmParity} from "./pcm-parity.js";
import {loadRoms} from "./census-worker.js";
import {screenJson} from "./screen-identity.js";
import {validateRecord,CENSUS_SCHEMA} from "./methodology.js";
const [directory="workspace/roms",hvsc="workspace/hvsc/C64Music"]=process.argv.slice(2);
const roms=loadRoms(directory);
const cases=[
  {file:"GAMES/M-R/Mexico_86.sid",seconds:23.193,halt:true,none:{sidlite:"incompatible",residfp:"incompatible"}},
  {file:"DEMOS/M-R/New_Scener.sid",seconds:117.760,halt:true,none:{sidlite:"incompatible",residfp:"compatible"}},
  {file:"MUSICIANS/0-9/5bot/Its_Hip_to_be_Cool.sid",seconds:176,halt:false,none:{sidlite:"incompatible",residfp:"compatible"}},
];
for(const fixture of cases)for(const engine of ["sidlite","residfp"] as const){
  const bytes=readFileSync(path.join(hvsc,fixture.file));
  const binary=path.resolve(`workspace/rom-audit-screen-${engine}/render`);
  const result=await classifyScreen(engine,binary,directory,roms,bytes,1,fixture.seconds,true);
  const audio=result.audio;
  if(!audio||audio.reference.outcome!=="clean"||audio.reference.repeat!=="identical"||
      result.states.full!=="compatible"||result.states.none!==fixture.none[engine])
    throw new Error(`Ending classification failed: ${fixture.file}/${engine}: ${screenJson(result)}`);
  if(fixture.halt!== (audio.reference.stoppedAtSample!==undefined))throw new Error("Reference halt evidence missing/unexpected");
  validateRecord({schema:CENSUS_SCHEMA,sha256:"a".repeat(64),song:1,seconds:fixture.seconds,sampleRate:48000,runs:[audio]},[engine]);
  if(fixture.halt){
    for(const mask of [7,0,3]){
      const lane=NativeLane.open(binary,directory,bytes,1,fixture.seconds,mask);
      const chunks:Buffer[]=[],writes:number[]=[];let samples=0;
      try{
        for(let chunk; (chunk=await lane.pull());){chunks.push(Buffer.from(chunk.pcm.buffer));samples+=chunk.pcm.length;writes.push(...chunk.writes);}
        if(lane.dropped||mask===7&&!lane.cpuHalted)throw new Error(`Expected complete terminal evidence: ${fixture.file}/${engine}/${mask}: ${lane.message}`);
      }finally{lane.close();}
      const reference=spawnSync("node",[path.join(import.meta.dir,"wasm-control.mjs")],{
        encoding:"utf8",maxBuffer:128*1024*1024,timeout:180000,
        input:screenJson({engine,mask,song:1,seconds:fixture.seconds,hex:bytes.toString("hex"),
          roms:Object.fromEntries(Object.entries(roms).map(([k,v])=>[k,Buffer.from(v).toString("base64")]))}),
      });
      if(reference.status!==0)throw new Error(`WASM ending control failed: ${reference.error?.message??reference.stderr}`);
      const measured=JSON.parse(reference.stdout) as {pcm:string;writes:number[];samples:number;stopMessage:string};
      if(samples!==measured.samples||(mask===7&&!measured.stopMessage.startsWith("Illegal instruction $"))||
          writes.length!==measured.writes.length||writes.some((v,i)=>v!==measured.writes[i]))
        throw new Error(`Native/WASM ending trace mismatch: ${fixture.file}/${engine}/${mask}: samples ${samples}/${measured.samples}, writes ${writes.length}/${measured.writes.length}`);
      const raw=Uint8Array.from(Buffer.from(measured.pcm,"base64"));
      const native=Uint8Array.from(Buffer.concat(chunks));
      pcmParity(engine,new Int16Array(native.buffer),new Int16Array(raw.buffer).subarray(0,samples));
    }
  }else if(result.screen?.none)throw new Error("Timing-shifted writes bypassed audio");
  console.log(`PASS ending ${fixture.file}/${engine}: ${screenJson({states:result.states,stop:audio.reference.stoppedAtSample,repeat:audio.reference.repeat})}`);
}
console.log("6 full-horizon dual-engine ending controls passed; halted native/WASM PCM and traces agree for all 3 ROM masks.");
