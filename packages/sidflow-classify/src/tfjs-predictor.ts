import * as tf from "@tensorflow/tfjs";
import { clampRating, type TagRatings } from "@sidflow/common";
import type { FeatureVector, PredictRatings } from "./index.js";

/**
 * Simple lightweight TensorFlow.js regressor for predicting (e,m,c) ratings.
 * 
 * This is a minimal demonstration model with a simple feedforward architecture.
 * In production, this should be replaced with a properly trained model.
 * 
 * The model takes extracted features as input and predicts three ratings:
 * - e (energy/intensity): 1-5 scale
 * - m (mood): 1-5 scale
 * - c (complexity): 1-5 scale
 */

// Feature names that the model expects (in order)
const EXPECTED_FEATURES = [
  "energy",
  "rms",
  "spectralCentroid",
  "spectralRolloff",
  "zeroCrossingRate",
  "bpm",
  "confidence",
  "duration"
];

// Normalization constants (would be computed from training data in production)
const FEATURE_MEANS: Record<string, number> = {
  energy: 0.1,
  rms: 0.1,
  spectralCentroid: 2000,
  spectralRolloff: 4000,
  zeroCrossingRate: 0.1,
  bpm: 120,
  confidence: 0.5,
  duration: 120
};

const FEATURE_STDS: Record<string, number> = {
  energy: 0.05,
  rms: 0.05,
  spectralCentroid: 1000,
  spectralRolloff: 2000,
  zeroCrossingRate: 0.05,
  bpm: 40,
  confidence: 0.3,
  duration: 60
};

let cachedModel: tf.LayersModel | null = null;

/**
 * Create a simple feedforward neural network for rating prediction.
 * Architecture: Input -> Dense(32) -> ReLU -> Dropout(0.2) -> Dense(16) -> ReLU -> Dense(3) -> Output
 */
function createModel(inputDim: number): tf.LayersModel {
  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [inputDim],
        units: 32,
        activation: "relu",
        kernelInitializer: "heNormal"
      }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({
        units: 16,
        activation: "relu",
        kernelInitializer: "heNormal"
      }),
      tf.layers.dense({
        units: 3,
        activation: "linear" // Output raw values that we'll scale to 1-5
      })
    ]
  });

  // In production, this model would be trained on labeled data.
  // For now, we initialize with random weights.
  return model;
}

/**
 * Get or create the prediction model.
 */
function getModel(): tf.LayersModel {
  if (cachedModel === null) {
    cachedModel = createModel(EXPECTED_FEATURES.length);
  }
  return cachedModel;
}

/**
 * Normalize feature values using z-score normalization.
 */
function normalizeFeatures(features: FeatureVector): number[] {
  return EXPECTED_FEATURES.map((featureName) => {
    const value = features[featureName] ?? 0;
    const mean = FEATURE_MEANS[featureName] ?? 0;
    const std = FEATURE_STDS[featureName] ?? 1;
    return (value - mean) / std;
  });
}

/**
 * Scale model output (which can be any real number) to the 1-5 rating scale.
 */
function scaleToRating(value: number): number {
  // Use sigmoid to map to [0, 1], then scale to [1, 5]
  const sigmoid = 1 / (1 + Math.exp(-value));
  const scaled = 1 + sigmoid * 4;
  return clampRating(Math.round(scaled));
}

/**
 * TensorFlow.js-based predictor for (s,m,c) ratings.
 * 
 * This predictor uses a lightweight neural network to predict ratings from features.
 * Note: This is a demonstration implementation. In production, the model should be:
 * 1. Trained on actual labeled data (manual tags)
 * 2. Saved to disk and loaded at runtime
 * 3. Evaluated for accuracy before deployment
 * 
 * @param options.features - The extracted audio features to use for prediction
 * @param options.sidFile - Path to SID file (currently unused, reserved for future enhancements)
 * @param options.relativePath - Relative path (currently unused, reserved for future enhancements)
 * @param options.metadata - Song metadata (currently unused, reserved for future enhancements)
 * @returns Predicted ratings object with e, m, c values (1-5 scale)
 */
export const tfjsPredictRatings: PredictRatings = async ({ features }) => {
  const model = getModel();

  // Normalize input features
  const normalizedFeatures = normalizeFeatures(features);

  // Create tensor and make prediction
  const inputTensor = tf.tensor2d([normalizedFeatures], [1, EXPECTED_FEATURES.length]);

  try {
    const prediction = model.predict(inputTensor) as tf.Tensor;
    const predictionData = await prediction.data();

    // Extract and scale the three ratings
    const e = scaleToRating(predictionData[0]);
    const m = scaleToRating(predictionData[1]);
    const c = scaleToRating(predictionData[2]);

    // Cleanup tensors
    prediction.dispose();

    return { e, m, c };
  } finally {
    inputTensor.dispose();
  }
};

/**
 * Dispose of the cached model to free memory.
 * Should be called when the model is no longer needed.
 */
export function disposeModel(): void {
  if (cachedModel !== null) {
    cachedModel.dispose();
    cachedModel = null;
  }
}
