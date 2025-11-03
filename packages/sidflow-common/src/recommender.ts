/**
 * Recommendation engine for SIDFlow.
 * 
 * Implements mood-based similarity search using LanceDB vector similarity,
 * scoring formulas combining similarity + feedback + user affinity,
 * and exploration controls to prevent preference bubbles.
 */

import { connect, type Table } from "vectordb";
import type { DatabaseRecord } from "./lancedb-builder.js";
import { DEFAULT_RATING } from "./ratings.js";

/**
 * Mood preset definitions for quick seed selections.
 */
export const MOOD_PRESETS = {
  quiet: { e: 1, m: 2, c: 1 },
  ambient: { e: 2, m: 3, c: 2 },
  energetic: { e: 5, m: 5, c: 4 },
  dark: { e: 3, m: 1, c: 3 },
  bright: { e: 4, m: 5, c: 3 },
  complex: { e: 3, m: 3, c: 5 }
} as const;

export type MoodPresetName = keyof typeof MOOD_PRESETS;

/**
 * Scoring weights for recommendation formula.
 * score = α·similarity + β·song_feedback + γ·user_affinity
 */
export interface ScoringWeights {
  /** Similarity weight (default: 0.6) */
  alpha: number;
  /** Song feedback weight (default: 0.3) */
  beta: number;
  /** User affinity weight (default: 0.1) */
  gamma: number;
}

/**
 * Default scoring weights as specified in Phase 8.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  alpha: 0.6,
  beta: 0.3,
  gamma: 0.1
};

/**
 * Query parameters for recommendations.
 */
export interface RecommendationQuery {
  /** Seed mood preset name or custom ratings */
  seed: MoodPresetName | { e: number; m: number; c: number; p?: number };
  /** Number of recommendations to return (default: 20) */
  limit?: number;
  /** Scoring weights (default: DEFAULT_SCORING_WEIGHTS) */
  weights?: Partial<ScoringWeights>;
  /** Minimum diversity threshold between consecutive songs (default: 0.2) */
  diversityThreshold?: number;
  /** Exploration factor 0-1 (0=exploit preferences, 1=explore diversity) (default: 0.2) */
  explorationFactor?: number;
  /** Number of nearest neighbors to consider (default: 100) */
  k?: number;
  /** Optional BPM matching range (e.g., [120, 140]) */
  bpmRange?: [number, number];
  /** Optional energy range filter (e.g., [3, 5]) */
  energyRange?: [number, number];
  /** Optional mood range filter (e.g., [1, 3]) */
  moodRange?: [number, number];
  /** Optional complexity range filter (e.g., [4, 5]) */
  complexityRange?: [number, number];
}

/**
 * A recommended song with metadata and scores.
 */
export interface Recommendation {
  /** SID path */
  sid_path: string;
  /** Final recommendation score */
  score: number;
  /** Cosine similarity to query vector */
  similarity: number;
  /** Song feedback score component */
  songFeedback: number;
  /** User affinity score component */
  userAffinity: number;
  /** Rating dimensions */
  ratings: {
    e: number;
    m: number;
    c: number;
    p?: number;
  };
  /** Feedback statistics */
  feedback: {
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
  };
  /** Extracted features (if available) */
  features?: Record<string, unknown>;
  /** Distance from previous song (for diversity tracking) */
  distanceFromPrevious?: number;
}

/**
 * Options for recommendation engine.
 */
export interface RecommendationEngineOptions {
  /** Path to LanceDB database */
  dbPath: string;
}

/**
 * Recommendation engine class.
 */
export class RecommendationEngine {
  private dbPath: string;
  private table?: Table;

  constructor(options: RecommendationEngineOptions) {
    this.dbPath = options.dbPath;
  }

  /**
   * Initialize database connection.
   */
  async connect(): Promise<void> {
    const db = await connect(this.dbPath);
    const tables = await db.tableNames();
    
    if (tables.length === 0) {
      throw new Error(`No tables found in database at ${this.dbPath}`);
    }
    
    // Use the first table (should be "sidflow" or similar)
    this.table = await db.openTable(tables[0]);
  }

  /**
   * Get recommendations based on query parameters.
   */
  async recommend(query: RecommendationQuery): Promise<Recommendation[]> {
    if (!this.table) {
      throw new Error("Database not connected. Call connect() first.");
    }

    // Resolve seed to rating vector
    const seedVector = this.resolveSeed(query.seed);
    
    // Apply defaults
    const limit = query.limit ?? 20;
    const k = query.k ?? 100;
    const diversityThreshold = query.diversityThreshold ?? 0.2;
    const explorationFactor = query.explorationFactor ?? 0.2;
    const weights = { ...DEFAULT_SCORING_WEIGHTS, ...query.weights };

    // Perform vector similarity search
    const candidates = await this.vectorSearch(seedVector, k);
    
    // Apply extended feature filters
    let filtered = this.applyFilters(candidates, query);
    
    // Score and rank candidates
    const scored = this.scoreRecommendations(filtered, seedVector, weights, explorationFactor);
    
    // Apply diversity filtering
    const diverse = this.applyDiversityFilter(scored, diversityThreshold);
    
    // Return top recommendations
    return diverse.slice(0, limit);
  }

  /**
   * Resolve seed (preset or custom) to rating vector.
   */
  private resolveSeed(seed: RecommendationQuery["seed"]): number[] {
    if (typeof seed === "string") {
      const preset = MOOD_PRESETS[seed];
      return [preset.e, preset.m, preset.c, DEFAULT_RATING];
    }
    return [seed.e, seed.m, seed.c, seed.p ?? DEFAULT_RATING];
  }

  /**
   * Perform vector similarity search using LanceDB.
   */
  private async vectorSearch(vector: number[], k: number): Promise<DatabaseRecord[]> {
    if (!this.table) {
      throw new Error("Table not initialized");
    }

    // Query using LanceDB vector search
    const results = await this.table
      .search(vector)
      .limit(k)
      .execute();

    return results as DatabaseRecord[];
  }

  /**
   * Apply extended feature filters (BPM, energy range, etc.).
   */
  private applyFilters(
    records: DatabaseRecord[],
    query: RecommendationQuery
  ): DatabaseRecord[] {
    let filtered = records;

    // Energy range filter
    if (query.energyRange) {
      const [min, max] = query.energyRange;
      filtered = filtered.filter(r => r.e >= min && r.e <= max);
    }

    // Mood range filter
    if (query.moodRange) {
      const [min, max] = query.moodRange;
      filtered = filtered.filter(r => r.m >= min && r.m <= max);
    }

    // Complexity range filter
    if (query.complexityRange) {
      const [min, max] = query.complexityRange;
      filtered = filtered.filter(r => r.c >= min && r.c <= max);
    }

    // BPM range filter (requires features)
    if (query.bpmRange) {
      const [min, max] = query.bpmRange;
      filtered = filtered.filter(r => {
        if (!r.features_json) return false;
        try {
          const features = JSON.parse(r.features_json);
          const bpm = features.bpm;
          return typeof bpm === "number" && bpm >= min && bpm <= max;
        } catch {
          return false;
        }
      });
    }

    return filtered;
  }

  /**
   * Score recommendations using the formula:
   * score = α·similarity + β·song_feedback + γ·user_affinity
   */
  private scoreRecommendations(
    records: DatabaseRecord[],
    seedVector: number[],
    weights: ScoringWeights,
    explorationFactor: number
  ): Recommendation[] {
    return records.map(record => {
      // Compute cosine similarity
      const similarity = this.cosineSimilarity(seedVector, record.vector);
      
      // Compute song feedback score
      const songFeedback = this.computeSongFeedback(record);
      
      // Compute user affinity (based on preference rating)
      const userAffinity = this.computeUserAffinity(record);
      
      // Apply exploration adjustment
      const explorationBoost = this.computeExplorationBoost(
        similarity,
        explorationFactor
      );
      
      // Final score with exploration
      const baseScore =
        weights.alpha * similarity +
        weights.beta * songFeedback +
        weights.gamma * userAffinity;
      
      const score = baseScore + explorationBoost;

      // Parse features if available
      let features: Record<string, unknown> | undefined;
      if (record.features_json) {
        try {
          features = JSON.parse(record.features_json);
        } catch {
          // Ignore parse errors
        }
      }

      return {
        sid_path: record.sid_path,
        score,
        similarity,
        songFeedback,
        userAffinity,
        ratings: {
          e: record.e,
          m: record.m,
          c: record.c,
          p: record.p
        },
        feedback: {
          likes: record.likes,
          dislikes: record.dislikes,
          skips: record.skips,
          plays: record.plays
        },
        features
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vector dimensions must match");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Compute song feedback score: (likes - dislikes - 0.3·skips) / max(plays, 1)
   */
  private computeSongFeedback(record: DatabaseRecord): number {
    const plays = Math.max(record.plays, 1);
    const score = (record.likes - record.dislikes - 0.3 * record.skips) / plays;
    
    // Normalize to [0, 1] range assuming feedback scores typically range from -2 to +2
    return Math.max(0, Math.min(1, (score + 2) / 4));
  }

  /**
   * Compute user affinity based on preference rating.
   * Higher preference ratings indicate stronger user affinity.
   */
  private computeUserAffinity(record: DatabaseRecord): number {
    if (record.p === undefined) {
      return 0.5; // Neutral for songs without preference
    }
    
    // Normalize preference (1-5) to [0, 1]
    return (record.p - 1) / 4;
  }

  /**
   * Compute exploration boost to introduce diversity.
   * Higher exploration factors favor more diverse (lower similarity) songs.
   */
  private computeExplorationBoost(similarity: number, explorationFactor: number): number {
    // Boost inversely proportional to similarity when exploring
    // Range: [-0.2 to +0.2] for typical exploration factors
    const diversity = 1 - similarity;
    return explorationFactor * diversity * 0.2;
  }

  /**
   * Apply diversity filter to prevent consecutive similar songs.
   */
  private applyDiversityFilter(
    recommendations: Recommendation[],
    threshold: number
  ): Recommendation[] {
    if (recommendations.length === 0) {
      return [];
    }

    const diverse: Recommendation[] = [recommendations[0]];

    for (let i = 1; i < recommendations.length; i++) {
      const current = recommendations[i];
      const previous = diverse[diverse.length - 1];

      // Compute distance between rating vectors
      const distance = this.euclideanDistance(
        [current.ratings.e, current.ratings.m, current.ratings.c],
        [previous.ratings.e, previous.ratings.m, previous.ratings.c]
      );

      // Include if distance exceeds threshold
      if (distance >= threshold) {
        current.distanceFromPrevious = distance;
        diverse.push(current);
      }
    }

    return diverse;
  }

  /**
   * Compute Euclidean distance between two vectors.
   */
  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  /**
   * Close database connection.
   */
  async disconnect(): Promise<void> {
    // LanceDB connections are managed automatically
    this.table = undefined;
  }
}

/**
 * Create a recommendation engine instance.
 */
export function createRecommendationEngine(
  options: RecommendationEngineOptions
): RecommendationEngine {
  return new RecommendationEngine(options);
}
