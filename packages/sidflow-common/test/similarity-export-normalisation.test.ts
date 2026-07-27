/**
 * Regression tests for the export's vector normalisation.
 *
 * These pin the PROPERTY that the measured station improvement rests on, rather
 * than pinning a number that only reproduces on one corpus.
 *
 * Rank-normalising each dimension across the corpus made held-out retrieval improve
 * by 14.8% (nDCG@10 0.2340 -> 0.2686, p=0.0002). The reason is invariance: raw
 * feature values arrive on arbitrary scales with arbitrary skew — one dimension is a
 * ratio in [0,1], another a tempo in the hundreds, another a heavily
 * zero-inflated activity measure — and cosine over them silently weights whichever
 * happens to have the largest spread. Replacing each value with its position among
 * the corpus makes the representation depend only on the ORDER of tracks along each
 * dimension, so a feature's units, scale and skew stop mattering.
 *
 * That is what the first test below checks, and it is the strongest statement
 * available about why the change helps: apply any per-dimension monotone rescaling
 * to the inputs and the stored vectors come out bit-identical, so the neighbours a
 * station is built from are unchanged.
 *
 * The remaining tests pin the two properties that make the transform safe to serve:
 * values stay in [0, 1] so the station's absolute similarity threshold keeps its
 * meaning, and a dimension carrying no information contributes nothing rather than
 * leaking corpus order.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";

import { buildSimilarityExport, cosineSimilarity } from "../src/index.js";

const DIMENSIONS = 12;
const TRACK_COUNT = 24;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
}

describe("similarity export vector normalisation", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-export-norm-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  /** Export a corpus whose vectors are produced by `vectorFor`, and read them back. */
  async function exportVectors(
    label: string,
    vectorFor: (trackIndex: number) => number[],
  ): Promise<Map<string, number[]>> {
    const root = path.join(tempRoot, label);
    const classifiedPath = path.join(root, "classified");
    const sqlitePath = path.join(root, "exports", `sidcorr-${label}-full-sidcorr-1.sqlite`);
    await mkdir(classifiedPath, { recursive: true });

    const lines: string[] = [];
    for (let index = 0; index < TRACK_COUNT; index += 1) {
      lines.push(
        JSON.stringify({
          sid_path: `T${String(index).padStart(3, "0")}.sid`,
          song_index: 1,
          ratings: { e: 1 + (index % 5), m: 1 + (index % 5), c: 1 + (index % 5), p: 3 },
          features: { bpm: 100 + index },
          vector: vectorFor(index),
          classified_at: "2026-03-13T10:00:00.000Z",
          source: "auto",
          render_engine: "wasm",
        }),
      );
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(root, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(root, "exports", `sidcorr-${label}-full-sidcorr-1.manifest.json`),
      corpusVersion: label,
      neighbors: 0,
    });

    const database = new Database(sqlitePath, { readonly: true });
    try {
      const rows = database.query("select sid_path, vector_json from tracks").all() as Array<{
        sid_path: string;
        vector_json: string;
      }>;
      return new Map(rows.map((row) => [row.sid_path, JSON.parse(row.vector_json) as number[]]));
    } finally {
      database.close();
    }
  }

  const rand = makeRandom(0x5eed);
  const RAW: number[][] = Array.from({ length: TRACK_COUNT }, () =>
    Array.from({ length: DIMENSIONS }, () => rand()),
  );

  test("is invariant to any per-dimension monotone rescaling of the features", async () => {
    // This is the property the measured improvement rests on. Real features arrive
    // on wildly different scales with different skew; after normalisation only the
    // ORDER of tracks along each dimension survives, so units and skew stop
    // influencing which neighbours a station is built from.
    const rescale = [
      (x: number) => x, // identity
      (x: number) => x * 1000, // pure scale
      (x: number) => x + 50, // pure offset
      (x: number) => x ** 3, // strong convex skew
      (x: number) => Math.sqrt(x), // strong concave skew
      (x: number) => Math.exp(x * 4), // exponential
      (x: number) => Math.log(x + 1e-6), // logarithmic
      (x: number) => x * 1e-6, // tiny scale
      (x: number) => x * 7 + 3,
      (x: number) => x ** 5,
      (x: number) => Math.tan((x - 0.5) * 1.4), // monotone but wild, and signed
      (x: number) => x,
    ];

    const original = await exportVectors("plain", (index) => [...RAW[index]!]);
    const rescaled = await exportVectors("rescaled", (index) =>
      RAW[index]!.map((value, dimension) => rescale[dimension]!(value)),
    );

    expect(original.size).toBe(TRACK_COUNT);
    for (const [sidPath, vector] of original) {
      const other = rescaled.get(sidPath);
      expect(other).toBeDefined();
      // Bit-identical, not merely close: the transform reads ranks, and the
      // rescalings above preserve every rank.
      expect(other).toEqual(vector);
    }
  });

  test("keeps stored values in [0, 1] so the station's similarity threshold keeps its scale", async () => {
    // A centred representation scores marginally better on retrieval and is
    // unshippable: it makes cosine span [-1,1], and measured against the station's
    // absolute 0.73 minimum-similarity threshold, zero candidates clear it anywhere
    // in the corpus. Every station would return empty.
    const stored = await exportVectors("bounded", (index) => [...RAW[index]!]);
    for (const vector of stored.values()) {
      for (const value of vector) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }

    // And similarity over them stays non-negative, which is what the threshold and
    // the tiny profile's one-byte similarity quantisation both assume.
    const vectors = [...stored.values()];
    for (let i = 0; i < vectors.length; i += 1) {
      for (let j = 0; j < vectors.length; j += 1) {
        const similarity = cosineSimilarity(vectors[i]!, vectors[j]!);
        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  test("a dimension with no information contributes nothing instead of leaking corpus order", async () => {
    // Giving tied values consecutive ranks would spread one repeated value across
    // the whole output range in corpus order, so a constant dimension would become
    // a ramp and file ordering would become signal the metric can see.
    const stored = await exportVectors("constant", (index) => {
      const vector = [...RAW[index]!];
      vector[3] = 0.5; // constant across every track
      vector[7] = 0.5;
      return vector;
    });
    const values = [...stored.values()];
    const firstConstant = values[0]![3]!;
    for (const vector of values) {
      expect(vector[3]!).toBe(firstConstant);
      expect(vector[7]!).toBe(firstConstant);
    }
  });

  test("a partially tied dimension keeps its tie groups together and its order intact", async () => {
    // The shape SID features actually have: zero for most of the corpus, varying
    // for the rest.
    const stored = await exportVectors("tied", (index) => {
      const vector = [...RAW[index]!];
      vector[0] = index < TRACK_COUNT / 2 ? 0 : index / TRACK_COUNT;
      return vector;
    });
    const byPath = (index: number) => stored.get(`T${String(index).padStart(3, "0")}.sid`)![0]!;

    const tiedValue = byPath(0);
    for (let index = 1; index < TRACK_COUNT / 2; index += 1) {
      expect(byPath(index)).toBe(tiedValue);
    }
    for (let index = TRACK_COUNT / 2 + 1; index < TRACK_COUNT; index += 1) {
      expect(byPath(index)).toBeGreaterThan(byPath(index - 1));
    }
    expect(byPath(TRACK_COUNT / 2)).toBeGreaterThan(tiedValue);
  });
});
