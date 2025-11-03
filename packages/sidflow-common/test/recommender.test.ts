import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "vectordb";
import {
  RecommendationEngine,
  createRecommendationEngine,
  MOOD_PRESETS,
  DEFAULT_SCORING_WEIGHTS,
  type Recommendation
} from "../src/recommender.js";
import type { DatabaseRecord } from "../src/lancedb-builder.js";

const TEST_DB_PATH = "/tmp/test-recommender-db";

/**
 * Create test database with sample records.
 */
async function createTestDatabase(records: DatabaseRecord[]): Promise<void> {
  await rm(TEST_DB_PATH, { recursive: true, force: true });
  await mkdir(TEST_DB_PATH, { recursive: true });

  const db = await connect(TEST_DB_PATH);
  await db.createTable("sidflow", records);
}

describe("RecommendationEngine", () => {
  const sampleRecords: DatabaseRecord[] = [
    {
      sid_path: "quiet_song.sid",
      vector: [1, 2, 1, 3],
      e: 1,
      m: 2,
      c: 1,
      p: 3,
      likes: 5,
      dislikes: 0,
      skips: 1,
      plays: 10,
      features_json: JSON.stringify({ bpm: 80, energy: 0.2, rms: 0.1 })
    },
    {
      sid_path: "energetic_song.sid",
      vector: [5, 5, 4, 4],
      e: 5,
      m: 5,
      c: 4,
      p: 4,
      likes: 10,
      dislikes: 2,
      skips: 3,
      plays: 20,
      features_json: JSON.stringify({ bpm: 150, energy: 0.8, rms: 0.7 })
    },
    {
      sid_path: "dark_song.sid",
      vector: [3, 1, 3, 2],
      e: 3,
      m: 1,
      c: 3,
      p: 2,
      likes: 3,
      dislikes: 5,
      skips: 8,
      plays: 15,
      features_json: JSON.stringify({ bpm: 100, energy: 0.4, rms: 0.3 })
    },
    {
      sid_path: "bright_song.sid",
      vector: [4, 5, 3, 5],
      e: 4,
      m: 5,
      c: 3,
      p: 5,
      likes: 15,
      dislikes: 1,
      skips: 0,
      plays: 25,
      features_json: JSON.stringify({ bpm: 120, energy: 0.6, rms: 0.5 })
    },
    {
      sid_path: "complex_song.sid",
      vector: [3, 3, 5, 3],
      e: 3,
      m: 3,
      c: 5,
      p: 3,
      likes: 7,
      dislikes: 2,
      skips: 2,
      plays: 12,
      features_json: JSON.stringify({ bpm: 110, energy: 0.5, rms: 0.4 })
    },
    {
      sid_path: "ambient_song.sid",
      vector: [2, 3, 2, 4],
      e: 2,
      m: 3,
      c: 2,
      p: 4,
      likes: 8,
      dislikes: 1,
      skips: 1,
      plays: 15,
      features_json: JSON.stringify({ bpm: 90, energy: 0.3, rms: 0.2 })
    }
  ];

  beforeAll(async () => {
    await createTestDatabase(sampleRecords);
  });

  afterAll(async () => {
    await rm(TEST_DB_PATH, { recursive: true, force: true });
  });

  test("createRecommendationEngine creates instance", () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    expect(engine).toBeInstanceOf(RecommendationEngine);
  });

  test("connect initializes database connection", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();
    await engine.disconnect();
  });

  test("recommend with quiet mood preset returns appropriate songs", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "quiet",
      limit: 3
    });

    expect(recommendations.length).toBeLessThanOrEqual(3);
    expect(recommendations.length).toBeGreaterThan(0);
    
    // First recommendation should be closest to quiet preset [1,2,1]
    const first = recommendations[0];
    expect(first.sid_path).toBeDefined();
    expect(first.score).toBeGreaterThan(0);
    expect(first.similarity).toBeGreaterThan(0);
    expect(first.ratings.e).toBeDefined();
    expect(first.ratings.m).toBeDefined();
    expect(first.ratings.c).toBeDefined();

    await engine.disconnect();
  });

  test("recommend with energetic mood preset returns high-energy songs", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "energetic",
      limit: 3
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // Energetic songs should have higher energy ratings
    const topSong = recommendations[0];
    expect(topSong.ratings.e).toBeGreaterThanOrEqual(3);

    await engine.disconnect();
  });

  test("recommend with custom seed vector works", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: { e: 3, m: 3, c: 5 }, // Looking for complex songs
      limit: 3
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].ratings.c).toBeDefined();

    await engine.disconnect();
  });

  test("scoring weights affect recommendation order", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    // Get recommendations with default weights
    const defaultRecs = await engine.recommend({
      seed: "bright",
      limit: 3,
      weights: DEFAULT_SCORING_WEIGHTS
    });

    // Get recommendations emphasizing feedback
    const feedbackRecs = await engine.recommend({
      seed: "bright",
      limit: 3,
      weights: { alpha: 0.2, beta: 0.7, gamma: 0.1 }
    });

    expect(defaultRecs.length).toBeGreaterThan(0);
    expect(feedbackRecs.length).toBeGreaterThan(0);
    
    // Scores should be different due to weight changes
    expect(defaultRecs[0].score).not.toBe(feedbackRecs[0].score);

    await engine.disconnect();
  });

  test("diversity filter prevents similar consecutive songs", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "ambient",
      limit: 5,
      diversityThreshold: 2.0 // High threshold for testing
    });

    // With high diversity threshold, consecutive songs should be different
    for (let i = 1; i < recommendations.length; i++) {
      const current = recommendations[i];
      const previous = recommendations[i - 1];
      
      // Check they're not identical
      expect(current.sid_path).not.toBe(previous.sid_path);
      
      // Distance should be recorded
      if (current.distanceFromPrevious !== undefined) {
        expect(current.distanceFromPrevious).toBeGreaterThanOrEqual(0);
      }
    }

    await engine.disconnect();
  });

  test("exploration factor affects recommendation diversity", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    // Low exploration (exploit preferences)
    const exploitRecs = await engine.recommend({
      seed: "energetic",
      limit: 3,
      explorationFactor: 0.0
    });

    // High exploration (explore diversity)
    const exploreRecs = await engine.recommend({
      seed: "energetic",
      limit: 3,
      explorationFactor: 1.0
    });

    expect(exploitRecs.length).toBeGreaterThan(0);
    expect(exploreRecs.length).toBeGreaterThan(0);

    // Scores should differ between exploration modes
    const exploitScores = exploitRecs.map(r => r.score);
    const exploreScores = exploreRecs.map(r => r.score);
    expect(exploitScores).not.toEqual(exploreScores);

    await engine.disconnect();
  });

  test("BPM range filter works", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "ambient",
      limit: 10,
      bpmRange: [80, 100] // Only quiet to mid-tempo songs
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // Check that all results have BPM in range
    for (const rec of recommendations) {
      if (rec.features && "bpm" in rec.features) {
        const bpm = rec.features.bpm as number;
        expect(bpm).toBeGreaterThanOrEqual(80);
        expect(bpm).toBeLessThanOrEqual(100);
      }
    }

    await engine.disconnect();
  });

  test("energy range filter works", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "bright",
      limit: 10,
      energyRange: [3, 5] // High energy only
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // All results should have energy >= 3
    for (const rec of recommendations) {
      expect(rec.ratings.e).toBeGreaterThanOrEqual(3);
      expect(rec.ratings.e).toBeLessThanOrEqual(5);
    }

    await engine.disconnect();
  });

  test("mood range filter works", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "dark",
      limit: 10,
      moodRange: [1, 3] // Dark to neutral moods
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // All results should have mood in range
    for (const rec of recommendations) {
      expect(rec.ratings.m).toBeGreaterThanOrEqual(1);
      expect(rec.ratings.m).toBeLessThanOrEqual(3);
    }

    await engine.disconnect();
  });

  test("complexity range filter works", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "complex",
      limit: 10,
      complexityRange: [4, 5] // High complexity only
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // All results should have high complexity
    for (const rec of recommendations) {
      expect(rec.ratings.c).toBeGreaterThanOrEqual(4);
      expect(rec.ratings.c).toBeLessThanOrEqual(5);
    }

    await engine.disconnect();
  });

  test("recommendations include feedback statistics", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "bright",
      limit: 3
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    for (const rec of recommendations) {
      expect(rec.feedback).toBeDefined();
      expect(rec.feedback.likes).toBeGreaterThanOrEqual(0);
      expect(rec.feedback.dislikes).toBeGreaterThanOrEqual(0);
      expect(rec.feedback.skips).toBeGreaterThanOrEqual(0);
      expect(rec.feedback.plays).toBeGreaterThanOrEqual(0);
    }

    await engine.disconnect();
  });

  test("recommendations include extracted features", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "energetic",
      limit: 3
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    const recWithFeatures = recommendations.find(r => r.features !== undefined);
    expect(recWithFeatures).toBeDefined();
    
    if (recWithFeatures?.features) {
      expect(recWithFeatures.features.bpm).toBeDefined();
      expect(recWithFeatures.features.energy).toBeDefined();
    }

    await engine.disconnect();
  });

  test("limit parameter controls result count", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const small = await engine.recommend({ seed: "ambient", limit: 2 });
    const large = await engine.recommend({ seed: "ambient", limit: 5 });

    expect(small.length).toBeLessThanOrEqual(2);
    expect(large.length).toBeLessThanOrEqual(5);
    expect(large.length).toBeGreaterThanOrEqual(small.length);

    await engine.disconnect();
  });

  test("k parameter affects candidate pool size", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    // Small k means fewer candidates
    const smallK = await engine.recommend({
      seed: "bright",
      limit: 3,
      k: 3
    });

    // Large k means more candidates (before filtering)
    const largeK = await engine.recommend({
      seed: "bright",
      limit: 3,
      k: 100
    });

    expect(smallK.length).toBeGreaterThan(0);
    expect(largeK.length).toBeGreaterThan(0);

    await engine.disconnect();
  });

  test("mood presets are all defined", () => {
    expect(MOOD_PRESETS.quiet).toBeDefined();
    expect(MOOD_PRESETS.ambient).toBeDefined();
    expect(MOOD_PRESETS.energetic).toBeDefined();
    expect(MOOD_PRESETS.dark).toBeDefined();
    expect(MOOD_PRESETS.bright).toBeDefined();
    expect(MOOD_PRESETS.complex).toBeDefined();
    
    // Verify all presets have e, m, c values
    for (const preset of Object.values(MOOD_PRESETS)) {
      expect(preset.e).toBeGreaterThanOrEqual(1);
      expect(preset.e).toBeLessThanOrEqual(5);
      expect(preset.m).toBeGreaterThanOrEqual(1);
      expect(preset.m).toBeLessThanOrEqual(5);
      expect(preset.c).toBeGreaterThanOrEqual(1);
      expect(preset.c).toBeLessThanOrEqual(5);
    }
  });

  test("recommendations are sorted by score descending", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "bright",
      limit: 5
    });

    expect(recommendations.length).toBeGreaterThan(1);
    
    // Verify scores are in descending order
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].score).toBeGreaterThanOrEqual(recommendations[i].score);
    }

    await engine.disconnect();
  });

  test("song feedback scoring considers likes, dislikes, and skips", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "bright",
      limit: 6
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // Find a song with positive feedback
    const positiveSong = recommendations.find(r => r.feedback.likes > r.feedback.dislikes);
    if (positiveSong) {
      expect(positiveSong.songFeedback).toBeGreaterThan(0);
    }

    await engine.disconnect();
  });

  test("user affinity considers preference ratings", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    await engine.connect();

    const recommendations = await engine.recommend({
      seed: "ambient",
      limit: 6,
      weights: { alpha: 0.1, beta: 0.1, gamma: 0.8 } // Emphasize user affinity
    });

    expect(recommendations.length).toBeGreaterThan(0);
    
    // High preference songs should score better with high gamma
    const highPrefSong = recommendations.find(r => r.ratings.p && r.ratings.p >= 4);
    if (highPrefSong) {
      expect(highPrefSong.userAffinity).toBeGreaterThan(0.5);
    }

    await engine.disconnect();
  });

  test("handles database with no tables gracefully", async () => {
    const emptyDbPath = "/tmp/test-empty-db";
    await rm(emptyDbPath, { recursive: true, force: true });
    await mkdir(emptyDbPath, { recursive: true });
    await connect(emptyDbPath); // Create empty database

    const engine = createRecommendationEngine({ dbPath: emptyDbPath });
    
    await expect(engine.connect()).rejects.toThrow("No tables found");
    
    await rm(emptyDbPath, { recursive: true, force: true });
  });

  test("throws error when recommending before connecting", async () => {
    const engine = createRecommendationEngine({ dbPath: TEST_DB_PATH });
    
    await expect(engine.recommend({ seed: "quiet" })).rejects.toThrow(
      "Database not connected"
    );
  });
});
