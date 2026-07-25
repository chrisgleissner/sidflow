#!/usr/bin/env node
// Build-time functional smoke test for the WASM artifact.
//
// String checks on the binary prove which engine was linked; they do not prove
// it renders. Two real defects would have passed a strings-only gate and been
// caught here in seconds:
//
//   * reSIDfp's filter-table threads throwing `thread constructor failed` on
//     the first tune load, so the engine never produced a sample;
//   * the old TracingSidEmu wrapper handing the mixer a stale, ever-growing
//     sample count.
//
// So: load a tune, render, and require the output to be audible and sane.
//
// Usage: node smoke-render.mjs <dist-dir> <tune.sid>

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [distDir, tunePath] = process.argv.slice(2);
if (!distDir || !tunePath) {
  console.error("usage: smoke-render.mjs <dist-dir> <tune.sid>");
  process.exit(2);
}

const SAMPLE_RATE = 48000;
const SECONDS = 3;
const CHUNK_CYCLES = 100000;

const fail = (message) => {
  console.error(`SMOKE RENDER FAILED: ${message}`);
  process.exit(1);
};

const { default: createLibsidplayfp } = await import(
  pathToFileURL(path.resolve(distDir, "libsidplayfp.js")).href
);

const mod = await createLibsidplayfp({ locateFile: (file) => path.resolve(distDir, file) });
const ctx = new mod.SidPlayerContext();

if (!ctx.configure(SAMPLE_RATE, true)) fail(`configure: ${ctx.getLastError()}`);
if (!ctx.loadSidBuffer(new Uint8Array(readFileSync(tunePath)))) fail(`loadSidBuffer: ${ctx.getLastError()}`);
ctx.selectSong(0);

const info = ctx.getEngineInfo();
console.log(`smoke render: engine=${info?.name} ${info?.version}`);

const wanted = SECONDS * SAMPLE_RATE * 2;
const samples = new Int16Array(wanted);
let have = 0;
let empties = 0;

while (have < wanted) {
  const chunk = ctx.render(CHUNK_CYCLES);
  if (!chunk || chunk.length === 0) {
    if (++empties > 64) fail(`engine stopped producing samples after ${(have / 2 / SAMPLE_RATE).toFixed(2)}s`);
    continue;
  }
  empties = 0;
  const take = Math.min(chunk.length, wanted - have);
  samples.set(chunk.subarray(0, take), have);
  have += take;
}

let sum = 0;
let sumSquares = 0;
let peak = 0;
for (let i = 0; i < have; i++) {
  const value = samples[i] / 32768;
  sum += value;
  sumSquares += value * value;
  if (Math.abs(value) > peak) peak = Math.abs(value);
}
const dc = sum / have;
const rms = Math.sqrt(sumSquares / have);

console.log(`smoke render: rms=${rms.toFixed(4)} peak=${peak.toFixed(4)} dc=${dc.toFixed(4)}`);

// A working engine on a real tune is audible, does not clip, and — because no
// C64 audio path emits DC — sits close to zero. The SIDLite artifact this build
// replaced measured dc=+0.17, which is what makes the DC bound worth asserting.
if (rms < 0.001) fail(`output is silent (rms ${rms.toFixed(6)})`);
if (peak >= 0.999) fail(`output clips (peak ${peak.toFixed(4)})`);
if (Math.abs(dc) > 0.02) fail(`output carries a DC offset of ${dc.toFixed(4)} (expected |DC| < 0.02)`);

console.log("smoke render: ok");
