/**
 * Playlist builder using LanceDB and RecommendationEngine.
 */

import {
  createRecommendationEngine,
  type RecommendationEngine,
  type RecommendationQuery,
  type Recommendation,
  type MoodPresetName,
  MOOD_PRESETS
} from "@sidflow/common";

/**
 * Playlist builder options.
 */
export interface PlaylistBuilderOptions {
  /** Path to LanceDB database */
  dbPath: string;
}

/**
 * Playlist configuration for building custom playlists.
 */
export interface PlaylistConfig {
  /** Mood preset or custom seed ratings */
  seed: MoodPresetName | { e: number; m: number; c: number; p?: number };
  /** Number of songs in playlist */
  limit?: number;
  /** Optional filters */
  filters?: {
    /** BPM range [min, max] */
    bpmRange?: [number, number];
    /** Energy range [min, max] */
    energyRange?: [number, number];
    /** Mood range [min, max] */
    moodRange?: [number, number];
    /** Complexity range [min, max] */
    complexityRange?: [number, number];
  };
  /** Exploration factor (0-1) */
  explorationFactor?: number;
  /** Diversity threshold */
  diversityThreshold?: number;
}

/**
 * A playlist with recommendations and metadata.
 */
export interface Playlist {
  /** Playlist metadata */
  metadata: {
    /** Generation timestamp */
    createdAt: string;
    /** Seed used for generation */
    seed: PlaylistConfig["seed"];
    /** Number of songs */
    count: number;
    /** Applied filters */
    filters?: PlaylistConfig["filters"];
  };
  /** Recommended songs in order */
  songs: Recommendation[];
}

/**
 * Playlist builder class.
 */
export class PlaylistBuilder {
  private engine: RecommendationEngine;
  private connected: boolean = false;

  constructor(options: PlaylistBuilderOptions) {
    this.engine = createRecommendationEngine({ dbPath: options.dbPath });
  }

  /**
   * Initialize database connection.
   */
  async connect(): Promise<void> {
    await this.engine.connect();
    this.connected = true;
  }

  /**
   * Build a playlist based on configuration.
   */
  async build(config: PlaylistConfig): Promise<Playlist> {
    if (!this.connected) {
      throw new Error("PlaylistBuilder not connected. Call connect() first.");
    }

    // Construct recommendation query
    const query: RecommendationQuery = {
      seed: config.seed,
      limit: config.limit,
      explorationFactor: config.explorationFactor,
      diversityThreshold: config.diversityThreshold,
      ...config.filters
    };

    // Get recommendations
    const songs = await this.engine.recommend(query);

    // Build playlist
    return {
      metadata: {
        createdAt: new Date().toISOString(),
        seed: config.seed,
        count: songs.length,
        filters: config.filters
      },
      songs
    };
  }

  /**
   * Get available mood presets.
   */
  getMoodPresets(): Record<string, { e: number; m: number; c: number }> {
    return { ...MOOD_PRESETS };
  }

  /**
   * Disconnect from database.
   */
  async disconnect(): Promise<void> {
    await this.engine.disconnect();
    this.connected = false;
  }
}

/**
 * Create a playlist builder instance.
 */
export function createPlaylistBuilder(
  options: PlaylistBuilderOptions
): PlaylistBuilder {
  return new PlaylistBuilder(options);
}
