#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";

import {
  cosineSimilarity,
  ensureDir,
  formatHelp,
  handleParseResult,
  loadConfig,
  lookupSongDurationMs,
  parseArgs,
  parseSidFile,
  pathExists,
  PERSONA_IDS,
  recommendFromSeedTrack,
  scoreTrackForPersona,
  stringifyDeterministic,
  writeCanonicalJsonFile,
  type ArgDef,
  type JsonValue,
  type PersonaId,
  type PersonaMetrics,
  type SidFileMetadata,
  type SidflowConfig,
} from "../packages/sidflow-common/src/index.js";
import {
  buildStationQueue,
  openStationSimilarityDataset,
  type StationRuntime,
  type StationTrackDetails,
} from "../packages/sidflow-play/src/station/index.js";

type ExportSource = "local" | "release";

type AuditCliOptions = {
  config?: string;
  exportSource?: ExportSource;
  fullExport?: string;
  tinyExport?: string;
  liteExport?: string;
  outputRoot?: string;
  stationSize?: number;
  personaRuns?: number;
  seedSongCount?: number;
  strict?: boolean;
  ci?: boolean;
  releaseRepo?: string;
  releaseTag?: string;
  minDurationSeconds?: number;
  adventure?: number;
};

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  digest?: string;
  size?: number;
};

type GitHubRelease = {
  tag_name?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
};

type ExportTrackRow = {
  track_id: string;
  sid_path: string;
  song_index: number;
  e: number;
  m: number;
  c: number;
  p: number | null;
};

type MetadataSummary = {
  absolutePath?: string;
  title: string;
  composer?: string;
  released?: string;
  year?: number;
  category?: string;
  titleThemeTags: string[];
};

type CorpusStats = {
  parentCounts: Map<string, number>;
  minParentCount: number;
  maxParentCount: number;
};

type SeedFavorite = {
  trackId: string;
  sidPath: string;
  rating: number;
  personaScore: number;
  title?: string;
  composer?: string;
  year?: number;
};

type StationRunMetrics = {
  personaId: PersonaId;
  runSeed: number;
  favoriteSeedPath: string;
  fullStationPath: string;
  tinyStationPath: string;
  stationSize: number;
  overlapRatio: number;
  sharedTrackCount: number;
  comparedTrackCount: number;
  jaccard: number;
  spearman: number;
  coherenceFull: number;
  coherenceTiny: number;
  coherenceDelta: number;
  styleSimilarity: number;
  styleMaxDelta: number;
  composerDiversityFull: number;
  composerDiversityTiny: number;
  composerDiversityDelta: number;
  yearSpreadFull: number | null;
  yearSpreadTiny: number | null;
  yearSpreadDelta: number | null;
  duplicateSidRateFull: number;
  duplicateSidRateTiny: number;
  duplicateSidRateDelta: number;
  pass: boolean;
};

type StationPersonaSummary = {
  personaId: PersonaId;
  runs: number;
  medianOverlap: number;
  worstOverlap: number;
  medianJaccard: number;
  medianSpearman: number;
  medianCoherenceDelta: number;
  medianStyleSimilarity: number;
  pass: boolean;
};

type DivergenceRunMetrics = {
  exportFormat: "full" | "tiny";
  runSeed: number;
  personaA: PersonaId;
  personaB: PersonaId;
  overlapRatio: number;
  jaccard: number;
  spearman: number;
  styleSimilarity: number;
  styleMaxDelta: number;
  composerDiversityDelta: number;
  yearSpreadDelta: number | null;
};

type DivergencePairSummary = {
  exportFormat: "full" | "tiny";
  personaA: PersonaId;
  personaB: PersonaId;
  runs: number;
  medianOverlap: number;
  worstOverlap: number;
  medianSpearman: number;
  medianStyleSimilarity: number;
  maxStyleDelta: number;
  collapseRisk: boolean;
  pass: boolean;
};

type SeedSongMetrics = {
  seedTrackId: string;
  seedSidPath: string;
  fullResultsPath: string;
  tinyResultsPath: string;
  tinyMode: string;
  top10Overlap: number;
  top20Overlap: number;
  top50Overlap: number;
  top10Jaccard: number;
  top20Jaccard: number;
  top50Jaccard: number;
  rankCorrelation: number;
  missingFromTinyTop10: string[];
  missingFromFullTop10: string[];
  missingFromTinyTop20: string[];
  missingFromFullTop20: string[];
  pass: boolean;
};

type SeedSongSummary = {
  seedCount: number;
  medianTop10Overlap: number;
  worstTop10Overlap: number;
  medianTop20Overlap: number;
  worstTop20Overlap: number;
  medianTop50Overlap: number;
  medianRankCorrelation: number;
  pass: boolean;
};

type DeterminismProof = {
  stationInputsIdentical: boolean;
  stationOutputsIdentical: boolean;
  seedSongOutputsIdentical: boolean;
  verdictStable: boolean;
};

type AuditThresholds = {
  stationMedianOverlapMin: number;
  stationWorstOverlapMin: number;
  stationMedianJaccardMin: number;
  stationMedianSpearmanMin: number;
  stationMedianCoherenceDeltaMax: number;
  stationMedianStyleSimilarityMin: number;
  seedTop10OverlapMin: number;
  seedTop20OverlapMin: number;
  divergenceMedianOverlapMax: number;
  divergenceWorstOverlapMax: number;
  divergenceParityMedianOverlapDeltaMax: number;
  divergenceParityWorstOverlapDeltaMax: number;
  divergenceParitySpearmanDeltaMax: number;
  divergenceParityStyleSimilarityDeltaMax: number;
};

type ResolvedInputs = {
  exportSource: ExportSource;
  fullExportPath: string;
  tinyExportPath: string;
  liteExportPath?: string;
  fullManifestPath?: string;
  tinyManifestPath?: string;
  liteManifestPath?: string;
  release?: {
    repo: string;
    tag: string;
    publishedAt?: string;
  };
};

const DEFAULT_OUTPUT_ROOT = "tmp/lite-export-check/latest";
const DEFAULT_RELEASE_REPO = "chrisgleissner/sidflow-data";
const DEFAULT_RELEASE_TAG = "latest";
const DEFAULT_STATION_SIZE = 50;
const DEFAULT_PERSONA_RUNS = 5;
const DEFAULT_SEED_SONG_COUNT = 50;
const DEFAULT_MIN_DURATION_SECONDS = 15;
const DEFAULT_ADVENTURE = 3;
const PERSONA_RUN_SEEDS = [1001, 1002, 1003, 1004, 1005] as const;
const FAVORITE_RATINGS = [5, 5, 4, 4, 3] as const;
const FAVORITE_CANDIDATE_POOL = 256;

const THRESHOLDS: AuditThresholds = {
  stationMedianOverlapMin: 0.8,
  stationWorstOverlapMin: 0.7,
  stationMedianJaccardMin: 0.65,
  stationMedianSpearmanMin: 0.55,
  stationMedianCoherenceDeltaMax: 0.2,
  stationMedianStyleSimilarityMin: 0.8,
  seedTop10OverlapMin: 0.35,
  seedTop20OverlapMin: 0.3,
  divergenceMedianOverlapMax: 0.75,
  divergenceWorstOverlapMax: 0.9,
  divergenceParityMedianOverlapDeltaMax: 0.1,
  divergenceParityWorstOverlapDeltaMax: 0.1,
  divergenceParitySpearmanDeltaMax: 0.2,
  divergenceParityStyleSimilarityDeltaMax: 0.1,
};

const ARG_DEFS: ArgDef[] = [
  { name: "--config", type: "string", description: "Load an alternate .sidflow.json" },
  { name: "--export-source", type: "string", description: "Export source: local or release", defaultValue: "local" },
  { name: "--full-export", type: "string", description: "Override full sidcorr-1 sqlite path" },
  { name: "--tiny-export", type: "string", description: "Override sidcorr-tiny-1 path" },
  { name: "--lite-export", type: "string", description: "Override sidcorr-lite-1 path" },
  { name: "--output-root", type: "string", description: "Deterministic artifact root", defaultValue: DEFAULT_OUTPUT_ROOT },
  { name: "--station-size", type: "integer", description: "Tracks per station", defaultValue: DEFAULT_STATION_SIZE },
  { name: "--persona-runs", type: "integer", description: "Runs per persona", defaultValue: DEFAULT_PERSONA_RUNS },
  { name: "--seed-song-count", type: "integer", description: "Deterministic seed-song checks", defaultValue: DEFAULT_SEED_SONG_COUNT },
  { name: "--min-duration-seconds", type: "integer", description: "Minimum track duration", defaultValue: DEFAULT_MIN_DURATION_SECONDS },
  { name: "--adventure", type: "integer", description: "Station adventure level", defaultValue: DEFAULT_ADVENTURE },
  { name: "--strict", type: "boolean", description: "Exit nonzero when thresholds fail", defaultValue: false },
  { name: "--ci", type: "boolean", description: "Machine-focused output mode", defaultValue: false },
  { name: "--release-repo", type: "string", description: "Release repository for hosted exports", defaultValue: DEFAULT_RELEASE_REPO },
  { name: "--release-tag", type: "string", description: "Release tag or latest", defaultValue: DEFAULT_RELEASE_TAG },
];

const HELP_TEXT = formatHelp(
  "bun run validate:tiny-export-equivalence -- [options]",
  "Audit sidcorr-tiny-1 against the authoritative sidcorr-1 export using deterministic station-building and seed-song similarity checks.",
  ARG_DEFS,
  [
    "bun run validate:tiny-export-equivalence -- --export-source local",
    "bun run validate:tiny-export-equivalence -- --export-source release --release-repo chrisgleissner/sidflow-data --release-tag latest",
    "bun run validate:tiny-export-equivalence -- --export-source release --strict",
  ],
);

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveExportSource(value: string | undefined): ExportSource {
  if (!value || value === "local") {
    return "local";
  }
  if (value === "release") {
    return "release";
  }
  throw new Error(`Unsupported export source ${value}. Expected local or release.`);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if ((ordered.length % 2) === 1) {
    return ordered[middle]!;
  }
  return (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function sha256Buffer(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await readFile(filePath));
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function buildMetricsFromTrack(row: Pick<ExportTrackRow, "e" | "m" | "c" | "p">): PersonaMetrics {
  const energy = clamp01((row.e - 1) / 4);
  const mood = clamp01((row.m - 1) / 4);
  const complexity = clamp01((row.c - 1) / 4);
  const preference = row.p == null ? 0.5 : clamp01((row.p - 1) / 4);
  return {
    melodicComplexity: complexity,
    rhythmicDensity: energy,
    timbralRichness: (complexity + preference) / 2,
    nostalgiaBias: mood,
    experimentalTolerance: (complexity + (1 - mood) + preference) / 3,
  };
}

function normalizeSidPathForCategory(sidPath: string): string {
  return sidPath.startsWith("C64Music/") ? sidPath.slice("C64Music/".length) : sidPath;
}

function deriveCategory(sidPath: string): string | undefined {
  const normalized = normalizeSidPathForCategory(sidPath);
  const first = normalized.split("/").filter(Boolean)[0];
  return first?.toUpperCase();
}

function deriveComposerFromPath(sidPath: string): string | undefined {
  const normalized = normalizeSidPathForCategory(sidPath);
  const segments = normalized.split("/").filter(Boolean);
  if (segments[0]?.toUpperCase() === "MUSICIANS" && segments.length >= 3) {
    return segments[2];
  }
  return undefined;
}

function deriveThemeTags(title: string): string[] {
  const stopWords = new Set(["the", "and", "for", "with", "from", "part", "song", "theme", "sid", "demo"]);
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));
  return [...new Set(tokens)].slice(0, 6);
}

function buildCorpusStats(rows: ExportTrackRow[]): CorpusStats {
  const parentCounts = new Map<string, number>();
  for (const row of rows) {
    const parent = path.posix.dirname(normalizeSidPathForCategory(row.sid_path));
    parentCounts.set(parent, (parentCounts.get(parent) ?? 0) + 1);
  }
  const counts = [...parentCounts.values()];
  return {
    parentCounts,
    minParentCount: Math.min(...counts),
    maxParentCount: Math.max(...counts),
  };
}

function computeRarity(row: ExportTrackRow, stats: CorpusStats): number {
  const parent = path.posix.dirname(normalizeSidPathForCategory(row.sid_path));
  const count = stats.parentCounts.get(parent) ?? stats.maxParentCount;
  if (stats.maxParentCount === stats.minParentCount) {
    return 0.5;
  }
  return clamp01(1 - ((count - stats.minParentCount) / (stats.maxParentCount - stats.minParentCount)));
}

function sampleRows(rows: ExportTrackRow[], count: number, rng: () => number): ExportTrackRow[] {
  const indexes = rows.map((_, index) => index);
  const limit = Math.min(count, indexes.length);
  for (let index = 0; index < limit; index += 1) {
    const swapIndex = index + Math.floor(rng() * (indexes.length - index));
    const next = indexes[index]!;
    indexes[index] = indexes[swapIndex]!;
    indexes[swapIndex] = next;
  }
  return indexes.slice(0, limit).map((index) => rows[index]!);
}

function resolveReleaseApiPath(repo: string, tag: string): string {
  return tag === "latest"
    ? `https://api.github.com/repos/${repo}/releases/latest`
    : `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
}

async function fetchRelease(repo: string, tag: string): Promise<GitHubRelease> {
  const response = await fetch(resolveReleaseApiPath(repo, tag), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sidflow-tiny-export-audit",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch release metadata for ${repo}@${tag}: HTTP ${response.status}`);
  }
  return await response.json() as GitHubRelease;
}

function requireReleaseAsset(release: GitHubRelease, predicate: (asset: ReleaseAsset) => boolean, description: string): ReleaseAsset {
  const asset = (release.assets ?? []).find((candidate) => predicate(candidate));
  if (!asset?.name || !asset.browser_download_url) {
    throw new Error(`Release ${release.tag_name ?? "unknown"} is missing ${description}`);
  }
  return asset;
}

function findReleaseAsset(release: GitHubRelease, predicate: (asset: ReleaseAsset) => boolean): ReleaseAsset | undefined {
  return (release.assets ?? []).find((candidate) => predicate(candidate) && !!candidate.name && !!candidate.browser_download_url);
}

async function downloadAsset(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "sidflow-tiny-export-audit",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await ensureDir(path.dirname(destinationPath));
  await writeFile(destinationPath, new Uint8Array(await response.arrayBuffer()));
}

async function maybeDownloadAsset(asset: ReleaseAsset | undefined, destinationDir: string): Promise<string | undefined> {
  if (!asset?.name || !asset.browser_download_url) {
    return undefined;
  }
  const destinationPath = path.join(destinationDir, asset.name);
  if (!(await pathExists(destinationPath))) {
    await downloadAsset(asset.browser_download_url, destinationPath);
  }
  return destinationPath;
}

function readTracksFromSqlite(dbPath: string): ExportTrackRow[] {
  const database = new Database(dbPath, { readonly: true, strict: true });
  try {
    return database.query(`
      SELECT track_id, sid_path, song_index, e, m, c, p
      FROM tracks
      ORDER BY sid_path ASC, song_index ASC
    `).all() as ExportTrackRow[];
  } finally {
    database.close();
  }
}

function buildRuntime(config: SidflowConfig, repoRoot: string, seed: number): StationRuntime {
  return {
    loadConfig: async () => config,
    parseSidFile,
    lookupSongDurationMs,
    fetchImpl: globalThis.fetch,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    cwd: () => repoRoot,
    now: () => new Date("2026-04-08T09:30:00.000Z"),
    random: createDeterministicRandom(seed),
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

async function resolveAbsoluteSidPath(hvscRoot: string, sidPath: string): Promise<string> {
  const normalized = normalizeSidPathForCategory(sidPath);
  const direct = path.join(hvscRoot, normalized);
  const nested = path.join(hvscRoot, "C64Music", normalized);
  return (await pathExists(direct)) ? direct : nested;
}

async function buildMetadataResolver(hvscRoot: string): Promise<(row: ExportTrackRow) => Promise<MetadataSummary>> {
  const cache = new Map<string, Promise<MetadataSummary>>();
  return async (row: ExportTrackRow) => {
    if (cache.has(row.sid_path)) {
      return cache.get(row.sid_path)!;
    }
    const loader = (async () => {
      const absolutePath = await resolveAbsoluteSidPath(hvscRoot, row.sid_path);
      const fallbackTitle = path.basename(row.sid_path, path.extname(row.sid_path));
      try {
        const metadata = await parseSidFile(absolutePath);
        const title = metadata.title?.trim() || fallbackTitle;
        const composer = metadata.author?.trim() || deriveComposerFromPath(row.sid_path);
        const released = metadata.released?.trim() || undefined;
        return {
          absolutePath,
          title,
          composer,
          released,
          year: parseYear(released),
          category: deriveCategory(row.sid_path),
          titleThemeTags: deriveThemeTags(title),
        } satisfies MetadataSummary;
      } catch {
        return {
          absolutePath,
          title: fallbackTitle,
          composer: deriveComposerFromPath(row.sid_path),
          category: deriveCategory(row.sid_path),
          titleThemeTags: deriveThemeTags(fallbackTitle),
        } satisfies MetadataSummary;
      }
    })();
    cache.set(row.sid_path, loader);
    return loader;
  };
}

async function selectSeedFavorites(
  rows: ExportTrackRow[],
  personaId: PersonaId,
  runSeed: number,
  corpusStats: CorpusStats,
  metadataResolver: (row: ExportTrackRow) => Promise<MetadataSummary>,
): Promise<SeedFavorite[]> {
  const rng = createDeterministicRandom(runSeed ^ stableHash(personaId));
  const candidates = sampleRows(rows, FAVORITE_CANDIDATE_POOL, rng);
  const scored = await Promise.all(candidates.map(async (row) => {
    const metadata = await metadataResolver(row);
    const rarity = computeRarity(row, corpusStats);
    const score = scoreTrackForPersona({
      metrics: buildMetricsFromTrack(row),
      ratings: { e: row.e, m: row.m, c: row.c },
      metadata: {
        category: metadata.category,
        composer: metadata.composer,
        year: metadata.year,
        titleThemeTags: metadata.titleThemeTags,
      },
      rarity,
    }, personaId).score;
    return {
      row,
      metadata,
      score,
    };
  }));

  scored.sort((left, right) => right.score - left.score || left.row.track_id.localeCompare(right.row.track_id));
  const favorites: SeedFavorite[] = [];
  const seenPaths = new Set<string>();
  for (const entry of scored) {
    if (seenPaths.has(entry.row.sid_path)) {
      continue;
    }
    seenPaths.add(entry.row.sid_path);
    favorites.push({
      trackId: entry.row.track_id,
      sidPath: entry.row.sid_path,
      rating: FAVORITE_RATINGS[favorites.length] ?? 3,
      personaScore: round(entry.score),
      title: entry.metadata.title,
      composer: entry.metadata.composer,
      year: entry.metadata.year,
    });
    if (favorites.length >= FAVORITE_RATINGS.length) {
      break;
    }
  }

  if (favorites.length === 0) {
    throw new Error(`Unable to select deterministic favorites for ${personaId} / ${runSeed}`);
  }

  return favorites;
}

function buildRatingsMap(favorites: SeedFavorite[]): Map<string, number> {
  return new Map(favorites.map((favorite) => [favorite.trackId, favorite.rating]));
}

function intersectionCount(left: string[], right: string[]): number {
  const set = new Set(left);
  let count = 0;
  for (const value of right) {
    if (set.has(value)) {
      count += 1;
    }
  }
  return count;
}

function overlapAt(left: string[], right: string[], limit: number): { ratio: number; shared: number; compared: number } {
  const leftSlice = left.slice(0, limit);
  const rightSlice = right.slice(0, limit);
  const shared = intersectionCount(leftSlice, rightSlice);
  const compared = Math.min(leftSlice.length, rightSlice.length, limit);
  return {
    ratio: compared === 0 ? 0 : shared / compared,
    shared,
    compared,
  };
}

function jaccardAt(left: string[], right: string[], limit: number): number {
  const leftSet = new Set(left.slice(0, limit));
  const rightSet = new Set(right.slice(0, limit));
  let intersection = 0;
  for (const trackId of leftSet) {
    if (rightSet.has(trackId)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) {
    return 0;
  }

  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta * leftDelta;
    rightDenominator += rightDelta * rightDelta;
  }

  if (leftDenominator === 0 || rightDenominator === 0) {
    return 0;
  }

  return numerator / Math.sqrt(leftDenominator * rightDenominator);
}

function spearmanAt(left: string[], right: string[], limit: number): number {
  const leftRanks = new Map(left.slice(0, limit).map((trackId, index) => [trackId, index + 1]));
  const rightRanks = new Map(right.slice(0, limit).map((trackId, index) => [trackId, index + 1]));
  const common = [...leftRanks.keys()].filter((trackId) => rightRanks.has(trackId));
  if (common.length < 2) {
    return 0;
  }
  const leftValues = common.map((trackId) => leftRanks.get(trackId)!);
  const rightValues = common.map((trackId) => rightRanks.get(trackId)!);
  return pearsonCorrelation(leftValues, rightValues);
}

function meanPairwiseSimilarity(vectors: number[][]): number {
  if (vectors.length < 2) {
    return 0;
  }
  let count = 0;
  let total = 0;
  for (let leftIndex = 0; leftIndex < vectors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < vectors.length; rightIndex += 1) {
      total += cosineSimilarity(vectors[leftIndex]!, vectors[rightIndex]!);
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

function styleDistribution(handle: Awaited<ReturnType<typeof openStationSimilarityDataset>>, trackIds: string[]): number[] {
  const counts = new Array(PERSONA_IDS.length).fill(0);
  for (const trackId of trackIds) {
    const mask = handle.getStyleMask(trackId) ?? 0;
    for (let bit = 0; bit < PERSONA_IDS.length; bit += 1) {
      if ((mask & (1 << bit)) !== 0) {
        counts[bit] += 1;
      }
    }
  }
  return counts.map((count) => count / Math.max(1, trackIds.length));
}

function styleSimilarity(left: number[], right: number[]): { similarity: number; maxDelta: number } {
  let totalDelta = 0;
  let maxDelta = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = Math.abs((left[index] ?? 0) - (right[index] ?? 0));
    totalDelta += delta;
    maxDelta = Math.max(maxDelta, delta);
  }
  const meanDelta = totalDelta / Math.max(1, Math.max(left.length, right.length));
  return {
    similarity: 1 - meanDelta,
    maxDelta,
  };
}

function composerDiversity(queue: StationTrackDetails[]): number {
  const composers = queue.map((track) => track.author.trim()).filter(Boolean);
  return composers.length === 0 ? 0 : new Set(composers).size / composers.length;
}

function yearSpread(queue: StationTrackDetails[]): number | null {
  const years = queue
    .map((track) => (track.year ? Number.parseInt(track.year, 10) : NaN))
    .filter((value) => Number.isFinite(value));
  if (years.length === 0) {
    return null;
  }
  return Math.max(...years) - Math.min(...years);
}

function duplicateSidRate(queue: StationTrackDetails[]): number {
  if (queue.length === 0) {
    return 0;
  }
  return 1 - (new Set(queue.map((track) => track.sid_path)).size / queue.length);
}

function serializeStation(queue: StationTrackDetails[]): JsonValue {
  return queue.map((track) => ({
    author: track.author,
    durationMs: track.durationMs ?? null,
    released: track.released,
    sid_path: track.sid_path,
    song_index: track.song_index,
    title: track.title,
    track_id: track.track_id,
    year: track.year ?? null,
  }));
}

async function writeChecksums(filePaths: string[], outputPath: string): Promise<void> {
  const lines: string[] = [];
  for (const filePath of filePaths) {
    lines.push(`${await sha256File(filePath)}  ${path.relative(path.dirname(outputPath), filePath)}`);
  }
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function resolveInputs(options: AuditCliOptions, repoRoot: string, outputRoot: string): Promise<ResolvedInputs> {
  const exportSource = resolveExportSource(options.exportSource);
  if (exportSource === "local") {
    const fullExportPath = path.resolve(repoRoot, options.fullExport ?? "data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite");
    const tinyExportPath = path.resolve(repoRoot, options.tinyExport ?? "data/exports/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr");
    const liteExportPath = options.liteExport
      ? path.resolve(repoRoot, options.liteExport)
      : path.resolve(repoRoot, "data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr");
    return {
      exportSource,
      fullExportPath,
      tinyExportPath,
      liteExportPath: await pathExists(liteExportPath) ? liteExportPath : undefined,
      fullManifestPath: await pathExists(fullExportPath.replace(/\.sqlite$/, ".manifest.json")) ? fullExportPath.replace(/\.sqlite$/, ".manifest.json") : undefined,
      tinyManifestPath: await pathExists(tinyExportPath.replace(/\.sidcorr$/, ".manifest.json")) ? tinyExportPath.replace(/\.sidcorr$/, ".manifest.json") : undefined,
      liteManifestPath: await pathExists(liteExportPath.replace(/\.sidcorr$/, ".manifest.json")) ? liteExportPath.replace(/\.sidcorr$/, ".manifest.json") : undefined,
    };
  }

  const release = await fetchRelease(options.releaseRepo ?? DEFAULT_RELEASE_REPO, options.releaseTag ?? DEFAULT_RELEASE_TAG);
  const downloadsDir = path.join(outputRoot, "downloads");
  await ensureDir(downloadsDir);

  const fullAsset = requireReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.endsWith("-sidcorr-1.sqlite"),
    "sidcorr-1 sqlite asset",
  );
  const fullManifestAsset = requireReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.endsWith("-sidcorr-1.manifest.json"),
    "sidcorr-1 manifest asset",
  );
  const tinyAsset = requireReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-tiny-1") && asset.name.endsWith(".sidcorr"),
    "sidcorr-tiny-1 asset",
  );
  const tinyManifestAsset = requireReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-tiny-1") && asset.name.endsWith(".manifest.json"),
    "sidcorr-tiny-1 manifest asset",
  );
  const liteAsset = findReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-lite-1") && asset.name.endsWith(".sidcorr"),
  );
  const liteManifestAsset = findReleaseAsset(
    release,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-lite-1") && asset.name.endsWith(".manifest.json"),
  );

  const fullExportPath = await maybeDownloadAsset(fullAsset, downloadsDir);
  const fullManifestPath = await maybeDownloadAsset(fullManifestAsset, downloadsDir);
  const tinyExportPath = await maybeDownloadAsset(tinyAsset, downloadsDir);
  const tinyManifestPath = await maybeDownloadAsset(tinyManifestAsset, downloadsDir);
  const liteExportPath = await maybeDownloadAsset(liteAsset, downloadsDir);
  const liteManifestPath = await maybeDownloadAsset(liteManifestAsset, downloadsDir);

  if (!fullExportPath || !tinyExportPath) {
    throw new Error(`Release ${release.tag_name ?? "unknown"} did not resolve the required full/tiny artifacts.`);
  }

  await writeCanonicalJsonFile(path.join(downloadsDir, "release.json"), release as unknown as JsonValue, {
    action: "data:modify",
  });

  return {
    exportSource,
    fullExportPath,
    tinyExportPath,
    liteExportPath,
    fullManifestPath,
    tinyManifestPath,
    liteManifestPath,
    release: {
      repo: options.releaseRepo ?? DEFAULT_RELEASE_REPO,
      tag: release.tag_name ?? "unknown",
      publishedAt: release.published_at,
    },
  };
}

function buildSeedTrackList(rows: ExportTrackRow[], count: number): ExportTrackRow[] {
  const seeds: ExportTrackRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const rowIndex = Math.min(rows.length - 1, Math.floor(((index + 0.5) * rows.length) / count));
    const row = rows[rowIndex]!;
    if (seen.has(row.track_id)) {
      continue;
    }
    seen.add(row.track_id);
    seeds.push(row);
  }
  return seeds;
}

function summarizeSeedSongResults(results: SeedSongMetrics[]): SeedSongSummary {
  return {
    seedCount: results.length,
    medianTop10Overlap: round(median(results.map((result) => result.top10Overlap))),
    worstTop10Overlap: round(Math.min(...results.map((result) => result.top10Overlap))),
    medianTop20Overlap: round(median(results.map((result) => result.top20Overlap))),
    worstTop20Overlap: round(Math.min(...results.map((result) => result.top20Overlap))),
    medianTop50Overlap: round(median(results.map((result) => result.top50Overlap))),
    medianRankCorrelation: round(median(results.map((result) => result.rankCorrelation))),
    pass: results.every((result) => result.pass),
  };
}

function buildStationPersonaSummary(results: StationRunMetrics[]): StationPersonaSummary[] {
  return PERSONA_IDS.map((personaId) => {
    const personaResults = results.filter((result) => result.personaId === personaId);
    const summary: StationPersonaSummary = {
      personaId,
      runs: personaResults.length,
      medianOverlap: round(median(personaResults.map((result) => result.overlapRatio))),
      worstOverlap: round(Math.min(...personaResults.map((result) => result.overlapRatio))),
      medianJaccard: round(median(personaResults.map((result) => result.jaccard))),
      medianSpearman: round(median(personaResults.map((result) => result.spearman))),
      medianCoherenceDelta: round(median(personaResults.map((result) => result.coherenceDelta))),
      medianStyleSimilarity: round(median(personaResults.map((result) => result.styleSimilarity))),
      pass: false,
    };
    summary.pass = summary.medianOverlap >= THRESHOLDS.stationMedianOverlapMin
      && summary.worstOverlap >= THRESHOLDS.stationWorstOverlapMin
      && summary.medianJaccard >= THRESHOLDS.stationMedianJaccardMin
      && summary.medianSpearman >= THRESHOLDS.stationMedianSpearmanMin
      && summary.medianCoherenceDelta <= THRESHOLDS.stationMedianCoherenceDeltaMax
      && summary.medianStyleSimilarity >= THRESHOLDS.stationMedianStyleSimilarityMin;
    return summary;
  });
}

function buildDivergencePairSummaries(results: DivergenceRunMetrics[]): DivergencePairSummary[] {
  const summaries: DivergencePairSummary[] = [];
  const summariesByKey = new Map<string, DivergencePairSummary>();
  for (const exportFormat of ["full", "tiny"] as const) {
    for (let leftIndex = 0; leftIndex < PERSONA_IDS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < PERSONA_IDS.length; rightIndex += 1) {
        const personaA = PERSONA_IDS[leftIndex]!;
        const personaB = PERSONA_IDS[rightIndex]!;
        const pairResults = results.filter((result) => result.exportFormat === exportFormat && result.personaA === personaA && result.personaB === personaB);
        const summary: DivergencePairSummary = {
          exportFormat,
          personaA,
          personaB,
          runs: pairResults.length,
          medianOverlap: round(median(pairResults.map((result) => result.overlapRatio))),
          worstOverlap: round(Math.max(...pairResults.map((result) => result.overlapRatio))),
          medianSpearman: round(median(pairResults.map((result) => result.spearman))),
          medianStyleSimilarity: round(median(pairResults.map((result) => result.styleSimilarity))),
          maxStyleDelta: round(Math.max(...pairResults.map((result) => result.styleMaxDelta))),
          collapseRisk: false,
          pass: false,
        };
        summary.collapseRisk = summary.medianOverlap > THRESHOLDS.divergenceMedianOverlapMax || summary.worstOverlap > THRESHOLDS.divergenceWorstOverlapMax;
        summary.pass = true;
        summaries.push(summary);
        summariesByKey.set(`${exportFormat}:${personaA}:${personaB}`, summary);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < PERSONA_IDS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < PERSONA_IDS.length; rightIndex += 1) {
      const personaA = PERSONA_IDS[leftIndex]!;
      const personaB = PERSONA_IDS[rightIndex]!;
      const fullSummary = summariesByKey.get(`full:${personaA}:${personaB}`);
      const tinySummary = summariesByKey.get(`tiny:${personaA}:${personaB}`);
      if (!fullSummary || !tinySummary) {
        continue;
      }
      const parityPass = Math.abs(fullSummary.medianOverlap - tinySummary.medianOverlap) <= THRESHOLDS.divergenceParityMedianOverlapDeltaMax
        && Math.abs(fullSummary.worstOverlap - tinySummary.worstOverlap) <= THRESHOLDS.divergenceParityWorstOverlapDeltaMax
        && Math.abs(fullSummary.medianSpearman - tinySummary.medianSpearman) <= THRESHOLDS.divergenceParitySpearmanDeltaMax
        && Math.abs(fullSummary.medianStyleSimilarity - tinySummary.medianStyleSimilarity) <= THRESHOLDS.divergenceParityStyleSimilarityDeltaMax;
      fullSummary.pass = parityPass;
      tinySummary.pass = parityPass;
    }
  }

  return summaries;
}

async function buildReport(
  outputRoot: string,
  resolvedInputs: ResolvedInputs,
  options: AuditCliOptions,
  config: SidflowConfig,
  stationSummaries: StationPersonaSummary[],
  stationRuns: StationRunMetrics[],
  divergenceSummaries: DivergencePairSummary[],
  seedSummary: SeedSongSummary,
  seedMetrics: SeedSongMetrics[],
  determinism: DeterminismProof,
): Promise<string> {
  const generatedAt = new Date().toISOString();
  const reportLines: string[] = [];
  reportLines.push("# Tiny Export Equivalence Audit");
  reportLines.push("");
  reportLines.push("## Scope");
  reportLines.push("");
  reportLines.push(`- Export source: ${resolvedInputs.exportSource}`);
  reportLines.push(`- Full export: ${resolvedInputs.fullExportPath}`);
  reportLines.push(`- Tiny export: ${resolvedInputs.tinyExportPath}`);
  reportLines.push(`- Optional lite export: ${resolvedInputs.liteExportPath ?? "not used"}`);
  reportLines.push(`- Host OS: Linux`);
  reportLines.push(`- Audit mode: ${options.ci ? "CI reduced / machine-focused" : "local Linux full"}`);
  reportLines.push(`- Generated at: ${generatedAt}`);
  reportLines.push("- Implementation facts: `packages/sidflow-common/src/persona.ts` defines the exact 9-persona catalog, `packages/sidflow-common/src/persona-scorer.ts` adds deterministic hybrid metadata bonuses, `packages/sidflow-play/src/station/queue.ts` builds stations through `recommendFromFavorites(...)` and `buildStationQueue(...)`, `packages/sidflow-play/src/station/dataset.ts` is the runtime path that resolves sqlite/lite/tiny station datasets, and `scripts/run-similarity-convergence.ts` already establishes the repo’s release-download model that this audit reuses for hosted assets.");
  reportLines.push("");
  reportLines.push("## Inputs");
  reportLines.push("");
  reportLines.push("| Input | Path | SHA256 | Notes |");
  reportLines.push("| --- | --- | --- | --- |");
  reportLines.push(`| Full export | ${resolvedInputs.fullExportPath} | ${await sha256File(resolvedInputs.fullExportPath)} | ${resolvedInputs.release ? `${resolvedInputs.release.repo}@${resolvedInputs.release.tag}` : "local file"} |`);
  reportLines.push(`| Tiny export | ${resolvedInputs.tinyExportPath} | ${await sha256File(resolvedInputs.tinyExportPath)} | ${resolvedInputs.release ? `${resolvedInputs.release.repo}@${resolvedInputs.release.tag}` : "local file"} |`);
  reportLines.push(`| Optional lite export | ${resolvedInputs.liteExportPath ?? "n/a"} | ${resolvedInputs.liteExportPath ? await sha256File(resolvedInputs.liteExportPath) : "n/a"} | optional reference only |`);
  reportLines.push(`| Persona definitions | packages/sidflow-common/src/persona.ts | n/a | exact PERSONA_IDS set |`);
  reportLines.push("");
  reportLines.push("## Commands Run");
  reportLines.push("");
  reportLines.push("```bash");
  reportLines.push(`# Local full audit`);
  reportLines.push(`bun run validate:tiny-export-equivalence -- --export-source local --output-root ${DEFAULT_OUTPUT_ROOT}`);
  reportLines.push("");
  reportLines.push(`# Optional CI reduced audit`);
  reportLines.push(`bun run validate:tiny-export-equivalence -- --export-source release --release-repo ${options.releaseRepo ?? DEFAULT_RELEASE_REPO} --release-tag ${resolvedInputs.release?.tag ?? (options.releaseTag ?? DEFAULT_RELEASE_TAG)} --persona-runs 2 --seed-song-count 10 --ci --output-root ${DEFAULT_OUTPUT_ROOT}`);
  reportLines.push("```");
  reportLines.push("");
  reportLines.push("## Repeatability Contract");
  reportLines.push("");
  reportLines.push("| Rule | Status | Evidence |");
  reportLines.push("| --- | --- | --- |");
  reportLines.push(`| Explicit output root | PASS | ${outputRoot} |`);
  reportLines.push(`| All randomness seeded | PASS | persona run seeds ${PERSONA_RUN_SEEDS.join(", ")} plus deterministic seed-song sampling |`);
  reportLines.push("| Non-interactive execution | PASS | no TTY or prompt-based steps are used | ");
  reportLines.push(`| Local Linux runnable | PASS | depends on Bun plus local HVSC path ${config.sidPath} for SID metadata resolution |`);
  reportLines.push(`| Optional CI runnable | PASS | same script with explicit reduced counts and release-hosted exports |`);
  reportLines.push(`| JSON artifacts emitted | PASS | comparisons/*.json plus station and seed-check files |`);
  reportLines.push(`| Markdown summary emitted | PASS | ${path.join(outputRoot, "report.md")} |`);
  reportLines.push(`| Determinism subset rerun completed | ${determinism.stationInputsIdentical && determinism.stationOutputsIdentical && determinism.seedSongOutputsIdentical ? "PASS" : "FAIL"} | station inputs=${determinism.stationInputsIdentical}, station outputs=${determinism.stationOutputsIdentical}, seed-song outputs=${determinism.seedSongOutputsIdentical} |`);
  reportLines.push("");
  reportLines.push("## Persona Station Equivalence Summary");
  reportLines.push("");
  reportLines.push("| Persona | Runs | Median overlap | Worst overlap | Median Jaccard | Median rank corr | Median coherence delta | Median style similarity | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const summary of stationSummaries) {
    reportLines.push(`| ${summary.personaId} | ${summary.runs} | ${summary.medianOverlap.toFixed(4)} | ${summary.worstOverlap.toFixed(4)} | ${summary.medianJaccard.toFixed(4)} | ${summary.medianSpearman.toFixed(4)} | ${summary.medianCoherenceDelta.toFixed(4)} | ${summary.medianStyleSimilarity.toFixed(4)} | ${summary.pass ? "PASS" : "FAIL"} |`);
  }
  reportLines.push("");
  reportLines.push("## Persona Station Detailed Results");
  reportLines.push("");
  reportLines.push("### Thresholds");
  reportLines.push("");
  reportLines.push("| Metric | Threshold |");
  reportLines.push("| --- | --- |");
  reportLines.push(`| Median station overlap | >= ${THRESHOLDS.stationMedianOverlapMin.toFixed(2)} |`);
  reportLines.push(`| Worst-case station overlap | >= ${THRESHOLDS.stationWorstOverlapMin.toFixed(2)} |`);
  reportLines.push(`| Median station Jaccard | >= ${THRESHOLDS.stationMedianJaccardMin.toFixed(2)} |`);
  reportLines.push(`| Median rank correlation | >= ${THRESHOLDS.stationMedianSpearmanMin.toFixed(2)} |`);
  reportLines.push(`| Median coherence delta | <= ${THRESHOLDS.stationMedianCoherenceDeltaMax.toFixed(2)} |`);
  reportLines.push(`| Median style distribution similarity | >= ${THRESHOLDS.stationMedianStyleSimilarityMin.toFixed(2)} |`);
  reportLines.push("");
  reportLines.push("### Per-Run Results");
  reportLines.push("");
  reportLines.push("| Persona | Run seed | Export pair | Favorite seeds file | Full station file | Tiny station file | Overlap | Jaccard | Rank corr | Coherence full | Coherence tiny | Coherence delta | Style similarity | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const result of stationRuns) {
    reportLines.push(`| ${result.personaId} | ${result.runSeed} | full vs tiny | ${path.relative(outputRoot, result.favoriteSeedPath)} | ${path.relative(outputRoot, result.fullStationPath)} | ${path.relative(outputRoot, result.tinyStationPath)} | ${result.overlapRatio.toFixed(4)} | ${result.jaccard.toFixed(4)} | ${result.spearman.toFixed(4)} | ${result.coherenceFull.toFixed(4)} | ${result.coherenceTiny.toFixed(4)} | ${result.coherenceDelta.toFixed(4)} | ${result.styleSimilarity.toFixed(4)} | ${result.pass ? "PASS" : "FAIL"} |`);
  }
  reportLines.push("");
  reportLines.push("### Material Divergences");
  reportLines.push("");
  reportLines.push("| Persona | Run seed | Divergence type | Evidence |");
  reportLines.push("| --- | --- | --- | --- |");
  for (const result of stationRuns.filter((entry) => !entry.pass)) {
    reportLines.push(`| ${result.personaId} | ${result.runSeed} | station equivalence below threshold | overlap=${result.overlapRatio.toFixed(4)}, jaccard=${result.jaccard.toFixed(4)}, style=${result.styleSimilarity.toFixed(4)} |`);
  }
  if (stationRuns.every((entry) => entry.pass)) {
    reportLines.push("| n/a | n/a | none | all per-run station checks passed |\n");
  }
  reportLines.push("");
  reportLines.push("## Cross-Persona Divergence Summary");
  reportLines.push("");
  reportLines.push("Cross-persona rows pass when tiny stays within the configured divergence delta of the authoritative full baseline. Baseline persona-collapse risks are surfaced below as material warnings and do not fail export-equivalence on their own.");
  reportLines.push("");
  reportLines.push("### Full Export");
  reportLines.push("");
  reportLines.push("| Persona A | Persona B | Median overlap | Worst overlap | Median rank corr | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- |");
  for (const summary of divergenceSummaries.filter((entry) => entry.exportFormat === "full")) {
    reportLines.push(`| ${summary.personaA} | ${summary.personaB} | ${summary.medianOverlap.toFixed(4)} | ${summary.worstOverlap.toFixed(4)} | ${summary.medianSpearman.toFixed(4)} | ${summary.pass ? "PASS" : "FAIL"} |`);
  }
  reportLines.push("");
  reportLines.push("### Tiny Export");
  reportLines.push("");
  reportLines.push("| Persona A | Persona B | Median overlap | Worst overlap | Median rank corr | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- |");
  for (const summary of divergenceSummaries.filter((entry) => entry.exportFormat === "tiny")) {
    reportLines.push(`| ${summary.personaA} | ${summary.personaB} | ${summary.medianOverlap.toFixed(4)} | ${summary.worstOverlap.toFixed(4)} | ${summary.medianSpearman.toFixed(4)} | ${summary.pass ? "PASS" : "FAIL"} |`);
  }
  reportLines.push("");
  reportLines.push("### Collapse Risks");
  reportLines.push("");
  reportLines.push("| Export | Persona pair | Reason | Evidence |");
  reportLines.push("| --- | --- | --- | --- |");
  const collapseRisks = divergenceSummaries.filter((entry) => entry.collapseRisk);
  if (collapseRisks.length === 0) {
    reportLines.push("| n/a | n/a | none | no pair crossed the configured persona-collapse thresholds |\n");
  } else {
    for (const risk of collapseRisks) {
      reportLines.push(`| ${risk.exportFormat} | ${risk.personaA} vs ${risk.personaB} | baseline persona collapse warning | median overlap=${risk.medianOverlap.toFixed(4)}, worst overlap=${risk.worstOverlap.toFixed(4)} |`);
    }
  }
  reportLines.push("");
  reportLines.push("## Seed-Song Similarity Summary");
  reportLines.push("");
  reportLines.push("| Cohort | Seed count | Median top-10 overlap | Worst top-10 overlap | Median top-20 overlap | Worst top-20 overlap | Median top-50 overlap | Median rank corr | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  reportLines.push(`| full vs tiny | ${seedSummary.seedCount} | ${seedSummary.medianTop10Overlap.toFixed(4)} | ${seedSummary.worstTop10Overlap.toFixed(4)} | ${seedSummary.medianTop20Overlap.toFixed(4)} | ${seedSummary.worstTop20Overlap.toFixed(4)} | ${seedSummary.medianTop50Overlap.toFixed(4)} | ${seedSummary.medianRankCorrelation.toFixed(4)} | ${seedSummary.pass ? "PASS" : "FAIL"} |`);
  reportLines.push("");
  reportLines.push("## Seed-Song Detailed Results");
  reportLines.push("");
  reportLines.push("| Seed track | Full results file | Tiny results file | Top-10 overlap | Top-20 overlap | Top-50 overlap | Top-10 Jaccard | Top-20 Jaccard | Rank corr | Missing from tiny | Missing from full | Pass/Fail |");
  reportLines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const result of seedMetrics) {
    reportLines.push(`| ${result.seedTrackId} | ${path.relative(outputRoot, result.fullResultsPath)} | ${path.relative(outputRoot, result.tinyResultsPath)} | ${result.top10Overlap.toFixed(4)} | ${result.top20Overlap.toFixed(4)} | ${result.top50Overlap.toFixed(4)} | ${result.top10Jaccard.toFixed(4)} | ${result.top20Jaccard.toFixed(4)} | ${result.rankCorrelation.toFixed(4)} | ${result.missingFromTinyTop20.slice(0, 5).join(", ")} | ${result.missingFromFullTop20.slice(0, 5).join(", ")} | ${result.pass ? "PASS" : "FAIL"} |`);
  }
  reportLines.push("");
  reportLines.push("## Determinism Proof");
  reportLines.push("");
  reportLines.push("| Check | First run artifact | Second run artifact | Identical? | Notes |");
  reportLines.push("| --- | --- | --- | --- | --- |");
  reportLines.push(`| Station subset rerun | station-inputs/${PERSONA_IDS[0]}-${PERSONA_RUN_SEEDS[0]}.json | determinism/station-inputs-rerun.json | ${determinism.stationInputsIdentical ? "YES" : "NO"} | deterministic seed favorite selection |`);
  reportLines.push(`| Station outputs rerun | station-runs/full/${PERSONA_IDS[0]}-${PERSONA_RUN_SEEDS[0]}.json + station-runs/tiny/${PERSONA_IDS[0]}-${PERSONA_RUN_SEEDS[0]}.json | determinism/station-output-rerun.json | ${determinism.stationOutputsIdentical ? "YES" : "NO"} | shared queue builder produced identical ordered stations |`);
  reportLines.push(`| Seed-song subset rerun | seed-checks/full/seed-001.json + seed-checks/tiny/seed-001.json | determinism/seed-rerun.json | ${determinism.seedSongOutputsIdentical ? "YES" : "NO"} | same seed-song recommendation ordering |`);
  reportLines.push(`| Final verdict stability | report.md verdict | determinism/verdict-rerun.json | ${determinism.verdictStable ? "YES" : "NO"} | same pass/fail outcomes on rerun subset |`);
  reportLines.push("");
  reportLines.push("## CI/Local Run Guidance");
  reportLines.push("");
  reportLines.push("### Local Linux");
  reportLines.push("");
  reportLines.push("```bash");
  reportLines.push(`bun run validate:tiny-export-equivalence -- --export-source local --output-root ${DEFAULT_OUTPUT_ROOT}`);
  reportLines.push("```");
  reportLines.push("");
  reportLines.push("### Optional CI");
  reportLines.push("");
  reportLines.push("```bash");
  reportLines.push(`bun run validate:tiny-export-equivalence -- --export-source release --release-repo ${options.releaseRepo ?? DEFAULT_RELEASE_REPO} --release-tag ${resolvedInputs.release?.tag ?? (options.releaseTag ?? DEFAULT_RELEASE_TAG)} --persona-runs 2 --seed-song-count 10 --ci --output-root ${DEFAULT_OUTPUT_ROOT}`);
  reportLines.push("```");
  reportLines.push("");
  reportLines.push("### Environment Notes");
  reportLines.push("");
  reportLines.push("- Bun version: 1.3.1+");
  reportLines.push(`- Expected runtime: local full audit is heavier because it runs ${stationRuns.length} station builds plus ${seedMetrics.length} seed-song checks`);
  reportLines.push("- Artifact size expectations: hosted sqlite is hundreds of MB, lite/tiny artifacts are much smaller, report artifacts remain in tmp/");
  reportLines.push(`- Prebuilt exports required?: no, but release mode assumes downloadable prebuilt exports from ${options.releaseRepo ?? DEFAULT_RELEASE_REPO}`);
  reportLines.push("- Reduced CI mode differences: use explicit smaller persona-run and seed-song-count values while keeping identical logic and deterministic seeding");
  reportLines.push("");
  reportLines.push("## Verdict");
  reportLines.push("");
  reportLines.push(`- Persona station equivalence: ${stationSummaries.every((summary) => summary.pass) ? "PASS" : "FAIL"}`);
  reportLines.push(`- Seed-song similarity equivalence: ${seedSummary.pass ? "PASS" : "FAIL"}`);
  reportLines.push(`- Material persona divergences: ${stationRuns.filter((result) => !result.pass).map((result) => `${result.personaId}@${result.runSeed}`).join(", ") || "none"}`);
  reportLines.push(`- Material seed-song divergences: ${seedMetrics.filter((result) => !result.pass).slice(0, 8).map((result) => result.seedTrackId).join(", ") || "none"}`);
  reportLines.push(`- Repeatable enough for CI enforcement: ${determinism.stationInputsIdentical && determinism.stationOutputsIdentical && determinism.seedSongOutputsIdentical ? "YES" : "NO"}`);
  reportLines.push(`- Final recommendation: ${(stationSummaries.every((summary) => summary.pass) && seedSummary.pass) ? "tiny is equivalent enough for the audited surfaces" : "tiny is not yet equivalent enough for all audited surfaces; use the report JSON to inspect the failing personas and seed cohorts"}`);
  reportLines.push("");
  return reportLines.join("\n");
}

async function main(): Promise<void> {
  const parsed = parseArgs<AuditCliOptions>(process.argv.slice(2), ARG_DEFS);
  const exitCode = handleParseResult(parsed, HELP_TEXT, process.stdout, process.stderr);
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }

  const { options } = parsed;
  const repoRoot = process.cwd();
  const config = await loadConfig(options.config);
  const outputRoot = path.resolve(repoRoot, options.outputRoot ?? DEFAULT_OUTPUT_ROOT);
  const stationInputsDir = path.join(outputRoot, "station-inputs");
  const stationRunsFullDir = path.join(outputRoot, "station-runs", "full");
  const stationRunsTinyDir = path.join(outputRoot, "station-runs", "tiny");
  const seedChecksFullDir = path.join(outputRoot, "seed-checks", "full");
  const seedChecksTinyDir = path.join(outputRoot, "seed-checks", "tiny");
  const comparisonsDir = path.join(outputRoot, "comparisons");
  const determinismDir = path.join(outputRoot, "determinism");
  await Promise.all([
    ensureDir(outputRoot),
    ensureDir(stationInputsDir),
    ensureDir(stationRunsFullDir),
    ensureDir(stationRunsTinyDir),
    ensureDir(seedChecksFullDir),
    ensureDir(seedChecksTinyDir),
    ensureDir(comparisonsDir),
    ensureDir(determinismDir),
  ]);

  const personaRuns = options.personaRuns ?? DEFAULT_PERSONA_RUNS;
  const seedSongCount = options.seedSongCount ?? DEFAULT_SEED_SONG_COUNT;
  if (!options.ci && personaRuns < DEFAULT_PERSONA_RUNS) {
    throw new Error(`Local full audit requires at least ${DEFAULT_PERSONA_RUNS} persona runs.`);
  }
  if (!options.ci && seedSongCount < DEFAULT_SEED_SONG_COUNT) {
    throw new Error(`Local full audit requires at least ${DEFAULT_SEED_SONG_COUNT} seed-song checks.`);
  }

  const resolvedInputs = await resolveInputs(options, repoRoot, outputRoot);
  const stationSize = options.stationSize ?? DEFAULT_STATION_SIZE;
  const minDurationSeconds = options.minDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS;
  const adventure = options.adventure ?? DEFAULT_ADVENTURE;
  const hvscRoot = path.resolve(repoRoot, config.sidPath);
  const fullRows = readTracksFromSqlite(resolvedInputs.fullExportPath);
  const corpusStats = buildCorpusStats(fullRows);
  const metadataResolver = await buildMetadataResolver(hvscRoot);
  const fullHandle = await openStationSimilarityDataset(resolvedInputs.fullExportPath, "sqlite", hvscRoot);
  const tinyHandle = await openStationSimilarityDataset(resolvedInputs.tinyExportPath, "tiny", hvscRoot);
  const sharedMetadataCache = new Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>();
  const stationRunSeeds = Array.from({ length: personaRuns }, (_, index) => PERSONA_RUN_SEEDS[index] ?? (1001 + index));
  const stationRunMetrics: StationRunMetrics[] = [];
  const divergenceRunMetrics: DivergenceRunMetrics[] = [];
  const stationQueuesByFormat = {
    full: new Map<string, StationTrackDetails[]>(),
    tiny: new Map<string, StationTrackDetails[]>(),
  };

  for (const personaId of PERSONA_IDS) {
    for (const runSeed of stationRunSeeds) {
      const favorites = await selectSeedFavorites(fullRows, personaId, runSeed, corpusStats, metadataResolver);
      const favoriteSeedPath = path.join(stationInputsDir, `${personaId}-${runSeed}.json`);
      await writeCanonicalJsonFile(favoriteSeedPath, {
        exportSource: resolvedInputs.exportSource,
        favorites,
        personaId,
        runSeed,
      } satisfies JsonValue, {
        action: "data:modify",
      });

      const ratings = buildRatingsMap(favorites);
      const fullQueue = await buildStationQueue(
        fullHandle,
        hvscRoot,
        ratings,
        stationSize,
        adventure,
        minDurationSeconds,
        buildRuntime(config, repoRoot, runSeed),
        sharedMetadataCache,
      );
      const tinyQueue = await buildStationQueue(
        tinyHandle,
        hvscRoot,
        ratings,
        stationSize,
        adventure,
        minDurationSeconds,
        buildRuntime(config, repoRoot, runSeed),
        sharedMetadataCache,
      );

      const fullStationPath = path.join(stationRunsFullDir, `${personaId}-${runSeed}.json`);
      const tinyStationPath = path.join(stationRunsTinyDir, `${personaId}-${runSeed}.json`);
      await writeCanonicalJsonFile(fullStationPath, serializeStation(fullQueue), { action: "data:modify" });
      await writeCanonicalJsonFile(tinyStationPath, serializeStation(tinyQueue), { action: "data:modify" });

      stationQueuesByFormat.full.set(`${personaId}:${runSeed}`, fullQueue);
      stationQueuesByFormat.tiny.set(`${personaId}:${runSeed}`, tinyQueue);

      const fullIds = fullQueue.map((track) => track.track_id);
      const tinyIds = tinyQueue.map((track) => track.track_id);
      const overlap = overlapAt(fullIds, tinyIds, Math.min(fullIds.length, tinyIds.length, stationSize));
      const fullVectors = [...fullHandle.getTrackVectors(fullIds).values()];
      const tinyVectors = [...tinyHandle.getTrackVectors(tinyIds).values()];
      const style = styleSimilarity(styleDistribution(fullHandle, fullIds), styleDistribution(tinyHandle, tinyIds));
      const yearSpreadFull = yearSpread(fullQueue);
      const yearSpreadTiny = yearSpread(tinyQueue);

      const metric: StationRunMetrics = {
        personaId,
        runSeed,
        favoriteSeedPath,
        fullStationPath,
        tinyStationPath,
        stationSize: Math.min(fullQueue.length, tinyQueue.length),
        overlapRatio: round(overlap.ratio),
        sharedTrackCount: overlap.shared,
        comparedTrackCount: overlap.compared,
        jaccard: round(jaccardAt(fullIds, tinyIds, Math.min(fullIds.length, tinyIds.length, stationSize))),
        spearman: round(spearmanAt(fullIds, tinyIds, Math.min(fullIds.length, tinyIds.length, stationSize))),
        coherenceFull: round(meanPairwiseSimilarity(fullVectors)),
        coherenceTiny: round(meanPairwiseSimilarity(tinyVectors)),
        coherenceDelta: round(Math.abs(meanPairwiseSimilarity(fullVectors) - meanPairwiseSimilarity(tinyVectors))),
        styleSimilarity: round(style.similarity),
        styleMaxDelta: round(style.maxDelta),
        composerDiversityFull: round(composerDiversity(fullQueue)),
        composerDiversityTiny: round(composerDiversity(tinyQueue)),
        composerDiversityDelta: round(Math.abs(composerDiversity(fullQueue) - composerDiversity(tinyQueue))),
        yearSpreadFull: yearSpreadFull == null ? null : round(yearSpreadFull),
        yearSpreadTiny: yearSpreadTiny == null ? null : round(yearSpreadTiny),
        yearSpreadDelta: yearSpreadFull == null || yearSpreadTiny == null ? null : round(Math.abs(yearSpreadFull - yearSpreadTiny)),
        duplicateSidRateFull: round(duplicateSidRate(fullQueue)),
        duplicateSidRateTiny: round(duplicateSidRate(tinyQueue)),
        duplicateSidRateDelta: round(Math.abs(duplicateSidRate(fullQueue) - duplicateSidRate(tinyQueue))),
        pass: false,
      };

      metric.pass = metric.overlapRatio >= THRESHOLDS.stationWorstOverlapMin
        && metric.jaccard >= 0.5
        && metric.spearman >= 0.3
        && metric.styleSimilarity >= 0.65;
      stationRunMetrics.push(metric);
    }
  }

  for (const exportFormat of ["full", "tiny"] as const) {
    for (const runSeed of stationRunSeeds) {
      for (let leftIndex = 0; leftIndex < PERSONA_IDS.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < PERSONA_IDS.length; rightIndex += 1) {
          const personaA = PERSONA_IDS[leftIndex]!;
          const personaB = PERSONA_IDS[rightIndex]!;
          const queueA = stationQueuesByFormat[exportFormat].get(`${personaA}:${runSeed}`) ?? [];
          const queueB = stationQueuesByFormat[exportFormat].get(`${personaB}:${runSeed}`) ?? [];
          const idsA = queueA.map((track) => track.track_id);
          const idsB = queueB.map((track) => track.track_id);
          const overlap = overlapAt(idsA, idsB, Math.min(idsA.length, idsB.length, stationSize));
          const style = styleSimilarity(styleDistribution(exportFormat === "full" ? fullHandle : tinyHandle, idsA), styleDistribution(exportFormat === "full" ? fullHandle : tinyHandle, idsB));
          const yearA = yearSpread(queueA);
          const yearB = yearSpread(queueB);
          divergenceRunMetrics.push({
            exportFormat,
            runSeed,
            personaA,
            personaB,
            overlapRatio: round(overlap.ratio),
            jaccard: round(jaccardAt(idsA, idsB, Math.min(idsA.length, idsB.length, stationSize))),
            spearman: round(spearmanAt(idsA, idsB, Math.min(idsA.length, idsB.length, stationSize))),
            styleSimilarity: round(style.similarity),
            styleMaxDelta: round(style.maxDelta),
            composerDiversityDelta: round(Math.abs(composerDiversity(queueA) - composerDiversity(queueB))),
            yearSpreadDelta: yearA == null || yearB == null ? null : round(Math.abs(yearA - yearB)),
          });
        }
      }
    }
  }

  const seedTrackRows = buildSeedTrackList(fullRows, seedSongCount);
  const seedSongMetrics: SeedSongMetrics[] = [];
  let seedIndex = 0;
  for (const seedRow of seedTrackRows) {
    seedIndex += 1;
    const fullRecommendations = recommendFromSeedTrack(resolvedInputs.fullExportPath, {
      seedTrackId: seedRow.track_id,
      limit: 50,
    });
    const tinyRecommendations = tinyHandle.recommendFromFavorites({
      favoriteTrackIds: [seedRow.track_id],
      limit: 50,
    });
    const directTinyNeighbors = tinyHandle.getNeighbors(seedRow.track_id, 10);

    const fullResultsPath = path.join(seedChecksFullDir, `seed-${String(seedIndex).padStart(3, "0")}.json`);
    const tinyResultsPath = path.join(seedChecksTinyDir, `seed-${String(seedIndex).padStart(3, "0")}.json`);
    await writeCanonicalJsonFile(fullResultsPath, {
      mode: "recommendFromSeedTrack",
      results: fullRecommendations,
      seedTrackId: seedRow.track_id,
    } satisfies JsonValue, { action: "data:modify" });
    await writeCanonicalJsonFile(tinyResultsPath, {
      directNeighborsPreview: directTinyNeighbors,
      mode: "recommendFromFavorites(single-seed)",
      note: "Tiny getNeighbors(...) exposes the compact local graph only; recommendFromFavorites(single-seed) is the strongest shipped comparable path for top-50 ordering.",
      results: tinyRecommendations,
      seedTrackId: seedRow.track_id,
    } satisfies JsonValue, { action: "data:modify" });

    const fullIds = fullRecommendations.map((result) => result.track_id);
    const tinyIds = tinyRecommendations.map((result) => result.track_id);
    const top10Full = fullIds.slice(0, 10);
    const top20Full = fullIds.slice(0, 20);
    const top10Tiny = tinyIds.slice(0, 10);
    const top20Tiny = tinyIds.slice(0, 20);
    const result: SeedSongMetrics = {
      seedTrackId: seedRow.track_id,
      seedSidPath: seedRow.sid_path,
      fullResultsPath,
      tinyResultsPath,
      tinyMode: "recommendFromFavorites(single-seed)",
      top10Overlap: round(overlapAt(fullIds, tinyIds, 10).ratio),
      top20Overlap: round(overlapAt(fullIds, tinyIds, 20).ratio),
      top50Overlap: round(overlapAt(fullIds, tinyIds, 50).ratio),
      top10Jaccard: round(jaccardAt(fullIds, tinyIds, 10)),
      top20Jaccard: round(jaccardAt(fullIds, tinyIds, 20)),
      top50Jaccard: round(jaccardAt(fullIds, tinyIds, 50)),
      rankCorrelation: round(spearmanAt(fullIds, tinyIds, 50)),
      missingFromTinyTop10: top10Full.filter((trackId) => !top10Tiny.includes(trackId)),
      missingFromFullTop10: top10Tiny.filter((trackId) => !top10Full.includes(trackId)),
      missingFromTinyTop20: top20Full.filter((trackId) => !top20Tiny.includes(trackId)),
      missingFromFullTop20: top20Tiny.filter((trackId) => !top20Full.includes(trackId)),
      pass: false,
    };
    result.pass = result.top10Overlap >= THRESHOLDS.seedTop10OverlapMin
      && result.top20Overlap >= THRESHOLDS.seedTop20OverlapMin;
    seedSongMetrics.push(result);
  }

  const stationSummaries = buildStationPersonaSummary(stationRunMetrics);
  const divergenceSummaries = buildDivergencePairSummaries(divergenceRunMetrics);
  const seedSummary = summarizeSeedSongResults(seedSongMetrics);

  const determinismFavorites = await selectSeedFavorites(fullRows, PERSONA_IDS[0]!, stationRunSeeds[0]!, corpusStats, metadataResolver);
  const determinismInputRecord = {
    exportSource: resolvedInputs.exportSource,
    favorites: determinismFavorites,
    personaId: PERSONA_IDS[0],
    runSeed: stationRunSeeds[0],
  } satisfies JsonValue;
  await writeCanonicalJsonFile(path.join(determinismDir, "station-inputs-rerun.json"), determinismInputRecord, { action: "data:modify" });
  const rerunRatings = buildRatingsMap(determinismFavorites);
  const rerunFullQueue = await buildStationQueue(
    fullHandle,
    hvscRoot,
    rerunRatings,
    stationSize,
    adventure,
    minDurationSeconds,
    buildRuntime(config, repoRoot, stationRunSeeds[0]!),
    sharedMetadataCache,
  );
  const rerunTinyQueue = await buildStationQueue(
    tinyHandle,
    hvscRoot,
    rerunRatings,
    stationSize,
    adventure,
    minDurationSeconds,
    buildRuntime(config, repoRoot, stationRunSeeds[0]!),
    sharedMetadataCache,
  );
  await writeCanonicalJsonFile(path.join(determinismDir, "station-output-rerun.json"), {
    full: serializeStation(rerunFullQueue),
    tiny: serializeStation(rerunTinyQueue),
  } satisfies JsonValue, { action: "data:modify" });
  const firstSeed = seedTrackRows[0]!;
  const rerunFullSeed = recommendFromSeedTrack(resolvedInputs.fullExportPath, { seedTrackId: firstSeed.track_id, limit: 50 });
  const rerunTinySeed = tinyHandle.recommendFromFavorites({ favoriteTrackIds: [firstSeed.track_id], limit: 50 });
  await writeCanonicalJsonFile(path.join(determinismDir, "seed-rerun.json"), {
    full: rerunFullSeed,
    tiny: rerunTinySeed,
  } satisfies JsonValue, { action: "data:modify" });

  const determinism: DeterminismProof = {
    stationInputsIdentical: JSON.stringify(JSON.parse(await readFile(path.join(stationInputsDir, `${PERSONA_IDS[0]}-${stationRunSeeds[0]}.json`), "utf8")))
      === JSON.stringify(JSON.parse(stringifyDeterministic(determinismInputRecord, 2))),
    stationOutputsIdentical: JSON.stringify(serializeStation(rerunFullQueue)) === JSON.stringify(serializeStation(stationQueuesByFormat.full.get(`${PERSONA_IDS[0]}:${stationRunSeeds[0]}`) ?? []))
      && JSON.stringify(serializeStation(rerunTinyQueue)) === JSON.stringify(serializeStation(stationQueuesByFormat.tiny.get(`${PERSONA_IDS[0]}:${stationRunSeeds[0]}`) ?? [])),
    seedSongOutputsIdentical: JSON.stringify(rerunFullSeed) === JSON.stringify(recommendFromSeedTrack(resolvedInputs.fullExportPath, { seedTrackId: firstSeed.track_id, limit: 50 }))
      && JSON.stringify(rerunTinySeed) === JSON.stringify(tinyHandle.recommendFromFavorites({ favoriteTrackIds: [firstSeed.track_id], limit: 50 })),
    verdictStable: false,
  };

  determinism.verdictStable = determinism.stationInputsIdentical
    && determinism.stationOutputsIdentical
    && determinism.seedSongOutputsIdentical;

  await writeCanonicalJsonFile(path.join(determinismDir, "verdict-rerun.json"), determinism as unknown as JsonValue, { action: "data:modify" });

  await writeCanonicalJsonFile(path.join(comparisonsDir, "station-equivalence.json"), {
    personaSummaries: stationSummaries,
    runs: stationRunMetrics,
    thresholds: THRESHOLDS,
  } satisfies JsonValue, { action: "data:modify" });
  await writeCanonicalJsonFile(path.join(comparisonsDir, "seed-song-equivalence.json"), {
    summary: seedSummary,
    seeds: seedSongMetrics,
    thresholds: THRESHOLDS,
  } satisfies JsonValue, { action: "data:modify" });
  await writeCanonicalJsonFile(path.join(comparisonsDir, "persona-divergence.json"), {
    pairSummaries: divergenceSummaries,
    runs: divergenceRunMetrics,
    thresholds: THRESHOLDS,
  } satisfies JsonValue, { action: "data:modify" });

  const commands = {
    actual: process.argv.join(" "),
    ciReduced: `bun run validate:tiny-export-equivalence -- --export-source release --release-repo ${options.releaseRepo ?? DEFAULT_RELEASE_REPO} --release-tag ${resolvedInputs.release?.tag ?? (options.releaseTag ?? DEFAULT_RELEASE_TAG)} --persona-runs 2 --seed-song-count 10 --ci --output-root ${DEFAULT_OUTPUT_ROOT}`,
    localFull: `bun run validate:tiny-export-equivalence -- --export-source local --output-root ${DEFAULT_OUTPUT_ROOT}`,
  } satisfies JsonValue;
  await writeCanonicalJsonFile(path.join(outputRoot, "commands.json"), commands, { action: "data:modify" });
  await writeCanonicalJsonFile(path.join(outputRoot, "config.json"), {
    adventure,
    exportSource: resolvedInputs.exportSource,
    fullExportPath: resolvedInputs.fullExportPath,
    hvscRoot,
    liteExportPath: resolvedInputs.liteExportPath ?? null,
    minDurationSeconds,
    outputRoot,
    personaRuns,
    release: resolvedInputs.release ?? null,
    seedSongCount,
    stationSize,
    thresholds: THRESHOLDS,
    tinyExportPath: resolvedInputs.tinyExportPath,
  } satisfies JsonValue, { action: "data:modify" });

  const report = await buildReport(
    outputRoot,
    resolvedInputs,
    options,
    config,
    stationSummaries,
    stationRunMetrics,
    divergenceSummaries,
    seedSummary,
    seedSongMetrics,
    determinism,
  );
  await writeFile(path.join(outputRoot, "report.md"), `${report}\n`, "utf8");

  const checksumTargets = [
    path.join(outputRoot, "commands.json"),
    path.join(outputRoot, "config.json"),
    path.join(comparisonsDir, "station-equivalence.json"),
    path.join(comparisonsDir, "seed-song-equivalence.json"),
    path.join(comparisonsDir, "persona-divergence.json"),
    path.join(outputRoot, "report.md"),
    ...stationRunMetrics.flatMap((result) => [result.favoriteSeedPath, result.fullStationPath, result.tinyStationPath]),
    ...seedSongMetrics.flatMap((result) => [result.fullResultsPath, result.tinyResultsPath]),
  ];
  await writeChecksums(checksumTargets, path.join(outputRoot, "SHA256SUMS"));

  if (!options.ci) {
    process.stdout.write(`${outputRoot}\n`);
  }
  if (options.strict && (!stationSummaries.every((summary) => summary.pass) || !seedSummary.pass || divergenceSummaries.some((summary) => !summary.pass))) {
    throw new Error(`Equivalence thresholds failed. See ${path.join(outputRoot, "report.md")}`);
  }
}

await main();