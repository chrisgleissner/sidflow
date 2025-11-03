/**
 * Training module for SIDFlow ML model.
 * 
 * Provides functions for loading training data from JSONL files,
 * merging explicit and implicit feedback, and training the model.
 */

import { readdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  pathExists,
  type AudioFeatures,
  type ClassificationRecord,
  type FeedbackRecord,
  type TagRatings
} from "@sidflow/common";
import type { FeatureVector } from "@sidflow/classify";
import {
  trainOnFeedback,
  evaluateModel,
  type TrainOptions,
  type TrainingSummary
} from "@sidflow/classify";

/**
 * Training sample with features and target ratings.
 */
export interface TrainingSample {
  features: FeatureVector;
  ratings: TagRatings;
  weight: number;
  source: "explicit" | "implicit";
}

/**
 * Feedback action weights for implicit training.
 */
export const FEEDBACK_WEIGHTS: Record<string, number> = {
  like: 0.7,
  dislike: 0.5,
  skip: 0.3,
  play: 0.0
};

/**
 * Load classification records from JSONL files.
 * 
 * @param classifiedPath - Path to classified directory
 * @returns Array of classification records
 */
export async function loadClassifications(
  classifiedPath: string
): Promise<ClassificationRecord[]> {
  if (!(await pathExists(classifiedPath))) {
    return [];
  }

  const records: ClassificationRecord[] = [];
  const files = await readdir(classifiedPath);

  for (const file of files) {
    if (!file.endsWith(".jsonl")) {
      continue;
    }

    const filePath = path.join(classifiedPath, file);
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as ClassificationRecord;
        records.push(record);
      } catch (error) {
        console.warn(`Failed to parse classification record: ${error}`);
      }
    }
  }

  return records;
}

/**
 * Load feedback records from JSONL files.
 * 
 * @param feedbackPath - Path to feedback directory
 * @returns Array of feedback records
 */
export async function loadFeedback(feedbackPath: string): Promise<FeedbackRecord[]> {
  if (!(await pathExists(feedbackPath))) {
    return [];
  }

  const records: FeedbackRecord[] = [];

  // Walk through date-partitioned directories
  async function walkFeedback(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walkFeedback(fullPath);
        } else if (entry.isFile() && entry.name === "events.jsonl") {
          const content = await readFile(fullPath, "utf8");
          const lines = content.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const record = JSON.parse(line) as FeedbackRecord;
              records.push(record);
            } catch (error) {
              console.warn(`Failed to parse feedback record: ${error}`);
            }
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  await walkFeedback(feedbackPath);
  return records;
}

/**
 * Minimum feedback count threshold for creating implicit training samples.
 * Only songs with at least this many feedback events will be used for implicit training.
 */
const MIN_FEEDBACK_COUNT = 2;

/**
 * Merge explicit ratings and implicit feedback into training samples.
 * 
 * @param classifications - Classification records with features
 * @param feedback - Feedback records with user interactions
 * @returns Array of training samples with weights
 */
export function mergeTrainingData(
  classifications: ClassificationRecord[],
  feedback: FeedbackRecord[]
): TrainingSample[] {
  const samples: TrainingSample[] = [];

  // Index classifications by sid_path for fast lookup
  const classificationMap = new Map<string, ClassificationRecord>();
  for (const record of classifications) {
    classificationMap.set(record.sid_path, record);
  }

  // Add explicit ratings with full weight
  for (const record of classifications) {
    if (!record.features) {
      continue; // Skip records without features
    }

    // Check if this is an explicit rating (has all rating dimensions)
    const hasExplicitRatings =
      record.ratings.e !== undefined &&
      record.ratings.m !== undefined &&
      record.ratings.c !== undefined;

    if (hasExplicitRatings) {
      samples.push({
        features: record.features as FeatureVector,
        ratings: record.ratings,
        weight: 1.0,
        source: "explicit"
      });
    }
  }

  // Group feedback by sid_path
  const feedbackMap = new Map<string, FeedbackRecord[]>();
  for (const record of feedback) {
    const existing = feedbackMap.get(record.sid_path) ?? [];
    existing.push(record);
    feedbackMap.set(record.sid_path, existing);
  }

  // Add implicit feedback samples
  for (const [sidPath, feedbackRecords] of feedbackMap) {
    const classification = classificationMap.get(sidPath);
    if (!classification || !classification.features) {
      continue; // Skip if no classification or features
    }

    // Compute aggregate feedback signal
    let likeCount = 0;
    let dislikeCount = 0;
    let skipCount = 0;

    for (const fb of feedbackRecords) {
      if (fb.action === "like") likeCount += 1;
      if (fb.action === "dislike") dislikeCount += 1;
      if (fb.action === "skip") skipCount += 1;
    }

    // Only create implicit sample if there's strong signal (likes or dislikes)
    if (likeCount > 0 || dislikeCount > 0) {
      // Use classification ratings as base, but adjust based on feedback
      const baseRatings = classification.ratings;
      
      // Determine weight based on feedback strength
      const totalFeedback = likeCount + dislikeCount + skipCount;
      
      let weight = 0;
      if (likeCount > dislikeCount) {
        weight = FEEDBACK_WEIGHTS.like;
      } else if (dislikeCount > likeCount) {
        weight = FEEDBACK_WEIGHTS.dislike;
      } else if (skipCount > 0) {
        weight = FEEDBACK_WEIGHTS.skip;
      }

      // Only add if we have a meaningful weight and sufficient feedback
      if (weight > 0 && totalFeedback >= MIN_FEEDBACK_COUNT) {
        samples.push({
          features: classification.features as FeatureVector,
          ratings: baseRatings,
          weight,
          source: "implicit"
        });
      }
    }
  }

  return samples;
}

/**
 * Split samples into training and test sets.
 * 
 * @param samples - All training samples
 * @param testSplit - Fraction of samples for test set (default: 0.2)
 * @returns Training and test sets
 */
export function splitTrainTest(
  samples: TrainingSample[],
  testSplit: number = 0.2
): { train: TrainingSample[]; test: TrainingSample[] } {
  // Shuffle samples
  const shuffled = [...samples];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const testCount = Math.floor(shuffled.length * testSplit);
  const test = shuffled.slice(0, testCount);
  const train = shuffled.slice(testCount);

  return { train, test };
}

/**
 * Save training summary to log file.
 * 
 * @param summary - Training summary to save
 * @param trainingPath - Path to training directory
 */
export async function saveTrainingSummary(
  summary: TrainingSummary,
  trainingPath: string
): Promise<void> {
  await ensureDir(trainingPath);
  
  const logPath = path.join(trainingPath, "training-log.jsonl");
  const line = JSON.stringify(summary) + "\n";
  
  try {
    await appendFile(logPath, line, "utf8");
  } catch (error) {
    // If file doesn't exist, create it
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeFile(logPath, line, "utf8");
    } else {
      throw error;
    }
  }
}

/**
 * Save training samples to JSONL file.
 * 
 * @param samples - Training samples to save
 * @param trainingPath - Path to training directory
 */
export async function saveTrainingSamples(
  samples: TrainingSample[],
  trainingPath: string
): Promise<void> {
  await ensureDir(trainingPath);
  
  const samplesPath = path.join(trainingPath, "training-samples.jsonl");
  const lines = samples.map((sample) => JSON.stringify(sample));
  await writeFile(samplesPath, lines.join("\n") + "\n", "utf8");
}

/**
 * Options for training the model.
 */
export interface TrainModelOptions {
  /** Path to classified directory (default: "data/classified") */
  classifiedPath?: string;
  /** Path to feedback directory (default: "data/feedback") */
  feedbackPath?: string;
  /** Path to training directory (default: "data/training") */
  trainingPath?: string;
  /** Path to model directory (default: "data/model") */
  modelPath?: string;
  /** Training options (epochs, batch size, etc.) */
  trainOptions?: TrainOptions;
  /** Whether to evaluate on test set (default: true) */
  evaluate?: boolean;
  /** Test split fraction (default: 0.2) */
  testSplit?: number;
}

/**
 * Result from training the model.
 */
export interface TrainModelResult {
  /** Number of training samples */
  trainSamples: number;
  /** Number of test samples */
  testSamples: number;
  /** Training loss */
  trainLoss: number;
  /** Training MAE */
  trainMAE: number;
  /** Test MAE (if evaluated) */
  testMAE?: number;
  /** Test R² (if evaluated) */
  testR2?: number;
  /** Training summary */
  summary: TrainingSummary;
}

/**
 * Train the model on explicit and implicit feedback.
 * 
 * @param options - Training options
 * @returns Training result with metrics
 */
export async function trainModel(
  options: TrainModelOptions = {}
): Promise<TrainModelResult> {
  const {
    classifiedPath = "data/classified",
    feedbackPath = "data/feedback",
    trainingPath = "data/training",
    modelPath = "data/model",  // Use consistent default with getModelPath
    trainOptions = {},
    evaluate: shouldEvaluate = true,
    testSplit = 0.2
  } = options;

  // Load data
  console.log("Loading classification records...");
  const classifications = await loadClassifications(classifiedPath);
  console.log(`Loaded ${classifications.length} classification records`);

  console.log("Loading feedback records...");
  const feedback = await loadFeedback(feedbackPath);
  console.log(`Loaded ${feedback.length} feedback records`);

  // Merge training data
  console.log("Merging training data...");
  const allSamples = mergeTrainingData(classifications, feedback);
  console.log(`Created ${allSamples.length} training samples`);

  if (allSamples.length === 0) {
    throw new Error("No training samples available");
  }

  // Split into train/test
  const { train: trainSamples, test: testSamples } = splitTrainTest(
    allSamples,
    testSplit
  );
  console.log(
    `Split into ${trainSamples.length} training and ${testSamples.length} test samples`
  );

  // Train model
  console.log("Training model...");
  const { loss, mae } = await trainOnFeedback(
    trainSamples,
    trainOptions,
    modelPath
  );
  console.log(`Training complete: loss=${loss.toFixed(4)}, mae=${mae.toFixed(4)}`);

  // Evaluate on test set
  let testMAE: number | undefined;
  let testR2: number | undefined;

  if (shouldEvaluate && testSamples.length > 0) {
    console.log("Evaluating on test set...");
    const evalResult = await evaluateModel(testSamples, modelPath);
    testMAE = evalResult.mae;
    testR2 = evalResult.r2;
    console.log(
      `Evaluation: mae=${testMAE.toFixed(4)}, r2=${testR2.toFixed(4)}`
    );
  }

  // Save training samples
  await saveTrainingSamples(allSamples, trainingPath);

  // Create and save training summary
  const summary: TrainingSummary = {
    modelVersion: "0.2.0",
    trainedAt: new Date().toISOString(),
    samples: allSamples.length,
    metrics: {
      mae: testMAE ?? mae,
      r2: testR2 ?? 0
    },
    featureSetVersion: "2025-11-03",
    notes: `Trained on ${trainSamples.length} samples (${allSamples.filter((s) => s.source === "explicit").length} explicit, ${allSamples.filter((s) => s.source === "implicit").length} implicit)`
  };

  await saveTrainingSummary(summary, trainingPath);

  return {
    trainSamples: trainSamples.length,
    testSamples: testSamples.length,
    trainLoss: loss,
    trainMAE: mae,
    testMAE,
    testR2,
    summary
  };
}
