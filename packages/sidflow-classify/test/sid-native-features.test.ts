import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createHybridFeatureExtractor,
  createSidNativeFeatureExtractor,
  extractSidNativeFeaturesFromWriteTrace,
  generateAutoTags,
  resolveWavPath,
  type ClassificationPlan,
  type SidWriteTrace,
} from "@sidflow/classify";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-sid-native-");

const FRAME_CYCLES = 985_248 / 50;

function createPlan(sidPath: string, audioCachePath: string, tagsPath: string): ClassificationPlan {
  return {
    config: {} as ClassificationPlan["config"],
    forceRebuild: false,
    classificationDepth: 3,
    sidPath,
    audioCachePath,
    tagsPath,
  } as unknown as ClassificationPlan;
}

function makeTrace(frame: number, offset: number, address: number, value: number, sidNumber = 0): SidWriteTrace {
  return {
    sidNumber,
    address,
    value,
    cyclePhi1: Math.round(frame * FRAME_CYCLES + offset),
  };
}

function createRepresentativeTrace(): SidWriteTrace[] {
  return [
    makeTrace(0, 10, 0x00, 0x34),
    makeTrace(0, 11, 0x01, 0x24),
    makeTrace(0, 12, 0x02, 0x80),
    makeTrace(0, 13, 0x03, 0x08),
    makeTrace(0, 14, 0x04, 0x41),
    makeTrace(0, 15, 0x05, 0x12),
    makeTrace(0, 16, 0x06, 0x23),

    makeTrace(0, 20, 0x07, 0x08),
    makeTrace(0, 21, 0x08, 0x04),
    makeTrace(0, 22, 0x0b, 0x21),
    makeTrace(0, 23, 0x0c, 0xA2),
    makeTrace(0, 24, 0x0d, 0xA9),

    makeTrace(0, 30, 0x0e, 0x20),
    makeTrace(0, 31, 0x0f, 0x10),
    makeTrace(0, 32, 0x12, 0x11),
    makeTrace(0, 33, 0x13, 0x55),
    makeTrace(0, 34, 0x14, 0x46),

    makeTrace(0, 40, 0x15, 0x20),
    makeTrace(0, 41, 0x16, 0x03),
    makeTrace(0, 42, 0x17, 0x71),
    makeTrace(0, 43, 0x18, 0x11),
    makeTrace(0, 44, 0x18, 0x12),
    makeTrace(0, 45, 0x18, 0x13),
    makeTrace(0, 46, 0x18, 0x1f),

    makeTrace(1, 10, 0x00, 0x68),
    makeTrace(1, 11, 0x01, 0x36),
    makeTrace(1, 12, 0x02, 0x90),
    makeTrace(1, 13, 0x03, 0x09),
    makeTrace(1, 14, 0x15, 0x10),
    makeTrace(1, 15, 0x16, 0x05),

    makeTrace(2, 10, 0x04, 0x40),
    makeTrace(3, 10, 0x04, 0x41),
    makeTrace(3, 11, 0x00, 0x9c),
    makeTrace(3, 12, 0x01, 0x48),
  ];
}

describe("extractSidNativeFeaturesFromWriteTrace", () => {
  it("derives bounded causal SID-native features from canonical frame events", () => {
    const features = extractSidNativeFeaturesFromWriteTrace({
      traces: createRepresentativeTrace(),
      clock: "PAL",
      skipSeconds: 0,
      analysisSeconds: 4 / 50,
    });

    expect(features.sidFeatureVariant).toBe("sid-native");
    expect(features.sidTraceClock).toBe("PAL");
    expect(features.sidTraceEventCount).toBeGreaterThan(0);
    expect(features.sidTraceFrameCount).toBe(4);
    expect(features.sidGateOnsetDensity).toBeGreaterThan(0);
    expect(features.sidWavePulseRatio).toBeGreaterThan(0);
    expect(features.sidWaveSawRatio).toBeGreaterThan(0);
    expect(features.sidWaveTriangleRatio).toBeGreaterThan(0);
    expect(features.sidPwmActivity).toBeGreaterThan(0);
    expect(features.sidFilterCutoffMean).toBeGreaterThan(0);
    expect(features.sidFilterMotion).toBeGreaterThan(0);
    expect(features.sidSamplePlaybackActivity).toBeGreaterThan(0);
    expect(features.sidRoleBassRatio).toBeGreaterThan(0);
    expect(features.sidRoleLeadRatio).toBeGreaterThan(0);
    expect(features.sidAdsrPluckRatio).toBeGreaterThan(0);
    expect(features.sidAdsrPadRatio).toBeGreaterThan(0);
  });

  it("returns a stable empty feature set when no trace events exist", () => {
    const features = extractSidNativeFeaturesFromWriteTrace({
      traces: [],
      clock: "PAL",
      skipSeconds: 0,
      analysisSeconds: 1 / 50,
    });

    expect(features.sidFeatureVariant).toBe("empty");
    expect(features.sidTraceEventCount).toBe(0);
    expect(features.sidWavePulseRatio).toBe(0);
    expect(features.sidFilterMotion).toBe(0);
  });
});

describe("hybrid SID-native classify integration", () => {
  it("writes merged WAV and SID-native features into classification JSONL", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const audioCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await Promise.all([
      mkdir(path.join(sidPath, "C64Music", "TEST"), { recursive: true }),
      mkdir(audioCachePath, { recursive: true }),
      mkdir(tagsPath, { recursive: true }),
    ]);

    const plan = createPlan(sidPath, audioCachePath, tagsPath);
    const sidFile = path.join(sidPath, "C64Music", "TEST", "Hybrid.sid");
    await writeFile(sidFile, "not-a-real-sid");

    const wavPath = resolveWavPath(plan, sidFile);
    await mkdir(path.dirname(wavPath), { recursive: true });
    await writeFile(wavPath, "cached-wav");

    const featureExtractor = createHybridFeatureExtractor(
      async () => ({ energy: 0.75, featureVariant: "test-wav" }),
      createSidNativeFeatureExtractor({
        traceProvider: async () => ({
          traces: createRepresentativeTrace(),
          clock: "PAL",
          skipSeconds: 0,
          analysisSeconds: 4 / 50,
        }),
      }),
    );

    const result = await generateAutoTags(plan, {
      extractMetadata: async () => ({ title: "Hybrid" }),
      featureExtractor,
      predictRatings: async () => ({ e: 3, m: 4, c: 2 }),
    });

    const lines = (await readFile(result.jsonlFile, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as { features: Record<string, number | string> };

    expect(record.features.energy).toBe(0.75);
    expect(record.features.featureVariant).toBe("test-wav");
    expect(record.features.sidFeatureVariant).toBe("sid-native");
    expect(record.features.sidTraceEventCount).toBeGreaterThan(0);
    expect(record.features.sidWavePulseRatio).toBeGreaterThan(0);
    expect(record.features.sidSamplePlaybackActivity).toBeGreaterThan(0);

    await rm(root, { recursive: true, force: true });
  });
});