import * as tf from "@tensorflow/tfjs";
import { clampRating, pathExists, type TagRatings } from "@sidflow/common";
import type { FeatureVector, PredictRatings } from "./index.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "@sidflow/common";

/**
 * Production-ready TensorFlow.js regressor for predicting (e,m,c) ratings.
 * 
 * Supports full model lifecycle: creation, loading, training, evaluation, and persistence.
 * 
 * The model takes extracted features as input and predicts three ratings:
 * - e (energy/intensity): 1-5 scale
 * - m (mood): 1-5 scale
 * - c (complexity): 1-5 scale
 */

// Model version and feature set version for tracking compatibility
export const MODEL_VERSION = "0.2.0";
export const FEATURE_SET_VERSION = "2025-11-03";

// Feature names that the model expects (in order)
export const EXPECTED_FEATURES = [
  "energy",
  "rms",
  "spectralCentroid",
  "spectralRolloff",
  "zeroCrossingRate",
  "bpm",
  "confidence",
  "duration"
];

/**
 * Feature normalization statistics.
 */
export interface FeatureStats {
  means: Record<string, number>;
  stds: Record<string, number>;
  featureNames: string[];
  version: string;
}

/**
 * Model metadata for version tracking and reproducibility.
 */
export interface ModelMetadata {
  modelVersion: string;
  featureSetVersion: string;
  createdAt: string;
  trainedAt?: string;
  architecture: {
    inputDim: number;
    hiddenLayers: number[];
    outputDim: number;
    activation: string;
  };
  samples?: number;
  metrics?: {
    mae: number;
    r2: number;
  };
}

/**
 * Training summary for audit trail.
 */
export interface TrainingSummary {
  modelVersion: string;
  trainedAt: string;
  samples: number;
  metrics: {
    mae: number;
    r2: number;
  };
  featureSetVersion: string;
  notes?: string;
}

// Default normalization constants (overridden by loaded stats)
let FEATURE_MEANS: Record<string, number> = {
  energy: 0.1,
  rms: 0.1,
  spectralCentroid: 2000,
  spectralRolloff: 4000,
  zeroCrossingRate: 0.1,
  bpm: 120,
  confidence: 0.5,
  duration: 120
};

let FEATURE_STDS: Record<string, number> = {
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
let cachedStats: FeatureStats | null = null;
let cachedMetadata: ModelMetadata | null = null;

/**
 * Get the default model directory path.
 */
export function getModelPath(basePath?: string): string {
  if (!basePath) {
    return path.join("data", "model");
  }
  // If the base path ends with "/model", use it as-is
  const normalized = path.normalize(basePath);
  if (normalized.endsWith(path.sep + "model") || normalized.endsWith("/model")) {
    return basePath;
  }
  return path.join(basePath, "model");
}

/**
 * Load feature normalization statistics from JSON file.
 */
export async function loadFeatureStats(modelPath?: string): Promise<FeatureStats> {
  const statsPath = path.join(getModelPath(modelPath), "feature-stats.json");
  
  if (!(await pathExists(statsPath))) {
    // Return default stats if file doesn't exist
    return {
      means: { ...FEATURE_MEANS },
      stds: { ...FEATURE_STDS },
      featureNames: [...EXPECTED_FEATURES],
      version: FEATURE_SET_VERSION
    };
  }

  const content = await readFile(statsPath, "utf8");
  const stats = JSON.parse(content) as FeatureStats;
  
  // Update global normalization constants
  FEATURE_MEANS = stats.means;
  FEATURE_STDS = stats.stds;
  
  return stats;
}

/**
 * Save feature normalization statistics to JSON file.
 */
export async function saveFeatureStats(stats: FeatureStats, modelPath?: string): Promise<void> {
  const dirPath = getModelPath(modelPath);
  await ensureDir(dirPath);
  
  const statsPath = path.join(dirPath, "feature-stats.json");
  const content = JSON.stringify(stats, null, 2);
  await writeFile(statsPath, content, "utf8");
  
  // Update global normalization constants
  FEATURE_MEANS = stats.means;
  FEATURE_STDS = stats.stds;
}

/**
 * Load model metadata from JSON file.
 */
export async function loadModelMetadata(modelPath?: string): Promise<ModelMetadata | null> {
  const metadataPath = path.join(getModelPath(modelPath), "model-metadata.json");
  
  if (!(await pathExists(metadataPath))) {
    return null;
  }

  const content = await readFile(metadataPath, "utf8");
  return JSON.parse(content) as ModelMetadata;
}

/**
 * Save model metadata to JSON file.
 */
export async function saveModelMetadata(metadata: ModelMetadata, modelPath?: string): Promise<void> {
  const dirPath = getModelPath(modelPath);
  await ensureDir(dirPath);
  
  const metadataPath = path.join(dirPath, "model-metadata.json");
  const content = JSON.stringify(metadata, null, 2);
  await writeFile(metadataPath, content, "utf8");
}

/**
 * Create a new feedforward neural network for rating prediction.
 * Architecture: Input -> Dense(32) -> ReLU -> Dropout(0.2) -> Dense(16) -> ReLU -> Dense(3) -> Tanh
 * 
 * @param inputDim - Number of input features
 * @returns Untrained TensorFlow.js model
 */
export function createModel(inputDim: number): tf.LayersModel {
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
        activation: "tanh", // Output in [-1, 1], will be scaled to [1, 5]
        kernelInitializer: "heNormal"
      })
    ]
  });

  return model;
}

/**
 * Load an existing model from disk or create a new one.
 * 
 * @param modelPath - Base path for model directory (defaults to "data")
 * @returns Loaded or newly created model
 */
export async function loadModel(modelPath?: string): Promise<tf.LayersModel> {
  const dirPath = getModelPath(modelPath);
  const modelJsonPath = path.join(dirPath, "model.json");
  
  // Try to load existing model
  if (await pathExists(modelJsonPath)) {
    try {
      const model = await tf.loadLayersModel(`file://${modelJsonPath}`);
      
      // Load metadata and stats
      cachedMetadata = await loadModelMetadata(modelPath);
      cachedStats = await loadFeatureStats(modelPath);
      
      return model;
    } catch (error) {
      console.warn(`Failed to load model from ${modelJsonPath}:`, error);
      // Fall through to create new model
    }
  }
  
  // Create new model if loading failed or file doesn't exist
  const model = createModel(EXPECTED_FEATURES.length);
  
  // Create default metadata
  cachedMetadata = {
    modelVersion: MODEL_VERSION,
    featureSetVersion: FEATURE_SET_VERSION,
    createdAt: new Date().toISOString(),
    architecture: {
      inputDim: EXPECTED_FEATURES.length,
      hiddenLayers: [32, 16],
      outputDim: 3,
      activation: "tanh"
    }
  };
  
  // Create default stats
  cachedStats = {
    means: { ...FEATURE_MEANS },
    stds: { ...FEATURE_STDS },
    featureNames: [...EXPECTED_FEATURES],
    version: FEATURE_SET_VERSION
  };
  
  return model;
}

/**
 * Save model to disk with metadata.
 * 
 * @param model - TensorFlow.js model to save
 * @param modelPath - Base path for model directory (defaults to "data")
 */
export async function saveModel(model: tf.LayersModel, modelPath?: string): Promise<void> {
  const dirPath = getModelPath(modelPath);
  await ensureDir(dirPath);
  
  // Save model weights and topology
  const modelJsonPath = `file://${path.join(dirPath, "model.json")}`;
  await model.save(modelJsonPath);
  
  // Update and save metadata
  if (cachedMetadata) {
    cachedMetadata.trainedAt = new Date().toISOString();
    await saveModelMetadata(cachedMetadata, modelPath);
  }
  
  // Save feature stats if available
  if (cachedStats) {
    await saveFeatureStats(cachedStats, modelPath);
  }
}

/**
 * Normalize feature values using z-score normalization.
 */
function normalizeFeatures(features: FeatureVector): number[] {
  return EXPECTED_FEATURES.map((featureName) => {
    const value = features[featureName] ?? 0;
    const mean = FEATURE_MEANS[featureName] ?? 0;
    const std = FEATURE_STDS[featureName] ?? 1;
    return std !== 0 ? (value - mean) / std : 0;
  });
}

/**
 * Scale model output from tanh range [-1, 1] to rating scale [1, 5].
 */
function scaleToRating(value: number): number {
  // Tanh output is in [-1, 1], map to [1, 5]
  const scaled = 3 + value * 2; // Maps -1->1, 0->3, 1->5
  return clampRating(Math.round(scaled));
}

/**
 * Scale rating from [1, 5] to tanh range [-1, 1] for training.
 */
function scaleFromRating(rating: number): number {
  // Map [1, 5] to [-1, 1]
  return (rating - 3) / 2;
}

/**
 * Compute feature statistics from training samples.
 */
export function computeFeatureStats(
  samples: Array<{ features: FeatureVector; ratings: TagRatings }>
): FeatureStats {
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  
  if (samples.length === 0) {
    return {
      means: { ...FEATURE_MEANS },
      stds: { ...FEATURE_STDS },
      featureNames: [...EXPECTED_FEATURES],
      version: FEATURE_SET_VERSION
    };
  }
  
  // Compute means
  for (const featureName of EXPECTED_FEATURES) {
    let sum = 0;
    let count = 0;
    for (const sample of samples) {
      const value = sample.features[featureName];
      if (value !== undefined && !Number.isNaN(value)) {
        sum += value;
        count += 1;
      }
    }
    means[featureName] = count > 0 ? sum / count : 0;
  }
  
  // Compute standard deviations
  for (const featureName of EXPECTED_FEATURES) {
    let sumSquaredDiff = 0;
    let count = 0;
    const mean = means[featureName];
    for (const sample of samples) {
      const value = sample.features[featureName];
      if (value !== undefined && !Number.isNaN(value)) {
        sumSquaredDiff += (value - mean) ** 2;
        count += 1;
      }
    }
    stds[featureName] = count > 1 ? Math.sqrt(sumSquaredDiff / (count - 1)) : 1;
    // Ensure std is never zero to avoid division by zero during normalization
    const MIN_STD = 1e-6; // Minimum standard deviation threshold
    if (stds[featureName] < MIN_STD) {
      stds[featureName] = 1; // Fallback to unit variance
    }
  }
  
  return {
    means,
    stds,
    featureNames: [...EXPECTED_FEATURES],
    version: FEATURE_SET_VERSION
  };
}

/**
 * Training options for model training.
 */
export interface TrainOptions {
  /** Number of training epochs (default: 5) */
  epochs?: number;
  /** Batch size (default: 8) */
  batchSize?: number;
  /** Learning rate (default: 0.001) */
  learningRate?: number;
  /** Validation split (default: 0.2) */
  validationSplit?: number;
}

/**
 * Train the model on feedback samples.
 * 
 * @param samples - Training samples with features and ratings
 * @param options - Training options
 * @param modelPath - Base path for model directory
 * @returns Training metrics (loss, MAE)
 */
export async function trainOnFeedback(
  samples: Array<{ features: FeatureVector; ratings: TagRatings }>,
  options: TrainOptions = {},
  modelPath?: string
): Promise<{ loss: number; mae: number }> {
  const {
    epochs = 5,
    batchSize = 8,
    learningRate = 0.001,
    validationSplit = 0.2
  } = options;
  
  if (samples.length === 0) {
    throw new Error("Cannot train on empty sample set");
  }
  
  // Compute and save feature statistics
  const stats = computeFeatureStats(samples);
  await saveFeatureStats(stats, modelPath);
  cachedStats = stats;
  
  // Load or create model
  let model = cachedModel;
  if (!model) {
    model = await loadModel(modelPath);
    cachedModel = model;
  }
  
  // Prepare training data
  const inputData: number[][] = [];
  const outputData: number[][] = [];
  
  for (const sample of samples) {
    const normalizedFeatures = normalizeFeatures(sample.features);
    inputData.push(normalizedFeatures);
    
    // Scale ratings to [-1, 1] for tanh activation
    const scaledRatings = [
      scaleFromRating(sample.ratings.e),
      scaleFromRating(sample.ratings.m),
      scaleFromRating(sample.ratings.c)
    ];
    outputData.push(scaledRatings);
  }
  
  // Create tensors
  const xs = tf.tensor2d(inputData);
  const ys = tf.tensor2d(outputData);
  
  try {
    // Compile model
    model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: "meanSquaredError",
      metrics: ["mae"]
    });
    
    // Train model
    const history = await model.fit(xs, ys, {
      epochs,
      batchSize,
      validationSplit,
      shuffle: true,
      verbose: 0
    });
    
    // Extract final metrics
    const loss = history.history.loss[history.history.loss.length - 1] as number;
    const mae = history.history.mae[history.history.mae.length - 1] as number;
    
    // Save model and metadata
    await saveModel(model, modelPath);
    
    // Update metadata with training info
    if (cachedMetadata) {
      cachedMetadata.samples = samples.length;
      cachedMetadata.trainedAt = new Date().toISOString();
      await saveModelMetadata(cachedMetadata, modelPath);
    }
    
    return { loss, mae };
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

/**
 * Evaluate model performance on a test set.
 * 
 * @param testSet - Test samples with features and ratings
 * @param modelPath - Base path for model directory
 * @returns Evaluation metrics (MAE, R²)
 */
export async function evaluateModel(
  testSet: Array<{ features: FeatureVector; ratings: TagRatings }>,
  modelPath?: string
): Promise<{ mae: number; r2: number }> {
  if (testSet.length === 0) {
    throw new Error("Cannot evaluate on empty test set");
  }
  
  // Load model if not cached
  let model = cachedModel;
  if (!model) {
    model = await loadModel(modelPath);
    cachedModel = model;
  }
  
  // Load feature stats
  if (!cachedStats) {
    cachedStats = await loadFeatureStats(modelPath);
  }
  
  // Prepare test data
  const predictions: number[][] = [];
  const actuals: number[][] = [];
  
  for (const sample of testSet) {
    const normalizedFeatures = normalizeFeatures(sample.features);
    const inputTensor = tf.tensor2d([normalizedFeatures]);
    
    try {
      const prediction = model.predict(inputTensor) as tf.Tensor;
      const predData = await prediction.data();
      
      predictions.push([
        scaleToRating(predData[0]),
        scaleToRating(predData[1]),
        scaleToRating(predData[2])
      ]);
      
      actuals.push([
        sample.ratings.e,
        sample.ratings.m,
        sample.ratings.c
      ]);
      
      prediction.dispose();
    } finally {
      inputTensor.dispose();
    }
  }
  
  // Compute MAE
  let sumAbsError = 0;
  let count = 0;
  for (let i = 0; i < predictions.length; i++) {
    for (let j = 0; j < 3; j++) {
      sumAbsError += Math.abs(predictions[i][j] - actuals[i][j]);
      count += 1;
    }
  }
  const mae = count > 0 ? sumAbsError / count : 0;
  
  // Compute R² (coefficient of determination)
  // R² = 1 - (SS_res / SS_tot)
  let ssTot = 0;
  let ssRes = 0;
  
  // Compute mean of actuals
  let sumActuals = 0;
  let countActuals = 0;
  for (const actual of actuals) {
    for (const value of actual) {
      sumActuals += value;
      countActuals += 1;
    }
  }
  const meanActual = countActuals > 0 ? sumActuals / countActuals : 0;
  
  // Compute SS_tot and SS_res
  for (let i = 0; i < predictions.length; i++) {
    for (let j = 0; j < 3; j++) {
      const actual = actuals[i][j];
      const predicted = predictions[i][j];
      ssTot += (actual - meanActual) ** 2;
      ssRes += (actual - predicted) ** 2;
    }
  }
  
  const r2 = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
  
  return { mae, r2 };
}

/**
 * TensorFlow.js-based predictor for (e,m,c) ratings with confidence score.
 * 
 * This predictor uses a trained neural network to predict ratings from features.
 * The model can be trained using the trainOnFeedback() function.
 * 
 * @param options.features - The extracted audio features to use for prediction
 * @param options.sidFile - Path to SID file (currently unused, reserved for future enhancements)
 * @param options.relativePath - Relative path (currently unused, reserved for future enhancements)
 * @param options.metadata - Song metadata (currently unused, reserved for future enhancements)
 * @returns Predicted ratings object with e, m, c values (1-5 scale) and confidence score
 */
export const tfjsPredictRatings: PredictRatings = async ({ features }) => {
  // Load model and stats if not cached
  let model = cachedModel;
  if (!model) {
    model = await loadModel();
    cachedModel = model;
  }
  
  if (!cachedStats) {
    cachedStats = await loadFeatureStats();
  }

  // Normalize input features
  const normalizedFeatures = normalizeFeatures(features);

  // Create tensor and make prediction
  const inputTensor = tf.tensor2d([normalizedFeatures], [1, EXPECTED_FEATURES.length]);

  try {
    const prediction = model.predict(inputTensor) as tf.Tensor;
    const predictionData = await prediction.data();

    // Extract and scale the three ratings (from tanh range [-1, 1])
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
 * Enhanced predictor that includes confidence score based on model certainty.
 * 
 * @param options - Prediction options (same as tfjsPredictRatings)
 * @returns Predicted ratings with confidence score (0-1)
 */
export async function tfjsPredictRatingsWithConfidence(
  options: Parameters<PredictRatings>[0]
): Promise<TagRatings & { confidence: number }> {
  // Load model and stats if not cached
  let model = cachedModel;
  if (!model) {
    model = await loadModel();
    cachedModel = model;
  }
  
  if (!cachedStats) {
    cachedStats = await loadFeatureStats();
  }

  // Normalize input features
  const normalizedFeatures = normalizeFeatures(options.features);

  // Create tensor and make prediction
  const inputTensor = tf.tensor2d([normalizedFeatures], [1, EXPECTED_FEATURES.length]);

  try {
    const prediction = model.predict(inputTensor) as tf.Tensor;
    const predictionData = await prediction.data();

    // Extract and scale the three ratings (from tanh range [-1, 1])
    const rawE = predictionData[0];
    const rawM = predictionData[1];
    const rawC = predictionData[2];
    
    const e = scaleToRating(rawE);
    const m = scaleToRating(rawM);
    const c = scaleToRating(rawC);

    // Compute confidence based on how close predictions are to the tanh bounds
    // Values near -1 or 1 indicate higher certainty
    const certainties = [Math.abs(rawE), Math.abs(rawM), Math.abs(rawC)];
    const avgCertainty = certainties.reduce((a, b) => a + b, 0) / certainties.length;
    const confidence = Math.min(1, avgCertainty); // Normalize to [0, 1]

    // Cleanup tensors
    prediction.dispose();

    return { e, m, c, confidence };
  } finally {
    inputTensor.dispose();
  }
}

/**
 * Dispose of the cached model to free memory.
 * Should be called when the model is no longer needed.
 */
export function disposeModel(): void {
  if (cachedModel !== null) {
    cachedModel.dispose();
    cachedModel = null;
  }
  cachedStats = null;
  cachedMetadata = null;
}
