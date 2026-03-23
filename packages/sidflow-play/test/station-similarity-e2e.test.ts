import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import {
  buildSimilarityExport,
  buildSimilarityTrackId,
  cosineSimilarity,
  type SidFileMetadata,
} from "@sidflow/common";
import { buildStationQueue } from "../src/station/queue.js";
import type { StationTrackDetails } from "../src/station/types.js";
import { StationSimulator } from "./helpers/station-simulator.ts";

const DIMENSIONS = 24;
const TOTAL_TRACKS = 200;
const LIKED_TRACK_COUNT = 100;
const RATED_SEED_COUNT = 10;

interface FixtureTrack {
  trackId: string;
  sidPath: string;
  vector: number[];
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return vector.map((value) => value / magnitude);
}

function createLikedVector(index: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0.005);
  vector[0] = 0.92 - (index * 0.0006);
  vector[1] = 0.26 + ((index % 7) * 0.003);
  vector[2] = 0.19 + ((index % 5) * 0.0025);
  vector[3] = 0.11 + ((index % 3) * 0.002);
  vector[4] = 0.08 + ((index % 11) * 0.001);
  return normalizeVector(vector);
}

function createRejectedVector(index: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0.004);
  vector[10] = 0.9 - (index * 0.0005);
  vector[11] = 0.3 + ((index % 5) * 0.002);
  vector[12] = 0.22 + ((index % 3) * 0.003);
  vector[13] = 0.14 + ((index % 7) * 0.0015);
  vector[14] = 0.09 + ((index % 9) * 0.001);
  return normalizeVector(vector);
}

function createStationRuntime(workspace: string) {
  return {
    random: (() => {
      const values = [0.13, 0.71, 0.27, 0.59, 0.41, 0.83, 0.19, 0.67];
      let index = 0;
      return () => values[index++ % values.length]!;
    })(),
    parseSidFile: async (filePath: string): Promise<SidFileMetadata> => ({
      type: "PSID",
      version: 2,
      title: path.basename(filePath),
      author: path.dirname(filePath).split(path.sep).slice(-2).join(" / "),
      released: "1990 Test Release",
      songs: 1,
      startSong: 1,
      clock: "PAL",
      sidModel1: "MOS6581",
      loadAddress: 0,
      initAddress: 0,
      playAddress: 0,
    }),
    lookupSongDurationMs: async () => 120_000,
    loadConfig: async () => ({
      sidPath: workspace,
      audioCachePath: workspace,
      tagsPath: workspace,
      classifiedPath: workspace,
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 0,
      classificationDepth: 3,
    }),
    fetchImpl: globalThis.fetch,
    stdout: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stderr: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stdin: process.stdin,
    cwd: () => workspace,
    now: () => new Date("2026-03-23T12:00:00.000Z"),
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

function createSeedTrack(track: FixtureTrack, workspace: string): StationTrackDetails {
  return {
    track_id: track.trackId,
    sid_path: track.sidPath,
    song_index: 1,
    e: 5,
    m: 4,
    c: 3,
    p: 4,
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 0,
    last_played: null,
    absolutePath: path.join(workspace, track.sidPath),
    title: path.basename(track.sidPath),
    author: "Test Author",
    released: "1990 Test Release",
    year: "1990",
    durationMs: 120_000,
  };
}

function buildCentroid(vectors: readonly number[][]): number[] {
  const centroid = new Array<number>(DIMENSIONS).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < DIMENSIONS; index += 1) {
      centroid[index] += vector[index] ?? 0;
    }
  }
  return normalizeVector(centroid.map((value) => value / Math.max(1, vectors.length)));
}

describe("station similarity end-to-end", () => {
  let tempRoot: string;
  let workspace: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let outputPath: string;
  let likedTracks: FixtureTrack[];
  let rejectedTracks: FixtureTrack[];
  let vectorsByTrackId: Map<string, number[]>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-similarity-"));
    workspace = path.join(tempRoot, "workspace");
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback");
    outputPath = path.join(tempRoot, "exports", "sidcorr-200.sqlite");
    likedTracks = [];
    rejectedTracks = [];
    vectorsByTrackId = new Map();

    await mkdir(workspace, { recursive: true });
    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });

    const lines: string[] = [];
    for (let index = 0; index < TOTAL_TRACKS; index += 1) {
      const isLikedCluster = index < LIKED_TRACK_COUNT;
      const clusterIndex = isLikedCluster ? index : index - LIKED_TRACK_COUNT;
      const sidPath = `${isLikedCluster ? "Liked" : "Rejected"}/track-${String(clusterIndex + 1).padStart(3, "0")}.sid`;
      const trackId = buildSimilarityTrackId(sidPath, 1);
      const vector = isLikedCluster ? createLikedVector(clusterIndex) : createRejectedVector(clusterIndex);
      const record = {
        sid_path: sidPath,
        song_index: 1,
        ratings: isLikedCluster ? { e: 5, m: 4, c: 3, p: 4 } : { e: 1, m: 1, c: 5, p: 2 },
        vector,
        features: {
          featureSetVersion: "1.3.0",
          sidFeatureVariant: "sid-native",
          sidTraceEventCount: 320 + index,
          sidWavePulseRatio: isLikedCluster ? 0.62 : 0.08,
          sidFilterMotion: isLikedCluster ? 0.44 : 0.11,
        },
        classified_at: `2026-03-23T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        source: "auto",
        render_engine: "wasm",
      };
      lines.push(JSON.stringify(record));
      vectorsByTrackId.set(trackId, vector);
      const fixtureTrack = { trackId, sidPath, vector };
      if (isLikedCluster) {
        likedTracks.push(fixtureTrack);
      } else {
        rejectedTracks.push(fixtureTrack);
      }

      const absolutePath = path.join(workspace, sidPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "PSID", "utf8");
    }

    await writeFile(path.join(classifiedPath, "classification_200.jsonl"), `${lines.join("\n")}\n`, "utf8");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("exports 200 SID-enriched songs to SQLite and keeps the station queue inside the liked cluster after 10 simulated likes", async () => {
    const exportResult = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      corpusVersion: "TEST-200",
      neighbors: 0,
    });

    expect(exportResult.manifest.track_count).toBe(200);
    expect(exportResult.manifest.vector_dimensions).toBe(24);
    expect(exportResult.manifest.feature_schema_version).toBe("1.3.0");

    const database = new Database(outputPath, { readonly: true, strict: true });
    try {
      const row = database.query("SELECT features_json FROM tracks WHERE track_id = ?").get(likedTracks[0]!.trackId) as { features_json: string | null };
      const features = JSON.parse(row.features_json ?? "{}");
      expect(features.sidFeatureVariant).toBe("sid-native");
      expect(features.sidTraceEventCount).toBeGreaterThan(0);
    } finally {
      database.close();
    }

    const likedSeeds = likedTracks.slice(0, RATED_SEED_COUNT);
    const simulator = new StationSimulator(likedSeeds.map((track) => createSeedTrack(track, workspace)), 0, { ratedTarget: 10 });
    const actions = likedSeeds.flatMap((_, index) => (
      index < likedSeeds.length - 1
        ? [{ type: "rate", rating: 5 } as const, { type: "next" } as const]
        : [{ type: "rate", rating: 5 } as const]
    ));
    simulator.applyActions(actions);

    const ratings = simulator.getState().ratings;
    expect(ratings.size).toBe(10);
    expect([...ratings.values()]).toEqual(new Array(10).fill(5));

    const queue = await buildStationQueue(
      outputPath,
      workspace,
      ratings,
      25,
      3,
      15,
      createStationRuntime(workspace),
      new Map(),
    );

    expect(queue).toHaveLength(25);
    expect(queue.every((track) => track.sid_path.startsWith("Liked/"))).toBeTrue();
    expect(queue.some((track) => track.sid_path.startsWith("Rejected/"))).toBeFalse();

    const likedCentroid = buildCentroid(likedSeeds.map((track) => vectorsByTrackId.get(track.trackId)!));
    for (const track of queue) {
      const vector = vectorsByTrackId.get(track.track_id);
      expect(vector).toBeDefined();
      expect(cosineSimilarity(likedCentroid, vector!)).toBeGreaterThan(0.93);
    }

    const renderedQueue = new StationSimulator(queue, 0, { ratedTarget: 10 }).renderScreen();
    expect(renderedQueue).toContain("Liked/");
    expect(renderedQueue).not.toContain("Rejected/");

    const rejectedCentroid = buildCentroid(rejectedTracks.slice(0, 10).map((track) => vectorsByTrackId.get(track.trackId)!));
    for (const track of queue) {
      const vector = vectorsByTrackId.get(track.track_id)!;
      expect(cosineSimilarity(rejectedCentroid, vector)).toBeLessThan(0.35);
    }
  });
});