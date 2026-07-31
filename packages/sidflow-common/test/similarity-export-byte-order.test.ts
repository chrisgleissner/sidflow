import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildSimilarityTrackId,
  compareUtf8Bytewise,
  openLiteSimilarityDataset,
} from "../src/index.js";

describe("compareUtf8Bytewise", () => {
  /**
   * The comparator walks UTF-16 code units instead of encoding each string, so the
   * equivalence to UTF-8 byte order is an implementation claim rather than an obvious
   * property. This checks it directly, including the one case where UTF-16 code unit
   * order and code point order disagree: a supplementary character (stored as a
   * surrogate pair, code units 0xD800-0xDFFF) must sort after U+E000-U+FFFF.
   */
  const samples = [
    "", "a", "A", "ab", "aB", "z", "Z", "_", "a_b", "ab_",
    "\u00e4", "\u00c4", "\u00f6", "\u20ac",
    // U+E000 and U+FFFD are the BMP characters whose code units sit above the surrogate
    // range; U+1F600 and U+10000 are the supplementary characters stored as pairs.
    "\ue000", "\ufffd", "\u{1F600}", "\u{10000}", "a\u{1F600}", "a\ufffd",
    "DEMOS/0-9/First.sid", "DEMOS/A-F/Second.sid", "MUSICIANS/H/Hubbard_Rob/Third.sid",
  ];

  test("orders strings exactly as their UTF-8 bytes do", () => {
    for (const left of samples) {
      for (const right of samples) {
        const expected = Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
        expect(Math.sign(compareUtf8Bytewise(left, right))).toBe(expected);
      }
    }
  });

  test("sorts a list the same way an encoded sort does", () => {
    const encodedOrder = [...samples].sort((left, right) => Buffer.compare(
      Buffer.from(left, "utf8"),
      Buffer.from(right, "utf8"),
    ));
    expect([...samples].sort(compareUtf8Bytewise)).toEqual(encodedOrder);
  });
});

describe("similarity export UTF-8 byte ordering", () => {
  let tempRoot: string;
  let classifiedPath: string;
  let sqlitePath: string;
  let litePath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-byte-order-"));
    classifiedPath = path.join(tempRoot, "classified");
    sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    // UTF-8 byte order is a.sid, z.sid, ä.sid. Locale collation commonly puts ä
    // before z, which changes serialized ranking ties and portable file ordinals.
    await writeFile(
      path.join(classifiedPath, "classification_tracks.jsonl"),
      ["a.sid", "z.sid", "ä.sid"].map((sidPath) => JSON.stringify({
        sid_path: sidPath,
        song_index: 1,
        ratings: { e: 3, m: 3, c: 3, p: 3 },
        features: { bpm: 120 },
        classified_at: "2026-07-31T10:00:00.000Z",
        source: "auto",
        render_engine: "wasm",
      })).join("\n") + "\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("uses bytewise ordering for full and lite recommendation ties", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      neighbors: 2,
    });

    const database = new Database(sqlitePath, { readonly: true, strict: true });
    let fullNeighborIds: string[];
    try {
      fullNeighborIds = (database.query(`
        SELECT neighbor_track_id
        FROM neighbors
        WHERE profile = 'full' AND seed_track_id = ?
        ORDER BY rank ASC
      `).all(buildSimilarityTrackId("a.sid", 1)) as Array<{ neighbor_track_id: string }>)
        .map((row) => row.neighbor_track_id);
    } finally {
      database.close();
    }

    expect(fullNeighborIds!).toEqual([
      buildSimilarityTrackId("z.sid", 1),
      buildSimilarityTrackId("ä.sid", 1),
    ]);

    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath });
    const lite = await openLiteSimilarityDataset(litePath);
    expect(lite.recommendFromFavorites({
      favoriteTrackIds: [buildSimilarityTrackId("a.sid", 1)],
      limit: 2,
    }).map((row) => row.track_id)).toEqual(fullNeighborIds!);
  });
});
