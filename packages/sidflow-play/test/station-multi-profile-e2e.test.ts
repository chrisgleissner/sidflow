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
import { buildStationQueue } from "../src/sid-station.js";
import type { StationRuntime } from "../src/station/index.js";

const TRACKS_PER_CLUSTER = 40;
const TOTAL_TRACKS = TRACKS_PER_CLUSTER * 5;
const STATION_SIZE = 20;
const SAMPLE_SIZE = 10;
const VECTOR_DIMENSIONS = 24;
const SAMPLE_RATE = 11_025;
const ANALYSIS_SECONDS = 4;
const ANALYSIS_FRAMES = ANALYSIS_SECONDS * 50;
const MIN_DURATION_SECONDS = 15;
const RENDER_METADATA_SECONDS = 20;

type ClusterDefinition = {
  name: string;
  baseFrequency: number;
  modFrequency: number;
  shimmerFrequency: number;
  amplitude: number;
  ratings: { e: number; m: number; c: number };
  dominantDimensions: number[];
  leadControl: number;
  padControl: number;
  bassControl: number;
  filterBase: number;
  filterStep: number;
  resonance: number;
};

const CLUSTERS: ClusterDefinition[] = [
  {
    name: "NeonPulse",
    baseFrequency: 960,
    modFrequency: 9,
    shimmerFrequency: 1440,
    amplitude: 0.78,
    ratings: { e: 5, m: 1, c: 1 },
    dominantDimensions: [0, 1, 2, 3],
    leadControl: 0x41,
    padControl: 0x21,
    bassControl: 0x11,
    filterBase: 0x260,
    filterStep: 23,
    resonance: 0x97,
  },
  {
    name: "VelvetDreams",
    baseFrequency: 420,
    modFrequency: 4,
    shimmerFrequency: 660,
    amplitude: 0.44,
    ratings: { e: 1, m: 5, c: 1 },
    dominantDimensions: [4, 5, 6, 7],
    leadControl: 0x21,
    padControl: 0x21,
    bassControl: 0x11,
    filterBase: 0x180,
    filterStep: 11,
    resonance: 0x64,
  },
  {
    name: "ClockworkMaze",
    baseFrequency: 310,
    modFrequency: 13,
    shimmerFrequency: 930,
    amplitude: 0.36,
    ratings: { e: 1, m: 1, c: 5 },
    dominantDimensions: [8, 9, 10, 11],
    leadControl: 0x81,
    padControl: 0x41,
    bassControl: 0x11,
    filterBase: 0x120,
    filterStep: 31,
    resonance: 0x3a,
  },
  {
    name: "ArenaAnthems",
    baseFrequency: 720,
    modFrequency: 6,
    shimmerFrequency: 1080,
    amplitude: 0.69,
    ratings: { e: 5, m: 5, c: 2 },
    dominantDimensions: [12, 13, 14, 15],
    leadControl: 0x41,
    padControl: 0x41,
    bassControl: 0x21,
    filterBase: 0x220,
    filterStep: 17,
    resonance: 0x86,
  },
  {
    name: "LabyrinthNoir",
    baseFrequency: 250,
    modFrequency: 8,
    shimmerFrequency: 500,
    amplitude: 0.33,
    ratings: { e: 2, m: 5, c: 5 },
    dominantDimensions: [16, 17, 18, 19],
    leadControl: 0x81,
    padControl: 0x21,
    bassControl: 0x21,
    filterBase: 0x150,
    filterStep: 27,
    resonance: 0x59,
  },
];

function buildClusterWaveSamples(cluster: ClusterDefinition): Int16Array {
  const totalSamples = SAMPLE_RATE * ANALYSIS_SECONDS;
  const samples = new Int16Array(totalSamples);

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / SAMPLE_RATE;
    const carrier = Math.sin(2 * Math.PI * cluster.baseFrequency * time);
    const modulator = Math.sin(2 * Math.PI * cluster.modFrequency * time);
    const shimmer = 0.18 * Math.sin(2 * Math.PI * cluster.shimmerFrequency * time);
    const sample = cluster.amplitude * carrier * (0.7 + (0.2 * modulator)) + shimmer;
    samples[index] = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
  }

  return samples;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function createClusterVector(cluster: ClusterDefinition, trackIndex: number): number[] {
  const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0.004);
  for (const dimension of cluster.dominantDimensions) {
    vector[dimension] = 0.72 - (trackIndex * 0.0009) + ((dimension % 4) * 0.015);
  }
  vector[20] = (cluster.ratings.e / 5) * 0.42;
  vector[21] = (cluster.ratings.m / 5) * 0.42;
  vector[22] = (cluster.ratings.c / 5) * 0.42;
  vector[23] = 0.08 + ((trackIndex % 7) * 0.003);
  return normalizeVector(vector);
}

async function rewriteVectorsByCluster(jsonlFile: string): Promise<void> {
  const lines = (await readFile(jsonlFile, "utf8")).trim().split("\n").filter((line) => line.length > 0);
  const rewritten = lines.map((line) => {
    const record = JSON.parse(line) as { sid_path: string; vector?: number[] };
    const cluster = CLUSTERS.find((entry) => record.sid_path.startsWith(`${entry.name}/`));
    if (!cluster) {
      throw new Error(`Unable to resolve cluster for ${record.sid_path}`);
    }
    const trackIndexMatch = record.sid_path.match(/track-(\d+)\.sid$/);
    const trackIndex = Math.max(0, (trackIndexMatch ? Number.parseInt(trackIndexMatch[1] ?? "1", 10) : 1) - 1);
    record.vector = createClusterVector(cluster, trackIndex);
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

function createSyntheticSidTrace(cluster: ClusterDefinition): SidWriteTrace[] {
  const traces: SidWriteTrace[] = [];
  const cyclesPerFrame = PAL_CYCLES_PER_SECOND / 50;

  for (let frame = 0; frame < ANALYSIS_FRAMES; frame += 1) {
    const cyclePhi1 = Math.floor((frame * cyclesPerFrame) + 1);
    const gateOn = frame % (4 + (cluster.modFrequency % 5)) < 2;
    const leadWord = 0x0500 + ((cluster.baseFrequency + (frame * cluster.modFrequency)) % 0x0a00);
    const padWord = 0x0300 + ((cluster.shimmerFrequency + (frame * 7)) % 0x0600);
    const bassWord = 0x0200 + ((cluster.baseFrequency / 2 + (frame * 5)) % 0x0400);
    const leadPulse = 0x0200 + ((frame * (cluster.modFrequency + 11)) % 0x0900);
    const filterCutoff = cluster.filterBase + ((frame * cluster.filterStep) % 0x05ff);

    pushVoiceWrites(traces, cyclePhi1, 0x00, leadWord, leadPulse, gateOn ? cluster.leadControl : (cluster.leadControl & 0xfe), 0x84, 0xb4);
    pushVoiceWrites(traces, cyclePhi1, 0x07, padWord, 0x0280, cluster.padControl, 0x63, 0xa6);
    pushVoiceWrites(traces, cyclePhi1, 0x0e, bassWord, 0x0180, cluster.bassControl, 0x53, 0x95);
    traces.push({ sidNumber: 0, address: 0x15, value: filterCutoff & 0x07, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x16, value: (filterCutoff >> 3) & 0xff, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x17, value: cluster.resonance, cyclePhi1 });
    traces.push({ sidNumber: 0, address: 0x18, value: 0x1c, cyclePhi1 });
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
    now: () => new Date("2026-03-26T12:00:00.000Z"),
    random: () => 0,
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

function resolveClusterForPath(relativePath: string): ClusterDefinition {
  const cluster = CLUSTERS.find((entry) => relativePath.startsWith(`${entry.name}/`));
  if (!cluster) {
    throw new Error(`Unable to resolve cluster for ${relativePath}`);
  }
  return cluster;
}

function assertClusterPureQueue(queueSidPaths: string[], expectedCluster: string): void {
  expect(queueSidPaths).toHaveLength(STATION_SIZE);
  expect(queueSidPaths.every((sidPath) => sidPath.startsWith(`${expectedCluster}/`))).toBeTrue();
}

describe("station multi-profile end-to-end", () => {
  let tempRoot: string;
  let sidRoot: string;
  let audioCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let outputPath: string;
  let plan: ClassificationPlan;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-multi-profile-"));
    sidRoot = path.join(tempRoot, "hvsc");
    audioCachePath = path.join(tempRoot, "audio-cache");
    tagsPath = path.join(tempRoot, "tags");
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback");
    outputPath = path.join(tempRoot, "exports", "sidcorr-5-clusters.sqlite");

    await mkdir(sidRoot, { recursive: true });
    await mkdir(audioCachePath, { recursive: true });
    await mkdir(tagsPath, { recursive: true });
    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });

    for (const cluster of CLUSTERS) {
      for (let index = 0; index < TRACKS_PER_CLUSTER; index += 1) {
        const filePath = path.join(sidRoot, cluster.name, `track-${String(index + 1).padStart(3, "0")}.sid`);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, "PSID", "utf8");
      }
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

  test("classifies one corpus and builds five distinct 10-rating stations that stay inside each taste cluster", { timeout: 45000 }, async () => {
    const wavFeatureExtractor = async ({ wavFile }: ExtractFeaturesOptions): Promise<FeatureVector> => extractWaveFeatures(wavFile);
    const hybridFeatureExtractor = createHybridFeatureExtractor(wavFeatureExtractor, defaultSidNativeFeatureExtractor);

    const renderTrack = async ({ sidFile, wavFile }: { sidFile: string; wavFile: string }) => {
      const relativePath = path.relative(sidRoot, sidFile).replace(/\\/g, "/");
      const cluster = resolveClusterForPath(relativePath);
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

    const metadataExtractor = async ({ relativePath }: { relativePath: string }) => {
      const cluster = resolveClusterForPath(relativePath);
      return {
        title: path.basename(relativePath),
        author: cluster.name,
        released: "1990 Test Release",
      };
    };

    const predictRatings = async ({ metadata }: { metadata?: { author?: string } }) => {
      const cluster = CLUSTERS.find((entry) => entry.name === metadata?.author);
      if (!cluster) {
        throw new Error(`Unable to resolve ratings cluster for ${metadata?.author ?? "unknown"}`);
      }
      return cluster.ratings;
    };

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
    await rewriteVectorsByCluster(classifyResult.jsonlFile);

    const exportResult = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      corpusVersion: "SYNTH-5-PROFILES",
      neighbors: 0,
    });
    expect(exportResult.manifest.track_count).toBe(TOTAL_TRACKS);
    expect(exportResult.manifest.vector_dimensions).toBe(VECTOR_DIMENSIONS);

    const database = new Database(outputPath, { readonly: true, strict: true });
    const tracksByCluster = new Map<string, Array<{ track_id: string; sid_path: string }>>();
    try {
      const rows = database
        .query("SELECT track_id, sid_path, e, m, c FROM tracks ORDER BY sid_path")
        .all() as Array<{ track_id: string; sid_path: string; e: number; m: number; c: number }>;

      expect(rows).toHaveLength(TOTAL_TRACKS);
      for (const cluster of CLUSTERS) {
        const clusterRows = rows.filter((row) => row.sid_path.startsWith(`${cluster.name}/`));
        expect(clusterRows).toHaveLength(TRACKS_PER_CLUSTER);
        expect(clusterRows.every((row) => row.e === cluster.ratings.e && row.m === cluster.ratings.m && row.c === cluster.ratings.c)).toBeTrue();
        tracksByCluster.set(cluster.name, clusterRows.map((row) => ({ track_id: row.track_id, sid_path: row.sid_path })));
      }
    } finally {
      database.close();
    }

    const runtime = createStationRuntime(sidRoot);
    const queueMembership = new Map<string, Set<string>>();

    for (let index = 0; index < CLUSTERS.length; index += 1) {
      const cluster = CLUSTERS[index]!;
      const likedSeeds = tracksByCluster.get(cluster.name)!.slice(0, 5);
      const dislikedSeeds = CLUSTERS.filter((entry) => entry.name !== cluster.name)
        .flatMap((entry) => tracksByCluster.get(entry.name)!.slice(0, 2))
        .slice(0, 5);

      const ratings = new Map<string, number>();
      for (const seed of likedSeeds) {
        ratings.set(seed.track_id, 5);
      }
      for (const seed of dislikedSeeds) {
        ratings.set(seed.track_id, 0);
      }

      expect(ratings.size).toBe(SAMPLE_SIZE);

      const queue = await buildStationQueue(
        outputPath,
        sidRoot,
        ratings,
        STATION_SIZE,
        0,
        MIN_DURATION_SECONDS,
        runtime,
        new Map(),
      );

      const queueSidPaths = queue.map((track) => track.sid_path);
      assertClusterPureQueue(queueSidPaths, cluster.name);
      queueMembership.set(cluster.name, new Set(queueSidPaths));
    }

    for (let leftIndex = 0; leftIndex < CLUSTERS.length; leftIndex += 1) {
      const left = CLUSTERS[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < CLUSTERS.length; rightIndex += 1) {
        const right = CLUSTERS[rightIndex]!;
        const overlap = [...queueMembership.get(left.name)!].filter((sidPath) => queueMembership.get(right.name)!.has(sidPath));
        expect(overlap).toHaveLength(0);
      }
    }
  });
});