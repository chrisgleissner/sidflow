import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  loadClassifications,
  loadFeedback,
  mergeTrainingData,
  splitTrainTest,
  trainModel,
  type TrainingSample
} from "../src/index.js";
import type { ClassificationRecord, FeedbackRecord } from "@sidflow/common";

const TEST_DIR = "/tmp/sidflow-train-test";
const CLASSIFIED_DIR = path.join(TEST_DIR, "classified");
const FEEDBACK_DIR = path.join(TEST_DIR, "feedback");
const TRAINING_DIR = path.join(TEST_DIR, "training");
const MODEL_DIR = path.join(TEST_DIR, "model");

// Sample test data
const sampleClassifications: ClassificationRecord[] = [
  {
    sid_path: "test/song1.sid",
    ratings: { e: 4, m: 3, c: 5 },
    features: {
      energy: 0.15,
      rms: 0.12,
      spectralCentroid: 2500,
      spectralRolloff: 5000,
      zeroCrossingRate: 0.10,
      bpm: 140,
      confidence: 0.85,
      duration: 180
    }
  },
  {
    sid_path: "test/song2.sid",
    ratings: { e: 2, m: 5, c: 3 },
    features: {
      energy: 0.08,
      rms: 0.09,
      spectralCentroid: 1800,
      spectralRolloff: 3500,
      zeroCrossingRate: 0.06,
      bpm: 90,
      confidence: 0.70,
      duration: 240
    }
  },
  {
    sid_path: "test/song3.sid",
    ratings: { e: 5, m: 4, c: 4 },
    features: {
      energy: 0.20,
      rms: 0.18,
      spectralCentroid: 3500,
      spectralRolloff: 7000,
      zeroCrossingRate: 0.15,
      bpm: 160,
      confidence: 0.90,
      duration: 150
    }
  }
];

const sampleFeedback: FeedbackRecord[] = [
  {
    ts: "2025-11-03T10:00:00Z",
    sid_path: "test/song1.sid",
    action: "like"
  },
  {
    ts: "2025-11-03T10:01:00Z",
    sid_path: "test/song1.sid",
    action: "like"
  },
  {
    ts: "2025-11-03T10:02:00Z",
    sid_path: "test/song2.sid",
    action: "skip"
  },
  {
    ts: "2025-11-03T10:03:00Z",
    sid_path: "test/song2.sid",
    action: "dislike"
  },
  {
    ts: "2025-11-03T10:04:00Z",
    sid_path: "test/song3.sid",
    action: "like"
  }
];

describe("Training data loading", () => {
  beforeAll(async () => {
    // Create test directories
    await mkdir(CLASSIFIED_DIR, { recursive: true });
    await mkdir(path.join(FEEDBACK_DIR, "2025/11/03"), { recursive: true });
    await mkdir(TRAINING_DIR, { recursive: true });
    await mkdir(MODEL_DIR, { recursive: true });

    // Write sample classification data
    const classifiedFile = path.join(CLASSIFIED_DIR, "test-data.jsonl");
    const classifiedLines = sampleClassifications.map((r) => JSON.stringify(r));
    await writeFile(classifiedFile, classifiedLines.join("\n"), "utf8");

    // Write sample feedback data
    const feedbackFile = path.join(FEEDBACK_DIR, "2025/11/03/events.jsonl");
    const feedbackLines = sampleFeedback.map((r) => JSON.stringify(r));
    await writeFile(feedbackFile, feedbackLines.join("\n"), "utf8");
  });

  afterAll(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("loads classification records from JSONL files", async () => {
    const records = await loadClassifications(CLASSIFIED_DIR);

    expect(records).toBeDefined();
    expect(records.length).toBe(3);
    expect(records[0].sid_path).toBe("test/song1.sid");
    expect(records[0].ratings.e).toBe(4);
    expect(records[0].features).toBeDefined();
    expect(records[0].features?.energy).toBe(0.15);
  });

  it("loads feedback records from date-partitioned directories", async () => {
    const records = await loadFeedback(FEEDBACK_DIR);

    expect(records).toBeDefined();
    expect(records.length).toBe(5);
    expect(records[0].sid_path).toBe("test/song1.sid");
    expect(records[0].action).toBe("like");
  });

  it("returns empty arrays for non-existent paths", async () => {
    const classifications = await loadClassifications("/tmp/nonexistent");
    const feedback = await loadFeedback("/tmp/nonexistent");

    expect(classifications).toEqual([]);
    expect(feedback).toEqual([]);
  });

  it("handles invalid JSON in classification files", async () => {
    const testClassifiedDir = path.join(TEST_DIR, "invalid-json-test");
    await mkdir(testClassifiedDir, { recursive: true });
    
    const jsonl = 
      '{"sid_path":"song1.sid","ratings":{"e":3,"m":4,"c":5}}\n' +
      'invalid json line\n' +
      '{"sid_path":"song2.sid","ratings":{"e":2,"m":3,"c":4}}';
    
    await writeFile(path.join(testClassifiedDir, "test.jsonl"), jsonl, "utf8");
    
    const classifications = await loadClassifications(testClassifiedDir);
    
    // Should load 2 valid records, skipping the invalid line
    expect(classifications.length).toBe(2);
  });

  it("handles invalid JSON in feedback files", async () => {
    const testFeedbackDir = path.join(TEST_DIR, "invalid-feedback-test");
    await mkdir(path.join(testFeedbackDir, "2025/11/03"), { recursive: true });
    
    const jsonl = 
      '{"ts":"2025-11-03T10:00:00Z","sid_path":"song1.sid","action":"like"}\n' +
      'invalid json\n' +
      '{"ts":"2025-11-03T10:01:00Z","sid_path":"song2.sid","action":"skip"}';
    
    await writeFile(path.join(testFeedbackDir, "2025/11/03/events.jsonl"), jsonl, "utf8");
    
    const feedback = await loadFeedback(testFeedbackDir);
    
    // Should load 2 valid records, skipping the invalid line
    expect(feedback.length).toBe(2);
  });
});

describe("Training data merging", () => {
  it("creates training samples from explicit ratings", () => {
    const samples = mergeTrainingData(sampleClassifications, []);

    expect(samples.length).toBe(3);
    expect(samples[0].source).toBe("explicit");
    expect(samples[0].weight).toBe(1.0);
    expect(samples[0].ratings.e).toBe(4);
    expect(samples[0].features.energy).toBe(0.15);
  });

  it("adds implicit samples from feedback", () => {
    const samples = mergeTrainingData(sampleClassifications, sampleFeedback);

    // 3 explicit + implicit samples for songs with feedback
    expect(samples.length).toBeGreaterThanOrEqual(3);

    // Check for explicit samples
    const explicitSamples = samples.filter((s) => s.source === "explicit");
    expect(explicitSamples.length).toBe(3);

    // Check for implicit samples (songs with likes/dislikes)
    const implicitSamples = samples.filter((s) => s.source === "implicit");
    expect(implicitSamples.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns correct weights to implicit samples", () => {
    const samples = mergeTrainingData(sampleClassifications, sampleFeedback);
    const implicitSamples = samples.filter((s) => s.source === "implicit");

    for (const sample of implicitSamples) {
      expect(sample.weight).toBeGreaterThan(0);
      expect(sample.weight).toBeLessThanOrEqual(1.0);
    }
  });

  it("skips samples without features", () => {
    const classificationsWithoutFeatures: ClassificationRecord[] = [
      {
        sid_path: "test/no-features.sid",
        ratings: { e: 3, m: 3, c: 3 }
        // No features
      }
    ];

    const samples = mergeTrainingData(classificationsWithoutFeatures, []);
    expect(samples.length).toBe(0);
  });
});

describe("Train/test splitting", () => {
  it("splits samples into train and test sets", () => {
    const samples: TrainingSample[] = Array.from({ length: 10 }, (_, i) => ({
      features: sampleClassifications[i % 3].features!,
      ratings: sampleClassifications[i % 3].ratings,
      weight: 1.0,
      source: "explicit"
    }));

    const { train, test } = splitTrainTest(samples, 0.3);

    expect(train.length + test.length).toBe(samples.length);
    expect(test.length).toBeGreaterThan(0);
    expect(train.length).toBeGreaterThan(0);
  });

  it("respects test split ratio", () => {
    const samples: TrainingSample[] = Array.from({ length: 100 }, (_, i) => ({
      features: { energy: i * 0.01, rms: i * 0.01 },
      ratings: { e: 3, m: 3, c: 3 },
      weight: 1.0,
      source: "explicit"
    }));

    const { train, test } = splitTrainTest(samples, 0.2);

    expect(test.length).toBe(20);
    expect(train.length).toBe(80);
  });

  it("handles small sample sizes", () => {
    const samples: TrainingSample[] = [
      {
        features: { energy: 0.1 },
        ratings: { e: 3, m: 3, c: 3 },
        weight: 1.0,
        source: "explicit"
      }
    ];

    const { train, test } = splitTrainTest(samples, 0.2);

    expect(train.length + test.length).toBe(1);
  });
});

describe("Model training (integration)", () => {
  beforeAll(async () => {
    // Create test directories and data
    await mkdir(CLASSIFIED_DIR, { recursive: true });
    await mkdir(path.join(FEEDBACK_DIR, "2025/11/03"), { recursive: true });
    await mkdir(TRAINING_DIR, { recursive: true });
    await mkdir(MODEL_DIR, { recursive: true });

    // Write sample classification data
    const classifiedFile = path.join(CLASSIFIED_DIR, "test-data.jsonl");
    const classifiedLines = sampleClassifications.map((r) => JSON.stringify(r));
    await writeFile(classifiedFile, classifiedLines.join("\n"), "utf8");

    // Write sample feedback data
    const feedbackFile = path.join(FEEDBACK_DIR, "2025/11/03/events.jsonl");
    const feedbackLines = sampleFeedback.map((r) => JSON.stringify(r));
    await writeFile(feedbackFile, feedbackLines.join("\n"), "utf8");
  });

  afterAll(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("trains model on sample data", async () => {
    // Note: This test trains the model but may not be able to save it
    // if tfjs-node is not installed (which requires native dependencies)
    try {
      const result = await trainModel({
        classifiedPath: CLASSIFIED_DIR,
        feedbackPath: FEEDBACK_DIR,
        trainingPath: TRAINING_DIR,
        modelPath: MODEL_DIR,
        trainOptions: {
          epochs: 2, // Use fewer epochs for faster test
          batchSize: 2
        },
        evaluate: true
      });

      expect(result).toBeDefined();
      expect(result.trainSamples).toBeGreaterThan(0);
      expect(result.testSamples).toBeGreaterThanOrEqual(0);
      expect(result.trainLoss).toBeGreaterThan(0);
      expect(result.trainMAE).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
      expect(result.summary.samples).toBeGreaterThan(0);
    } catch (error) {
      // If tfjs-node is not available, we expect a save handler error
      if ((error as Error).message.includes("save handlers")) {
        console.log("Skipping model persistence (tfjs-node not available)");
        // This is expected in environments without tfjs-node
      } else {
        throw error;
      }
    }
  }, 30000); // 30 second timeout for training

  it("throws error when no training samples available", async () => {
    expect(
      trainModel({
        classifiedPath: "/tmp/empty",
        feedbackPath: "/tmp/empty",
        trainingPath: TRAINING_DIR,
        modelPath: MODEL_DIR
      })
    ).rejects.toThrow("No training samples available");
  });
});
