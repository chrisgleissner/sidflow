/**
 * The tiny profile's favourites ranking must come from its neighbour graph.
 *
 * `recommendFromFavorites` computed a five-hop decayed walk over the 3-neighbour
 * graph — forward and reverse edges, decays 0.76^d and 0.70^d, reverse edges at
 * x0.92, frontier capped at 256 — and then threw it away. The block that followed
 * was written as a fallback but was guarded only on a favourite having resolved,
 * never on the walk having failed, and it called `scores.set` rather than
 * accumulating. So it overwrote every score the walk had produced and assigned one to
 * every track the walk had never reached.
 *
 * The result: whenever the function returned anything at all — the only case in which
 * it returns anything — 100% of the ranking came from a cosine over
 * [e, m, c, p ?? 3], a 4-element rating vector with at most 125 distinct values across
 * 87,868 tracks, ties broken by ordinal. The neighbour graph, 57% of the bundle's
 * bytes, contributed nothing. Every tiny bundle ever published has been read this way
 * by SIDFlow's own library reader; the defect dates to a7aac3ea, 2026-04-07.
 *
 * The release gate could not see it: it asserted only that the result was non-empty,
 * which the overwrite guaranteed for every seed.
 *
 * These tests fail against that code. The corpus is built so that the two rankings
 * disagree loudly: the vector geometry gives the seed genuine, strong neighbour edges,
 * and the RATINGS are ordered against that geometry, so a rating cosine puts the
 * seed's actual neighbours near the bottom.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  openTinySimilarityDataset,
  type SimilarityDataset,
} from "../src/index.js";

const TRACK_COUNT = 12;
const SEED_INDEX = 0;
const VECTOR_DIMENSIONS = 12;

/**
 * A geometry in which each track's nearest neighbours are known by construction.
 *
 * Tracks sit at increasing angles on a circle embedded in the first two dimensions, so
 * a track's nearest neighbours are its immediate angular neighbours. The remaining
 * dimensions carry a small per-track constant so no two vectors are identical.
 */
function vectorFor(index: number): number[] {
  const angle = (index / TRACK_COUNT) * (Math.PI / 2);
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0.01 * (index + 1));
  vector[0] = Math.cos(angle);
  vector[1] = Math.sin(angle);
  return vector;
}

/**
 * Ratings ordered AGAINST the vector geometry.
 *
 * The seed sits at index 0 and gets the lowest ratings; its true neighbours (indices 1
 * and 2) get the highest. A rating cosine therefore ranks the seed's real neighbours
 * last, and any ranking that agrees with the neighbour graph cannot be a rating cosine
 * in disguise.
 */
function ratingsFor(index: number): { e: number; m: number; c: number; p: number } {
  const inverted = TRACK_COUNT - index;
  return {
    e: 1 + (inverted % 5),
    m: 1 + ((inverted + 1) % 5),
    c: 1 + ((inverted + 2) % 5),
    p: 3,
  };
}

describe("tiny recommendFromFavorites ranks from the neighbour graph", () => {
  let tempRoot: string;
  let dataset: SimilarityDataset;
  let seedTrackId: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-favorites-"));
    const classifiedPath = path.join(tempRoot, "classified");
    const hvscRoot = path.join(tempRoot, "hvsc");
    const sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    const litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    const tinyPath = path.join(tempRoot, "exports", "tiny.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    const lines: string[] = [];
    for (let index = 0; index < TRACK_COUNT; index += 1) {
      const relative = `MUSICIANS/T/Test/T${index}.sid`;
      const onDisk = path.join(hvscRoot, "C64Music", relative);
      await mkdir(path.dirname(onDisk), { recursive: true });
      await writeFile(onDisk, Buffer.from(`PSID-fixture-${index}`, "utf8"));
      lines.push(JSON.stringify({
        sid_path: relative,
        song_index: 1,
        ratings: ratingsFor(index),
        features: { bpm: 100 + index },
        vector: vectorFor(index),
        classified_at: `2026-07-27T10:${String(index).padStart(2, "0")}:00.000Z`,
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(tempRoot, "exports", "full.manifest.json"),
      corpusVersion: "favorites",
      neighbors: 3,
    });
    await buildLiteSimilarityExport({
      sourceSqlitePath: sqlitePath,
      outputPath: litePath,
      corpusVersion: "favorites",
    });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: path.join(hvscRoot, "C64Music"),
      outputPath: tinyPath,
      corpusVersion: "favorites",
      neighborSqlitePath: sqlitePath,
    });

    // Opened WITH the HVSC root, so ids resolve to real paths rather than to the
    // md5_48 keys the bundle stores. That is how every real consumer opens it.
    dataset = await openTinySimilarityDataset(tinyPath, { hvscRoot: path.join(hvscRoot, "C64Music") });
    seedTrackId = `MUSICIANS/T/Test/T${SEED_INDEX}.sid#1`;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("the seed's stored neighbours lead its own recommendations", async () => {
    const storedNeighbors = dataset.getNeighbors(seedTrackId, 3);
    expect(storedNeighbors.length).toBeGreaterThan(0);

    const recommendations = dataset.recommendFromFavorites({
      favoriteTrackIds: [seedTrackId],
      limit: TRACK_COUNT,
    });
    expect(recommendations.length).toBeGreaterThan(0);

    const rankByTrackId = new Map(recommendations.map((entry, index) => [entry.track_id, index + 1]));
    for (const neighbor of storedNeighbors) {
      const rank = rankByTrackId.get(neighbor.track_id);
      expect(rank).toBeDefined();
      // Every stored neighbour must place inside the top few. Against the old code
      // these landed mid-table behind tracks that were not neighbours at all, because
      // the ranking was a rating cosine and the ratings are ordered against the
      // geometry that produced these edges.
      expect(rank!).toBeLessThanOrEqual(storedNeighbors.length + 1);
    }

    // The single strongest stored edge must lead.
    expect(recommendations[0]!.track_id).toBe(storedNeighbors[0]!.track_id);

    // And the walk must not have invented a score for the whole corpus. Only tracks
    // the graph actually reaches from the seed are ranked; the old code assigned every
    // ordinal a score whether the walk had seen it or not.
    expect(recommendations.length).toBeLessThan(TRACK_COUNT - 1);
  });

  test("the ranking is not a cosine over [e, m, c, p]", () => {
    const recommendations = dataset.recommendFromFavorites({
      favoriteTrackIds: [seedTrackId],
      limit: TRACK_COUNT,
    });

    const seedRatings = ratingsFor(SEED_INDEX);
    const seedVector = [seedRatings.e, seedRatings.m, seedRatings.c, seedRatings.p];
    const ratingCosine = (other: number[]): number => {
      let dot = 0;
      let leftNorm = 0;
      let rightNorm = 0;
      for (let index = 0; index < 4; index += 1) {
        dot += seedVector[index]! * other[index]!;
        leftNorm += seedVector[index]! * seedVector[index]!;
        rightNorm += other[index]! * other[index]!;
      }
      return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
    };

    // Against the old code every returned score matched this to twelve decimal places.
    const matches = recommendations.filter((entry) => {
      const ratings = [entry.e, entry.m, entry.c, entry.p ?? 3];
      return Math.abs(entry.score - ratingCosine(ratings)) < 1e-12;
    });
    expect(matches.length).toBeLessThan(recommendations.length);
  });

  test("scores take more distinct values than the rating vector can express", () => {
    const recommendations = dataset.recommendFromFavorites({
      favoriteTrackIds: [seedTrackId],
      limit: TRACK_COUNT,
    });

    // The rating vector has at most 125 reachable positions corpus-wide and far fewer
    // on a 12-track fixture, so a degenerate ranking collapses into a handful of
    // repeated scores — measured at 5 distinct values across 11 recommendations. Walk
    // scores are continuous.
    const distinctScores = new Set(recommendations.map((entry) => entry.score.toFixed(12)));
    expect(distinctScores.size).toBe(recommendations.length);
  });

  test("scores are relative to the strongest match, not clamped", () => {
    // The walk ACCUMULATES: a track reachable by several paths sums their contributions,
    // so raw scores routinely exceed 1. Clamping to [-1, 1] made every strongly-connected
    // candidate report exactly 1.0 — measured on the shipped HVSC bundle, a seed's top 100
    // recommendations came back with ONE distinct score between them while the underlying
    // walk had 973 distinct values across the 1,674 tracks it reached. The ranking was
    // never wrong; the number a consumer reads was.
    const recommendations = dataset.recommendFromFavorites({
      favoriteTrackIds: [seedTrackId],
      limit: TRACK_COUNT,
    });

    expect(recommendations.length).toBeGreaterThan(1);
    expect(recommendations[0]!.score).toBeCloseTo(1, 10);
    for (const entry of recommendations) {
      expect(entry.score).toBeLessThanOrEqual(1);
      expect(entry.score).toBeGreaterThan(0);
    }
    // Strictly descending: no two tracks share the top score.
    for (let index = 1; index < recommendations.length; index += 1) {
      expect(recommendations[index]!.score).toBeLessThan(recommendations[index - 1]!.score);
    }
  });

  test("tiny reports no vector data, and returns none", () => {
    expect(dataset.info.hasVectorData).toBe(false);
    expect(dataset.getTrackVectors([seedTrackId]).size).toBe(0);
    expect(dataset.getTrackVectors([]).size).toBe(0);
  });

  test("a favourite that resolves to nothing returns nothing", () => {
    // Documented consequence of deleting the rating-cosine fallback: with no usable
    // seed there is no neighbour evidence, and the honest answer is an empty result
    // rather than a corpus-wide ranking by a key known to be degenerate.
    const recommendations = dataset.recommendFromFavorites({
      favoriteTrackIds: ["MUSICIANS/T/Test/DoesNotExist.sid#1"],
      limit: TRACK_COUNT,
    });
    expect(recommendations).toHaveLength(0);
  });
});
