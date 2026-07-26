/**
 * Load a classification run's raw features and rebuild perceptual vectors offline.
 *
 * ## Why this exists
 *
 * The perceptual vector is normally computed during classification and frozen
 * into the export. That makes every feature-set experiment cost a full
 * re-classification — around two hours for the development corpus — which is far
 * too slow to search a feature space with.
 *
 * But the vector is a pure function of the raw features plus a corpus-level
 * normalisation model, and the raw features are all written to the features
 * JSONL. So the vector can be rebuilt offline, in seconds, for any number of
 * candidate definitions. Classification then only has to run when the FEATURES
 * change, not when their combination does.
 *
 * This is what makes feature selection a first-class part of the optimisation
 * loop rather than a thing done by hand.
 *
 * ## Trust
 *
 * `verifyAgainstExport` reproduces the shipped vector from the same inputs and
 * compares it to what the export actually stored. If that matches to float
 * precision, offline experiments are measuring the real pipeline rather than a
 * plausible reimplementation of it.
 */

import { readFileSync } from "node:fs";

import {
  DeterministicRatingModelBuilder,
  buildPerceptualVector,
  type DeterministicRatingModel,
} from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import type { FeatureVector } from "../../packages/sidflow-classify/src/index.js";

export interface FeatureRecord {
  sidPath: string;
  songIndex: number;
  trackId: string;
  renderEngine: string;
  features: FeatureVector;
}

/**
 * The features JSONL has no song_index column; the song is encoded in auto_key as
 * "<file>.sid:<n>", with the bare filename meaning song 1. Deriving it here keeps
 * the offline track ids identical to buildSimilarityTrackId's, so an offline
 * result can be joined against an export.
 */
function songIndexFromAutoKey(autoKey: unknown): number {
  if (typeof autoKey !== "string") return 1;
  const colon = autoKey.lastIndexOf(":");
  if (colon < 0) return 1;
  const parsed = Number.parseInt(autoKey.slice(colon + 1), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function loadFeatureRecords(jsonlPath: string): FeatureRecord[] {
  const out: FeatureRecord[] = [];
  for (const line of readFileSync(jsonlPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed: {
      sid_path?: string;
      auto_key?: string;
      render_engine?: string;
      features?: FeatureVector;
    };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed.sid_path || !parsed.features) continue;
    const songIndex = songIndexFromAutoKey(parsed.auto_key);
    out.push({
      sidPath: parsed.sid_path,
      songIndex,
      trackId: `${parsed.sid_path}#${songIndex}`,
      renderEngine: typeof parsed.render_engine === "string" ? parsed.render_engine : "unknown",
      features: parsed.features,
    });
  }
  return out;
}

/**
 * Rebuild the corpus normalisation model.
 *
 * Built from the same records the vectors are computed for, which is what
 * classification does. Note the consequence: the model is corpus-relative, so a
 * feature's normalised value depends on the rest of the corpus. That is
 * deliberate — it is what makes the ratings and vector comparable across tunes —
 * but it means a subsample's model differs slightly from the full corpus's.
 */
export function buildModel(records: FeatureRecord[]): DeterministicRatingModel {
  const builder = new DeterministicRatingModelBuilder();
  let renderEngine = "unknown";
  for (const record of records) {
    if (record.renderEngine && record.renderEngine !== "unknown") renderEngine = record.renderEngine;
    builder.add(record.features);
  }
  return builder.finalize(renderEngine);
}

/** The vector the product builds today, recomputed from raw features. */
export function shippedVector(model: DeterministicRatingModel, features: FeatureVector): number[] {
  return buildPerceptualVector(model, features);
}

export interface VerificationResult {
  compared: number;
  missingFromExport: number;
  maxAbsoluteDifference: number;
  mismatchedTracks: string[];
}

/**
 * Compare offline-rebuilt vectors against an export's stored vectors.
 *
 * `tolerance` is generous by float standards because the export round-trips
 * through JSON; anything beyond it means the offline path is not reproducing the
 * pipeline and no offline result should be believed.
 */
export function verifyAgainstExport(
  records: FeatureRecord[],
  exportVectors: Map<string, number[]>,
  tolerance = 1e-9,
): VerificationResult {
  const model = buildModel(records);
  let compared = 0;
  let missing = 0;
  let worst = 0;
  const mismatched: string[] = [];

  for (const record of records) {
    const stored = exportVectors.get(record.trackId);
    if (!stored) {
      missing++;
      continue;
    }
    const rebuilt = shippedVector(model, record.features);
    compared++;
    let localWorst = 0;
    const shared = Math.min(stored.length, rebuilt.length);
    for (let i = 0; i < shared; i++) {
      localWorst = Math.max(localWorst, Math.abs(stored[i]! - rebuilt[i]!));
    }
    if (stored.length !== rebuilt.length) localWorst = Number.POSITIVE_INFINITY;
    worst = Math.max(worst, localWorst);
    if (localWorst > tolerance && mismatched.length < 10) mismatched.push(record.trackId);
  }

  return {
    compared,
    missingFromExport: missing,
    maxAbsoluteDifference: worst,
    mismatchedTracks: mismatched,
  };
}
