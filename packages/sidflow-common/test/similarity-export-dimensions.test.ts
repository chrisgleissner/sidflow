/**
 * The export pipeline must carry an arbitrary similarity-vector width.
 *
 * Adding a musical property to the classifier means adding dimensions. If any
 * export profile hard-coded 24, every such addition would be a format break and a
 * new schema version, and the schema would end up versioned by how many features
 * happened to exist that month.
 *
 * The good news is that nothing hard-codes it: `full` derives the width from the
 * widest stored vector, `lite` records it in its own header and builds one
 * codebook per dimension, and `tiny` never stores vectors at all — it reads them
 * to build a neighbour graph and then discards them. These tests pin that, so a
 * future change that reintroduces a fixed width fails here rather than silently
 * truncating everyone's vectors.
 *
 * They also pin the size consequence, which is what decides whether widening is
 * affordable: `tiny` must not grow at all.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  decodeLiteSimilarityExport,
  readSimilarityExportManifest,
} from "../src/index.js";
import { Database } from "bun:sqlite";

/** Deterministic pseudo-random vectors, so a failure is reproducible. */
function makeVector(dimensions: number, seed: number): number[] {
  let state = (seed * 2654435761) >>> 0;
  return Array.from({ length: dimensions }, () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return Number(((state / 0x100000000) as number).toFixed(6));
  });
}

const TRACKS = ["A.sid", "B.sid", "C.sid", "D.sid", "E.sid", "F.sid", "G.sid", "H.sid"];

describe("similarity export vector dimensionality", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-export-dims-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  /** Build all three profiles for a given vector width. */
  async function buildAll(dimensions: number, label: string) {
    const root = path.join(tempRoot, label);
    const classifiedPath = path.join(root, "classified");
    const hvscRoot = path.join(root, "hvsc");
    const sqlitePath = path.join(root, "exports", `sidcorr-${label}-full-sidcorr-1.sqlite`);
    const litePath = path.join(root, "exports", `sidcorr-${label}-lite.sidcorr`);
    const tinyPath = path.join(root, "exports", `sidcorr-${label}-tiny.sidcorr`);

    await mkdir(classifiedPath, { recursive: true });
    await mkdir(hvscRoot, { recursive: true });

    const vectors = new Map<string, number[]>();
    const lines = TRACKS.map((sidPath, index) => {
      const vector = makeVector(dimensions, index + 1);
      vectors.set(sidPath, vector);
      return JSON.stringify({
        sid_path: sidPath,
        song_index: 1,
        ratings: { e: 1 + (index % 5), m: 1 + (index % 5), c: 1 + (index % 5), p: 3 },
        features: { bpm: 90 + index },
        vector,
        classified_at: `2026-03-13T10:0${index}:00.000Z`,
        source: "auto",
        render_engine: "wasm",
      });
    });
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");
    for (const sidName of TRACKS) {
      await writeFile(path.join(hvscRoot, sidName), Buffer.from(`PSID-${sidName}-${dimensions}`, "utf8"));
    }

    const full = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(root, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(root, "exports", `sidcorr-${label}-full-sidcorr-1.manifest.json`),
      corpusVersion: label,
      neighbors: 3,
    });

    const lite = await buildLiteSimilarityExport({
      sourceSqlitePath: sqlitePath,
      outputPath: litePath,
      corpusVersion: label,
    });

    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      corpusVersion: label,
    });

    return { full, lite, sqlitePath, litePath, tinyPath, vectors };
  }

  test("the full profile records and preserves an arbitrary width", async () => {
    for (const dimensions of [24, 40, 54]) {
      const built = await buildAll(dimensions, `d${dimensions}`);
      expect(built.full.manifest.vector_dimensions).toBe(dimensions);

      const manifest = await readSimilarityExportManifest(
        path.join(path.dirname(built.sqlitePath), `sidcorr-d${dimensions}-full-sidcorr-1.manifest.json`),
      );
      expect(manifest.vector_dimensions).toBe(dimensions);

      const database = new Database(built.sqlitePath, { readonly: true });
      try {
        const rows = database.query("select sid_path, vector_json from tracks").all() as Array<{
          sid_path: string;
          vector_json: string;
        }>;
        expect(rows.length).toBe(TRACKS.length);
        for (const row of rows) {
          const stored = JSON.parse(row.vector_json) as number[];
          expect(stored.length).toBe(dimensions);
          for (const value of stored) expect(Number.isFinite(value)).toBe(true);
        }

        // The export rank-Gaussian normalises before storing, so the values are
        // not the input values -- but the transform is per-dimension monotone, so
        // the ORDER of tracks along every dimension must be untouched. That is
        // the property a similarity metric actually depends on, and checking it
        // catches a transform applied across the wrong axis, which comparing
        // lengths alone would not.
        expect(built.full.manifest.vector_normalisation).toBe("rank-uniform");
        // Non-negative, so cosine stays in [0,1] and the product's absolute
        // similarity thresholds keep the meaning they were tuned with.
        for (const row of rows) {
          for (const value of JSON.parse(row.vector_json) as number[]) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
          const byInput = [...built.vectors.entries()]
            .sort((left, right) => left[1][dimension]! - right[1][dimension]!)
            .map(([sidPath]) => sidPath);
          const storedByPath = new Map(
            rows.map((row) => [row.sid_path, JSON.parse(row.vector_json) as number[]]),
          );
          for (let i = 1; i < byInput.length; i += 1) {
            const previous = storedByPath.get(byInput[i - 1]!)![dimension]!;
            const current = storedByPath.get(byInput[i]!)![dimension]!;
            expect(current).toBeGreaterThanOrEqual(previous);
          }
        }
      } finally {
        database.close();
      }
    }
  });

  test("the lite profile round-trips an arbitrary width through quantisation", async () => {
    for (const dimensions of [24, 54]) {
      const built = await buildAll(dimensions, `lite${dimensions}`);
      expect(built.lite.manifest.vector_dimensions).toBe(dimensions);
      const decoded = await decodeLiteSimilarityExport(built.litePath);
      expect(decoded.rows.length).toBe(TRACKS.length);
      for (const row of decoded.rows) {
        // The decoded width comes from the file's own header, so this failing
        // would mean the header and the payload disagree.
        expect(row.vector.length).toBe(dimensions);
        for (const value of row.vector) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test("the tiny profile does not grow with vector width", async () => {
    // The constraint that decides whether widening the vector is affordable at
    // all: tiny is the bandwidth-sensitive artifact, and it stores a neighbour
    // graph rather than vectors, so its size must be completely independent of
    // how many dimensions produced that graph.
    const narrow = await buildAll(24, "tiny24");
    const wide = await buildAll(54, "tiny54");

    const narrowBytes = (await stat(narrow.tinyPath)).size;
    const wideBytes = (await stat(wide.tinyPath)).size;

    expect(narrowBytes).toBeGreaterThan(0);
    expect(wideBytes).toBe(narrowBytes);
  });

  test("a wider vector is not silently truncated to the previous width", async () => {
    // The specific regression this guards: a hard-coded 24 anywhere in the chain
    // would still produce a valid-looking export, just one that had thrown away
    // every new dimension.
    const built = await buildAll(54, "notruncate");
    expect(built.full.manifest.vector_dimensions).not.toBe(24);
    expect(built.full.manifest.vector_dimensions).toBe(54);
    expect(built.lite.manifest.vector_dimensions).toBe(54);
    const decoded = await decodeLiteSimilarityExport(built.litePath);
    expect(decoded.rows[0]!.vector.length).toBe(54);
  });
});
