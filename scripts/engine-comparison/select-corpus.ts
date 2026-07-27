#!/usr/bin/env bun
/**
 * Pick a reproducible, diverse subset of HVSC for the engine comparison.
 *
 * Systematic sampling over the lexicographically sorted corpus: sort every .sid
 * path, then take every (N/k)-th entry. HVSC's directory layout is
 * category/artist/tune, so a sorted walk is already ordered by category and then
 * by artist — sampling it at a fixed stride therefore spreads the selection
 * across every category and a wide range of artists, without anyone choosing
 * which tunes are "interesting".
 *
 * That last point is the reason for this method rather than a hand-picked or
 * trait-weighted set: the comparison is supposed to measure how two engines
 * differ on ordinary HVSC material. Over-sampling the pathological cases would
 * make SIDLite look worse than it is in practice, and picking favourites would
 * make it look better. A fixed stride is defensible because it is decided before
 * anything is measured and cannot be tuned afterwards.
 *
 * Deterministic: same HVSC, same output, no RNG.
 *
 *   bun run scripts/engine-comparison/select-corpus.ts [count] [--out <file>]
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const HVSC = process.env.SIDFLOW_HVSC ?? path.join(process.cwd(), "workspace/hvsc/C64Music");
const count = Number.parseInt(process.argv[2] ?? "500", 10);
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > 0 ? process.argv[outIndex + 1]! : "scripts/engine-comparison/corpus-500.json";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.toLowerCase().endsWith(".sid")) out.push(full);
  }
  return out;
}

/** Header traits, reported so the selection's diversity is auditable. */
function traitsOf(file: string): { chips: number; kind: string; basic: boolean; songs: number } | null {
  let header: Buffer;
  try {
    header = readFileSync(file).subarray(0, 0x80);
  } catch {
    return null;
  }
  if (header.length < 0x76) return null;
  const magic = header.subarray(0, 4).toString("latin1");
  if (magic !== "PSID" && magic !== "RSID") return null;

  const version = header.readUInt16BE(4);
  const songs = header.readUInt16BE(0x0e);
  const flags = version >= 2 && header.length >= 0x78 ? header.readUInt16BE(0x76) : 0;
  const second = version >= 3 && header.length > 0x7a ? header[0x7a]! : 0;
  const third = version >= 4 && header.length > 0x7b ? header[0x7b]! : 0;

  return {
    chips: 1 + (second ? 1 : 0) + (third ? 1 : 0),
    kind: magic,
    basic: magic === "RSID" && (flags & 0x02) !== 0,
    songs,
  };
}

const all = walk(HVSC);
if (all.length === 0) {
  process.stderr.write(`No SID files under ${HVSC}\n`);
  process.exit(1);
}

const stride = all.length / count;
const selected: string[] = [];
for (let i = 0; i < count; i++) {
  // Sample at the middle of each stride bucket so the selection does not cling
  // to the first entry of every directory.
  const index = Math.min(all.length - 1, Math.floor((i + 0.5) * stride));
  selected.push(all[index]!);
}

const unique = [...new Set(selected)];

const composition: Record<string, number> = {};
const traitCounts: Record<string, number> = {};
for (const file of unique) {
  const rel = path.relative(HVSC, file);
  const category = rel.split(path.sep)[0] ?? "?";
  composition[category] = (composition[category] ?? 0) + 1;

  const traits = traitsOf(file);
  if (!traits) continue;
  traitCounts[traits.kind] = (traitCounts[traits.kind] ?? 0) + 1;
  if (traits.chips > 1) traitCounts[`${traits.chips}SID`] = (traitCounts[`${traits.chips}SID`] ?? 0) + 1;
  if (traits.basic) traitCounts["RSID+BASIC"] = (traitCounts["RSID+BASIC"] ?? 0) + 1;
  if (traits.songs >= 8) traitCounts["subsongs>=8"] = (traitCounts["subsongs>=8"] ?? 0) + 1;
}

const manifest = {
  generatedFrom: path.relative(process.cwd(), HVSC),
  corpusSize: all.length,
  requested: count,
  selected: unique.length,
  method: "systematic sampling of the lexicographically sorted corpus (fixed stride, no RNG)",
  composition,
  traits: traitCounts,
  files: unique.map((file) => path.relative(HVSC, file)).sort(),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`corpus: ${all.length} SID files -> selected ${unique.length}\n`);
process.stdout.write(`categories: ${JSON.stringify(composition)}\n`);
process.stdout.write(`traits: ${JSON.stringify(traitCounts)}\n`);
process.stdout.write(`written: ${outPath}\n`);
