#!/usr/bin/env bun
/** Exact native/WASM PCM and absolute timed SID-write comparison on controls.
 * verify-native.ts <C64Music> <romDir> [certificate.json] [extra-cases.json]
 * Temporary native evidence is deleted; production renders still emit no PCM.
 */
import { createRequire } from "node:module";
import { mkdtemp,rm,writeFile,readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringifyDeterministic,type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { delayedRomFixture } from "./fixtures.js";
import { sha } from "./publish-production.js";
import { freshNativeRenderer,corpusIdentity } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import type { Execution,Measurement } from "./analysis.js";
const require=createRequire(new URL("../../packages/sidflow-classify/package.json",import.meta.url));
const {default:load}=await import(require.resolve("libsidplayfp-wasm/dist/index.js"));
const [hvsc,romDir,certificate,extra]=process.argv.slice(2);
if(!hvsc||!romDir)throw new Error("Expected HVSC root and ROM directory");
const cases:[string,number,number][]=[
 ["MUSICIANS/H/Hubbard_Rob/Commando.sid",1,2],["MUSICIANS/G/Galway_Martin/Arkanoid.sid",1,2],
 ["MUSICIANS/P/Pace_Wayne/Polonaise_BASIC.sid",1,2],["DEMOS/0-9/128_Byte_Blues_BASIC.sid",1,2],
 ["MUSICIANS/P/Peters_Alan/Tusari.sid",10,2],["MUSICIANS/A/A-Man/Phat_Frog_2SID.sid",1,2],
 ["MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid",1,60]];
const temp=await mkdtemp(path.join(tmpdir(),"rom-parity-exact-"));
try{
 for(const mask of [1,2,4,7]){const file=path.join(temp,`delayed-${mask}.sid`);await writeFile(file,delayedRomFixture(mask));cases.push([file,1,8]);}
 // Dependencies first read at ~70s in a non-default subtune, observed at 75s.
 for(const mask of [2,7]){const file=path.join(temp,`late-${mask}.sid`);await writeFile(file,delayedRomFixture(mask,{frames:3500,songs:2,dependentSong:2}));cases.push([file,2,75]);}
 if(extra)cases.push(...JSON.parse(await readFile(extra,"utf8")) as [string,number,number][]);
 for(const [file,song,seconds] of cases)if(!file||/[\t\r\n]/.test(file)||!Number.isInteger(song)||song<1||!Number.isFinite(seconds)||seconds<=0||seconds>3600)
  throw new Error("Invalid control case");
 // Every non-synthetic control counts toward the rollout ceiling by content, wherever the file lives.
 RolloutLedger.open(await corpusIdentity(hvsc)).reserve(await Promise.all(cases.filter(([f])=>!path.resolve(hvsc,f).startsWith(temp+path.sep)).map(async([f,s])=>
  ({sha256:sha(await readFile(path.resolve(hvsc,f))),path:path.relative(hvsc,path.resolve(hvsc,f)),song:s}))),"verify-native");
 const rom=async(name:string):Promise<Uint8Array>=>new Uint8Array(await readFile(path.join(romDir,name)));
 const kernal=await rom("kernal.901227-03.bin"),basic=await rom("basic.901226-01.bin"),chargen=await rom("characters.901225-01.bin");
 const renderer={pathname:freshNativeRenderer()};
 const assets={nativeSha256:renderer.pathname,sourceSha256:require.resolve("libsidplayfp-wasm/dist/complete-source.tar.gz"),wasmSha256:require.resolve("libsidplayfp-wasm/dist/sidlite/libsidplayfp.wasm")};
 const before=Object.fromEntries(await Promise.all(Object.entries(assets).map(async([key,file])=>[key,sha(await readFile(file))])));
 const originals=await Promise.all(cases.map(([file])=>readFile(path.resolve(hvsc,file))));
 const native=spawnSync(renderer.pathname,[romDir],{input:cases.map(([f,s,t],i)=>`${path.resolve(hvsc,f)}\t${s}\t${t}\thex:${originals[i]!.toString("hex")}\n`).join(""),
  encoding:"utf8",timeout:3600000,maxBuffer:32*1024*1024,env:{...process.env,ROM_AUDIT_CONTROL_DIR:temp}});
 if(native.status!==0)throw new Error(`Native controls failed: ${native.error?.stack??native.stderr}`);
 const rows=native.stdout.trim().split("\n").map(line=>JSON.parse(line) as Execution);
 if(rows.length!==cases.length)throw new Error("Missing native controls");
 const certified:{sha256:string;song:number;mask:number;seconds:number;measurementSha256:string;referenceSha256:string;pcmSha256:string;traceSha256:string}[]=[];
 const measurementSha=(m:Measurement):string=>sha(stringifyDeterministic(m as unknown as JsonValue,0));
 for(let index=0;index<cases.length;index++){
  const [file,song,seconds]=cases[index]!,row=rows[index]!;
  if(row.path!==path.resolve(hvsc,file)||row.song!==song||row.seconds!==seconds||row.matrix?.length!==8)throw new Error("Native control identity mismatch");
  const original=originals[index]!,bytes=Buffer.from(original);bytes.writeUInt16BE(song,0x10);
  for(let mask=0;mask<8;mask++){
   const measured=row.matrix[mask]!;
   if(measured.traceComplete!==true)throw new Error("Native trace truncation prevents parity qualification");
   const pcm=await readFile(path.join(temp,`${index}-${mask}.pcm`)),trace=await readFile(path.join(temp,`${index}-${mask}.trace`));
   if(pcm.length!==measured.samples*2||trace.length!==measured.sidWrites*32)throw new Error("Truncated native evidence");
   const module=await load({engine:"sidlite",print:()=>{}}),ctx=new module.SidPlayerContext();
   try{
    if(!ctx.configure(8000,true)||!ctx.setEmulationConfig({powerOnDelay:5000})||
      !ctx.setSystemROMs(mask&1?kernal:null,mask&2?basic:new Uint8Array(8192),mask&4?chargen:new Uint8Array(4096))||
      !ctx.loadSidBuffer(new Uint8Array(bytes)))throw new Error(ctx.getLastError());
    ctx.setSidWriteTraceEnabled(true);
    const wanted=Math.round(seconds*8000)*2;let samples=0,events=0,failed=false;
    // A failed WASM render may still hold timed writes made before the failure;
    // drain and compare them exactly like those of a successful chunk.
    const drain=():void=>{
     const packed=ctx.getAndClearSidWriteTracesPacked();
     if(ctx.getDroppedSidWriteTraceCount()||packed.length%4)throw new Error("WASM trace truncation/corruption");
     for(let j=0;j<packed.length;j++,events++){
      if((events+1)*8>trace.length||Number(trace.readBigUInt64LE(events*8))!==packed[j])throw new Error(`${file} #${song} mask${mask}: exact timed-write mismatch at scalar ${events}`);
     }
    };
    while(samples<wanted){
     const chunk=ctx.render(256);
     if(!chunk?.length){failed=true;drain();break;}
     drain();
     const take=Math.min(chunk.length,wanted-samples);
     for(let j=0;j<take;j++,samples++)if((samples+1)*2>pcm.length||pcm.readInt16LE(samples*2)!==chunk[j])
      throw new Error(`${file} #${song} mask${mask}: exact PCM mismatch at sample ${samples}`);
    }
    if(failed!==!!measured.error||samples!==measured.samples||events*8!==trace.length)
     throw new Error(`${file} #${song} mask${mask}: execution/length parity differs`);
    certified.push({sha256:sha(original),song,mask,seconds,measurementSha256:measurementSha(measured),referenceSha256:measurementSha(row.both),pcmSha256:sha(pcm),traceSha256:sha(trace)});
    console.log(`PASS ${file} #${song} mask${mask}: exact PCM samples and timed writes; ${samples} samples, ${events/4} writes`);
   }finally{ctx.delete();}
   // Bound temporary disk use to native output already consumed by this control.
   await rm(path.join(temp,`${index}-${mask}.pcm`));await rm(path.join(temp,`${index}-${mask}.trace`));
  }
 }
 for(const [key,file] of Object.entries(assets))if(before[key]!==sha(await readFile(file)))throw new Error(`Engine asset changed during parity qualification: ${key}`);
 if(certificate)await writeFile(certificate,stringifyDeterministic({schema:"sidflow-rom-parity-2",comparison:"exact-pcm-and-timed-traces",
  ...before,
  roms:{"kernal.901227-03.bin":sha(kernal),"basic.901226-01.bin":sha(basic),"characters.901225-01.bin":sha(chargen)},cases:certified}));
 console.log(`${certified.length} exact native/WASM controls passed.`);
}finally{await rm(temp,{recursive:true,force:true});}
