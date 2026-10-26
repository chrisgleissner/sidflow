#!/usr/bin/env bun
/** PCM pull regression using synthetic fixtures and a required local HVSC input.
 * Run against the AddressSanitizer binary to catch engine heap writes, not just
 * whether a process happens to survive allocator padding.
 * bun scripts/rom-audit/native-regression.ts <renderer> <ROM dir> <HVSC root>
 */
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { delayedRomFixture } from "./fixtures.js";
import { evidence } from "./analysis.js";
import { corpusIdentity } from "./inputs.js";
import { RolloutLedger } from "./ledger.js";
import type { Execution } from "./analysis.js";
const [renderer,roms,hvsc]=process.argv.slice(2);
if (!renderer||!roms||!hvsc) throw new Error("Usage: native-regression.ts <renderer> <ROM dir> <HVSC root>");
const temp=await mkdtemp(path.join(tmpdir(),"sidflow-rom-audit-regression-"));
try {
  const jobs:string[]=[];
  for (const [name,flags] of [["PAL",0x14],["NTSC",0x18]] as const) {
    const bytes=Buffer.alloc(0x7c+12);
    bytes.write("PSID");bytes.writeUInt16BE(2,4);bytes.writeUInt16BE(0x7c,6);
    bytes.writeUInt16BE(0x1000,0x0a);bytes.writeUInt16BE(0x1006,0x0c);
    bytes.writeUInt16BE(1,0x0e);bytes.writeUInt16BE(1,0x10);bytes.writeUInt16BE(flags,0x76);
    bytes.write("Synthetic buffer boundary",0x16);bytes.write("SIDFlow",0x36);bytes.write("2026",0x56);
    // Embedded load address, init: volume=15, play: increment voice-1 frequency.
    Buffer.from([0x00,0x10,0xa9,0x0f,0x8d,0x18,0xd4,0x60,0xee,0x00,0xd4,0x60]).copy(bytes,0x7c);
    const file=path.join(temp,name+".sid");await writeFile(file,bytes);jobs.push(`${file}\t1\t2\n`);
  }
  // An RSID can write continuously rather than only once per VBI. Repeated
  // short SID clocks exercise the fractional sample carry that exposed the
  // 20,000-cycle buffer overrun in Justincase (part 6).
  const busy=Buffer.alloc(0x7c+18);
  busy.write("RSID");busy.writeUInt16BE(2,4);busy.writeUInt16BE(0x7c,6);
  busy.writeUInt16BE(0x1000,0x0a);busy.writeUInt16BE(1,0x0e);busy.writeUInt16BE(1,0x10);busy.writeUInt16BE(0x14,0x76);
  busy.write("Synthetic busy-loop SID writes",0x16);busy.write("SIDFlow",0x36);busy.write("2026",0x56);
  Buffer.from([0x00,0x10,0x78,0xa9,0x35,0x85,0x01,0xa9,0x0f,0x8d,0x18,0xd4,0xee,0x00,0xd4,0x4c,0x0a,0x10]).copy(busy,0x7c);
  const busyFile=path.join(temp,"busy-loop.sid");await writeFile(busyFile,busy);jobs.push(`${busyFile}\t1\t2\n`);
  const justincase="MUSICIANS/A/Andy/Justincase_part_6.sid";
  RolloutLedger.open(await corpusIdentity(hvsc)).reserve([{sha256:createHash("sha256").update(await readFile(path.resolve(hvsc,justincase))).digest("hex"),path:justincase,song:1}],"native-regression");
  const actual=path.resolve(hvsc,"MUSICIANS/A/Andy/Justincase_part_6.sid");
  // The actual failure involves raster/CPU scheduling; the simpler synthetic
  // stimuli above alone do not reproduce it. Require the real regression input.
  jobs.push(`${actual}\t1\t2\n`);
  const result=spawnSync(path.resolve(renderer),[roms],{input:jobs.join(""),encoding:"utf8",timeout:60000});
  if (result.status!==0) throw new Error(`Native buffer regression failed (${result.status}/${result.signal}): ${result.error?.stack??""}\n${result.stderr}`);
  const rows=result.stdout.trim().split("\n").map((line)=>JSON.parse(line) as Execution);
  if (rows.length!==4) throw new Error("Missing PAL/NTSC/busy-loop/Justincase results");
  for (const row of rows) {
    for (const m of [...(row.matrix??[]),row.both,row.repeat])
      if (m.error || m.samples!==32000) throw new Error(`Incomplete ${row.path}`);
    if (!row.repeat.equal) throw new Error(`Unstable repeated reference ${row.path}`);
  }
  for (const dependency of [1,2,4,7]) {
    const file=path.join(temp,`delayed-${dependency}.sid`);await writeFile(file,delayedRomFixture(dependency));
    const delayed=spawnSync(path.resolve(renderer),[roms],{input:`${file}\t1\t2\n${file}\t1\t8\n`,encoding:"utf8",timeout:120000});
    if(delayed.status!==0)throw new Error(`Delayed regression failed: ${delayed.stderr}`);
    const [short,long]=delayed.stdout.trim().split("\n").map(line=>JSON.parse(line) as Execution);
    if(!short?.matrix||!long?.matrix)throw new Error("Missing delayed matrix");
    if (!["identical-in-window","pcm-difference-with-similar-write-sequence"].includes(evidence(short)))
      throw new Error(`Old methodology already detects stimulus: ${evidence(short)}`);
    for(let mask=0;mask<8;mask++) {
      const before=short.matrix[mask]!,after=long.matrix[mask]!;
      if(before.matchingWritePrefix!==Math.min(before.sidWrites,short.both.sidWrites))throw new Error("Unexpected early value divergence");
      if((mask&dependency)!==dependency && after.matchingWritePrefix===Math.min(after.sidWrites,long.both.sidWrites))
        throw new Error(`Missed delayed dependency ${dependency} under mask ${mask}`);
      if((mask&dependency)===dependency && after.matchingWritePrefix!==Math.min(after.sidWrites,long.both.sidWrites))
        throw new Error(`Unexpected value divergence with required ROMs ${dependency}/${mask}`);
    }
    console.log(`PASS delayed mask ${dependency}: old 2s observation misses dependency; 8s detects late register changes.`);
  }
  // Dependencies that first appear well beyond the documented-length margins:
  // read at ~70s (3500 PAL frames) and compared at 65s vs 75s. A non-default
  // subtune carries the dependency in a two-subtune file; subtune 1 stays flat.
  const run=(input:string,timeout:number):Execution[]=>{
    const result=spawnSync(path.resolve(renderer),[roms],{input,encoding:"utf8",timeout});
    if(result.status!==0)throw new Error(`Native regression failed (${result.status}/${result.signal}): ${result.stderr}`);
    return result.stdout.trim().split("\n").map(line=>JSON.parse(line) as Execution);
  };
  const matches=(m:Execution["both"],reference:Execution["both"]):boolean=>
    m.matchingWritePrefix===Math.min(m.sidWrites,reference.sidWrites)&&m.sidWrites===reference.sidWrites;
  for (const dependency of [1,2,4,7]) {
    const file=path.join(temp,`late-${dependency}.sid`);await writeFile(file,delayedRomFixture(dependency,{frames:3500,songs:2,dependentSong:2}));
    const [flat,early,late,beforeLate]=run(`${file}\t1\t75\n${file}\t2\t65\n${file}\t2\t75\n${file}\t2\t69\n`,1200000);
    if(!flat?.matrix||!early?.matrix||!late?.matrix||!beforeLate?.matrix)throw new Error("Missing late-dependency matrix");
    for(let mask=0;mask<8;mask++) {
      const missing=(mask&dependency)!==dependency;
      if(!matches(flat.matrix[mask]!,flat.both))throw new Error(`Subtune 1 must not depend on ROMs (mask ${mask})`);
      if(!matches(early.matrix[mask]!,early.both)||!matches(beforeLate.matrix[mask]!,beforeLate.both))
        throw new Error(`Dependency ${dependency} visible before its 70s trigger (mask ${mask})`);
      if(missing===matches(late.matrix[mask]!,late.both))
        throw new Error(`Late dependency ${dependency} misclassified under mask ${mask} at 75s`);
    }
    console.log(`PASS late dependency ${dependency}: invisible at 65s and 69s, detected at 75s, subtune 1 independent.`);
  }
  // Native input protocol: path and hex payload must be interchangeable, the
  // payload must win over a deleted or retargeted label path, and malformed or
  // trailing fields must fail the worker instead of producing a result.
  const sample=path.join(temp,"protocol.sid"),bytes=delayedRomFixture(1,{frames:50});await writeFile(sample,bytes);
  const [byPath,byPayload,byGhost]=run(`${sample}\t1\t3\n${sample}\t1\t3\thex:${bytes.toString("hex")}\n/nonexistent/deleted.sid\t1\t3\thex:${bytes.toString("hex")}\n`,60000);
  for(const field of ["both","repeat","matrix"] as const)
    if(JSON.stringify(byPath![field])!==JSON.stringify(byPayload![field])||JSON.stringify(byPath![field])!==JSON.stringify(byGhost![field]))
      throw new Error(`Path/payload equivalence failed for ${field}`);
  const hex=bytes.toString("hex");
  for(const bad of [`${sample}\t1\t3\thex:${hex}\textra\n`,`${sample}\t1\t3\thex:${hex.slice(0,-1)}\n`,`${sample}\t1\t3\thex:zz\n`,
    `${sample}\t1\t3\tdata:${hex}\n`,`${sample}\t1x\t3\n`,`${sample}\t1\t3s\n`,`${sample}\t0\t3\n`,`${sample}\t1\t0\n`,`${sample}\t1\t3601\n`,`${sample}\t1\n`,
    `\t1\t3\thex:${hex}\n`,`${sample}\t1\t3\thex:${"00".repeat(1024*1024+1)}\n`]) {
    const result=spawnSync(path.resolve(renderer),[roms],{input:bad,encoding:"utf8",timeout:60000});
    if(result.status===0||result.stdout.trim())throw new Error(`Malformed protocol record accepted: ${JSON.stringify(bad.slice(0,60))}`);
  }
  const garbage=run(`${sample}\t1\t3\thex:\n`,60000)[0]!;
  if(!garbage.both.error||garbage.matrix!.some(m=>!m.error))throw new Error("An empty payload must be reported as a render error in every experiment");
  console.log("PASS native protocol: path/payload equivalence, deleted label path, malformed and trailing fields rejected.");
  console.log("PASS PAL, NTSC, RSID busy-loop and Justincase buffer boundary; all configurations complete; repeated references identical.");
} finally {await rm(temp,{recursive:true,force:true});}
