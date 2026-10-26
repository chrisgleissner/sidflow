#!/usr/bin/env bun
import { NativeLane } from "./native-lanes.js";
import { pcmParity } from "./pcm-parity.js";
import { screenJson } from "./screen-identity.js";
/** Bounded native digital / fresh WASM 256-event absolute trace parity.
 * verify-screen.ts <roms> <sidlite binary> <residfp binary> [report.json]
 * Synthetic cases do not consume HVSC rollout scope.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { delayedRomFixture, syntheticFixture, busReadRomFixture, seedReadRomFixture } from "./fixtures.js";
import { screenLane } from "./digital-screen.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RolloutLedger,ceilings } from "./ledger.js";
import { HVSC85_CORPUS } from "./screen-inventory.js";
import { loadRoms } from "./census-worker.js";
const [directory,sidlite,residfp,out,hvsc] = process.argv.slice(2);
if (!directory || !sidlite || !residfp) throw new Error("Expected roms and both native binaries");
const roms=loadRoms(directory), results: unknown[]=[];
const cases = [1,2,4,7].map(bank=>({name:`bank-${bank}`,bytes:delayedRomFixture(bank,{frames:50})}));
for (const kind of ["osc3-reader","second-sid-late","third-sid-late","silent-divergence","exactly-one"] as const) cases.push({name:kind,bytes:syntheticFixture(kind,{frames:50})});
for(const engine of ["sidlite","residfp"] as const)cases.push({name:`bus-dependent-${engine}`,bytes:busReadRomFixture(engine)});
cases.unshift({name:"seed-early-osc3",bytes:seedReadRomFixture(0x1b)},{name:"seed-early-env3",bytes:seedReadRomFixture(0x1c)},{name:"seed-late-env3",bytes:seedReadRomFixture(0x1c,100)});
for (const fixture of [...cases]) {
  const bytes=Buffer.from(fixture.bytes); bytes.writeUInt16BE((bytes.readUInt16BE(0x76)&~0x30)|0x20,0x76);
  cases.push({name:fixture.name+"-8580",bytes});
}
if(hvsc)for(const file of ["MUSICIANS/H/Hubbard_Rob/Commando.sid","MUSICIANS/G/Galway_Martin/Arkanoid.sid","MUSICIANS/A/Andy/Justincase_part_6.sid","MUSICIANS/H/Hermit/3SID_Tracker_Demo_1_3SID.sid"]){
  const bytes=readFileSync(`${hvsc}/${file}`),sha256=createHash("sha256").update(bytes).digest("hex");
  if(!RolloutLedger.open(HVSC85_CORPUS).reserve([{sha256,song:1,path:file}],"screen-parity",ceilings(61157,87868)))throw new Error("Parity would exceed pilot ceiling");
  cases.push({name:file,bytes});
}
for (const engine of ["sidlite","residfp"] as const) for (const fixture of cases) for (const mask of [0,3,7]) {
  const {bytes,name}=fixture, seconds=3;
  const native=await screenLane(engine==="sidlite"?sidlite:residfp,directory,bytes,1,seconds,mask);
  const fast=await screenLane(engine==="sidlite"?sidlite:residfp,directory,bytes,1,seconds,mask,true);
  const warm=await screenLane(engine==="sidlite"?sidlite:residfp,directory,bytes,1,seconds,mask,false,true);
  if(name.startsWith("seed-early")&&warm.error||name.startsWith("seed-late")&&!warm.error)throw new Error(`Warmup read boundary control failed: ${engine}, ${name}`);
  if(warm.error!=="stateful SID read requires detailed screen"&&(warm.error||!warm.traceComplete||warm.writes.length!==native.writes.length||warm.writes.some((v,i)=>v!==native.writes[i])||warm.chargenReads!==native.chargenReads))throw new Error(`Warmup screen changed execution: ${engine}, ${name}, mask ${mask}`);

  if(fast.error!=="stateful SID read requires detailed screen" && (fast.error||!fast.traceComplete||fast.writes.length!==native.writes.length||fast.writes.some((v,i)=>v!==native.writes[i])||fast.chargenReads!==native.chargenReads))throw new Error(`Bus-only screen changed execution: ${engine}, ${name}, mask ${mask}`);

  const lane=NativeLane.open(engine==="sidlite"?sidlite:residfp,directory,bytes,1,seconds,mask);
  const nativePcm=new Int16Array(seconds*96000), nativeAudioWrites:number[]=[];let nativeSamples=0;
  try{while(nativeSamples<nativePcm.length){const chunk=await lane.pull();if(!chunk)throw new Error(`Native audio stopped: ${lane.message}`);nativePcm.set(chunk.pcm,nativeSamples);nativeSamples+=chunk.pcm.length;nativeAudioWrites.push(...chunk.writes);}}finally{lane.close();}
  const reference=spawnSync("node",[fileURLToPath(new URL("./wasm-control.mjs",import.meta.url))],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:120000,
    input:screenJson({engine,mask,song:1,seconds,hex:bytes.toString("hex"),roms:Object.fromEntries(Object.entries(roms).map(([k,v])=>[k,Buffer.from(v).toString("base64")]))})});
  if(reference.status!==0)throw new Error(`Cold Node WASM control failed: ${reference.error?.message??reference.stderr}`);
  const measured=JSON.parse(reference.stdout) as {pcm:string;writes:number[];referenceRuntime:string};
  const raw=Uint8Array.from(Buffer.from(measured.pcm,"base64")),wasmPcm=new Int16Array(raw.buffer),writes=measured.writes;
  if (native.error || !native.traceComplete || native.writes.length < writes.length || writes.some((v,i)=>v!==native.writes[i])) throw new Error(`Digital/WASM trace mismatch: ${engine}, ${name}, mask ${mask}`);
  if(nativeAudioWrites.length!==writes.length||writes.some((v,i)=>v!==nativeAudioWrites[i]))throw new Error(`Native audio/WASM timed trace mismatch: ${engine}, ${name}, mask ${mask}`);
  const parity=pcmParity(engine,nativePcm,wasmPcm);
  if(mask===7){
    const repeat=NativeLane.open(engine==="sidlite"?sidlite:residfp,directory,bytes,1,seconds,mask);let offset=0;
    try{while(offset<nativePcm.length){const chunk=await repeat.pull();if(!chunk||chunk.pcm.some((v,i)=>v!==nativePcm[offset+i]))throw new Error(`Native reference not repeatable: ${engine}, ${name}`);offset+=chunk.pcm.length;}}finally{repeat.close();}
  }
  const result={engine,fixture:name,mask,referenceRuntime:measured.referenceRuntime,busOnly:!fast.error,warmup:!warm.error,parity,scalars:writes.length,traceSha256:createHash("sha256").update(new Uint8Array(Float64Array.from(writes).buffer)).digest("hex")};
  results.push(result); console.log(screenJson(result));
}
if(out)writeFileSync(out,screenJson({schema:"sidflow-digital-screen-parity-1",results})+"\n");
console.log(`${results.length} native digital + audio / fresh WASM PCM and trace comparisons passed.`);
