/**
 * Tests for resuming a classification pass that crashed partway.
 *
 * These pin the properties that decide whether a resume works at all. A resume that
 * silently matches nothing does not fail — it re-renders the entire corpus, which on
 * HVSC is hours of wall clock, and the only symptom is that it takes as long as a fresh
 * run. So the key format and the parsing are worth pinning precisely.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { indexExtractedSongs, resumeKeyFor } from "../src/resume-index.js";

/** A feature record shaped like the real ones, which carry all 131 features. */
function record(sidPath: string, songIndex?: number): string {
  const features: Record<string, number | string> = {
    featureSetVersion: "1.5.0",
    featureVariant: "essentia",
  };
  for (let index = 0; index < 129; index += 1) {
    features[`feature${index}`] = index / 100;
  }
  const payload: Record<string, unknown> = {
    sid_path: sidPath,
    song_count: songIndex === undefined ? 1 : 4,
    queue_index: 0,
    render_engine: "wasm",
    sid_engine: "sidlite",
    features,
  };
  if (songIndex !== undefined) {
    payload.song_index = songIndex;
  }
  return JSON.stringify(payload);
}

describe("resume index", () => {
  let classifiedPath: string;

  beforeEach(async () => {
    classifiedPath = await mkdtemp(path.join(os.tmpdir(), "sidflow-resume-"));
  });

  afterEach(async () => {
    await rm(classifiedPath, { recursive: true, force: true });
  });

  test("indexes songs from a features file, defaulting a single-song file to index 1", async () => {
    await writeFile(
      path.join(classifiedPath, "features_2026-07-26_10-00-00-000.jsonl"),
      [record("DEMOS/0-9/Alpha.sid"), record("GAMES/A-F/Beta.sid", 3)].join("\n") + "\n",
      "utf8",
    );

    const keys = await indexExtractedSongs(classifiedPath);
    expect(keys.has("DEMOS/0-9/Alpha.sid#1")).toBe(true);
    expect(keys.has("GAMES/A-F/Beta.sid#3")).toBe(true);
    expect(keys.size).toBe(2);
  });

  test("merges every features file, because each crash-and-resume cycle writes a new one", async () => {
    // The reason this matters: a corpus that took three attempts has its progress spread
    // across three files, and reading only the newest would re-render the first two
    // attempts' work.
    await writeFile(
      path.join(classifiedPath, "features_2026-07-26_08-00-00-000.jsonl"),
      record("DEMOS/0-9/First.sid") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(classifiedPath, "features_2026-07-26_09-00-00-000.jsonl"),
      record("DEMOS/0-9/Second.sid") + "\n",
      "utf8",
    );
    await writeFile(
      path.join(classifiedPath, "features_2026-07-26_10-00-00-000.jsonl"),
      record("DEMOS/0-9/Third.sid") + "\n",
      "utf8",
    );

    const keys = await indexExtractedSongs(classifiedPath);
    expect(keys.size).toBe(3);
    for (const name of ["First", "Second", "Third"]) {
      expect(keys.has(`DEMOS/0-9/${name}.sid#1`)).toBe(true);
    }
  });

  test("ignores files that are not feature records", async () => {
    // classification_*.jsonl is written only in phase 2 and .events.jsonl is telemetry;
    // neither is a record that a song was extracted.
    await writeFile(path.join(classifiedPath, "features_a.jsonl"), record("A.sid") + "\n", "utf8");
    await writeFile(path.join(classifiedPath, "classification_a.jsonl"), record("B.sid") + "\n", "utf8");
    await writeFile(path.join(classifiedPath, "classification_a.events.jsonl"), record("C.sid") + "\n", "utf8");
    await writeFile(path.join(classifiedPath, "notes.txt"), record("D.sid") + "\n", "utf8");

    const keys = await indexExtractedSongs(classifiedPath);
    expect(keys.size).toBe(1);
    expect(keys.has("A.sid#1")).toBe(true);
  });

  test("survives a truncated final line, which is what a crash leaves behind", async () => {
    // The process died mid-write. The complete records before it must still be usable,
    // or one crash discards everything the run achieved.
    const complete = [record("DEMOS/0-9/One.sid"), record("DEMOS/0-9/Two.sid")].join("\n");
    const truncated = record("DEMOS/0-9/Three.sid").slice(0, 240);
    await writeFile(
      path.join(classifiedPath, "features_crash.jsonl"),
      `${complete}\n${truncated}`,
      "utf8",
    );

    const keys = await indexExtractedSongs(classifiedPath);
    expect(keys.has("DEMOS/0-9/One.sid#1")).toBe(true);
    expect(keys.has("DEMOS/0-9/Two.sid#1")).toBe(true);
  });

  test("does not truncate a path containing an escaped quote", async () => {
    // A greedy or naive pattern stops at the escaped quote and yields a key that matches
    // nothing, so the song is re-rendered on every resume forever.
    const awkward = 'DEMOS/0-9/Quote"Name.sid';
    await writeFile(
      path.join(classifiedPath, "features_quote.jsonl"),
      JSON.stringify({ sid_path: awkward, features: {} }) + "\n",
      "utf8",
    );

    const keys = await indexExtractedSongs(classifiedPath);
    expect([...keys][0]).toBe(`${awkward}#1`);
  });

  test("names a sid_path it cannot decode instead of dropping it in silence", async () => {
    // A record whose escaped path will not decode is dropped, which reclassifies that
    // song -- the safe direction. It must still be reported: on an 87,868-line features
    // file a systematic decode failure would quietly shrink the index and re-render the
    // corpus, with nothing on stderr to say why.
    const written: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };

    try {
      await writeFile(
        path.join(classifiedPath, "features_bad_escape.jsonl"),
        // A lone trailing backslash escape that JSON.parse rejects, followed by a record
        // that decodes cleanly, so the file is not simply unreadable.
        '{"sid_path":"DEMOS/0-9/Bad\\x.sid","features":{}}\n'
        + JSON.stringify({ sid_path: "DEMOS/0-9/Good.sid", features: {} }) + "\n",
        "utf8",
      );

      const keys = await indexExtractedSongs(classifiedPath);
      expect(keys.has("DEMOS/0-9/Good.sid#1")).toBe(true);
      expect(keys.size).toBe(1);

      const stderr = written.join("");
      expect(stderr).toContain("could not be decoded");
      expect(stderr).toContain("features_bad_escape.jsonl");
    } finally {
      (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
    }
  });

  test("returns empty for a directory that does not exist, rather than throwing", async () => {
    // A first run has no classified directory yet, and that is not an error.
    const keys = await indexExtractedSongs(path.join(classifiedPath, "absent"));
    expect(keys.size).toBe(0);
  });

  test("builds the same key the classifier looks up", async () => {
    // The one invariant the whole mechanism rests on. If these two ever diverge the
    // index matches nothing and the resume silently re-renders the corpus.
    expect(resumeKeyFor("DEMOS/0-9/Alpha.sid")).toBe("DEMOS/0-9/Alpha.sid#1");
    expect(resumeKeyFor("DEMOS/0-9/Alpha.sid", 1)).toBe("DEMOS/0-9/Alpha.sid#1");
    expect(resumeKeyFor("GAMES/A-F/Beta.sid", 7)).toBe("GAMES/A-F/Beta.sid#7");
  });
});
