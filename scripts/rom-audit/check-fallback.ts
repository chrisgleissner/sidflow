#!/usr/bin/env bun
/** Compare SIDLite/reSIDfp without changing the common C64 execution settings.
 * bun scripts/rom-audit/check-fallback.ts <module dist/index.js> <C64Music> <romDir>
 * Accepts a second installed package explicitly; it never changes dependencies.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const [moduleFile,hvsc,romDir]=process.argv.slice(2);
if (!moduleFile||!hvsc||!romDir) throw new Error("Usage: check-fallback.ts <module index.js> <C64Music> <romDir>");
const library=await import(pathToFileURL(path.resolve(moduleFile)).href);
const get=async(name:string):Promise<Uint8Array>=>new Uint8Array(await readFile(path.join(romDir,name)));
const kernal=await get("kernal.901227-03.bin"),basic=await get("basic.901226-01.bin"),chargen=await get("characters.901225-01.bin");
const sha=(bytes:Uint8Array):string=>createHash("sha256").update(bytes).digest("hex");
const results:unknown[]=[];
for (const file of ["DEMOS/0-9/128_Byte_Blues_BASIC.sid","MUSICIANS/P/Pace_Wayne/Polonaise_BASIC.sid","MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid"])
  for (const engine of ["sidlite","residfp"]) {
    const variants:Record<string,unknown>={};
    for (const supplied of [true,false]) {
      const player=new library.SidAudioEngine({engine,sampleRate:8000,stereo:true});
      try {
        await player.setSystemROMs(supplied?kernal:null,supplied?basic:new Uint8Array(8192),chargen);
        await player.loadSidBuffer(new Uint8Array(await readFile(path.join(hvsc,file))),0);
        await player.setEmulationConfig({powerOnDelay:5000});
        player.setSidWriteTraceEnabled(true);
        const pcm=await player.renderSeconds(10,256);
        const writes=player.getAndClearSidWriteTraces();
        const sequence=new Uint8Array(writes.flatMap((w:{sidNumber:number;address:number;value:number})=>[w.sidNumber,w.address,w.value]));
        // Keep sustained activity separate from total RMS and initialization writes.
        const acRmsPerSecond=Array.from({length:10},(_,second)=>{
          const sum=[0,0],square=[0,0];
          for (let i=second*16000;i<(second+1)*16000;i++) {
            const channel=i%2,value=pcm[i]!/32768;
            sum[channel]!+=value;square[channel]!+=value*value;
          }
          return Math.sqrt(Math.max(0,(square[0]!+square[1]!)/16000-
            (sum[0]!**2+sum[1]!**2)/(2*8000**2)));
        });
        variants[supplied?"both":"neither"]={samples:pcm.length,pcmSha256:sha(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength)),
          writes:writes.length,writeSequenceSha256:sha(sequence),lastWriteCycle:writes.at(-1)?.cyclePhi1??null,
          firstWriteCycle:writes[0]?.cyclePhi1??null,acRmsPerSecond,
          romStatus:player.getRomStatus?.()??null};
      } finally {player.dispose();}
    }
    const result={file,engine,seconds:10,libraryVersion:library.LIBSIDPLAYFP_VERSION??null,packageVersion:library.PACKAGE_VERSION??null,variants};
    results.push(result);console.log(JSON.stringify(result));
  }
console.log(JSON.stringify({moduleFile,results},null,2));
