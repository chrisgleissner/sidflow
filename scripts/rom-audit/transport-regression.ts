#!/usr/bin/env bun
/** Concurrent early-halt regression for the native terminal-packet transport.
 * Uses one already-counted subtune; never advances the HVSC rollout population
 * without first reserving its exact content identity through the pilot ledger.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ScreenWorker } from "./screen-worker.js";
import { RolloutLedger,ceilings } from "./ledger.js";
import { HVSC85_CORPUS } from "./screen-inventory.js";
import { screenSha,screenJson } from "./screen-identity.js";
const [roms="workspace/roms",hvsc="workspace/hvsc/C64Music"]=process.argv.slice(2);
const relative="GAMES/A-F/Dark_Tower_BASIC.sid",bytes=readFileSync(path.join(hvsc,relative)),sha256=screenSha(bytes);
if(!RolloutLedger.open(HVSC85_CORPUS).reserve([{sha256,song:3,path:relative}],"native-transport-regression",ceilings(61157,87868)))throw new Error("Transport control would exceed pilot ceiling");
const job={sha256,hex:bytes.toString("hex"),song:3,seconds:10,repeat:true};let completed=0;
await Promise.all(Array.from({length:8},async()=>{
  const worker=new ScreenWorker(path.resolve(roms),path.resolve("workspace/rom-audit-screen-sidlite/render"),path.resolve("workspace/rom-audit-screen-residfp/render"));
  try{for(let i=0;i<4;i++){
    const result=await worker.request(job);
    if(result.failure||result.engines.length!==2||result.engines.some(e=>e.states.none!=="incompatible"||e.states.full!=="compatible"||e.audio?.reference.repeat!=="identical"))throw new Error(`Early-halt transport regression: ${screenJson(result)}`);
    completed++;
  }}finally{worker.close();}
}));
console.log(`Dark Tower #3: ${completed} repeated dual-engine jobs passed, 0 failures.`);

// Full-horizon reference and finite-boundary controls share the transport gate.
await import("./ending-regression.js");
