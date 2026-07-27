/**
 * The tiny profile identifies files by a 48-bit MD5 prefix. Two files can share one.
 *
 * Across HVSC's ~62,000 SID files the birthday probability of at least one collision
 * is roughly 0.7%. That is unlikely for any single release and near-certain to happen
 * eventually across many, and the failure is silent: the colliding entries overwrite
 * each other in the path map, so every track of the loser is reported under the
 * winner's path. A listener sees a station entry naming a tune that is not playing,
 * and nothing in the build says so.
 *
 * These tests pin that the collision is DETECTED and NAMED, and that the bundle still
 * builds -- a collision is a property of the collection, not a bug in the exporter, so
 * refusing to produce anything would be the worse outcome.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  clearSonglengthCaches,
} from "../src/index.js";

/**
 * The identity is the MD5 of the file's BYTES, so the collision that actually occurs
 * in practice is the simplest one: the same tune filed under two paths. HVSC does
 * this -- a tune appears under both GAMES and MUSICIANS -- and byte-identical files
 * hash identically, so no preimage search is needed to reproduce it.
 */
const SHARED_BYTES = "PSID-duplicated-tune";

const FILES = [
  { relative: "DEMOS/0-9/Alpha.sid", bytes: SHARED_BYTES },
  { relative: "GAMES/A-F/Beta.sid", bytes: SHARED_BYTES },
  { relative: "GAMES/G-L/Gamma.sid", bytes: "PSID-unique-tune" },
];

describe("tiny profile md5_48 collisions", () => {
  let tempRoot: string;
  let stderrChunks: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-collide-"));
    clearSonglengthCaches();
    stderrChunks = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(async () => {
    process.stderr.write = originalWrite;
    clearSonglengthCaches();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function build(): Promise<string> {
    const classifiedPath = path.join(tempRoot, "classified");
    const hvscRoot = path.join(tempRoot, "hvsc");
    const sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    const litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    const tinyPath = path.join(tempRoot, "exports", "tiny.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    const classified: string[] = [];
    for (const [index, file] of FILES.entries()) {
      const onDisk = path.join(hvscRoot, "C64Music", file.relative);
      await mkdir(path.dirname(onDisk), { recursive: true });
      await writeFile(onDisk, Buffer.from(file.bytes, "utf8"));

      classified.push(JSON.stringify({
        sid_path: `C64Music/${file.relative}`,
        song_index: 1,
        ratings: { e: 1 + index, m: 1 + index, c: 1 + index, p: 3 },
        features: { bpm: 100 + index },
        vector: Array.from({ length: 12 }, (_, d) => ((index * 5 + d * 3) % 20) / 20),
        classified_at: "2026-03-13T10:00:00.000Z",
        source: "auto",
        render_engine: "wasm",
      }));
    }

    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${classified.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(tempRoot, "exports", "full.manifest.json"),
      corpusVersion: "collide",
      neighbors: 2,
    });
    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath, corpusVersion: "collide" });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      neighborSqlitePath: sqlitePath,
      corpusVersion: "collide",
    });
    return tinyPath;
  }

  test("names both colliding files instead of silently dropping one", async () => {
    await build();
    const stderr = stderrChunks.join("");
    expect(stderr).toContain("md5_48 collision");
    // Both sides named, so an operator can act on it rather than just knowing a
    // count. Which one wins is an implementation detail; that both appear is not.
    expect(stderr).toContain("Alpha.sid");
    expect(stderr).toContain("Beta.sid");
  });

  test("still produces a usable bundle, because a collision is the corpus's property", async () => {
    const tinyPath = await build();
    const { stat } = await import("node:fs/promises");
    const info = await stat(tinyPath);
    expect(info.size).toBeGreaterThan(0);
  });

  test("says nothing when no two files collide", async () => {
    // Guards against a warning that fires on every build and is therefore ignored.
    const classifiedPath = path.join(tempRoot, "clean-classified");
    const hvscRoot = path.join(tempRoot, "clean-hvsc");
    const sqlitePath = path.join(tempRoot, "clean-exports", "full.sqlite");
    const litePath = path.join(tempRoot, "clean-exports", "lite.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    const classified: string[] = [];
    for (const [index, file] of FILES.slice(1).entries()) {
      const onDisk = path.join(hvscRoot, "C64Music", file.relative);
      await mkdir(path.dirname(onDisk), { recursive: true });
      // Distinct bytes per path, so no two identities can coincide.
      await writeFile(onDisk, Buffer.from(`PSID-unique-${file.relative}`, "utf8"));
      classified.push(JSON.stringify({
        sid_path: `C64Music/${file.relative}`,
        song_index: 1,
        ratings: { e: 3, m: 3, c: 3, p: 3 },
        features: { bpm: 120 + index },
        vector: Array.from({ length: 12 }, (_, d) => ((index * 5 + d * 3) % 20) / 20),
        classified_at: "2026-03-13T10:00:00.000Z",
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${classified.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "clean-feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(tempRoot, "clean-exports", "full.manifest.json"),
      corpusVersion: "clean",
      neighbors: 1,
    });
    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath, corpusVersion: "clean" });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: path.join(tempRoot, "clean-exports", "tiny.sidcorr"),
      neighborSqlitePath: sqlitePath,
      corpusVersion: "clean",
    });

    expect(stderrChunks.join("")).not.toContain("md5_48 collision");
  });
});
