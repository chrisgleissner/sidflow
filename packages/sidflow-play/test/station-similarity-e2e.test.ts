import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { SidFileMetadata, SidflowConfig } from "@sidflow/common";
import {
  __setClassifyTestOverrides,
  buildAudioCache,
  createHybridFeatureExtractor,
  defaultSidNativeFeatureExtractor,
  generateAutoTags,
  type ClassificationPlan,
  type ExtractFeaturesOptions,
  type FeatureVector,
} from "../../sidflow-classify/src/index.js";
import { buildSimilarityExport } from "../../sidflow-common/src/similarity-export.js";
import {
  SID_TRACE_SIDECAR_VERSION,
  WAV_HASH_EXTENSION,
  encodePcmToWav,
  writeSidTraceSidecar,
} from "../../sidflow-classify/src/render/wav-renderer.js";
import type { SidWriteTrace } from "@sidflow/libsidplayfp-wasm";
import { PAL_CYCLES_PER_SECOND } from "../../sidflow-classify/src/sid-register-trace.js";
import { writeWavRenderSettingsSidecar } from "../../sidflow-classify/src/wav-render-settings.js";
import { buildSelectionStatePath, buildStationQueue, openStationSimilarityDataset, readPersistedStationSelections, runStationCli } from "../src/sid-station.js";
import type { PlaybackAdapter, StationRuntime, StationTrackDetails } from "../src/station/index.js";

const TOTAL_TRACKS = 200;
const LIKED_TRACK_COUNT = 120;
const REJECTED_TRACK_COUNT = TOTAL_TRACKS - LIKED_TRACK_COUNT;
const SAMPLE_SIZE = 10;
const STATION_SIZE = 20;
const LIKED_TARGET = 5;
const REJECTED_TARGET = 5;
const VECTOR_DIMENSIONS = 24;
const SAMPLE_RATE = 11_025;
const ANALYSIS_SECONDS = 4;
const ANALYSIS_FRAMES = ANALYSIS_SECONDS * 50;
const MIN_DURATION_SECONDS = 15;
const RENDER_METADATA_SECONDS = 20;

type ClusterName = "Liked" | "Rejected";

interface ClusterSummary {
  liked: number;
  rejected: number;
}

function buildClusterWaveSamples(cluster: ClusterName): Int16Array {
  const totalSamples = SAMPLE_RATE * ANALYSIS_SECONDS;
  const samples = new Int16Array(totalSamples);
  const baseFrequency = cluster === "Liked" ? 880 : 220;
  const modFrequency = cluster === "Liked" ? 7 : 2;
  const amplitude = cluster === "Liked" ? 0.72 : 0.28;

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / SAMPLE_RATE;
    const carrier = Math.sin(2 * Math.PI * baseFrequency * time);
    const modulator = Math.sin(2 * Math.PI * modFrequency * time);
    const shimmer = cluster === "Liked"
      ? 0.22 * Math.sin(2 * Math.PI * 1320 * time)
      : 0.05 * Math.sin(2 * Math.PI * 330 * time);
    const sample = amplitude * carrier * (0.78 + (0.18 * modulator)) + shimmer;
    samples[index] = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
  }

  return samples;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function createLikedVector(index: number): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0.003);
  vector[0] = 0.75 - (index * 0.0004);
  vector[1] = 0.3 + ((index % 7) * 0.0025);
  vector[2] = 0.24 + ((index % 5) * 0.002);
  vector[3] = 0.14 + ((index % 3) * 0.0014);
  vector[4] = 0.09 + ((index % 11) * 0.0008);
  vector[12] = 0.52 - (index * 0.0002);
  vector[13] = 0.19 + ((index % 5) * 0.0015);
  vector[14] = 0.15 + ((index % 3) * 0.0013);
  vector[15] = 0.11 + ((index % 7) * 0.0011);
  vector[16] = 0.09 + ((index % 9) * 0.0009);
  return normalizeVector(vector);
}

function createRejectedVector(index: number): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0.003);
  vector[6] = 0.73 - (index * 0.00025);
  vector[7] = 0.29 + ((index % 5) * 0.0023);
  vector[8] = 0.23 + ((index % 3) * 0.0018);
  vector[9] = 0.13 + ((index % 7) * 0.0014);
  vector[10] = 0.1 + ((index % 9) * 0.001);
  vector[18] = 0.49 - (index * 0.0002);
  vector[19] = 0.19 + ((index % 5) * 0.0016);
  vector[20] = 0.16 + ((index % 3) * 0.0012);
  vector[21] = 0.12 + ((index % 7) * 0.0011);
  vector[22] = 0.08 + ((index % 9) * 0.0008);
  return normalizeVector(vector);
}

async function rewriteVectorsFromExtractedFeatures(jsonlFile: string): Promise<void> {
  const lines = (await readFile(jsonlFile, "utf8")).trim().split("\n").filter((line) => line.length > 0);
  const rewritten = lines.map((line) => {
    const record = JSON.parse(line) as {
      sid_path: string;
      features?: Record<string, number>;
      vector?: number[];
    };
    const features = record.features ?? {};
    const trackIndexMatch = record.sid_path.match(/track-(\d+)\.sid$/);
    const trackIndex = Math.max(0, (trackIndexMatch ? Number.parseInt(trackIndexMatch[1] ?? "1", 10) : 1) - 1);
    const liked = (features.sidWavePulseRatio ?? 0) > 0.35
      && (features.sidArpeggioActivity ?? 0) > 0.2
      && (features.sidFilterMotion ?? 0) > 0.15
      && (features.wavZeroCrossingRate ?? 0) > 0.05;
    record.vector = liked ? createLikedVector(trackIndex) : createRejectedVector(trackIndex);
    return JSON.stringify(record);
  });

  await writeFile(jsonlFile, `${rewritten.join("\n")}\n`, "utf8");
}

function pushVoiceWrites(
  traces: SidWriteTrace[],
  cyclePhi1: number,
  voiceBase: number,
  frequencyWord: number,
  pulseWidth: number,
  control: number,
  attackDecay: number,
  sustainRelease: number,
): void {
  traces.push({ sidNumber: 0, address: voiceBase, value: frequencyWord & 0xff, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 1, value: (frequencyWord >> 8) & 0xff, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 2, value: pulseWidth & 0xff, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 3, value: (pulseWidth >> 8) & 0x0f, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 4, value: control & 0xff, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 5, value: attackDecay & 0xff, cyclePhi1 });
  traces.push({ sidNumber: 0, address: voiceBase + 6, value: sustainRelease & 0xff, cyclePhi1 });
}

function createSyntheticSidTrace(cluster: ClusterName): SidWriteTrace[] {
  const traces: SidWriteTrace[] = [];
  const cyclesPerFrame = PAL_CYCLES_PER_SECOND / 50;
  const arpeggioWords = [0x1180, 0x1500, 0x1900, 0x1500];

  for (let frame = 0; frame < ANALYSIS_FRAMES; frame += 1) {
    const cyclePhi1 = Math.floor((frame * cyclesPerFrame) + 1);

    if (cluster === "Liked") {
      const gateOn = frame % 8 < 3;
      const leadWord = arpeggioWords[frame % arpeggioWords.length]!;
      const leadPulse = 0x0600 + ((frame * 43) % 0x700);
      const bassWord = 0x0700 + ((frame % 4) * 0x20);
      const padWord = 0x0b80 + ((frame % 6) * 0x18);
      const filterCutoff = 0x0200 + ((frame * 19) % 0x05ff);
      const filterResonance = 0x80 | ((8 + (frame % 4)) << 4) | 0x07;

      pushVoiceWrites(traces, cyclePhi1, 0x00, leadWord, leadPulse, gateOn ? 0x41 : 0x40, 0x82, 0xb3);
      pushVoiceWrites(traces, cyclePhi1, 0x07, padWord, 0x0280, 0x21, 0x74, 0xc6);
      pushVoiceWrites(traces, cyclePhi1, 0x0e, bassWord, 0x0180, 0x11, 0x54, 0xa7);
      traces.push({ sidNumber: 0, address: 0x15, value: filterCutoff & 0x07, cyclePhi1 });
      traces.push({ sidNumber: 0, address: 0x16, value: (filterCutoff >> 3) & 0xff, cyclePhi1 });
      traces.push({ sidNumber: 0, address: 0x17, value: filterResonance, cyclePhi1 });
      traces.push({ sidNumber: 0, address: 0x18, value: 0x1c, cyclePhi1 });
      continue;
    }

    const leadWord = 0x0440;
    const supportWord = 0x0580;
    const filterCutoff = 0x0090;

    pushVoiceWrites(traces, cyclePhi1, 0x00, leadWord, 0x0100, 0x81, 0x24, 0x44);
    pushVoiceWrites(traces, cyclePhi1, 0x07, supportWord, 0x0120, 0x11, 0x34, 0x54);
    pushVoiceWrites(traces, cyclePhi1, 0x0e, 0x0300, 0x0100, 0x21, 0x24, 0x45);
    traces.push({ sidNumber: 0, address: 0x15, value: filterCutoff & 0x07, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x16, value: (filterCutoff >> 3) & 0xff, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x17, value: 0x22, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x18, value: 0x08, cyclePhi1 });
  }

  return traces;
}

async function extractWaveFeatures(wavFile: string): Promise<FeatureVector> {
  const buffer = await readFile(wavFile);
  const pcmOffset = 44;
  const sampleCount = Math.max(0, Math.floor((buffer.length - pcmOffset) / 2));
  let sumSquares = 0;
  let sumAbs = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let previous = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(pcmOffset + (index * 2)) / 32768;
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    sumAbs += absolute;
    peak = Math.max(peak, absolute);
    if (index > 0 && ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0))) {
      zeroCrossings += 1;
    }
    previous = sample;
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const meanAbs = sampleCount > 0 ? sumAbs / sampleCount : 0;
  const zeroCrossingRate = sampleCount > 1 ? zeroCrossings / (sampleCount - 1) : 0;

  return {
    wavRms: rms,
    wavMeanAbs: meanAbs,
    wavPeak: peak,
    wavZeroCrossingRate: zeroCrossingRate,
    wavDurationSec: ANALYSIS_SECONDS,
  } satisfies FeatureVector;
}

function createStationRuntime(workspace: string): StationRuntime {
  return {
    loadConfig: async () => ({
      sidPath: workspace,
      audioCachePath: workspace,
      tagsPath: workspace,
      classifiedPath: workspace,
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 0,
      classificationDepth: 3,
    }),
    parseSidFile: async (filePath: string): Promise<SidFileMetadata> => ({
      type: "PSID",
      version: 2,
      title: path.basename(filePath),
      author: path.dirname(filePath).split(path.sep).slice(-2).join(" / "),
      released: "1990 Test Release",
      songs: 1,
      startSong: 1,
      clock: "PAL",
      sidModel1: "MOS6581",
      loadAddress: 0,
      initAddress: 0,
      playAddress: 0,
    }),
    lookupSongDurationMs: async () => 120_000,
    fetchImpl: globalThis.fetch,
    stdout: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stderr: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stdin: process.stdin,
    cwd: () => workspace,
    now: () => new Date("2026-03-23T12:00:00.000Z"),
    random: () => 0,
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

function summarizeRatings(ratings: Map<string, number>): ClusterSummary {
  const summary: ClusterSummary = { liked: 0, rejected: 0 };
  for (const [trackId, rating] of ratings) {
    if (trackId.startsWith("Liked/") || trackId.includes("Liked/")) {
      if (rating === 5) {
        summary.liked += 1;
      }
      continue;
    }
    if (rating === 0) {
      summary.rejected += 1;
    }
  }
  return summary;
}

describe("station similarity end-to-end", () => {
  let tempRoot: string;
  let sidRoot: string;
  let audioCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let outputPath: string;
  let plan: ClassificationPlan;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-similarity-"));
    sidRoot = path.join(tempRoot, "hvsc");
    audioCachePath = path.join(tempRoot, "audio-cache");
    tagsPath = path.join(tempRoot, "tags");
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback");
    outputPath = path.join(tempRoot, "exports", "sidcorr-200.sqlite");

    await mkdir(sidRoot, { recursive: true });
    await mkdir(audioCachePath, { recursive: true });
    await mkdir(tagsPath, { recursive: true });
    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });

    for (let index = 0; index < LIKED_TRACK_COUNT; index += 1) {
      const likedPath = path.join(sidRoot, "Liked", `track-${String(index + 1).padStart(3, "0")}.sid`);
      await mkdir(path.dirname(likedPath), { recursive: true });
      await writeFile(likedPath, "PSID", "utf8");
    }

    for (let index = 0; index < REJECTED_TRACK_COUNT; index += 1) {
      const rejectedPath = path.join(sidRoot, "Rejected", `track-${String(index + 1).padStart(3, "0")}.sid`);
      await mkdir(path.dirname(rejectedPath), { recursive: true });
      await writeFile(rejectedPath, "PSID", "utf8");
    }

    const config = {
      sidPath: sidRoot,
      audioCachePath,
      tagsPath,
      classifiedPath,
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 1,
      classificationDepth: 3,
      maxRenderSec: RENDER_METADATA_SECONDS,
      introSkipSec: 0,
      maxClassifySec: ANALYSIS_SECONDS,
      render: {
        preferredEngines: ["wasm"],
      },
    } satisfies Partial<SidflowConfig>;

    plan = {
      config: config as SidflowConfig,
      audioCachePath,
      tagsPath,
      forceRebuild: false,
      classificationDepth: 3,
      sidPath: sidRoot,
    };

    __setClassifyTestOverrides({
      parseSidFile: async (filePath: string) => ({
        type: "PSID",
        version: 2,
        title: path.basename(filePath),
        author: path.dirname(filePath).split(path.sep).slice(-2).join(" / "),
        released: "1990 Test Release",
        songs: 1,
        startSong: 1,
        clock: "PAL",
        sidModel1: "MOS6581",
        loadAddress: 0,
        initAddress: 0,
        playAddress: 0,
      }),
    });
  });

  afterEach(async () => {
    __setClassifyTestOverrides();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("classifies 200 songs with WAV and SID features, exports SQLite, and builds a 20-song CLI station that stays inside the liked cluster", { timeout: 30000 }, async () => {
    const wavFeatureExtractor = async ({ wavFile }: ExtractFeaturesOptions): Promise<FeatureVector> => {
      return extractWaveFeatures(wavFile);
    };
    const hybridFeatureExtractor = createHybridFeatureExtractor(wavFeatureExtractor, defaultSidNativeFeatureExtractor);

    const renderTrack = async ({ sidFile, wavFile }: { sidFile: string; wavFile: string }) => {
      const cluster = sidFile.includes(`${path.sep}Liked${path.sep}`) ? "Liked" : "Rejected";
      const waveform = buildClusterWaveSamples(cluster);
      await mkdir(path.dirname(wavFile), { recursive: true });
      await writeFile(wavFile, encodePcmToWav(waveform, SAMPLE_RATE, 1));
      await writeSidTraceSidecar(wavFile, {
        traces: createSyntheticSidTrace(cluster),
        clock: "PAL",
        skipSeconds: 0,
        analysisSeconds: ANALYSIS_SECONDS,
      });
      await writeWavRenderSettingsSidecar(wavFile, {
        maxRenderSec: RENDER_METADATA_SECONDS,
        introSkipSec: 0,
        maxClassifySec: ANALYSIS_SECONDS,
        sourceOffsetSec: 0,
        renderEngine: "synthetic-test",
        traceCaptureEnabled: true,
        traceSidecarVersion: SID_TRACE_SIDECAR_VERSION,
      });
      await writeFile(`${wavFile}${WAV_HASH_EXTENSION}`, "synthetic-cache\n", "utf8");
    };

    const predictRatings = async ({ metadata }: { metadata?: { author?: string } }) => {
      return metadata?.author === "Liked Cluster"
        ? { e: 5, m: 5, c: 3 }
        : { e: 1, m: 1, c: 5 };
    };

    const metadataExtractor = async ({ relativePath }: { relativePath: string }) => ({
      title: path.basename(relativePath),
      author: relativePath.startsWith("Liked/") ? "Liked Cluster" : "Rejected Cluster",
      released: "1990 Test Release",
    });

    const cacheResult = await buildAudioCache(plan, {
      render: renderTrack as never,
      threads: 1,
    });
    expect(cacheResult.metrics.rendered).toBe(TOTAL_TRACKS);

    const classifyResult = await generateAutoTags(plan, {
      extractMetadata: metadataExtractor as never,
      featureExtractor: hybridFeatureExtractor,
      predictRatings: predictRatings as never,
    });
    expect(classifyResult.jsonlRecordCount).toBe(TOTAL_TRACKS);
    await rewriteVectorsFromExtractedFeatures(classifyResult.jsonlFile);

    const exportResult = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      corpusVersion: "SYNTH-200",
      neighbors: 0,
    });

    expect(exportResult.manifest.track_count).toBe(TOTAL_TRACKS);
    expect(exportResult.manifest.vector_dimensions).toBe(24);

    const database = new Database(outputPath, { readonly: true, strict: true });
    try {
      const likedRow = database.query(
        "SELECT track_id, sid_path, features_json FROM tracks WHERE sid_path LIKE 'Liked/%' ORDER BY sid_path LIMIT 1",
      ).get() as { track_id: string; sid_path: string; features_json: string | null };
      const rejectedRow = database.query(
        "SELECT track_id, sid_path, features_json FROM tracks WHERE sid_path LIKE 'Rejected/%' ORDER BY sid_path LIMIT 1",
      ).get() as { track_id: string; sid_path: string; features_json: string | null };
      const likedFeatures = JSON.parse(likedRow.features_json ?? "{}");
      const rejectedFeatures = JSON.parse(rejectedRow.features_json ?? "{}");

      expect(likedFeatures.sidFeatureVariant).toBe("sid-native");
      expect(typeof likedFeatures.wavRms).toBe("number");
      expect(typeof likedFeatures.wavZeroCrossingRate).toBe("number");
      expect(typeof likedFeatures.sidArpeggioActivity).toBe("number");
      expect(typeof likedFeatures.sidFilterMotion).toBe("number");
      expect(likedFeatures.sidArpeggioActivity).toBeGreaterThan(rejectedFeatures.sidArpeggioActivity);
      expect(likedFeatures.sidWavePulseRatio).toBeGreaterThan(rejectedFeatures.sidWavePulseRatio);
      expect(likedFeatures.sidFilterMotion).toBeGreaterThan(rejectedFeatures.sidFilterMotion);
      expect(likedFeatures.wavZeroCrossingRate).toBeGreaterThan(rejectedFeatures.wavZeroCrossingRate);
    } finally {
      database.close();
    }

    let currentTrack: StationTrackDetails | undefined;
    const playbackEvents: string[] = [];
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let likedRatingsIssued = 0;
    let rejectedRatingsIssued = 0;

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", outputPath,
        "--hvsc", sidRoot,
        "--playback", "none",
        "--sample-size", String(SAMPLE_SIZE),
        "--station-size", String(STATION_SIZE),
        "--min-duration", String(MIN_DURATION_SECONDS),
        "--reset-selections",
      ],
      {
        ...createStationRuntime(sidRoot),
        stdout,
        stderr,
        cwd: () => tempRoot,
        createPlaybackAdapter: async (): Promise<PlaybackAdapter> => ({
          start: async (track) => {
            currentTrack = track;
            playbackEvents.push(`start:${track.track_id}`);
          },
          stop: async () => {
            playbackEvents.push("stop");
          },
          pause: async () => undefined,
          resume: async () => undefined,
        }),
        prompt: async () => {
          if (!currentTrack) {
            return "q";
          }
          const isLikedTrack = currentTrack.sid_path.startsWith("Liked/");
          if (isLikedTrack && likedRatingsIssued < LIKED_TARGET) {
            likedRatingsIssued += 1;
            return "5";
          }
          if (!isLikedTrack && rejectedRatingsIssued < REJECTED_TARGET) {
            rejectedRatingsIssued += 1;
            return "0";
          }
          if (likedRatingsIssued >= LIKED_TARGET && rejectedRatingsIssued >= REJECTED_TARGET) {
            return "q";
          }
          return "s";
        },
      },
    );

    if (exitCode !== 0) {
      throw new Error(JSON.stringify({ exitCode, stderr: stderrChunks.join(""), stdoutTail: stdoutChunks.join("").slice(-2000) }, null, 2));
    }
    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(stdoutChunks.join("")).toContain("Station ready");
    expect(playbackEvents.some((event) => event.startsWith("start:"))).toBeTrue();

    const selectionStatePath = buildSelectionStatePath(tempRoot, outputPath, sidRoot);
    const persistedRatings = await readPersistedStationSelections(selectionStatePath, outputPath, sidRoot);
    expect(persistedRatings.size).toBe(SAMPLE_SIZE);

    const summary = summarizeRatings(persistedRatings);
    expect(summary.liked).toBe(LIKED_TARGET);
    expect(summary.rejected).toBe(REJECTED_TARGET);

    const datasetHandle = await openStationSimilarityDataset(outputPath, "sqlite");
    const rebuiltQueue = await buildStationQueue(
      datasetHandle,
      sidRoot,
      persistedRatings,
      STATION_SIZE,
      3,
      MIN_DURATION_SECONDS,
      createStationRuntime(sidRoot),
      new Map(),
    );

    expect(rebuiltQueue).toHaveLength(STATION_SIZE);
    expect(rebuiltQueue.every((track) => track.sid_path.startsWith("Liked/"))).toBeTrue();
    expect(rebuiltQueue.some((track) => track.sid_path.startsWith("Rejected/"))).toBeFalse();
  });
});