import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  loadHvscE2eSubsetManifest,
  stringifyDeterministic,
  PERSONA_LIST,
  type ClassificationRecord,
  type HvscE2eSubsetEntry,
  type PersonaDefinition,
  type PersonaMetricName,
  type PersonaMetrics,
} from "@sidflow/common";

// ---------------------------------------------------------------------------
// Result types (exported for test consumption)
// ---------------------------------------------------------------------------

export interface PersonaTrackEntry {
  rank: number;
  trackId: string;
  sidPath: string;
  songIndex: number;
  score: number;
  metrics: PersonaMetrics;
  ratings: ClassificationRecord["ratings"];
  explanation: string;
}

export interface PersonaStationOutput {
  personaId: string;
  personaLabel: string;
  trackCount: number;
  tracks: PersonaTrackEntry[];
  distribution: PersonaDistribution;
}

export interface PersonaDistribution {
  avgRhythmicDensity: number;
  avgMelodicComplexity: number;
  avgTimbralRichness: number;
  avgNostalgiaBias: number;
  avgExperimentalTolerance: number;
}

export interface OverlapEntry {
  personaA: string;
  personaB: string;
  sharedCount: number;
  overlapPct: number;
}

export interface ParallelPersonaStationResult {
  personas: Array<{ id: string; label: string }>;
  stations: PersonaStationOutput[];
  overlapMatrix: OverlapEntry[];
  /** True when all overlap pairs are <= MAX_OVERLAP_PCT */
  overlapValid: boolean;
  /** True when distribution leader assertions pass */
  distributionValid: boolean;
  distributionAssertions: DistributionAssertion[];
}

export interface DistributionAssertion {
  metric: PersonaMetricName;
  direction: "highest" | "lowest";
  expectedPersona: string;
  actualPersona: string;
  actualValue: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Internal context type
// ---------------------------------------------------------------------------

interface PersonaTrackContext {
  record: ClassificationRecord;
  subsetEntry: HvscE2eSubsetEntry;
  trackId: string;
  metrics: PersonaMetrics;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATION_SIZE = 50;
const MAX_OVERLAP_PCT = 40;

// Use only the 5 audio-led personas from the shared definitions
const AUDIO_PERSONAS: PersonaDefinition[] = PERSONA_LIST.filter((p) => p.kind === "audio");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSubsetSidPath(sidPath: string): string {
  return sidPath.startsWith("C64Music/") ? sidPath.slice("C64Music/".length) : sidPath;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeRating(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return clamp01((value - 1) / 4);
}

function normalizeSignedResidual(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return clamp01((value + 1) / 2);
}

function normalizedEntropy(values: number[]): number {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((s, v) => s + v, 0);
  if (total <= 0 || positive.length <= 1) return 0;
  let entropy = 0;
  for (const v of positive) {
    const p = v / total;
    entropy -= p * Math.log2(p);
  }
  return clamp01(entropy / Math.log2(positive.length));
}

function average(values: number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function resolveTrackId(record: ClassificationRecord): string {
  const songIndex =
    typeof record.song_index === "number" && Number.isFinite(record.song_index)
      ? record.song_index
      : 1;
  return `${record.sid_path}:${songIndex}`;
}

function resolveSongIndex(record: ClassificationRecord): number {
  return typeof record.song_index === "number" && Number.isFinite(record.song_index)
    ? record.song_index
    : 1;
}

// ---------------------------------------------------------------------------
// Metric derivation (same formula as before — deterministic from vector + metadata)
// ---------------------------------------------------------------------------

function buildPersonaMetrics(
  record: ClassificationRecord,
  subsetEntry: HvscE2eSubsetEntry,
): PersonaMetrics {
  const vector = Array.isArray(record.vector) ? record.vector : [];
  const waveEntropy = normalizedEntropy([
    vector[5] ?? 0,
    vector[6] ?? 0,
    vector[7] ?? 0,
    vector[8] ?? 0,
  ]);
  const olderYearBias =
    subsetEntry.year === null ? 0.5 : clamp01((2026 - subsetEntry.year) / 44);
  const categoryBias =
    subsetEntry.category === "GAMES"
      ? 1
      : subsetEntry.category === "DEMOS"
        ? 0.82
        : subsetEntry.category === "MUSICIANS"
          ? 0.58
          : 0.5;
  const sidModelBias =
    subsetEntry.sidModel1 === "MOS6581"
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
    melodicComplexity: clamp01(
      average([
        normalizeRating(record.ratings.c),
        vector[13] ?? 0.5,
        vector[16] ?? 0.5,
        vector[4] ?? 0,
        1 - Math.abs(0.5 - residualEnergy),
      ]),
    ),
    rhythmicDensity: clamp01(
      average([
        vector[0] ?? 0.5,
        vector[1] ?? 0.5,
        vector[3] ?? 0,
        vector[19] ?? 0.5,
        normalizeRating(record.ratings.e),
      ]),
    ),
    timbralRichness: clamp01(
      average([
        waveEntropy,
        vector[11] ?? 0.5,
        vector[12] ?? 0,
        vector[20] ?? 0.5,
        vector[21] ?? 0.5,
        residualEnergy,
      ]),
    ),
    nostalgiaBias: clamp01(
      average([
        olderYearBias,
        categoryBias,
        sidModelBias,
        subsetEntry.chipCount === 1 ? 0.82 : 0.46,
        normalizeRating(record.ratings.m),
      ]),
    ),
    experimentalTolerance: clamp01(
      average([
        chipCountNorm,
        vector[3] ?? 0,
        vector[12] ?? 0,
        vector[21] ?? 0.5,
        waveEntropy,
        residualEnergy,
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Scoring — directional weighted metric score
// ---------------------------------------------------------------------------

/**
 * Scores a track for a persona. Each metric contributes:
 *   direction +1 → raw metric value (higher is better)
 *   direction -1 → (1 - raw metric value) (lower is better)
 *   direction  0 → 0.5 (neutral, no contribution)
 * Weighted sum produces final score in [0, 1].
 */
function scoreTrack(
  metrics: PersonaMetrics,
  ratings: ClassificationRecord["ratings"],
  persona: PersonaDefinition,
): { score: number; breakdown: Record<PersonaMetricName, number> } {
  const breakdown = {} as Record<PersonaMetricName, number>;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const metricName of Object.keys(persona.metricWeights) as PersonaMetricName[]) {
    const weight = persona.metricWeights[metricName];
    const direction = persona.metricDirections[metricName];
    const raw = metrics[metricName];
    let contribution: number;
    if (direction === 1) {
      contribution = raw;
    } else if (direction === -1) {
      contribution = 1 - raw;
    } else {
      contribution = 0.5;
    }
    breakdown[metricName] = contribution * weight;
    weightedSum += contribution * weight;
    totalWeight += weight;
  }

  // Rating affinity (small bonus, 18% of total)
  const ratingDistance = average([
    Math.abs(normalizeRating(ratings.e) - normalizeRating(persona.ratingTargets.e)),
    Math.abs(normalizeRating(ratings.m) - normalizeRating(persona.ratingTargets.m)),
    Math.abs(normalizeRating(ratings.c) - normalizeRating(persona.ratingTargets.c)),
  ]);

  const metricScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  const score = clamp01(metricScore * 0.82 + (1 - ratingDistance) * 0.18);
  return { score, breakdown };
}

function buildExplanation(
  metrics: PersonaMetrics,
  breakdown: Record<PersonaMetricName, number>,
  persona: PersonaDefinition,
): string {
  // Sort by contribution descending
  const sorted = (Object.keys(breakdown) as PersonaMetricName[])
    .filter((k) => persona.metricDirections[k] !== 0)
    .sort((a, b) => breakdown[b] - breakdown[a]);

  const top = sorted.slice(0, 2);
  const parts = top.map((m) => {
    const dir = persona.metricDirections[m];
    const dirLabel = dir === 1 ? "high" : "low";
    return `${m}=${metrics[m].toFixed(3)} (${dirLabel}, w=${persona.metricWeights[m].toFixed(2)})`;
  });
  return `Selected for ${persona.label}: ${parts.join("; ")}`;
}

// ---------------------------------------------------------------------------
// Distribution computation
// ---------------------------------------------------------------------------

function computeDistribution(tracks: PersonaTrackEntry[]): PersonaDistribution {
  const n = tracks.length || 1;
  return {
    avgRhythmicDensity: tracks.reduce((s, t) => s + t.metrics.rhythmicDensity, 0) / n,
    avgMelodicComplexity: tracks.reduce((s, t) => s + t.metrics.melodicComplexity, 0) / n,
    avgTimbralRichness: tracks.reduce((s, t) => s + t.metrics.timbralRichness, 0) / n,
    avgNostalgiaBias: tracks.reduce((s, t) => s + t.metrics.nostalgiaBias, 0) / n,
    avgExperimentalTolerance: tracks.reduce((s, t) => s + t.metrics.experimentalTolerance, 0) / n,
  };
}

// ---------------------------------------------------------------------------
// Overlap computation
// ---------------------------------------------------------------------------

function computeOverlapMatrix(stations: PersonaStationOutput[]): OverlapEntry[] {
  const entries: OverlapEntry[] = [];
  for (let i = 0; i < stations.length; i++) {
    const setA = new Set(stations[i].tracks.map((t) => t.trackId));
    for (let j = i + 1; j < stations.length; j++) {
      const setB = new Set(stations[j].tracks.map((t) => t.trackId));
      let shared = 0;
      for (const id of setA) {
        if (setB.has(id)) shared++;
      }
      const overlapPct = (shared / STATION_SIZE) * 100;
      entries.push({
        personaA: stations[i].personaId,
        personaB: stations[j].personaId,
        sharedCount: shared,
        overlapPct: Number(overlapPct.toFixed(1)),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Distribution assertions
// ---------------------------------------------------------------------------

function validateDistributions(stations: PersonaStationOutput[]): DistributionAssertion[] {
  const assertions: DistributionAssertion[] = [];

  const rules: Array<{
    metric: PersonaMetricName;
    distKey: keyof PersonaDistribution;
    direction: "highest" | "lowest";
    expectedPersona: string;
  }> = [
    { metric: "rhythmicDensity", distKey: "avgRhythmicDensity", direction: "highest", expectedPersona: "fast_paced" },
    { metric: "rhythmicDensity", distKey: "avgRhythmicDensity", direction: "lowest", expectedPersona: "slow_ambient" },
    { metric: "experimentalTolerance", distKey: "avgExperimentalTolerance", direction: "highest", expectedPersona: "experimental" },
    { metric: "nostalgiaBias", distKey: "avgNostalgiaBias", direction: "highest", expectedPersona: "nostalgic" },
    { metric: "melodicComplexity", distKey: "avgMelodicComplexity", direction: "highest", expectedPersona: "melodic" },
  ];

  for (const rule of rules) {
    let bestStation = stations[0];
    for (const station of stations) {
      const current = station.distribution[rule.distKey];
      const best = bestStation.distribution[rule.distKey];
      if (rule.direction === "highest" ? current > best : current < best) {
        bestStation = station;
      }
    }
    assertions.push({
      metric: rule.metric,
      direction: rule.direction,
      expectedPersona: rule.expectedPersona,
      actualPersona: bestStation.personaId,
      actualValue: bestStation.distribution[rule.distKey],
      passed: bestStation.personaId === rule.expectedPersona,
    });
  }

  return assertions;
}

// ---------------------------------------------------------------------------
// Core: build parallel persona stations
// ---------------------------------------------------------------------------

export function buildParallelPersonaStation(
  records: ClassificationRecord[],
  subsetEntries: HvscE2eSubsetEntry[],
): ParallelPersonaStationResult {
  const subsetByPath = new Map(
    subsetEntries.map((entry) => [normalizeSubsetSidPath(entry.sidPath), entry] as const),
  );

  // Build full pool — every track is available to every persona
  const pool: PersonaTrackContext[] = records
    .map((record) => {
      const subsetEntry = subsetByPath.get(normalizeSubsetSidPath(record.sid_path));
      if (!subsetEntry) return null;
      return {
        record,
        subsetEntry,
        trackId: resolveTrackId(record),
        metrics: buildPersonaMetrics(record, subsetEntry),
      } satisfies PersonaTrackContext;
    })
    .filter((v): v is PersonaTrackContext => v !== null)
    .sort((a, b) => a.trackId.localeCompare(b.trackId));

  // Each persona independently scores ALL tracks and takes top STATION_SIZE
  const stations: PersonaStationOutput[] = AUDIO_PERSONAS.map((persona) => {
    const scored = pool
      .map((ctx) => {
        const { score, breakdown } = scoreTrack(ctx.metrics, ctx.record.ratings, persona);
        return { ctx, score, breakdown };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.ctx.trackId.localeCompare(b.ctx.trackId);
      });

    const topN = scored.slice(0, STATION_SIZE);

    const tracks: PersonaTrackEntry[] = topN.map((entry, rank) => ({
      rank: rank + 1,
      trackId: entry.ctx.trackId,
      sidPath: entry.ctx.record.sid_path,
      songIndex: resolveSongIndex(entry.ctx.record),
      score: Number(entry.score.toFixed(6)),
      metrics: {
        melodicComplexity: Number(entry.ctx.metrics.melodicComplexity.toFixed(6)),
        rhythmicDensity: Number(entry.ctx.metrics.rhythmicDensity.toFixed(6)),
        timbralRichness: Number(entry.ctx.metrics.timbralRichness.toFixed(6)),
        nostalgiaBias: Number(entry.ctx.metrics.nostalgiaBias.toFixed(6)),
        experimentalTolerance: Number(entry.ctx.metrics.experimentalTolerance.toFixed(6)),
      },
      ratings: entry.ctx.record.ratings,
      explanation: buildExplanation(entry.ctx.metrics, entry.breakdown, persona),
    }));

    const distribution = computeDistribution(tracks);
    return {
      personaId: persona.id,
      personaLabel: persona.label,
      trackCount: tracks.length,
      tracks,
      distribution,
    };
  });

  const overlapMatrix = computeOverlapMatrix(stations);
  const overlapValid = overlapMatrix.every((e) => e.overlapPct <= MAX_OVERLAP_PCT);
  const distributionAssertions = validateDistributions(stations);
  const distributionValid = distributionAssertions.every((a) => a.passed);

  return {
    personas: AUDIO_PERSONAS.map((p) => ({ id: p.id, label: p.label })),
    stations,
    overlapMatrix,
    overlapValid,
    distributionValid,
    distributionAssertions,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface PersonaStationCliOptions {
  classificationJsonl: string;
  subsetManifest: string;
  outputJson?: string;
  outputM3u?: string;
}

async function loadClassificationRecords(jsonlPath: string): Promise<ClassificationRecord[]> {
  const content = await readFile(jsonlPath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ClassificationRecord);
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
            "Build 5 independent persona radio stations from a classified HVSC subset (parallel model).",
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
  const result = buildParallelPersonaStation(records, subsetManifest.entries);

  // Validate: every station must have exactly STATION_SIZE tracks
  for (const station of result.stations) {
    if (station.trackCount !== STATION_SIZE) {
      throw new Error(
        `Persona "${station.personaLabel}" produced ${station.trackCount} tracks, expected ${STATION_SIZE}`,
      );
    }
  }

  // Validate: overlap constraint
  if (!result.overlapValid) {
    const violations = result.overlapMatrix.filter((e) => e.overlapPct > MAX_OVERLAP_PCT);
    throw new Error(
      `Overlap constraint violated (max ${MAX_OVERLAP_PCT}%): ${violations.map((v) => `${v.personaA}/${v.personaB}=${v.overlapPct}%`).join(", ")}`,
    );
  }

  // Validate: distribution assertions
  if (!result.distributionValid) {
    const failures = result.distributionAssertions.filter((a) => !a.passed);
    throw new Error(
      `Distribution assertions failed: ${failures.map((f) => `${f.metric} ${f.direction} expected=${f.expectedPersona} actual=${f.actualPersona}`).join("; ")}`,
    );
  }

  if (options.outputJson) {
    await ensureDir(path.dirname(options.outputJson));
    await writeFile(options.outputJson, stringifyDeterministic(JSON.parse(JSON.stringify(result))), "utf8");
  }
  if (options.outputM3u) {
    // M3U uses the first persona station by default
    await ensureDir(path.dirname(options.outputM3u));
    const m3u = [
      "#EXTM3U",
      ...result.stations[0].tracks.map((t) => t.sidPath),
    ].join("\n");
    await writeFile(options.outputM3u, m3u, "utf8");
  }

  const stationSummary = result.stations
    .map((s) => `${s.personaLabel}: ${s.trackCount}`)
    .join(", ");
  process.stdout.write(`Built ${result.stations.length} persona stations (${stationSummary})\n`);
  return 0;
}
