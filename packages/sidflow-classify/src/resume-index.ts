/**
 * Which songs a previous, unfinished run of this corpus already extracted.
 *
 * Classification over a full corpus does not reliably reach the end: the renderer
 * replaces a worker whenever a tune fails to return inside the job timeout, each
 * replacement instantiates a fresh WASM module, and eventually instantiation fails with
 * "Out of memory" — observed at 31,626 of 87,868 HVSC tracks. Re-rendering everything to
 * recover from that is hours of wasted work, so a resume has to know what is already
 * done.
 *
 * The auto-tags cannot answer that. They are written when a run FINISHES, so a run that
 * dies partway leaves none at all: the pass above had written 144 MB of feature records
 * and zero tag files. The features JSONL is the artifact written incrementally, so it is
 * the only usable record of progress.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "@sidflow/common";

/**
 * Read by pattern rather than `JSON.parse`.
 *
 * Each record carries all 131 features and the file passes 400 MB over a full corpus,
 * while exactly two fields are needed from it. Measured at 243 ms to index 31,626
 * records from 144 MB, against several seconds to parse them.
 *
 * The path pattern tolerates backslash escapes so a filename containing a quote cannot
 * truncate the match and silently produce a key that matches nothing.
 */
const SID_PATH_PATTERN = /"sid_path":"((?:[^"\\]|\\.)*)"/;
const SONG_INDEX_PATTERN = /"song_index":(\d+)/;

/**
 * The key must be built exactly as the classifier builds a song's identity — the POSIX
 * relative path plus the song index, defaulting to 1 when a record omits it because the
 * file has a single song. Any divergence makes the index match nothing, which fails
 * quietly as a resume that re-renders everything.
 */
export function resumeKeyFor(sidPath: string, songIndex?: number): string {
  return `${sidPath}#${songIndex ?? 1}`;
}

/** Songs present in any `features_*.jsonl` under `classifiedPath`. */
export async function indexExtractedSongs(classifiedPath: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!(await pathExists(classifiedPath))) {
    return keys;
  }

  const entries = await readdir(classifiedPath, { withFileTypes: true });
  // Sorted so the set is built in a deterministic order; the result is order-independent
  // but a deterministic read order keeps any diagnostic output reproducible.
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("features_") && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();

  for (const name of files) {
    const contents = await readFile(path.join(classifiedPath, name), "utf8");
    for (const line of contents.split("\n")) {
      if (!line) {
        continue;
      }
      const pathMatch = SID_PATH_PATTERN.exec(line);
      if (!pathMatch) {
        continue;
      }
      const songMatch = SONG_INDEX_PATTERN.exec(line);
      keys.add(resumeKeyFor(pathMatch[1]!, songMatch ? Number.parseInt(songMatch[1]!, 10) : undefined));
    }
  }

  return keys;
}
