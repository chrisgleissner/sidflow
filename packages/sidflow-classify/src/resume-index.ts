/**
 * Which songs a previous, unfinished run of this corpus already extracted.
 *
 * Classification over a full corpus does not reliably reach the end. Observed three
 * times on one HVSC pass, at 31,626, 50,221 and 55,625 of 87,868 tracks: a fresh WASM
 * instantiation fails with `RangeError: Out of memory`, then Bun segfaults. Peak RSS was
 * 3.5 GB on a 62 GB machine, so the host is not short of memory.
 *
 * The mechanism is NOT established. The obvious suspect — the render pool's job-timeout
 * safety net terminating and replacing workers, each replacement instantiating another
 * module — is ruled out by the logs: zero job timeouts and zero worker exits were
 * recorded across a pass that crashed three times. What is established is that it
 * happens, that it happens sooner with more threads, and that it happens later in a pass
 * rather than at a fixed track count.
 *
 * Whatever the cause, re-rendering 87,868 tracks to recover from it is hours of wasted
 * work, so a resume has to know what is already done.
 *
 * The auto-tags cannot answer that. They are written when a run FINISHES, so a run that
 * dies partway leaves none at all: the pass above had written 144 MB of feature records
 * and zero tag files. The features JSONL is the artifact written incrementally, so it is
 * the only usable record of progress.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "@sidflow/common";

import { isFeatureRecordSound } from "./feature-integrity.js";
import type { FeatureVector } from "./index.js";

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
  let unsound = 0;
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

      // Self-healing: an unsound record is treated as NOT done, so a rerun reclassifies
      // it rather than preserving it forever. Without this, a resume would faithfully
      // carry forward the very records a bug produced -- which is how 16,398 records with
      // an empty playroutine vector would have survived every subsequent run.
      //
      // Parsed rather than pattern-matched, because soundness depends on the relationship
      // between fields and cannot be read off one of them.
      let sound = true;
      try {
        const record = JSON.parse(line) as { features?: FeatureVector };
        if (record.features) {
          sound = isFeatureRecordSound(record.features);
        }
      } catch {
        // A truncated final line is what a crash leaves behind; treat it as not done.
        sound = false;
      }
      if (!sound) {
        unsound += 1;
        continue;
      }

      keys.add(resumeKeyFor(pathMatch[1]!, songMatch ? Number.parseInt(songMatch[1]!, 10) : undefined));
    }
  }

  if (unsound > 0) {
    process.stderr.write(
      `[classify-resume] ${unsound} previously classified record(s) failed the integrity`
      + " check and will be reclassified\n",
    );
  }

  return keys;
}
