import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { parseSidFile, type SidflowConfig } from "@sidflow/common";

import {
  __setClassifyTestOverrides,
  destroyFeatureExtractionPool,
  fallbackMetadataFromPath,
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
} from "../src/index.js";

const REPO_ROOT = path.join(import.meta.dir, "../../../");
const CHECKED_IN_COLLECTION_ROOT = path.join(REPO_ROOT, "test-data/C64Music");
const CHECKED_IN_MARIO_SID = path.join(
  CHECKED_IN_COLLECTION_ROOT,
  "GAMES/S-Z/Super_Mario_Bros_64_2SID.sid"
);
const MARIO_COPY_COUNT = 24;
const MARIO_ROUNDS = 3;
const FIXTURE_ROUNDS = 2;
const CLASSIFY_THREADS = 4;
const THREAD_GROWTH_BUDGET = 20;
const PEAK_RSS_GROWTH_MB = 768;
const ROUND_RSS_DRIFT_MB = 128;
const ROUND_THREAD_DRIFT = 4;
const THROUGHPUT_SLOWDOWN_FACTOR = 1.75;
const THROUGHPUT_SLOWDOWN_GRACE_MS = 75;
const COMPLETION_GAP_FACTOR = 8;
const COMPLETION_GAP_GRACE_MS = 4_000;
const SAMPLE_INTERVAL_MS = 100;

interface ProcessSample {
  rssMb: number;
  threadCount: number;
  timestampMs: number;
}

interface RoundSummary {
  name: string;
  expectedRecords: number;
  durationMs: number;
  initialSample: ProcessSample;
  finalSample: ProcessSample;
  peakRssMb: number;
  peakThreads: number;
  maxClassifyThreadId: number;
  completionGapsMs: number[];
}

function readProcessSample(): ProcessSample {
  if (existsSync("/proc/self/status")) {
    const status = readFileSync("/proc/self/status", "utf8");
    const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    const threadMatch = status.match(/^Threads:\s+(\d+)$/m);
    const rssMb = rssMatch ? Math.round(Number.parseInt(rssMatch[1], 10) / 1024) : Math.round(process.memoryUsage().rss / (1024 * 1024));
    const threadCount = threadMatch
      ? Number.parseInt(threadMatch[1], 10)
      : existsSync("/proc/self/task")
        ? readdirSync("/proc/self/task").length
        : 0;
    return { rssMb, threadCount, timestampMs: Date.now() };
  }

  return {
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    threadCount: 0,
    timestampMs: Date.now(),
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function collectCheckedInSids(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCheckedInSids(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".sid")) {
      files.push(fullPath);
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

async function materializeScenarioCollection(
  targetCollectionRoot: string,
  sourceFiles: string[],
  transformRelativePath: (relativePath: string, index: number) => string,
): Promise<string[]> {
  const copiedPaths: string[] = [];
  for (const [index, sourceFile] of sourceFiles.entries()) {
    const relativePath = path.relative(CHECKED_IN_COLLECTION_ROOT, sourceFile);
    const scenarioRelativePath = transformRelativePath(relativePath, index);
    const destination = path.join(targetCollectionRoot, scenarioRelativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(sourceFile));
    copiedPaths.push(destination);
  }
  return copiedPaths;
}

async function runClassificationRound(options: {
  name: string;
  sourceFiles: string[];
  forceSingleSong: (sidFile: string) => boolean;
  expectedRecords: number;
  transformRelativePath: (relativePath: string, index: number) => string;
}): Promise<RoundSummary> {
  const root = await mkdtemp(path.join(tmpdir(), `sidflow-stability-${options.name}-`));
  const sidCollectionRoot = path.join(root, "C64Music");
  const audioCachePath = path.join(root, "audio-cache");
  const tagsPath = path.join(root, "tags");
  const classifiedPath = path.join(root, "classified");
  const configPath = path.join(root, ".sidflow.json");

  await mkdir(sidCollectionRoot, { recursive: true });
  await mkdir(audioCachePath, { recursive: true });
  await mkdir(tagsPath, { recursive: true });
  await mkdir(classifiedPath, { recursive: true });

  await materializeScenarioCollection(sidCollectionRoot, options.sourceFiles, options.transformRelativePath);

  const config: SidflowConfig = {
    sidPath: sidCollectionRoot,
    audioCachePath,
    tagsPath,
    classifiedPath,
    threads: CLASSIFY_THREADS,
    classificationDepth: 3,
    maxRenderSec: 20,
    introSkipSec: 1,
    maxClassifySec: 5,
    render: {
      preferredEngines: ["wasm"],
    },
  } as SidflowConfig;
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  __setClassifyTestOverrides({
    parseSidFile: async (sidFile) => {
      const parsed = await parseSidFile(sidFile);
      if (options.forceSingleSong(sidFile)) {
        return {
          ...parsed,
          songs: 1,
          startSong: 1,
        };
      }
      return parsed;
    },
  });

  const plan = await planClassification({ configPath, forceRebuild: true });
  const seenClassifyThreads = new Set<number>();
  const samples: ProcessSample[] = [];
  const completionTimestamps: number[] = [];
  const initialSample = readProcessSample();
  samples.push(initialSample);
  const startedAt = Date.now();

  const sampler = setInterval(() => {
    samples.push(readProcessSample());
  }, SAMPLE_INTERVAL_MS);

  try {
    const result = await generateAutoTags(plan, {
      threads: CLASSIFY_THREADS,
      extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
      featureExtractor: heuristicFeatureExtractor,
      predictRatings: heuristicPredictRatings,
      deleteWavAfterClassification: true,
      onThreadUpdate: (update) => {
        seenClassifyThreads.add(update.threadId);
        if (update.phase === "building" && update.status === "idle") {
          completionTimestamps.push(Date.now());
        }
      },
    });

    expect(result.jsonlRecordCount).toBe(options.expectedRecords);
    expect(result.autoTagged.length + result.manualEntries.length + result.mixedEntries.length).toBe(options.expectedRecords);
    expect(result.metrics.peakRssMb).toBeGreaterThan(0);

    await destroyFeatureExtractionPool();
    await sleep(250);
    samples.push(readProcessSample());

    const finalSample = samples.at(-1) ?? initialSample;
    const completionGapsMs = completionTimestamps.slice(1).map((timestamp, index) => timestamp - completionTimestamps[index]);

    return {
      name: options.name,
      expectedRecords: options.expectedRecords,
      durationMs: Date.now() - startedAt,
      initialSample,
      finalSample,
      peakRssMb: Math.max(...samples.map((sample) => sample.rssMb)),
      peakThreads: Math.max(...samples.map((sample) => sample.threadCount)),
      maxClassifyThreadId: Math.max(0, ...seenClassifyThreads),
      completionGapsMs,
    };
  } finally {
    clearInterval(sampler);
    await destroyFeatureExtractionPool();
    __setClassifyTestOverrides();
    await rm(root, { recursive: true, force: true });
  }
}

function assertRoundBounded(round: RoundSummary): void {
  expect(round.maxClassifyThreadId).toBeLessThanOrEqual(CLASSIFY_THREADS);
  expect(round.peakThreads).toBeLessThanOrEqual(round.initialSample.threadCount + THREAD_GROWTH_BUDGET);
  expect(round.finalSample.threadCount).toBeLessThanOrEqual(round.initialSample.threadCount + THREAD_GROWTH_BUDGET);
  expect(round.peakRssMb).toBeLessThanOrEqual(round.initialSample.rssMb + PEAK_RSS_GROWTH_MB);

  if (round.completionGapsMs.length > 0) {
    const medianGap = median(round.completionGapsMs);
    const maxGap = Math.max(...round.completionGapsMs);
    expect(maxGap).toBeLessThanOrEqual(Math.max(COMPLETION_GAP_GRACE_MS, medianGap * COMPLETION_GAP_FACTOR));
  }
}

function assertNoCrossRoundDrift(rounds: RoundSummary[]): void {
  let bestMsPerRecord = Number.POSITIVE_INFINITY;
  let lowestFinalRss = Number.POSITIVE_INFINITY;
  let lowestFinalThreads = Number.POSITIVE_INFINITY;

  for (const round of rounds) {
    const msPerRecord = round.durationMs / Math.max(1, round.expectedRecords);
    if (Number.isFinite(bestMsPerRecord)) {
      expect(msPerRecord).toBeLessThanOrEqual(bestMsPerRecord * THROUGHPUT_SLOWDOWN_FACTOR + THROUGHPUT_SLOWDOWN_GRACE_MS);
    }
    if (Number.isFinite(lowestFinalRss)) {
      expect(round.finalSample.rssMb).toBeLessThanOrEqual(lowestFinalRss + ROUND_RSS_DRIFT_MB);
    }
    if (Number.isFinite(lowestFinalThreads)) {
      expect(round.finalSample.threadCount).toBeLessThanOrEqual(lowestFinalThreads + ROUND_THREAD_DRIFT);
    }

    bestMsPerRecord = Math.min(bestMsPerRecord, msPerRecord);
    lowestFinalRss = Math.min(lowestFinalRss, round.finalSample.rssMb);
    lowestFinalThreads = Math.min(lowestFinalThreads, round.finalSample.threadCount);
  }
}

describe("Classification stability regression", () => {
  afterEach(async () => {
    __setClassifyTestOverrides();
    await destroyFeatureExtractionPool();
  });

  test(
    "classifies repeated Super Mario runtime copies without drift across rounds",
    async () => {
      const rounds: RoundSummary[] = [];
      const sourceFiles = Array.from({ length: MARIO_COPY_COUNT }, () => CHECKED_IN_MARIO_SID);

      for (let roundIndex = 0; roundIndex < MARIO_ROUNDS; roundIndex += 1) {
        const round = await runClassificationRound({
          name: `mario-${roundIndex + 1}`,
          sourceFiles,
          expectedRecords: MARIO_COPY_COUNT,
          forceSingleSong: (sidFile) => path.basename(sidFile).startsWith("Super_Mario_Bros_64_2SID_stress_"),
          transformRelativePath: (_relativePath, index) =>
            path.join(
              "GAMES/S-Z",
              `Super_Mario_Bros_64_2SID_stress_${String(index + 1).padStart(3, "0")}.sid`
            ),
        });
        rounds.push(round);
        assertRoundBounded(round);
      }

      assertNoCrossRoundDrift(rounds);
    },
    300_000
  );

  test(
    "classifies every checked-in SID fixture with bounded resources",
    async () => {
      const checkedInSids = await collectCheckedInSids(CHECKED_IN_COLLECTION_ROOT);
      expect(checkedInSids.length).toBeGreaterThan(0);

      const rounds: RoundSummary[] = [];
      for (let roundIndex = 0; roundIndex < FIXTURE_ROUNDS; roundIndex += 1) {
        const round = await runClassificationRound({
          name: `fixtures-${roundIndex + 1}`,
          sourceFiles: checkedInSids,
          expectedRecords: checkedInSids.length,
          forceSingleSong: () => true,
          transformRelativePath: (relativePath) => relativePath,
        });
        rounds.push(round);
        assertRoundBounded(round);
      }

      assertNoCrossRoundDrift(rounds);
    },
    240_000
  );
});