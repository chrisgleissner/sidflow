/**
 * Can the export schemas hold a corpus larger than a 16-bit count?
 *
 * HVSC is already at 61,787 SID files and 87,868 songs, so 65,535 is not a theoretical
 * boundary — it is roughly one collection update away. A field that silently truncates
 * there would not fail: it would map several files onto one id, and every affected track
 * would be reported under another file's path. The bundle would build, report correct
 * counts, and be wrong.
 *
 * Where each schema actually stands:
 *
 *   full (SQLite)  SQL integers, no fixed width.
 *   lite           The per-track file reference is 2 bytes up to 65,535 files and 3 bytes
 *                  beyond, and the chosen width is written into the header (bytes 14-15)
 *                  and read back from it. Ceiling 16,777,215 files.
 *   tiny           Track and file counts are UInt32; neighbour ordinals are UInt24, so the
 *                  ceiling is 16,777,214 tracks (0xffffff is the empty-neighbour
 *                  sentinel). Songs per file is one byte, which matches the SID format's
 *                  own 256-song maximum.
 *
 * The lite boundary is the only one this test can cross cheaply, and it is the one that
 * matters, because it is the closest.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  openLiteSimilarityDataset,
} from "../src/index.js";

/** Just past the 16-bit boundary, so the 3-byte path is exercised rather than reasoned about. */
const TRACK_COUNT = 65_600;

function sidPathFor(index: number): string {
  return `C64Music/MUSICIANS/${String.fromCharCode(65 + (index % 26))}/C_${index % 900}/T_${index}.sid`;
}

describe("export schemas beyond a 16-bit corpus", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-scale-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("lite carries more than 65,535 distinct files and resolves the highest id", async () => {
    const classifiedPath = path.join(tempRoot, "classified");
    await mkdir(classifiedPath, { recursive: true });

    let state = 11;
    const random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
    const lines: string[] = [];
    for (let index = 0; index < TRACK_COUNT; index += 1) {
      lines.push(JSON.stringify({
        sid_path: sidPathFor(index),
        song_index: 1,
        ratings: { e: 1 + (index % 5), m: 1 + (index % 5), c: 1 + (index % 5), p: 3 },
        features: { bpm: 100 + (index % 80) },
        vector: Array.from({ length: 12 }, () => random()),
        classified_at: "2026-07-26T00:00:00.000Z",
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_scale.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const sqlitePath = path.join(tempRoot, "full.sqlite");
    // neighbors: 0 keeps this a schema test rather than an O(n^2) distance benchmark.
    const full = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(tempRoot, "full.manifest.json"),
      corpusVersion: "scale",
      neighbors: 0,
    });
    expect(full.manifest.track_count).toBe(TRACK_COUNT);

    const litePath = path.join(tempRoot, "lite.sidcorr");
    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath, corpusVersion: "scale" });

    const dataset = await openLiteSimilarityDataset(litePath);
    expect(dataset.info.trackCount).toBe(TRACK_COUNT);

    // The track with the highest file id is the one a 2-byte field would corrupt.
    const highest = `${sidPathFor(TRACK_COUNT - 1)}#1`;
    expect(dataset.resolveTrack(highest)).not.toBeNull();

    // And the lowest, to prove the wider field did not shift everything by a byte.
    expect(dataset.resolveTrack(`${sidPathFor(0)}#1`)).not.toBeNull();
  }, 300_000);

  test("a corpus below the boundary still uses the narrow field", async () => {
    // The wider field costs a byte per track across the whole corpus, so it must only
    // appear when it is needed.
    const classifiedPath = path.join(tempRoot, "small");
    await mkdir(classifiedPath, { recursive: true });
    const lines: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      lines.push(JSON.stringify({
        sid_path: sidPathFor(index),
        song_index: 1,
        ratings: { e: 3, m: 3, c: 3, p: 3 },
        features: { bpm: 120 },
        vector: Array.from({ length: 12 }, (_, d) => ((index + d) % 20) / 20),
        classified_at: "2026-07-26T00:00:00.000Z",
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_small.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const sqlitePath = path.join(tempRoot, "small.sqlite");
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(tempRoot, "small.manifest.json"),
      corpusVersion: "small",
      neighbors: 0,
    });
    const litePath = path.join(tempRoot, "small.sidcorr");
    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath, corpusVersion: "small" });

    const dataset = await openLiteSimilarityDataset(litePath);
    expect(dataset.info.trackCount).toBe(50);
    expect(dataset.resolveTrack(`${sidPathFor(0)}#1`)).not.toBeNull();
  });
});
