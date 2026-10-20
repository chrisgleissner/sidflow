#!/usr/bin/env bun
/** Confirm the fast native path against the actual locked WASM renderer.
 * bun scripts/rom-audit/verify-native.ts <C64Music> <romDir>
 * Includes header-default subtune override, BASIC, RSID, PSID and multi-SID.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Execution } from "./analysis.js";
const require = createRequire(new URL("../../packages/sidflow-classify/package.json",import.meta.url));
const { default: load } = await import(require.resolve("libsidplayfp-wasm/dist/index.js"));
const [hvsc,romDir] = process.argv.slice(2);
if (!hvsc || !romDir) throw new Error("Usage: verify-native.ts <C64Music> <romDir>");
const cases = [
  ["MUSICIANS/H/Hubbard_Rob/Commando.sid",1],
  ["MUSICIANS/G/Galway_Martin/Arkanoid.sid",1],
  ["MUSICIANS/P/Pace_Wayne/Polonaise_BASIC.sid",1],
  ["DEMOS/0-9/128_Byte_Blues_BASIC.sid",1],
  ["MUSICIANS/P/Peters_Alan/Tusari.sid",10],
  ["MUSICIANS/A/A-Man/Phat_Frog_2SID.sid",1],
] as const;
const rom = async (name:string):Promise<Uint8Array> => new Uint8Array(await readFile(path.join(romDir,name)));
const kernal=await rom("kernal.901227-03.bin"), basic=await rom("basic.901226-01.bin"),chargen=await rom("characters.901225-01.bin");
const seconds=2,rate=8000;
const native=spawnSync(path.resolve(new URL("../../workspace/rom-audit-native/render",import.meta.url).pathname),[romDir],{
  input:cases.map(([file,song])=>`${path.resolve(hvsc,file)}\t${song}\t${seconds}\n`).join(""),encoding:"utf8",timeout:120000,
});
if (native.status !== 0) throw new Error(`Native control failed: ${native.error?.stack ?? native.stderr}`);
const rows=native.stdout.trim().split("\n").map((line)=>JSON.parse(line) as Execution);
let checks=0;
for (let i=0;i<cases.length;i++) {
  const [file,song]=cases[i]!,row=rows[i]!;
  const bytes=Buffer.from(await readFile(path.join(hvsc,file)));
  bytes.writeUInt16BE(song,0x10); // select initial tune directly, no extra initialization
  for (const variant of ["both","neither","kernal","basic"] as const) {
    // Fresh module per control: prevents a null BASIC setter retaining old ROM bytes.
    const module=await load({engine:"sidlite",print:()=>{}});
    const ctx=new module.SidPlayerContext();
    try {
      if (!ctx.configure(rate,true) || !ctx.setEmulationConfig({powerOnDelay:5000}) ||
        !ctx.setSystemROMs(variant==="both"||variant==="kernal"?kernal:null,
          variant==="both"||variant==="basic"?basic:new Uint8Array(8192),chargen) ||
        !ctx.loadSidBuffer(new Uint8Array(bytes))) throw new Error(ctx.getLastError());
      ctx.setSidWriteTraceEnabled(true);
      const pcm=new Int16Array(seconds*rate*2);let have=0;
      while (have<pcm.length) {
        const chunk=ctx.render(256);
        if (!chunk?.length) throw new Error(`WASM returned no samples: ${ctx.getLastError()}`);
        const take=Math.min(chunk.length,pcm.length-have);pcm.set(chunk.subarray(0,take),have);have+=take;
      }
      let hash=14695981039346656037n;
      for (const sample of pcm) {
        hash=BigInt.asUintN(64,(hash ^ BigInt(sample&255))*1099511628211n);
        hash=BigInt.asUintN(64,(hash ^ BigInt((sample>>>8)&255))*1099511628211n);
      }
      const writes=ctx.getAndClearSidWriteTracesPacked().length/4;
      if (hash.toString(16)!==row[variant].hash || writes!==row[variant].sidWrites)
        throw new Error(`${file} #${song} ${variant}: native/WASM mismatch: hashes ${row[variant].hash}/${hash.toString(16)}, writes ${row[variant].sidWrites}/${writes}`);
      checks++;console.log(`PASS ${file} #${song} ${variant}: PCM bit-identical; ${writes} writes`);
    } finally {ctx.delete();}
  }
}
console.log(`${checks} native/WASM controls passed.`);
