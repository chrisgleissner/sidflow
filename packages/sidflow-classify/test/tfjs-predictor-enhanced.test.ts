import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createModel,
  loadModel,
  saveModel,
  loadFeatureStats,
  saveFeatureStats,
  loadModelMetadata,
  saveModelMetadata,
  computeFeatureStats,
  trainOnFeedback,
  evaluateModel,
  tfjsPredictRatings,
  tfjsPredictRatingsWithConfidence,
  disposeModel,
  MODEL_VERSION,
  FEATURE_SET_VERSION,
  EXPECTED_FEATURES
} from "@sidflow/classify";

const TEST_MODEL_DIR = "/tmp/sidflow-tfjs-test";

describe("Model lifecycle", () => {
  beforeAll(async () => {
    await mkdir(TEST_MODEL_DIR, { recursive: true });
  });

  afterAll(async () => {
    disposeModel();
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
  });

  it("creates a new model with correct architecture", () => {
    const model = createModel(8);
    
    expect(model).toBeDefined();
    expect(model.layers.length).toBeGreaterThan(0);
    
    // Check input shape
    const inputShape = model.inputs[0].shape;
    expect(inputShape[1]).toBe(8);
    
    // Check output shape (should be 3 for e, m, c)
    const outputShape = model.outputs[0].shape;
    expect(outputShape[1]).toBe(3);
    
    model.dispose();
  });

  it("saves and loads model correctly", async () => {
    const model = createModel(EXPECTED_FEATURES.length);
    
    try {
      await saveModel(model, TEST_MODEL_DIR);
      
      // Dispose original model
      model.dispose();
      
      // Load model back
      const loadedModel = await loadModel(TEST_MODEL_DIR);
      
      expect(loadedModel).toBeDefined();
      expect(loadedModel.layers.length).toBeGreaterThan(0);
      
      loadedModel.dispose();
    } catch (error) {
      // If tfjs-node is not available, we expect a save handler error
      if ((error as Error).message.includes("save handlers")) {
        console.log("Skipping model save/load test (tfjs-node not available)");
        model.dispose();
      } else {
        model.dispose();
        throw error;
      }
    }
  });

  it("creates new model if loading fails", async () => {
    const model = await loadModel("/tmp/nonexistent-model");
    
    expect(model).toBeDefined();
    expect(model.layers.length).toBeGreaterThan(0);
    
    model.dispose();
  });
});

describe("Feature statistics", () => {
  beforeAll(async () => {
    await mkdir(TEST_MODEL_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
  });

  it("computes feature statistics from samples", () => {
    const samples = [
      {
        features: {
          energy: 0.1,
          rms: 0.1,
          spectralCentroid: 2000,
          spectralRolloff: 4000,
          zeroCrossingRate: 0.1,
          bpm: 120,
          confidence: 0.5,
          duration: 120
        },
        ratings: { e: 3, m: 3, c: 3 }
      },
      {
        features: {
          energy: 0.2,
          rms: 0.2,
          spectralCentroid: 3000,
          spectralRolloff: 6000,
          zeroCrossingRate: 0.2,
          bpm: 140,
          confidence: 0.7,
          duration: 180
        },
        ratings: { e: 4, m: 4, c: 4 }
      }
    ];

    const stats = computeFeatureStats(samples);

    expect(stats.means.energy).toBeCloseTo(0.15, 2);
    expect(stats.means.bpm).toBeCloseTo(130, 0);
    expect(stats.stds.energy).toBeGreaterThan(0);
    expect(stats.featureNames).toEqual(EXPECTED_FEATURES);
    expect(stats.version).toBe(FEATURE_SET_VERSION);
  });

  it("saves and loads feature statistics", async () => {
    const stats = {
      means: {
        energy: 0.15,
        rms: 0.12,
        spectralCentroid: 2500,
        spectralRolloff: 5000,
        zeroCrossingRate: 0.1,
        bpm: 130,
        confidence: 0.6,
        duration: 150
      },
      stds: {
        energy: 0.05,
        rms: 0.04,
        spectralCentroid: 500,
        spectralRolloff: 1000,
        zeroCrossingRate: 0.05,
        bpm: 20,
        confidence: 0.2,
        duration: 30
      },
      featureNames: EXPECTED_FEATURES,
      version: FEATURE_SET_VERSION
    };

    await saveFeatureStats(stats, TEST_MODEL_DIR);
    const loaded = await loadFeatureStats(TEST_MODEL_DIR);

    expect(loaded.means.energy).toBeCloseTo(stats.means.energy, 5);
    expect(loaded.stds.energy).toBeCloseTo(stats.stds.energy, 5);
    expect(loaded.version).toBe(FEATURE_SET_VERSION);
  });

  it("returns default stats if file doesn't exist", async () => {
    const stats = await loadFeatureStats("/tmp/nonexistent");
    
    expect(stats).toBeDefined();
    expect(stats.means).toBeDefined();
    expect(stats.stds).toBeDefined();
    expect(stats.featureNames).toEqual(EXPECTED_FEATURES);
  });
});

describe("Model metadata", () => {
  beforeAll(async () => {
    await mkdir(TEST_MODEL_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
  });

  it("saves and loads model metadata", async () => {
    const metadata = {
      modelVersion: MODEL_VERSION,
      featureSetVersion: FEATURE_SET_VERSION,
      createdAt: new Date().toISOString(),
      trainedAt: new Date().toISOString(),
      architecture: {
        inputDim: 8,
        hiddenLayers: [32, 16],
        outputDim: 3,
        activation: "tanh"
      },
      samples: 100,
      metrics: {
        mae: 0.45,
        r2: 0.82
      }
    };

    await saveModelMetadata(metadata, TEST_MODEL_DIR);
    const loaded = await loadModelMetadata(TEST_MODEL_DIR);

    expect(loaded).toBeDefined();
    expect(loaded?.modelVersion).toBe(MODEL_VERSION);
    expect(loaded?.samples).toBe(100);
    expect(loaded?.metrics?.mae).toBeCloseTo(0.45, 2);
  });

  it("returns null if metadata file doesn't exist", async () => {
    const metadata = await loadModelMetadata("/tmp/nonexistent");
    expect(metadata).toBeNull();
  });
});

describe("Training", () => {
  beforeAll(async () => {
    await mkdir(TEST_MODEL_DIR, { recursive: true });
  });

  afterAll(async () => {
    disposeModel();
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
  });

  it("trains model on sample data", async () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      features: {
        energy: 0.1 + i * 0.01,
        rms: 0.1 + i * 0.01,
        spectralCentroid: 2000 + i * 100,
        spectralRolloff: 4000 + i * 200,
        zeroCrossingRate: 0.1 + i * 0.005,
        bpm: 120 + i * 2,
        confidence: 0.5 + i * 0.02,
        duration: 120 + i * 5
      },
      ratings: {
        e: Math.min(5, Math.max(1, Math.round(3 + i * 0.1))),
        m: Math.min(5, Math.max(1, Math.round(3 - i * 0.05))),
        c: Math.min(5, Math.max(1, Math.round(3 + i * 0.08)))
      }
    }));

    try {
      const result = await trainOnFeedback(samples, {
        epochs: 2,
        batchSize: 4
      }, TEST_MODEL_DIR);

      expect(result.loss).toBeGreaterThan(0);
      expect(result.mae).toBeGreaterThan(0);
    } catch (error) {
      // If tfjs-node is not available, we expect a save handler error
      if ((error as Error).message.includes("save handlers")) {
        console.log("Skipping model training test (tfjs-node not available)");
      } else {
        throw error;
      }
    }
  }, 30000);

  it("throws error on empty sample set", async () => {
    expect(trainOnFeedback([], {}, TEST_MODEL_DIR)).rejects.toThrow(
      "Cannot train on empty sample set"
    );
  });
});

describe("Evaluation", () => {
  let modelTrained = false;
  
  beforeAll(async () => {
    await mkdir(TEST_MODEL_DIR, { recursive: true });
    
    // Train a small model first
    const samples = Array.from({ length: 10 }, (_, i) => ({
      features: {
        energy: 0.1 + i * 0.01,
        rms: 0.1 + i * 0.01,
        spectralCentroid: 2000,
        spectralRolloff: 4000,
        zeroCrossingRate: 0.1,
        bpm: 120,
        confidence: 0.5,
        duration: 120
      },
      ratings: { e: 3, m: 3, c: 3 }
    }));
    
    try {
      await trainOnFeedback(samples, { epochs: 1 }, TEST_MODEL_DIR);
      modelTrained = true;
    } catch (error) {
      if ((error as Error).message.includes("save handlers")) {
        console.log("Skipping model training for eval tests (tfjs-node not available)");
      } else {
        throw error;
      }
    }
  });

  afterAll(async () => {
    disposeModel();
    await rm(TEST_MODEL_DIR, { recursive: true, force: true });
  });

  it("evaluates model on test set", async () => {
    if (!modelTrained) {
      console.log("Skipping evaluation test (model training failed)");
      return;
    }
    
    const testSet = Array.from({ length: 5 }, (_, i) => ({
      features: {
        energy: 0.15 + i * 0.01,
        rms: 0.15 + i * 0.01,
        spectralCentroid: 2500,
        spectralRolloff: 5000,
        zeroCrossingRate: 0.12,
        bpm: 130,
        confidence: 0.6,
        duration: 150
      },
      ratings: { e: 3, m: 3, c: 3 }
    }));

    const result = await evaluateModel(testSet, TEST_MODEL_DIR);

    expect(result.mae).toBeGreaterThan(0);
    expect(result.r2).toBeGreaterThanOrEqual(-1); // R² can be negative
    expect(result.r2).toBeLessThanOrEqual(1);
  }, 30000);

  it("throws error on empty test set", async () => {
    expect(evaluateModel([], TEST_MODEL_DIR)).rejects.toThrow(
      "Cannot evaluate on empty test set"
    );
  });
});

describe("Prediction", () => {
  afterAll(() => {
    disposeModel();
  });

  it("predicts ratings from features", async () => {
    const features = {
      energy: 0.15,
      rms: 0.12,
      spectralCentroid: 2500,
      spectralRolloff: 5000,
      zeroCrossingRate: 0.10,
      bpm: 140,
      confidence: 0.85,
      duration: 180
    };

    const ratings = await tfjsPredictRatings({
      features,
      sidFile: "/test/song.sid",
      relativePath: "test/song.sid",
      metadata: {}
    });

    expect(ratings.e).toBeGreaterThanOrEqual(1);
    expect(ratings.e).toBeLessThanOrEqual(5);
    expect(ratings.m).toBeGreaterThanOrEqual(1);
    expect(ratings.m).toBeLessThanOrEqual(5);
    expect(ratings.c).toBeGreaterThanOrEqual(1);
    expect(ratings.c).toBeLessThanOrEqual(5);
  });

  it("predicts ratings with confidence score", async () => {
    const features = {
      energy: 0.15,
      rms: 0.12,
      spectralCentroid: 2500,
      spectralRolloff: 5000,
      zeroCrossingRate: 0.10,
      bpm: 140,
      confidence: 0.85,
      duration: 180
    };

    const result = await tfjsPredictRatingsWithConfidence({
      features,
      sidFile: "/test/song.sid",
      relativePath: "test/song.sid",
      metadata: {}
    });

    expect(result.e).toBeGreaterThanOrEqual(1);
    expect(result.e).toBeLessThanOrEqual(5);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("handles missing features gracefully", async () => {
    const features = {
      energy: 0.1,
      rms: 0.1
      // Missing other features
    };

    const ratings = await tfjsPredictRatings({
      features,
      sidFile: "/test/partial.sid",
      relativePath: "test/partial.sid",
      metadata: {}
    });

    expect(ratings.e).toBeGreaterThanOrEqual(1);
    expect(ratings.e).toBeLessThanOrEqual(5);
  });
});
