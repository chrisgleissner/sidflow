import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  loadHvscE2eSubsetManifest,
  stringifyDeterministic,
  type ClassificationRecord,
  type HvscE2eSubsetEntry,
} from "@sidflow/common";

type PersonaMetricName =
  | "melodicComplexity"
  | "rhythmicDensity"
  | "timbralRichness"
  | "nostalgiaBias"
  | "experimentalTolerance";

interface PersonaMetrics {
  melodicComplexity: number;
  rhythmicDensity: number;
  timbralRichness: number;
  nostalgiaBias: number;
  experimentalTolerance: number;
}

interface PersonaDefinition {
  id: string;
  label: string;
  baseThreshold: number;
  stageTargetSize: number;
  metricTargets: PersonaMetrics;
  ratingTargets: { e: number; m: number; c: number };
  metricWeights: Record<PersonaMetricName, number>;
}

interface PersonaTrackContext {
  record: ClassificationRecord;
  subsetEntry: HvscE2eSubsetEntry;
  trackId: string;
  metrics: PersonaMetrics;
}

interface PersonaScoredTrack {
  trackId: string;
  sidPath: string;
  songIndex: number;
  score: number;
  metrics: PersonaMetrics;
  ratings: ClassificationRecord["ratings"];
}

export interface PersonaStageResult {
  personaId: string;
  personaLabel: string;
  inputCount: number;
  threshold: number;
  targetSize: number;
  approvedCount: number;
  approvedTrackIds: string[];
}

export interface SequentialPersonaStationResult {
  personas: Array<{ id: string; label: string }>;
  stages: PersonaStageResult[];
  finalPlaylistTrackIds: string[];
  finalPlaylist: Array<{
    trackId: string;
    sidPath: string;
    songIndex: number;
    score: number;
  }>;
}

interface PersonaStationCliOptions {
  classificationJsonl: string;
  subsetManifest: string;
  outputJson?: string;
  outputM3u?: string;
}

const PERSONAS: PersonaDefinition[] = [
  {
    id: "melodic_archivist",
    label: "Melodic Archivist",
    baseThreshold: 0.67,
    stageTargetSize: 220,
    metricTargets: {
      melodicComplexity: 0.88,
      rhythmicDensity: 0.48,
      timbralRichness: 0.58,
      nostalgiaBias: 0.82,
      experimentalTolerance: 0.32,
    },
    ratingTargets: { e: 2, m: 4, c: 5 },
    metricWeights: {
      melodicComplexity: 0.34,
      rhythmicDensity: 0.12,
      timbralRichness: 0.18,
      nostalgiaBias: 0.24,
      experimentalTolerance: 0.12,
    },
  },
  {
    id: "groove_cartographer",
    label: "Groove Cartographer",
    baseThreshold: 0.68,
    stageTargetSize: 170,
    metricTargets: {
      melodicComplexity: 0.62,
      rhythmicDensity: 0.88,
      timbralRichness: 0.56,
      nostalgiaBias: 0.46,
      experimentalTolerance: 0.42,
    },
    ratingTargets: { e: 5, m: 3, c: 4 },
    metricWeights: {
      melodicComplexity: 0.16,
      rhythmicDensity: 0.36,
      timbralRichness: 0.16,
      nostalgiaBias: 0.08,
      experimentalTolerance: 0.24,
    },
  },
  {
    id: "chip_alchemist",
    label: "Chip Alchemist",
    baseThreshold: 0.69,
    stageTargetSize: 120,
    metricTargets: {
      melodicComplexity: 0.66,
      rhythmicDensity: 0.56,
      timbralRichness: 0.94,
      nostalgiaBias: 0.40,
      experimentalTolerance: 0.74,
    },
    ratingTargets: { e: 4, m: 3, c: 5 },
    metricWeights: {
      melodicComplexity: 0.12,
      rhythmicDensity: 0.12,
      timbralRichness: 0.42,
      nostalgiaBias: 0.06,
      experimentalTolerance: 0.28,
    },
  },
  {
    id: "memory_lane_dj",
    label: "Memory Lane DJ",
    baseThreshold: 0.70,
    stageTargetSize: 80,
    metricTargets: {
      melodicComplexity: 0.70,
      rhythmicDensity: 0.44,
      timbralRichness: 0.52,
      nostalgiaBias: 0.96,
      experimentalTolerance: 0.18,
    },
    ratingTargets: { e: 3, m: 5, c: 3 },
    metricWeights: {
      melodicComplexity: 0.18,
      rhythmicDensity: 0.08,
      timbralRichness: 0.12,
      nostalgiaBias: 0.52,
      experimentalTolerance: 0.10,
    },
  },
  {
    id: "frontier_curator",
    label: "Frontier Curator",
    baseThreshold: 0.72,
    stageTargetSize: 50,
    metricTargets: {
      melodicComplexity: 0.74,
      rhythmicDensity: 0.72,
      timbralRichness: 0.86,
      nostalgiaBias: 0.50,
      experimentalTolerance: 0.82,
    },
    ratingTargets: { e: 4, m: 3, c: 5 },
    metricWeights: {
      melodicComplexity: 0.18,
      rhythmicDensity: 0.18,
      timbralRichness: 0.24,
      nostalgiaBias: 0.08,
      experimentalTolerance: 0.32,
    },
  },
];

function normalizeSubsetSidPath(sidPath: string): string {
  return sidPath.startsWith("C64Music/") ? sidPath.slice("C64Music/".length) : sidPath;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeRating(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return clamp01((value - 1) / 4);
}

function normalizeSignedResidual(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return clamp01((value + 1) / 2);
}

function normalizedEntropy(values: number[]): number {
  const positive = values.filter((value) => value > 0);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || positive.length <= 1) {
    return 0;
  }

  let entropy = 0;
  for (const value of positive) {
    const probability = value / total;
    entropy -= probability * Math.log2(probability);
  }
  return clamp01(entropy / Math.log2(positive.length));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveTrackId(record: ClassificationRecord): string {
  const songIndex = typeof record.song_index === "number" && Number.isFinite(record.song_index)
    ? record.song_index
    : 1;
  return `${record.sid_path}:${songIndex}`;
}

function resolveSongIndex(record: ClassificationRecord): number {
  return typeof record.song_index === "number" && Number.isFinite(record.song_index)
    ? record.song_index
    : 1;
}

function buildPersonaMetrics(record: ClassificationRecord, subsetEntry: HvscE2eSubsetEntry): PersonaMetrics {
  const vector = Array.isArray(record.vector) ? record.vector : [];
  const waveEntropy = normalizedEntropy([
    vector[5] ?? 0,
    vector[6] ?? 0,
    vector[7] ?? 0,
    vector[8] ?? 0,
  ]);
  const olderYearBias = subsetEntry.year === null
    ? 0.5
    : clamp01((2026 - subsetEntry.year) / 44);
  const categoryBias = subsetEntry.category === "GAMES"
    ? 1
    : subsetEntry.category === "DEMOS"
      ? 0.82
      : subsetEntry.category === "MUSICIANS"
        ? 0.58
        : 0.5;
  const sidModelBias = subsetEntry.sidModel1 === "MOS6581"
    ? 1
    : subsetEntry.sidModel1 === "Both"
      ? 0.78
      : subsetEntry.sidModel1 === "MOS8580"
        ? 0.52
        : 0.5;
  const chipCountNorm = clamp01((subsetEntry.chipCount - 1) / 2);
  const residualEnergy = average([
    normalizeSignedResidual(vector[22]),
    normalizeSignedResidual(vector[23]),
  ]);

  return {
    melodicComplexity: clamp01(average([
      normalizeRating(record.ratings.c),
      vector[13] ?? 0.5,
      vector[16] ?? 0.5,
      vector[4] ?? 0,
      1 - Math.abs(0.5 - residualEnergy),
    ])),
    rhythmicDensity: clamp01(average([
      vector[0] ?? 0.5,
      vector[1] ?? 0.5,
      vector[3] ?? 0,
      vector[19] ?? 0.5,
      normalizeRating(record.ratings.e),
    ])),
    timbralRichness: clamp01(average([
      waveEntropy,
      vector[11] ?? 0.5,
      vector[12] ?? 0,
      vector[20] ?? 0.5,
      vector[21] ?? 0.5,
      residualEnergy,
    ])),
    nostalgiaBias: clamp01(average([
      olderYearBias,
      categoryBias,
      sidModelBias,
      subsetEntry.chipCount === 1 ? 0.82 : 0.46,
      normalizeRating(record.ratings.m),
    ])),
    experimentalTolerance: clamp01(average([
      chipCountNorm,
      vector[3] ?? 0,
      vector[12] ?? 0,
      vector[21] ?? 0.5,
      waveEntropy,
      residualEnergy,
    ])),
  };
}

function scoreTrack(context: PersonaTrackContext, persona: PersonaDefinition): number {
  let metricDistance = 0;
  let metricWeight = 0;

  for (const [metricName, weight] of Object.entries(persona.metricWeights) as Array<[PersonaMetricName, number]>) {
    metricDistance += Math.abs(context.metrics[metricName] - persona.metricTargets[metricName]) * weight;
    metricWeight += weight;
  }

  const normalizedMetricScore = metricWeight > 0 ? 1 - (metricDistance / metricWeight) : 0.5;
  const ratingDistance = average([
    Math.abs(normalizeRating(context.record.ratings.e) - normalizeRating(persona.ratingTargets.e)),
    Math.abs(normalizeRating(context.record.ratings.m) - normalizeRating(persona.ratingTargets.m)),
    Math.abs(normalizeRating(context.record.ratings.c) - normalizeRating(persona.ratingTargets.c)),
  ]);

  return clamp01((normalizedMetricScore * 0.82) + ((1 - ratingDistance) * 0.18));
}

function rankTracks(pool: PersonaTrackContext[], persona: PersonaDefinition): PersonaScoredTrack[] {
  return pool
    .map((context) => ({
      trackId: context.trackId,
      sidPath: context.record.sid_path,
      songIndex: resolveSongIndex(context.record),
      score: scoreTrack(context, persona),
      metrics: context.metrics,
      ratings: context.record.ratings,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.trackId.localeCompare(right.trackId);
    });
}

export function buildSequentialPersonaStation(
  records: ClassificationRecord[],
  subsetEntries: HvscE2eSubsetEntry[],
): SequentialPersonaStationResult {
  const subsetByPath = new Map(subsetEntries.map((entry) => [normalizeSubsetSidPath(entry.sidPath), entry] as const));
  let currentPool = records
    .map((record) => {
      const subsetEntry = subsetByPath.get(normalizeSubsetSidPath(record.sid_path));
      if (!subsetEntry) {
        return null;
      }
      return {
        record,
        subsetEntry,
        trackId: resolveTrackId(record),
        metrics: buildPersonaMetrics(record, subsetEntry),
      } satisfies PersonaTrackContext;
    })
    .filter((value): value is PersonaTrackContext => value !== null)
    .sort((left, right) => left.trackId.localeCompare(right.trackId));

  const stages: PersonaStageResult[] = [];

  for (const persona of PERSONAS) {
    const ranked = rankTracks(currentPool, persona);
    const stageTarget = Math.min(persona.stageTargetSize, ranked.length);
    let threshold = persona.baseThreshold;
    let approved = ranked.filter((track) => track.score >= threshold);

    while (approved.length < stageTarget && threshold > 0) {
      threshold = Math.max(0, Number((threshold - 0.02).toFixed(2)));
      approved = ranked.filter((track) => track.score >= threshold);
    }

    if (approved.length < stageTarget) {
      approved = ranked.slice(0, stageTarget);
    } else if (approved.length > stageTarget) {
      approved = approved.slice(0, stageTarget);
    }

    const approvedTrackIds = approved.map((track) => track.trackId);
    stages.push({
      personaId: persona.id,
      personaLabel: persona.label,
      inputCount: currentPool.length,
      threshold,
      targetSize: stageTarget,
      approvedCount: approved.length,
      approvedTrackIds,
    });

    const approvedSet = new Set(approvedTrackIds);
    currentPool = currentPool.filter((context) => approvedSet.has(context.trackId));
  }

  const finalRanked = rankTracks(currentPool, PERSONAS[PERSONAS.length - 1]);
  const finalPlaylist = finalRanked.slice(0, 50).map((track) => ({
    trackId: track.trackId,
    sidPath: track.sidPath,
    songIndex: track.songIndex,
    score: Number(track.score.toFixed(6)),
  }));

  return {
    personas: PERSONAS.map((persona) => ({ id: persona.id, label: persona.label })),
    stages,
    finalPlaylistTrackIds: finalPlaylist.map((track) => track.trackId),
    finalPlaylist,
  };
}

async function loadClassificationRecords(jsonlPath: string): Promise<ClassificationRecord[]> {
  const content = await readFile(jsonlPath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ClassificationRecord);
}

function buildM3uOutput(result: SequentialPersonaStationResult): string {
  return [
    "#EXTM3U",
    ...result.finalPlaylist.map((track) => track.sidPath),
  ].join("\n");
}

function parsePersonaStationArgs(argv: string[]): PersonaStationCliOptions {
  const options: PersonaStationCliOptions = {
    classificationJsonl: "",
    subsetManifest: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--classification-jsonl":
        options.classificationJsonl = argv[++index] ?? "";
        break;
      case "--subset-manifest":
        options.subsetManifest = argv[++index] ?? "";
        break;
      case "--output-json":
        options.outputJson = argv[++index];
        break;
      case "--output-m3u":
        options.outputM3u = argv[++index];
        break;
      case "--help":
      case "-h":
        throw new Error(
          [
            "Usage: sidflow-play persona-station --classification-jsonl <file> --subset-manifest <file> [--output-json <file>] [--output-m3u <file>]",
            "",
            "Build a deterministic 5-persona sequential radio station from a classified HVSC subset.",
          ].join("\n"),
        );
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.classificationJsonl) {
    throw new Error("Missing required --classification-jsonl <file>");
  }
  if (!options.subsetManifest) {
    throw new Error("Missing required --subset-manifest <file>");
  }

  return options;
}

export async function runPersonaStationCli(argv: string[]): Promise<number> {
  let options: PersonaStationCliOptions;
  try {
    options = parsePersonaStationArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return (error as Error).message.startsWith("Usage:") ? 0 : 1;
  }

  const [records, subsetManifest] = await Promise.all([
    loadClassificationRecords(options.classificationJsonl),
    loadHvscE2eSubsetManifest(options.subsetManifest),
  ]);
  const result = buildSequentialPersonaStation(records, subsetManifest.entries);

  if (result.finalPlaylistTrackIds.length !== 50) {
    throw new Error(`Persona station did not converge to exactly 50 tracks; produced ${result.finalPlaylistTrackIds.length}`);
  }

  if (options.outputJson) {
    await ensureDir(path.dirname(options.outputJson));
    await writeFile(options.outputJson, stringifyDeterministic(result), "utf8");
  }
  if (options.outputM3u) {
    await ensureDir(path.dirname(options.outputM3u));
    await writeFile(options.outputM3u, buildM3uOutput(result), "utf8");
  }

  process.stdout.write(`Built persona station with ${result.finalPlaylistTrackIds.length} final tracks\n`);
  return 0;
}