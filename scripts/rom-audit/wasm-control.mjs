#!/usr/bin/env node
/** One cold, official WASM reference per Node process. Qualification only:
 * avoids retaining/reinitialising hundreds of Emscripten runtimes in Bun.
 * stdin carries immutable SID/ROM bytes; stdout carries measured PCM/traces.
 */
import {createRequire} from "node:module";
import {stringifyDeterministic} from "../../packages/sidflow-common/dist/json.js";
const parts=[];let size=0;
for await(const part of process.stdin){size+=part.length;if(size>4*1024*1024)throw Error("Oversized WASM control input");parts.push(part);}
const job=JSON.parse(Buffer.concat(parts).toString());
if(!["sidlite","residfp"].includes(job.engine)||![0,3,7].includes(job.mask)||!Number.isInteger(job.song)||job.song<1||!Number.isFinite(job.seconds)||job.seconds<=0||job.seconds>3600)throw Error("Invalid WASM control input");
const require=createRequire(import.meta.url),{default:load}=await import(require.resolve("libsidplayfp-wasm-audit/dist/index.js"));
const module=await load({engine:job.engine,print:()=>{},printErr:()=>{}}),ctx=new module.SidPlayerContext();
const bytes=Buffer.from(job.hex,"hex");bytes.writeUInt16BE(job.song,0x10);
const kernal=Uint8Array.from(Buffer.from(job.roms.kernal,"base64")),basic=Uint8Array.from(Buffer.from(job.roms.basic,"base64")),chargen=Uint8Array.from(Buffer.from(job.roms.chargen,"base64"));
const wanted=Math.round(job.seconds*48000)*2,pcm=new Int16Array(wanted),writes=[];let samples=0,stopMessage="";
try{
  if(!ctx.configure(48000,true)||!ctx.setSystemROMs(job.mask&1?kernal:null,job.mask&2?basic:new Uint8Array(8192),job.mask&4?chargen:new Uint8Array(4096))||!ctx.loadSidBuffer(bytes)||!ctx.reset())throw Error(ctx.getLastError());
  ctx.setSidWriteTraceEnabled(true);
  while(samples<wanted){
    let chunk;
    try { chunk=ctx.render(256); }
    catch(error){
      console.error("[debug] WASM ending control render exception",error);
      const message=ctx.getLastError();
      if(!message.startsWith("Illegal instruction $"))throw error;
      stopMessage=message;break;
    }
    if(!chunk?.length){
      const message=ctx.getLastError();
      if(!message.startsWith("Illegal instruction $"))throw Error(message||"WASM control stopped");
      stopMessage=message;break;
    }
    const take=Math.min(chunk.length,wanted-samples);pcm.set(chunk.subarray(0,take),samples);samples+=take;
    if(ctx.getDroppedSidWriteTraceCount())throw Error("WASM trace dropped");
    writes.push(...ctx.getAndClearSidWriteTracesPacked());
  }
  if(stopMessage){
    if(ctx.getDroppedSidWriteTraceCount())throw Error("WASM ending trace dropped");
    writes.push(...ctx.getAndClearSidWriteTracesPacked());
  }
}finally{ctx.delete();}
process.stdout.write(stringifyDeterministic({pcm:Buffer.from(pcm.buffer).toString("base64"),writes,samples,stopMessage,referenceRuntime:process.version},0));
