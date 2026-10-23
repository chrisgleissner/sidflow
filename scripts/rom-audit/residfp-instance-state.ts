#!/usr/bin/env bun
/**
 * Reproduction for an upstream report (not yet filed): in `libsidplayfp-wasm` 1.1.0 a second player created in
 * the SAME reSIDfp WASM instance renders different PCM from the first for identical input, while the SID write
 * traces are equal. A fresh instance reproduces the first player's PCM. SIDLite is unaffected.
 *   bun scripts/rom-audit/residfp-instance-state.ts <ROM directory> <Commando.sid>
 */
import { readFileSync } from "node:fs";
import { loadRoms } from "./census-worker.js";
import { loadModule } from "./wasm-lanes.js";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";

const [romDirectory, sidFile] = process.argv.slice(2);
if (!romDirectory || !sidFile) throw new Error("Usage: residfp-instance-state.ts <ROM directory> <file.sid>");
const roms = loadRoms(romDirectory), bytes = new Uint8Array(readFileSync(sidFile));
async function play(engine: RomAuditEngine, shared?: Awaited<ReturnType<typeof loadModule>>): Promise<{ pcm: number[]; writes: number[]; module: Awaited<ReturnType<typeof loadModule>> }> {
  const module = shared ?? await loadModule(engine), ctx = new module.SidPlayerContext() as unknown as {
    configure(r: number, s: boolean): boolean; setSidWriteTraceEnabled(b: boolean): void; setSystemROMs(k: Uint8Array, b: Uint8Array, c: Uint8Array): boolean;
    loadSidBuffer(b: Uint8Array): boolean; reset(): boolean; render(c: number): Int16Array; getAndClearSidWriteTracesPacked(): Float64Array; delete(): void };
  ctx.configure(48000, true); ctx.setSidWriteTraceEnabled(true); ctx.setSystemROMs(roms.kernal, roms.basic, roms.chargen); ctx.loadSidBuffer(bytes); ctx.reset();
  const pcm: number[] = [], writes: number[] = [];
  for (let i = 0; i < 20; i++) { pcm.push(...ctx.render(engine === "sidlite" ? 256 : 100000)); writes.push(...ctx.getAndClearSidWriteTracesPacked()); }
  ctx.delete();
  return { pcm, writes, module };
}
const firstDifference = (a: number[], b: number[]): string => { let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++; return i === a.length && a.length === b.length ? "equal" : `first difference at sample ${i}`; };
for (const engine of ["sidlite", "residfp"] as const) {
  const first = await play(engine), second = await play(engine, first.module), fresh = await play(engine);
  console.log(`${engine}: second player in the same instance: PCM ${firstDifference(first.pcm, second.pcm)}, writes ${firstDifference(first.writes, second.writes)}; fresh instance: PCM ${firstDifference(first.pcm, fresh.pcm)}`);
}
