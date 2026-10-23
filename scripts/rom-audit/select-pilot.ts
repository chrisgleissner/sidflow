#!/usr/bin/env bun
/**
 * Deterministic, stratified hardening-pilot selection. The pilot exists to expose
 * methodology bugs on a small, diverse corpus before any broad rollout, so the
 * strata deliberately over-sample unusual compositions. Ordering inside each
 * stratum is by SHA-256 of "path#song", so the selection is reproducible.
 *   bun scripts/rom-audit/select-pilot.ts <C64Music> <selection.json>
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { releaseLengths } from "./inputs.js";
import { observationHorizon } from "./methodology.js";

interface Candidate { path: string; song: number; songs: number; start: number; magic: string; basic: boolean; sids: number; token: string | undefined; required: number; readsOsc3: boolean }
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const order = (c: { path: string; song: number }): string => createHash("sha256").update(`${c.path}#${c.song}`).digest("hex");

export const QUOTAS = { rsidBasic: 40, rsidMachine: 60, psid: 120, multiSid: 40, tripleSid: 10, nonDefaultSong: 80, defaultOfMulti: 40, unknownLength: 20, longTunes: 20, osc3Readers: 60, longest: 10 } as const;

async function main(): Promise<void> {
  const [hvsc, out] = process.argv.slice(2);
  if (!hvsc || !out) throw new Error("Usage: select-pilot.ts <C64Music> <selection.json>");
  const lengths = releaseLengths((await readFile(path.join(hvsc, "DOCUMENTS/Songlengths.md5"), "utf8")).replace(/\r/g, ""));
  const files = (await readdir(hvsc, { recursive: true, withFileTypes: true })).filter(e => e.isFile() && e.name.toLowerCase().endsWith(".sid"))
    .map(e => path.relative(hvsc, path.join(e.parentPath, e.name))).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const all: Candidate[] = [];
  for (const file of files) {
    const bytes = await readFile(path.join(hvsc, file)), fields = checkSidHeader(bytes).fields;
    if (!fields) throw new Error(`Invalid header ${file}`);
    // Static lower bound: absolute LDA/LDX/LDY/CMP/BIT of $D41B or $D41C (OSC3/ENV3 feedback registers).
    const readsOsc3 = /[\xad\xae\xac\xcd\x2c][\x1b\x1c]\xd4/.test(bytes.toString("latin1"));
    const tokens = lengths.get(file)?.tokens ?? [];
    for (let song = 1; song <= fields.songs; song++) {
      const horizon = observationHorizon(tokens[song - 1], 10);
      all.push({ path: file, song, songs: fields.songs, start: fields.startSong, magic: fields.magic, basic: fields.magic === "RSID" && !!((fields.flags ?? 0) & 2),
        sids: 1 + (fields.secondSidAddress ? 1 : 0) + (fields.thirdSidAddress ? 1 : 0), token: tokens[song - 1], required: horizon.seconds, readsOsc3 });
    }
  }
  const chosen = new Map<string, Candidate>();
  const take = (name: string, pool: Candidate[], quota: number): void => {
    let added = 0;
    for (const candidate of [...pool].sort((a, b) => order(a).localeCompare(order(b)))) {
      if (added >= quota) break;
      const key = `${candidate.path}#${candidate.song}`;
      if (chosen.has(key)) continue;
      chosen.set(key, candidate); added++;
    }
    console.log(`${name}: ${added}/${quota}`);
  };
  // Historical and named controls first: they are the known ROM-sensitive cases.
  for (const selectionFile of ["notable-selection.json", "extended-selection.json"]) {
    const entries = JSON.parse(await readFile(path.join(scriptDir, selectionFile), "utf8")) as { path: string; song: number }[];
    take(selectionFile, entries.map(e => all.find(c => c.path === e.path && c.song === e.song)).filter((c): c is Candidate => !!c), entries.length);
  }
  take("named controls", all.filter(c => /(Justincase_part_6|Great_Giana_Sisters|Commando|Arkanoid|Polonaise_BASIC|128_Byte_Blues_BASIC|Tusari|Phat_Frog_2SID)\.sid$/.test(c.path) && c.song <= 2), 40);
  take("RSID BASIC", all.filter(c => c.basic && c.required <= 400), QUOTAS.rsidBasic);
  take("RSID machine code", all.filter(c => c.magic === "RSID" && !c.basic && c.required <= 400), QUOTAS.rsidMachine);
  take("PSID", all.filter(c => c.magic === "PSID" && c.sids === 1 && c.required <= 400), QUOTAS.psid);
  take("2-SID", all.filter(c => c.sids === 2 && c.required <= 400), QUOTAS.multiSid);
  take("3-SID", all.filter(c => c.sids === 3 && c.required <= 400), QUOTAS.tripleSid);
  take("non-default subtune", all.filter(c => c.songs > 1 && c.song !== c.start && c.required <= 400), QUOTAS.nonDefaultSong);
  take("start subtune of multi-song files", all.filter(c => c.songs > 1 && c.song === c.start && c.required <= 400), QUOTAS.defaultOfMulti);
  take("unknown or invalid length", all.filter(c => observationHorizon(c.token, 10).documentedSeconds === null), QUOTAS.unknownLength);
  take("static OSC3/ENV3 readers", all.filter(c => c.readsOsc3 && c.required <= 400), QUOTAS.osc3Readers);
  take("longest horizons", all.filter(c => c.required > 1500), QUOTAS.longest);
  take("long compositions (>300s required)", all.filter(c => c.required > 300 && c.required <= 700 && observationHorizon(c.token, 10).documentedSeconds !== null), QUOTAS.longTunes);
  const selection = [...chosen.values()].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)) || a.song - b.song).map(c => ({ path: c.path, song: c.song }));
  await writeFile(out, stringifyDeterministic(selection as unknown as JsonValue));
  console.log(`Selected ${selection.length} subtunes / ${new Set(selection.map(s => s.path)).size} files; ${selection.reduce((n, s) => n + all.find(c => c.path === s.path && c.song === s.song)!.required, 0).toFixed(0)} required seconds.`);
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
