import { describe, it, expect } from "bun:test";
import { FEEDBACK_WEIGHTS, type FeedbackAction, type ClassificationRecord, type FeedbackRecord, type AudioFeatures } from "../src/jsonl-schema.js";

describe("FEEDBACK_WEIGHTS", () => {
  it("has correct weight for like", () => {
    expect(FEEDBACK_WEIGHTS.like).toBe(1.0);
  });
  it("has correct weight for dislike", () => {
    expect(FEEDBACK_WEIGHTS.dislike).toBe(-1.0);
  });
  it("has correct weight for skip", () => {
    expect(FEEDBACK_WEIGHTS.skip).toBe(-0.3);
  });
  it("has correct weight for play", () => {
    expect(FEEDBACK_WEIGHTS.play).toBe(0.0);
  });
  it("contains all feedback actions", () => {
    const actions: FeedbackAction[] = ["play", "like", "dislike", "skip"];
    actions.forEach(action => {
      expect(FEEDBACK_WEIGHTS[action]).toBeDefined();
      expect(typeof FEEDBACK_WEIGHTS[action]).toBe("number");
    });
  });
});

describe("ClassificationRecord", () => {
  it("accepts valid classification record", () => {
    const record: ClassificationRecord = {
      sid_path: "MUSICIANS/A/Artist/Song.sid",
      ratings: { e: 3, m: 4, f: 5 },
    };
    expect(record.sid_path).toBe("MUSICIANS/A/Artist/Song.sid");
    expect(record.ratings.e).toBe(3);
  });
  it("accepts record with song_index", () => {
    const record: ClassificationRecord = {
      sid_path: "test.sid",
      song_index: 2,
      ratings: { e: 3, m: 3, f: 3 },
    };
    expect(record.song_index).toBe(2);
  });
  it("accepts record with features", () => {
    const features: AudioFeatures = {
      energy: 0.5,
      rms: 0.3,
      spectralCentroid: 1500,
      duration: 120.5,
    };
    const record: ClassificationRecord = {
      sid_path: "test.sid",
      ratings: { e: 3, m: 3, f: 3 },
      features,
    };
    expect(record.features?.duration).toBe(120.5);
  });
});

describe("FeedbackRecord", () => {
  it("accepts valid feedback record", () => {
    const record: FeedbackRecord = {
      ts: "2025-11-19T10:00:00Z",
      sid_path: "test.sid",
      action: "like",
    };
    expect(record.action).toBe("like");
  });
  it("accepts record with song_index", () => {
    const record: FeedbackRecord = {
      ts: "2025-11-19T10:00:00Z",
      sid_path: "test.sid",
      song_index: 1,
      action: "play",
    };
    expect(record.song_index).toBe(1);
  });
  it("accepts record with uuid", () => {
    const record: FeedbackRecord = {
      ts: "2025-11-19T10:00:00Z",
      sid_path: "test.sid",
      action: "skip",
      uuid: "123e4567-e89b-12d3-a456-426614174000",
    };
    expect(record.uuid).toBe("123e4567-e89b-12d3-a456-426614174000");
  });
  it("accepts all feedback actions", () => {
    const actions: FeedbackAction[] = ["play", "like", "dislike", "skip"];
    actions.forEach(action => {
      const record: FeedbackRecord = {
        ts: "2025-11-19T10:00:00Z",
        sid_path: "test.sid",
        action,
      };
      expect(record.action).toBe(action);
    });
  });
});

describe("AudioFeatures", () => {
  it("accepts standard features", () => {
    const features: AudioFeatures = {
      energy: 0.8,
      rms: 0.6,
      spectralCentroid: 2000,
      spectralRolloff: 5000,
      zeroCrossingRate: 0.1,
      bpm: 120,
      confidence: 0.95,
      duration: 180,
    };
    expect(features.bpm).toBe(120);
    expect(features.confidence).toBe(0.95);
  });
  it("accepts custom features", () => {
    const features: AudioFeatures = {
      energy: 0.5,
      customFeature1: 1.5,
      customFeature2: 2.5,
    };
    expect(features.customFeature1).toBe(1.5);
  });
  it("allows undefined features", () => {
    const features: AudioFeatures = {
      energy: undefined,
      rms: 0.5,
    };
    expect(features.energy).toBeUndefined();
    expect(features.rms).toBe(0.5);
  });
});
