#!/usr/bin/env bun
/**
 * Select a development corpus: whole HVSC groups, drawn uniformly at random.
 *
 * ## Why not the whole collection
 *
 * The optimisation loop does not need all ~87k tracks. Every quantity it
 * estimates is a per-seed mean, and the width of those confidence intervals is
 * governed by the number of SEEDS, not by corpus size — so a corpus of ~11k
 * tracks already gives intervals far tighter than the effects being chased,
 * while classifying in a bit over an hour instead of most of a day. The full
 * collection is classified once, at the end, with whatever configuration wins.
 *
 * ## Why whole groups
 *
 * The ground-truth label is the HVSC group (MUSICIANS/<composer>,
 * GAMES/<production>). Sampling individual .sid files would strand most
 * composers with a single tune and destroy the very structure being measured —
 * there would be nothing to retrieve. Taking whole groups keeps "several tunes
 * per composer" intact.
 *
 * ## Why uniformly at random, and why that is not the same as "systematically"
 *
 * Sampling whole groups uniformly gives every track an equal inclusion
 * probability (a track is in iff its group is in, and groups are equiprobable),
 * so the sample preserves the corpus's group-SIZE distribution — prolific
 * composers stay prolific and one-tune composers stay one-tune. That matters
 * because the protocol has a cold-start guardrail: a corpus of only prolific
 * composers would make the rare-group metric unmeasurable.
 *
 * This deliberately differs from scripts/engine-comparison/select-corpus.ts,
 * which samples the sorted file list at a fixed stride. A stride is right for
 * comparing two renderers on ordinary material, but it lands on unrelated tunes
 * and leaves almost no same-group pairs, so it cannot support retrieval
 * measurement at all.
 *
 * Ordering uses the same salted, avalanche-finalised hash as
 * techniques.subsampleByGroup, so a smaller budget yields a strict subset of a
 * larger one and re-selection is stable across runs and machines.
 *
 *   bun run scripts/station-quality/select-dev-corpus.ts [files] [--out <file>]
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { saltedHash } from "./techniques.js";

const HVSC = process.env.SIDFLOW_HVSC ?? path.join(process.cwd(), "workspace/hvsc/C64Music");
const budget = Number.parseInt(process.argv[2] ?? "8000", 10);
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex > 0 ? process.argv[outIndex + 1]! : "scripts/station-quality/dev-corpus.json";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.toLowerCase().endsWith(".sid")) out.push(full);
  }
  return out;
}

/** Same rule the metrics use: <TREE>/<letter>/<name>. */
function groupOf(relative: string): string | null {
  const parts = relative.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "MUSICIANS" || p === "GAMES" || p === "DEMOS");
  if (idx < 0 || parts.length < idx + 3) return null;
  return parts.slice(idx, idx + 3).join("/");
}

const absolute = walk(HVSC);
const relative = absolute.map((p) => path.relative(HVSC, p));

const groups = new Map<string, string[]>();
let ungrouped = 0;
for (const rel of relative) {
  const g = groupOf(rel);
  if (!g) {
    ungrouped++;
    continue;
  }
  groups.set(g, [...(groups.get(g) ?? []), rel]);
}

const ordered = [...groups.entries()].sort(
  (a, b) => saltedHash(a[0]) - saltedHash(b[0]) || a[0].localeCompare(b[0]),
);

const files: string[] = [];
const chosen: string[] = [];
for (const [group, members] of ordered) {
  if (files.length + members.length > budget) break;
  files.push(...members);
  chosen.push(group);
}

const composition: Record<string, number> = {};
for (const rel of files) {
  const tree = groupOf(rel)!.split("/")[0]!;
  composition[tree] = (composition[tree] ?? 0) + 1;
}
const fullComposition: Record<string, number> = {};
for (const rel of relative) {
  const tree = groupOf(rel)?.split("/")[0] ?? "ungrouped";
  fullComposition[tree] = (fullComposition[tree] ?? 0) + 1;
}

/** Group-size histogram: proof the cold-start population survived sampling. */
function sizeHistogram(names: string[]): Record<string, number> {
  const buckets: Record<string, number> = { "1": 0, "2-3": 0, "4-7": 0, "8-15": 0, "16+": 0 };
  for (const name of names) {
    const n = groups.get(name)!.length;
    const key = n === 1 ? "1" : n <= 3 ? "2-3" : n <= 7 ? "4-7" : n <= 15 ? "8-15" : "16+";
    buckets[key]!++;
  }
  return buckets;
}

const manifest = {
  generatedFrom: path.relative(process.cwd(), HVSC),
  corpusFiles: relative.length,
  corpusGroups: groups.size,
  ungroupedFilesSkipped: ungrouped,
  requestedFiles: budget,
  selectedFiles: files.length,
  selectedGroups: chosen.length,
  method:
    "whole HVSC groups in salted-avalanche-hashed order, accumulated until the file budget; " +
    "a prefix of a randomly ordered group list, so group inclusion is equiprobable and the " +
    "sampled group-size distribution matches the corpus",
  composition,
  fullComposition,
  selectedGroupSizes: sizeHistogram(chosen),
  corpusGroupSizes: sizeHistogram([...groups.keys()]),
  files,
};

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);

const pct = (part: number, total: number) => `${((100 * part) / total).toFixed(1)}%`;
process.stdout.write(
  `HVSC: ${relative.length} files in ${groups.size} groups (${ungrouped} ungrouped files skipped)\n` +
    `selected: ${files.length} files from ${chosen.length} groups\n\n`,
);
process.stdout.write(`tree composition (sample vs corpus):\n`);
for (const tree of ["MUSICIANS", "GAMES", "DEMOS"]) {
  const s = composition[tree] ?? 0;
  const f = fullComposition[tree] ?? 0;
  process.stdout.write(
    `  ${tree.padEnd(10)} ${String(s).padStart(6)} ${pct(s, files.length).padStart(7)}   corpus ${pct(f, relative.length).padStart(7)}\n`,
  );
}
process.stdout.write(`\ngroup-size histogram (sample vs corpus, as share of groups):\n`);
for (const bucket of ["1", "2-3", "4-7", "8-15", "16+"]) {
  const s = manifest.selectedGroupSizes[bucket] ?? 0;
  const f = manifest.corpusGroupSizes[bucket] ?? 0;
  process.stdout.write(
    `  ${bucket.padEnd(6)} ${String(s).padStart(5)} ${pct(s, chosen.length).padStart(7)}   corpus ${pct(f, groups.size).padStart(7)}\n`,
  );
}
process.stdout.write(`\nwritten: ${OUT}\n`);
