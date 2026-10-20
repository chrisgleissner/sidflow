#!/usr/bin/env bun
/** Run each case in a fresh process: a corrupted engine must not seed another check.
 * check-large-pulls.ts <package dir> <HVSC> <ROM dir>
 */
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [packageDir, hvsc, roms, rateArg, engineArg, pullArg] = process.argv.slice(2);
if (!packageDir || !hvsc || !roms) throw new Error("Expected package directory, HVSC root and ROM directory");
if (!rateArg) {
  for (const rate of [8000, 48000]) for (const engine of ["sidlite", "residfp"]) for (const pull of [256, 100000]) {
    const result = spawnSync(process.execPath, [import.meta.path, packageDir, hvsc, roms, String(rate), engine, String(pull)],
      { encoding: "utf8", timeout: 60000 });
    console.log(JSON.stringify({ rate, engine, pull, status: result.status, signal: result.signal,
      error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr }));
  }
} else {
  const library = await import(pathToFileURL(path.resolve(packageDir, "dist/index.js")).href);
  const player = new library.SidAudioEngine({engine: engineArg, sampleRate: Number(rateArg), stereo: true});
  try {
    const rom = async (name: string): Promise<Uint8Array> => new Uint8Array(await readFile(path.join(roms, name)));
    await player.setSystemROMs(await rom("kernal.901227-03.bin"), await rom("basic.901226-01.bin"), await rom("characters.901225-01.bin"));
    await player.loadSidBuffer(new Uint8Array(await readFile(path.join(hvsc, "MUSICIANS/A/Andy/Justincase_part_6.sid"))), 0);
    await player.setEmulationConfig({powerOnDelay: 5000});
    const pcm = await player.renderSeconds(2, Number(pullArg));
    console.log(JSON.stringify({packageVersion: library.PACKAGE_VERSION, libraryVersion: library.LIBSIDPLAYFP_VERSION,
      samples: pcm.length, sha256: createHash("sha256").update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest("hex")}));
  } finally { player.dispose(); }
}
