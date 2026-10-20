#!/usr/bin/env bun
/** PCM pull regression using synthetic fixtures and a required local HVSC input.
 * Run against the AddressSanitizer binary to catch engine heap writes, not just
 * whether a process happens to survive allocator padding.
 * bun scripts/rom-audit/native-regression.ts <renderer> <ROM dir> <HVSC root>
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const actual=path.resolve(hvsc,"MUSICIANS/A/Andy/Justincase_part_6.sid");
  // The actual failure involves raster/CPU scheduling; the simpler synthetic
  // stimuli above alone do not reproduce it. Require the real regression input.
  jobs.push(`${actual}\t1\t2\n`);
  const result=spawnSync(path.resolve(renderer),[roms],{input:jobs.join(""),encoding:"utf8",timeout:60000});
  if (result.status!==0) throw new Error(`Native buffer regression failed (${result.status}/${result.signal}): ${result.error?.stack??""}\n${result.stderr}`);
  const rows=result.stdout.trim().split("\n").map((line)=>JSON.parse(line) as Execution);
  if (rows.length!==4) throw new Error("Missing PAL/NTSC/busy-loop/Justincase results");
  for (const row of rows) {
    for (const key of ["both","repeat","neither","kernal","basic"] as const)
      if (row[key].error || row[key].samples!==32000) throw new Error(`Incomplete ${row.path} ${key}`);
    if (!row.repeat.equal) throw new Error(`Unstable repeated reference ${row.path}`);
  }
  console.log("PASS PAL, NTSC, RSID busy-loop and Justincase buffer boundary; all configurations complete; repeated references identical.");
} finally {await rm(temp,{recursive:true,force:true});}
