#!/usr/bin/env bun
/** Exercise the deployed sample worker, repeats, errors and real input wiring
 * against the original classifier. No new real corpus scope is reserved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SampleScreenWorker } from "./sample-worker.js";
import { classifyScreen } from "./screen-classifier.js";
import { loadRoms } from "./census-worker.js";
import { delayedRomFixture, syntheticFixture } from "./fixtures.js";
import { screenJson, screenSha } from "./screen-identity.js";
import { RolloutLedger } from "./ledger.js";
import { HVSC85_CORPUS } from "./screen-inventory.js";
import { scopeLock } from "./rollout.js";
const [roms="workspace/roms",hvsc="workspace/hvsc/C64Music"]=process.argv.slice(2);
scopeLock(HVSC85_CORPUS,true);
const images=loadRoms(roms),ledger=RolloutLedger.open(HVSC85_CORPUS);
const binaries={sidlite:path.resolve("workspace/rom-audit-screen-sidlite/render"),residfp:path.resolve("workspace/rom-audit-screen-residfp/render"),sample:path.resolve("workspace/rom-audit-sample-clock/native/render")};
const cases=[1,2,4].map(mask=>({name:`delayed-${mask}`,bytes:delayedRomFixture(mask,{frames:100})}));
for(const kind of ["silence","silent-tail","silent-halt","halt-without-basic","osc3-reader","second-sid-late","third-sid-late"] as const)cases.push({name:kind,bytes:syntheticFixture(kind,{frames:100})});
for(const file of ["MUSICIANS/H/Hubbard_Rob/Commando.sid","MUSICIANS/G/Galway_Martin/Arkanoid.sid","MUSICIANS/A/Andy/Justincase_part_6.sid","MUSICIANS/H/Hermit/3SID_Tracker_Demo_1_3SID.sid"]){
  const bytes=readFileSync(path.join(hvsc,file));
  if(!ledger.has({sha256:screenSha(bytes),song:1}))throw new Error("Worker regression input was not reserved by parity controls");
  cases.push({name:file,bytes});
}
let next=0;
await Promise.all(Array.from({length:4},async()=>{
  const worker=new SampleScreenWorker(path.resolve(roms),binaries.sidlite,binaries.residfp,binaries.sample);
  try{
    const invalid=await worker.request({sha256:"0".repeat(64),hex:cases[0]!.bytes.toString("hex"),song:1,seconds:10.123,repeat:false});
    if(!invalid.failure||invalid.engines.length)throw new Error("Bad checksum did not fail closed");
    for(let index=next++;index<cases.length;index=next++){
      const item=cases[index]!,repeat=index%2===0;
      const actual=await worker.request({sha256:screenSha(item.bytes),hex:item.bytes.toString("hex"),song:1,seconds:10.123,repeat});
      if(actual.failure||actual.engines.length!==2||!(actual.cpuSeconds!>0))throw new Error(`Sample worker failed: ${screenJson(actual)}`);
      for(const [i,engine]of (["sidlite","residfp"] as const).entries()){
        const expected=await classifyScreen(engine,binaries[engine],roms,images,item.bytes,1,10.123,repeat),measured=actual.engines[i]!;
        if(measured.engine!==engine||screenJson(measured.states)!==screenJson(expected.states)||Object.values(measured.states).includes("unknown")||repeat&&measured.audio?.reference.repeat!=="identical")throw new Error(`Sample worker classification/repeat mismatch: ${item.name}/${engine}: ${screenJson({repeat,expected:expected.states,actual:measured.states,reference:measured.audio?.reference})}`);
      }
      console.log(`PASS sample worker ${item.name}, repeat=${repeat}`);
    }
  }finally{worker.close();}
}));
console.log(`${cases.length} deployed dual-engine worker controls passed; checksum errors remain failures.`);
