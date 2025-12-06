/**
 * JSONL schema definitions for SIDFlow classification output and feedback logs.
 * 
 * These types define the canonical data format for classification results and
 * user feedback, stored as JSON Lines (JSONL) for efficient storage and merging.
 */

import type { TagRatings } from "./ratings.js";

/**
 * Feature set version for tracking breaking changes to feature schema.
 * Increment when adding/removing features or changing computation methods.
 */
export const FEATURE_SCHEMA_VERSION = "1.1.0";

/**
 * Extended audio features extracted from WAV files during classification.
 * All features are extensible - additional features can be added by classifiers.
 * 
 * Contracts:
 * - Each song produces exactly one JSONL line with ratings and Essentia-derived features
 * - Features carry analysis metadata (sample rate, window, version)
 * - Essentia is required by default; degraded paths only run with explicit flag
 * - Duration/numSamples reflect the analyzed window
 */
export interface AudioFeatures {
  /** Signal energy (float) */
  energy?: number;
  /** Root mean square amplitude (float) */
  rms?: number;
  /** Spectral center of mass in Hz (float) */
  spectralCentroid?: number;
  /** Frequency below which 85% of spectrum energy is contained (float) */
  spectralRolloff?: number;
  /** Rate of sign changes in signal (float) */
  zeroCrossingRate?: number;
  /** Estimated tempo in beats per minute (float) */
  bpm?: number;
  /** Confidence score for tempo estimation (0-1) */
  confidence?: number;
  /** Audio duration in seconds of analyzed window (float) */
  duration?: number;
  /** Number of samples analyzed after downsampling */
  numSamples?: number;
  /** Original sample rate of source WAV (Hz) */
  sampleRate?: number;
  /** Sample rate used for feature extraction (Hz) */
  analysisSampleRate?: number;
  /** Analysis window length in seconds */
  analysisWindowSec?: number;
  /** Feature set version identifier */
  featureSetVersion?: string;
  /** Variant: 'essentia' | 'heuristic' | 'cached' */
  featureVariant?: string;
  /** Allow any additional feature fields */
  [feature: string]: number | string | undefined;
}

/**
 * Single classification record in JSONL format.
 * One record per line in classified/*.jsonl files.
 * 
 * Contracts:
 * - Each song produces exactly one record with ratings and Essentia-derived features
 * - Records carry both original audio metadata and analysis settings
 * - JSONL writes are serialized; ordering is deterministic
 * - Partial writes on failure are prevented
 */
export interface ClassificationRecord {
  /** Full relative path within HVSC or local folders */
  sid_path: string;
  /** Song index within the SID file (1-based, optional for backwards compatibility) */
  song_index?: number;
  /** Rating dimensions (may originate from manual rating or classifier prediction) */
  ratings: TagRatings;
  /** All extracted audio features from classifier (optional, classifier output only) */
  features?: AudioFeatures;
  /** Classification timestamp (ISO 8601) */
  classified_at?: string;
  /** Source of ratings: 'auto' | 'manual' | 'mixed' */
  source?: string;
  /** Whether degraded feature extraction was used */
  degraded?: boolean;
  /** Render engine used: 'wasm' | 'sidplayfp-cli' */
  render_engine?: string;
}

/**
 * User feedback actions with defined weighting.
 */
export type FeedbackAction = "play" | "like" | "dislike" | "skip";

/**
 * Single feedback event in JSONL format.
 * One event per line in feedback/YYYY/MM/DD/events.jsonl files.
 */
export interface FeedbackRecord {
  /** ISO 8601 timestamp with timezone */
  ts: string;
  /** Full relative path matching classification records */
  sid_path: string;
  /** Song index within the SID file (1-based, optional for backwards compatibility) */
  song_index?: number;
  /** User interaction type */
  action: FeedbackAction;
  /** Optional unique event ID for deduplication */
  uuid?: string;
}

/**
 * Feedback action weights for recommendation scoring.
 */
export const FEEDBACK_WEIGHTS: Record<FeedbackAction, number> = {
  like: 1.0,
  skip: -0.3,
  dislike: -1.0,
  play: 0.0
} as const;
