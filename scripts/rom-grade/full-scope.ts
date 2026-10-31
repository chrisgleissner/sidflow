/** The full-run scope: every HVSC #85 subtune with the identifiers the grading results file needs. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HVSC85_CORPUS } from "../rom-audit/screen-inventory.js";
import { buildInventory } from "./inventory.js";
import { nativePaths } from "./native.js";
import type { SidKind } from "./sid-info.js";

export interface ScopeJob { path: string; song: number; seconds: number; sha256: string; md5: string; kind: SidKind }
export interface Scope { jobs: ScopeJob[]; files: number; subtunes: number; corpusId: string; songlengthsSha256: string }

/** Builds the scope from the HVSC tree and verifies it is the pinned HVSC #85 corpus (content-hash identity). */
export async function fullScope(): Promise<Scope> {
  const hvsc = nativePaths().hvsc;
  const inventory = await buildInventory(hvsc);
  const corpusId = createHash("sha256").update(inventory.tunes.map(t => `${t.path}\t${t.sha256}\n`).join("")).digest("hex");
  if (corpusId !== HVSC85_CORPUS) throw new Error(`HVSC tree is not the pinned release 85 corpus (${corpusId})`);
  const songlengthsSha256 = createHash("sha256").update(await readFile(path.join(hvsc, "DOCUMENTS/Songlengths.md5"))).digest("hex");
  const jobs = inventory.tunes.flatMap(t => t.songsList.map(s => ({ path: path.join(hvsc, t.path), song: s.song, seconds: s.seconds, sha256: t.sha256, md5: t.md5, kind: t.kind })));
  return { jobs, files: inventory.tunes.length, subtunes: jobs.length, corpusId, songlengthsSha256 };
}
