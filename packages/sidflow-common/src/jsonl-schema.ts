/**
 * JSONL schema definitions for SIDFlow classification output and feedback logs.
 * 
 * These types define the canonical data format for classification results and
 * user feedback, stored as JSON Lines (JSONL) for efficient storage and merging.
 */

import type { TagRatings } from "./ratings.js";

/**
 * Extended audio features extracted from WAV files during classification.
 * All features are extensible - additional features can be added by classifiers.
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
  /** Audio duration in seconds (float) */
  duration?: number;
  /** Allow any additional feature fields */
  [feature: string]: number | undefined;
}

/**
 * Single classification record in JSONL format.
 * One record per line in classified/*.jsonl files.
 */
export interface ClassificationRecord {
  /** Full relative path within HVSC or local folders (ensures uniqueness) */
  sid_path: string;
  /** Rating dimensions (may originate from manual rating or classifier prediction) */
  ratings: TagRatings;
  /** All extracted audio features from classifier (optional, classifier output only) */
  features?: AudioFeatures;
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
