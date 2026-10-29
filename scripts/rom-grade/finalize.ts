/** Finalization of a grading run: grading-results.jsonl (schema sidflow-rom-grading-results-1, read by the sidromdep generator)
 * and a gzipped full-detail export for research.
 *
 *   bun scripts/rom-grade/finalize.ts <output dir> [--allow-partial] [--declare-scope]
 *
 * Refuses when the checkpoint is incomplete for the full HVSC #85 scope, was written under a different methodology identity, or contains
 * an unmeasured lane. --allow-partial writes what exists but keeps the full-HVSC counts in the header, so the consumer reports it as
 * incomplete. --declare-scope (validation only) writes a self-consistent header for the graded subset and marks the profile. */
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { REFERENCE_ROM_SHA256, romSetId } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { fullScope } from "./full-scope.js";
import { frozenOptions, methodologyIdentity } from "./methodology-id.js";
import type { PoolRecord } from "./pool.js";
import { LANE_FIELDS, laneGrades } from "./summary.js";

export const RESULTS_SCHEMA = "sidflow-rom-grading-results-1";
export interface FinalizeOptions { allowPartial: boolean; declareScope: boolean }

export async function finalize(out: string, options: FinalizeOptions): Promise<{ rows: number; complete: boolean; resultsFile: string }> {
  const identity = await methodologyIdentity();
  const scope = await fullScope();
  const sidecar = JSON.parse(readFileSync(path.join(out, "scope.json"), "utf8")) as { corpusId: string; maxJobs: number | null };
  if (sidecar.corpusId !== scope.corpusId) throw new Error("Output directory was produced for a different HVSC corpus");
  const md5BySha = new Map(scope.jobs.map(j => [j.sha256, j.md5]));
  const lines: Array<{ md5: string; song: number; grades: Record<string, number>; research: string }> = [];
  const seen = new Set<string>();
  let first = true;
  for await (const line of createInterface({ input: createReadStream(path.join(out, "checkpoint.jsonl"), { encoding: "utf8" }), crlfDelay: Infinity })) {
    if (!line) continue;
    if (first) {
      first = false;
      const header = JSON.parse(line) as { identity: string | null };
      if (header.identity !== identity.id) throw new Error(`Checkpoint methodology ${header.identity} differs from the current ${identity.id}`);
      continue;
    }
    const record = JSON.parse(line) as PoolRecord;
    const md5 = md5BySha.get(record.grade.sha256);
    if (!md5) throw new Error(`Checkpoint record ${record.key} is not in the HVSC scope`);
    if (seen.has(record.key)) throw new Error(`Duplicate checkpoint record ${record.key}`);
    seen.add(record.key);
    const g = laneGrades(record), grades: Record<string, number> = {};
    for (const lane of LANE_FIELDS) { if (g[lane] === null) throw new Error(`Unmeasured lane ${lane} in ${record.key}`); grades[lane] = g[lane]!; }
    lines.push({ md5, song: record.grade.song, grades, research: JSON.stringify({ md5, song: record.grade.song, grade: record.grade, jsCpuSeconds: record.jsCpuSeconds }) });
  }
  const complete = lines.length === scope.subtunes && scope.jobs.every(j => seen.has(`${j.sha256}#${j.song}`));
  if (!complete && !options.allowPartial && !options.declareScope) throw new Error(`Grading incomplete: ${lines.length} of ${scope.subtunes} subtunes graded`);
  lines.sort((a, b) => a.md5 < b.md5 ? -1 : a.md5 > b.md5 ? 1 : a.song - b.song);
  const declared = options.declareScope && !complete;
  const files = declared ? new Set(lines.map(l => l.md5)).size : scope.files, subtunes = declared ? lines.length : scope.subtunes;
  const header = {
    record: "header", schema: RESULTS_SCHEMA, methodologyId: identity.id, hvscRelease: 85, corpusId: scope.corpusId, songlengthsSha256: scope.songlengthsSha256, files, subtunes,
    profile: {
      romSetId: romSetId(), romSha256: REFERENCE_ROM_SHA256, engines: ["sidlite", "residfp"], lanes: ["none", "kernal+basic"], frozen: frozenOptions(), binaries: identity.binaries,
      scope: complete ? "full" : declared ? "declared-bounded-validation-only" : "partial", gradedSubtunes: lines.length,
    },
  };
  const resultsFile = path.join(out, "grading-results.jsonl");
  writeFileSync(resultsFile, [JSON.stringify(header), ...lines.map(l => JSON.stringify({ record: "grade", md5: l.md5, song: l.song, methodologyId: identity.id, grades: l.grades }))].join("\n") + "\n");
  const gz = createGzip({ level: 9 }), sink = createWriteStream(path.join(out, "research-export.jsonl.gz"));
  gz.pipe(sink);
  gz.write(JSON.stringify({ record: "header", schema: "sidflow-rom-grading-research-1", methodologyId: identity.id, methodology: identity, corpusId: scope.corpusId, subtunes: lines.length }) + "\n");
  for (const l of lines) if (!gz.write(l.research + "\n")) await once(gz, "drain");
  gz.end();
  await once(sink, "close");
  console.error(`finalized ${lines.length} subtunes (${complete ? "complete" : "partial"}) -> ${resultsFile}`);
  return { rows: lines.length, complete, resultsFile };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: finalize.ts <output dir> [--allow-partial] [--declare-scope]");
  await finalize(path.resolve(out), { allowPartial: process.argv.includes("--allow-partial"), declareScope: process.argv.includes("--declare-scope") });
}
