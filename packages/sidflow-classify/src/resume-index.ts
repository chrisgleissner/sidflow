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

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { pathExists } from "@sidflow/common";

/**
 * Read by pattern rather than `JSON.parse`, and streamed rather than read whole.
 *
 * The first version read the file and JSON.parse'd every line to check integrity. That works
 * at 30,000 records and fails at 84,000: the file is ~380 MB, so readFile plus split("\n")
 * allocates it twice over before a single record is examined, and the parse allocates 84,000
 * objects of 131 fields each. The classify process then died with "RangeError: Out of memory"
 * BEFORE CLASSIFYING ANYTHING -- the resume index had become the thing preventing the resume.
 *
 * So it streams in fixed-size chunks, never holds more than one line, and tests integrity by
 * pattern over that line. Memory is constant in the size of the corpus.
 *
 * The path pattern tolerates backslash escapes so a filename containing a quote cannot
 * truncate the match and silently produce a key that matches nothing.
 */
const SID_PATH_PATTERN = /"sid_path":"((?:[^"\\]|\\.)*)"/;
const SONG_INDEX_PATTERN = /"song_index":(\d+)/;
const TRACE_EVENT_PATTERN = /"sidTraceEventCount":(\d+)/;

/**
 * Decode the JSON string capture without parsing the feature payload.
 *
 * Returns the reason on failure rather than just null, because the caller drops the
 * record and a dropped record means that song is reclassified. That is the safe
 * direction, but it must not be silent: on an 87,868-line features file a systematically
 * undecodable path would quietly shrink the resume index and re-render the corpus.
 */
function decodeSidPath(escapedPath: string): { path: string } | { error: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse("\"" + escapedPath + "\"");
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return typeof decoded === "string" ? { path: decoded } : { error: `decoded to ${typeof decoded}` };
}

/**
 * Dimensions that cannot all be zero at once when the trace holds events.
 *
 * `sidSilentFrameRatio` is deliberately absent: the empty default sets it to 1, so including
 * it would make every empty record look as though it held one real value.
 */
const PLAYROUTINE_EVIDENCE_KEYS = [
  "sidWritesPerFrame", "sidMultiSpeedRatio", "sidWriteShareFrequency", "sidWriteSharePulseWidth",
  "sidWriteShareControl", "sidWriteShareEnvelope", "sidWriteShareFilter", "sidWriteShareVolume",
  "sidWriteSpreadEntropy", "sidWriteRateRegularity", "sidVoiceCount1Ratio", "sidVoiceCount2Ratio",
  "sidVoiceCount3Ratio", "sidVoiceCountVariation", "sidWriteFramePositionMean",
  "sidWriteFramePositionSpread", "sidWriteRedundantRatio", "sidWriteRegisterCoverage",
  "sidWriteOrderEntropy", "sidWriteVoice1Share", "sidWriteVoice2Share", "sidWriteVoice3Share",
] as const;

/**
 * True when the record contradicts itself and should be reclassified.
 *
 * Tested against the raw line so no object is allocated. A dimension counts as zero only when
 * serialised as exactly `0`; anything else, including `0.0001`, is evidence of real data.
 */
function lineIsUnsound(line: string): boolean {
  const traceMatch = TRACE_EVENT_PATTERN.exec(line);
  if (traceMatch && Number.parseInt(traceMatch[1]!, 10) > 0) {
    let allZero = true;
    for (const key of PLAYROUTINE_EVIDENCE_KEYS) {
      if (!line.includes(`"${key}":0,`) && !line.includes(`"${key}":0}`)) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      return true;
    }
  }
  // NaN detection is deliberately NOT done here. A blanket search for ":null" flags every
  // record, because legitimate fields serialise as null -- "manual_ratings":null among them --
  // and that made this index return zero keys on a real 84,095-record corpus, i.e. a resume
  // that silently reclassified the entire corpus. Non-finite values are caught by the live
  // integrity assertion during classification, which has the parsed record and can tell a
  // null feature from a null anything-else.
  return false;
}

/** Streams one file, calling `onLine` per complete line. Never holds the whole file. */
async function forEachLine(filePath: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 1 << 20 });
    let pending = "";
    stream.on("data", (chunk: string | Buffer) => {
      pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let newlineAt = pending.indexOf("\n");
      while (newlineAt !== -1) {
        onLine(pending.slice(0, newlineAt));
        pending = pending.slice(newlineAt + 1);
        newlineAt = pending.indexOf("\n");
      }
    });
    // A truncated final line is what a crash leaves behind, and it is deliberately dropped:
    // an incomplete record is not done, so omitting it makes the resume reclassify it.
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
}

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
  let undecodable = 0;
  let firstUndecodable: string | null = null;
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
    await forEachLine(path.join(classifiedPath, name), (line) => {
      if (!line) {
        return;
      }
      const pathMatch = SID_PATH_PATTERN.exec(line);
      if (!pathMatch) {
        return;
      }

      // Self-healing: an unsound record counts as NOT done, so a rerun reclassifies it.
      // Without this a resume would faithfully carry forward the records a bug produced.
      if (lineIsUnsound(line)) {
        unsound += 1;
        return;
      }

      const decoded = decodeSidPath(pathMatch[1]!);
      if ("error" in decoded) {
        undecodable += 1;
        if (firstUndecodable === null) {
          firstUndecodable = `${name}: ${pathMatch[1]!} (${decoded.error})`;
        }
        return;
      }
      const songMatch = SONG_INDEX_PATTERN.exec(line);
      keys.add(resumeKeyFor(decoded.path, songMatch ? Number.parseInt(songMatch[1]!, 10) : undefined));
    });
  }

  if (unsound > 0) {
    process.stderr.write(
      `[classify-resume] ${unsound} previously classified record(s) failed the integrity`
      + " check and will be reclassified\n",
    );
  }

  if (undecodable > 0) {
    process.stderr.write(
      `[classify-resume] ${undecodable} record(s) have a sid_path that could not be decoded and`
      + ` will be reclassified; first: ${firstUndecodable}\n`,
    );
  }

  return keys;
}
