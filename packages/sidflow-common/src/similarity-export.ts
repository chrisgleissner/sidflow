import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { writeCanonicalJsonFile } from "./canonical-writer.js";
import { ensureDir, pathExists } from "./fs.js";
import {
  FEATURE_SCHEMA_VERSION,
  type AudioFeatures,
  type ClassificationRecord,
  type FeedbackRecord,
} from "./jsonl-schema.js";
import { DEFAULT_RATING, DEFAULT_RATINGS, clampRating, type TagRatings } from "./ratings.js";
import { aggregateFeedbackRecordsByKey, type AggregatedFeedback } from "./feedback-aggregation.js";
import {
  computeSimilarityStyleMask,
  pickRandomRows,
  type SimilarityDataset,
  type SimilarityTrackRow,
} from "./similarity-portable.js";
import { cosineSimilarity } from "./vector-similarity.js";

export const SIMILARITY_EXPORT_SCHEMA_VERSION = "sidcorr-1";

export type SimilarityExportProfile = "full" | "mobile";

export interface SimilarityExportTrack {
  track_id: string;
  sid_path: string;
  song_index: number;
  vector: number[];
  e: number;
  m: number;
  c: number;
  p?: number;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  decayed_likes: number;
  decayed_dislikes: number;
  decayed_skips: number;
  decayed_plays: number;
  last_played?: string;
  classified_at?: string;
  source?: string;
  render_engine?: string;
  features_json?: string;
}

export interface SimilarityExportManifest {
  schema_version: typeof SIMILARITY_EXPORT_SCHEMA_VERSION;
  export_profile: SimilarityExportProfile;
  generated_at: string;
  corpus_version: string;
  feature_schema_version: string;
  vector_dimensions: number;
  include_vectors: boolean;
  neighbor_count_per_track: number;
  track_count: number;
  neighbor_row_count: number;
  paths: {
    sqlite: string;
    manifest: string;
  };
  source_checksums: {
    classified: string;
    feedback: string;
  };
  file_checksums: {
    sqlite_sha256: string;
  };
  tables: readonly string[];
}

export interface BuildSimilarityExportOptions {
  classifiedPath: string;
  feedbackPath: string;
  outputPath: string;
  manifestPath?: string;
  profile?: SimilarityExportProfile;
  corpusVersion?: string;
  dims?: number;
  includeVectors?: boolean;
  neighbors?: number;
}

export interface BuildSimilarityExportResult {
  outputPath: string;
  manifestPath: string;
  manifest: SimilarityExportManifest;
  durationMs: number;
}

export interface SimilarityExportRecommendation {
  track_id: string;
  sid_path: string;
  song_index: number;
  score: number;
  rank: number;
  e: number;
  m: number;
  c: number;
  p?: number;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  decayed_likes: number;
  decayed_dislikes: number;
  decayed_skips: number;
  decayed_plays: number;
  last_played?: string;
}

export interface RecommendFromSeedTrackOptions {
  seedTrackId: string;
  limit?: number;
  profile?: SimilarityExportProfile;
  excludeTrackIds?: string[];
}

export interface RecommendFromFavoritesOptions {
  favoriteTrackIds: string[];
  limit?: number;
  excludeTrackIds?: string[];
  weightsByTrackId?: Record<string, number>;
}

interface PersistedTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
  vector_json: string | null;
  e: number;
  m: number;
  c: number;
  p: number | null;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  decayed_likes: number;
  decayed_dislikes: number;
  decayed_skips: number;
  decayed_plays: number;
  last_played: string | null;
}

interface TrackColumnSupport {
  hasTrackId: boolean;
  hasSongIndex: boolean;
  hasDecayedFeedback: boolean;
}

type RatingDimension = "e" | "m" | "c";

type PartialRatings = Partial<TagRatings>;

interface FeaturePhaseRecord {
  sid_path: string;
  song_index?: number;
  manual_ratings?: PartialRatings | null;
  features: AudioFeatures;
  render_engine?: string;
}

interface FeatureNormStats {
  mu: number;
  sigma: number;
  count: number;
  nonZeroCount: number;
}

interface DeterministicRatingModel {
  featureSetVersion: string;
  renderEngine: string;
  features: Partial<Record<DeterministicFeatureKey, FeatureNormStats>>;
}

type DeterministicFeatureKey =
  | "bpm"
  | "rms"
  | "energy"
  | "spectralCentroid"
  | "spectralRolloff"
  | "spectralFlatnessDb"
  | "spectralEntropy"
  | "spectralCrest"
  | "spectralHfc"
  | "zeroCrossingRate";

type WeightedTerm = {
  w: number;
  x?: number;
};

const RATING_DIMENSIONS: readonly RatingDimension[] = ["e", "m", "c"] as const;

const DETERMINISTIC_FEATURE_KEYS: readonly DeterministicFeatureKey[] = [
  "bpm",
  "rms",
  "energy",
  "spectralCentroid",
  "spectralRolloff",
  "spectralFlatnessDb",
  "spectralEntropy",
  "spectralCrest",
  "spectralHfc",
  "zeroCrossingRate",
] as const;

function normalizeSongIndex(songIndex?: number): number {
  return Number.isInteger(songIndex) && (songIndex as number) > 0 ? (songIndex as number) : 1;
}

export function buildSimilarityTrackId(sidPath: string, songIndex?: number): string {
  return `${sidPath}#${normalizeSongIndex(songIndex)}`;
}

export function parseSimilarityTrackId(trackId: string): { sid_path: string; song_index: number } {
  const hashIndex = trackId.lastIndexOf("#");
  if (hashIndex <= 0 || hashIndex === trackId.length - 1) {
    return { sid_path: trackId, song_index: 1 };
  }

  const sidPath = trackId.slice(0, hashIndex);
  const rawSongIndex = Number.parseInt(trackId.slice(hashIndex + 1), 10);
  return {
    sid_path: sidPath,
    song_index: normalizeSongIndex(rawSongIndex),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function ratingFromRaw(value: number): number {
  return clampRating(Math.round(1 + 4 * clamp01(value)));
}

function weightedAverageTerms(terms: WeightedTerm[]): { value: number; present: boolean } {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const term of terms) {
    if (!isFiniteNumber(term.x) || !isFiniteNumber(term.w) || term.w <= 0) {
      continue;
    }
    weightedSum += term.w * term.x;
    totalWeight += term.w;
  }

  if (totalWeight <= 0) {
    return { value: 0, present: false };
  }

  return { value: weightedSum / totalWeight, present: true };
}

function sigmoidFromNormalizedTerms(terms: WeightedTerm[]): { value: number; present: boolean } {
  const average = weightedAverageTerms(terms);
  if (!average.present) {
    return { value: 0.5, present: false };
  }
  return { value: sigmoid(average.value), present: true };
}

function normalizeFeature(
  model: DeterministicRatingModel,
  key: DeterministicFeatureKey,
  value: unknown,
): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined;
  }

  const stats = model.features[key];
  if (!stats) {
    return undefined;
  }

  return clamp((value - stats.mu) / stats.sigma, -3, 3);
}

function buildDeterministicRatingModel(records: FeaturePhaseRecord[]): DeterministicRatingModel {
  const online = new Map<DeterministicFeatureKey, { count: number; mean: number; m2: number; nonZeroCount: number }>();
  let featureSetVersion = FEATURE_SCHEMA_VERSION;
  let renderEngine = "unknown";

  for (const record of records) {
    if (typeof record.features.featureSetVersion === "string" && record.features.featureSetVersion) {
      featureSetVersion = record.features.featureSetVersion;
    }
    if (typeof record.render_engine === "string" && record.render_engine) {
      renderEngine = record.render_engine;
    }

    for (const key of DETERMINISTIC_FEATURE_KEYS) {
      const raw = record.features[key];
      if (!isFiniteNumber(raw)) {
        continue;
      }

      const stats = online.get(key) ?? { count: 0, mean: 0, m2: 0, nonZeroCount: 0 };
      stats.count += 1;
      const delta = raw - stats.mean;
      stats.mean += delta / stats.count;
      const delta2 = raw - stats.mean;
      stats.m2 += delta * delta2;
      if (Math.abs(raw) > 1e-12) {
        stats.nonZeroCount += 1;
      }
      online.set(key, stats);
    }
  }

  const model: DeterministicRatingModel = {
    featureSetVersion,
    renderEngine,
    features: {},
  };

  for (const key of DETERMINISTIC_FEATURE_KEYS) {
    const stats = online.get(key);
    if (!stats || stats.nonZeroCount <= 0 || stats.count <= 0) {
      continue;
    }

    const sigma = Math.sqrt(Math.max(0, stats.m2 / stats.count));
    if (!Number.isFinite(sigma) || sigma <= 0) {
      continue;
    }

    model.features[key] = {
      mu: stats.mean,
      sigma,
      count: stats.count,
      nonZeroCount: stats.nonZeroCount,
    };
  }

  return model;
}

function predictRecoveredRatings(model: DeterministicRatingModel, features: AudioFeatures): TagRatings {
  const tempoFast = (() => {
    const bpmNorm = normalizeFeature(model, "bpm", features.bpm);
    if (bpmNorm === undefined) {
      return { value: 0.5, present: false };
    }
    const confidence = isFiniteNumber(features.confidence) ? clamp(features.confidence, 0, 1) : 1;
    return { value: sigmoid(bpmNorm * confidence), present: true };
  })();

  const bright = sigmoidFromNormalizedTerms([
    { w: 0.45, x: normalizeFeature(model, "spectralCentroid", features.spectralCentroid) },
    { w: 0.35, x: normalizeFeature(model, "spectralRolloff", features.spectralRolloff) },
    { w: 0.2, x: normalizeFeature(model, "spectralHfc", features.spectralHfc) },
  ]);

  const noisy = sigmoidFromNormalizedTerms([
    { w: 0.45, x: normalizeFeature(model, "spectralFlatnessDb", features.spectralFlatnessDb) },
    { w: 0.25, x: normalizeFeature(model, "zeroCrossingRate", features.zeroCrossingRate) },
    { w: 0.3, x: normalizeFeature(model, "spectralEntropy", features.spectralEntropy) },
  ]);

  const percussive = sigmoidFromNormalizedTerms([
    { w: 0.5, x: normalizeFeature(model, "spectralCrest", features.spectralCrest) },
    { w: 0.3, x: normalizeFeature(model, "zeroCrossingRate", features.zeroCrossingRate) },
    { w: 0.2, x: normalizeFeature(model, "spectralHfc", features.spectralHfc) },
  ]);

  const dynamicLoud = sigmoidFromNormalizedTerms([
    { w: 0.7, x: normalizeFeature(model, "rms", features.rms) },
    { w: 0.3, x: normalizeFeature(model, "energy", features.energy) },
  ]);

  const tonalClarity = noisy.present
    ? { value: 1 - noisy.value, present: true }
    : { value: 0.5, present: false };

  const complexity = weightedAverageTerms([
    { w: 0.35, x: percussive.present ? percussive.value : undefined },
    { w: 0.25, x: tempoFast.present ? tempoFast.value : undefined },
    { w: 0.25, x: bright.present ? bright.value : undefined },
    { w: 0.15, x: noisy.present ? noisy.value : undefined },
  ]);

  const energy = weightedAverageTerms([
    { w: 0.4, x: dynamicLoud.present ? dynamicLoud.value : undefined },
    { w: 0.35, x: tempoFast.present ? tempoFast.value : undefined },
    { w: 0.25, x: percussive.present ? percussive.value : undefined },
  ]);

  const mood = weightedAverageTerms([
    { w: 0.45, x: tonalClarity.present ? tonalClarity.value : undefined },
    { w: 0.25, x: percussive.present ? 1 - percussive.value : undefined },
    { w: 0.15, x: bright.present ? 1 - bright.value : undefined },
    { w: 0.15, x: dynamicLoud.present ? 1 - dynamicLoud.value : undefined },
  ]);

  return {
    c: ratingFromRaw(complexity.present ? complexity.value : 0.5),
    e: ratingFromRaw(energy.present ? energy.value : 0.5),
    m: ratingFromRaw(mood.present ? mood.value : 0.5),
  };
}

function hasMissingDimensions(ratings: PartialRatings): boolean {
  return RATING_DIMENSIONS.some((dimension) => ratings[dimension] === undefined);
}

function combineRecoveredRatings(
  manual: PartialRatings | null | undefined,
  automatic: TagRatings | null,
): { ratings: TagRatings; source: "manual" | "auto" | "mixed" } {
  const ratings: TagRatings = { ...DEFAULT_RATINGS };
  let manualCount = 0;
  let autoCount = 0;

  for (const dimension of RATING_DIMENSIONS) {
    if (manual && manual[dimension] !== undefined) {
      ratings[dimension] = clampRating(manual[dimension] as number);
      manualCount += 1;
      continue;
    }

    if (automatic && automatic[dimension] !== undefined) {
      ratings[dimension] = clampRating(automatic[dimension]);
      autoCount += 1;
      continue;
    }
  }

  if (manual?.p !== undefined) {
    ratings.p = clampRating(manual.p);
  }

  if (manualCount === 0 && autoCount > 0) {
    return { ratings, source: "auto" };
  }
  if (manualCount > 0 && autoCount > 0) {
    return { ratings, source: "mixed" };
  }
  return { ratings, source: "manual" };
}

function parseTimestampFromJsonlName(fileName: string): string | undefined {
  const match = fileName.match(/_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})\.jsonl$/);
  if (!match) {
    return undefined;
  }
  const [, date, hour, minute, second, millis] = match;
  return `${date}T${hour}:${minute}:${second}.${millis}Z`;
}

function isFeaturePhaseRecord(value: unknown): value is FeaturePhaseRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.sid_path === "string" && !!record.features && typeof record.features === "object";
}

function recoverClassificationsFromFeatureFile(
  records: FeaturePhaseRecord[],
  classifiedAt: string | undefined,
): ClassificationRecord[] {
  if (records.length === 0) {
    return [];
  }

  const model = buildDeterministicRatingModel(records);
  return records.map((record) => {
    const needsAutomaticRatings = !record.manual_ratings || hasMissingDimensions(record.manual_ratings);
    const automaticRatings = needsAutomaticRatings ? predictRecoveredRatings(model, record.features) : null;
    const combined = combineRecoveredRatings(record.manual_ratings, automaticRatings);
    const classification: ClassificationRecord = {
      sid_path: record.sid_path,
      ratings: combined.ratings,
      source: combined.source,
      classified_at: classifiedAt,
      render_engine: record.render_engine,
      features: record.features,
    };
    if (record.song_index !== undefined) {
      classification.song_index = record.song_index;
    }
    if (record.features.featureVariant === "heuristic") {
      classification.degraded = true;
    }
    return classification;
  });
}

async function readClassificationsForExport(dirPath: string): Promise<ClassificationRecord[]> {
  const records: ClassificationRecord[] = [];

  if (!(await pathExists(dirPath))) {
    return records;
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      const contents = await readFile(fullPath, "utf8");
      const lines = contents.split("\n").map((line) => line.trim()).filter(Boolean);

      if (entry.name.startsWith("features_")) {
        const featureRecords = lines
          .map((line) => JSON.parse(line) as unknown)
          .filter(isFeaturePhaseRecord);
        records.push(...recoverClassificationsFromFeatureFile(featureRecords, parseTimestampFromJsonlName(entry.name)));
        continue;
      }

      if (!entry.name.startsWith("classification_")) {
        continue;
      }

      for (const line of lines) {
        records.push(JSON.parse(line) as ClassificationRecord);
      }
    }
  }

  await walk(dirPath);
  return records;
}

async function readJsonlFiles<T>(dirPath: string): Promise<T[]> {
  const records: T[] = [];

  if (!(await pathExists(dirPath))) {
    return records;
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const contents = await readFile(fullPath, "utf8");
      for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        records.push(JSON.parse(trimmed) as T);
      }
    }
  }

  await walk(dirPath);
  return records;
}

function buildLegacyVector(ratings: TagRatings, dims: number): number[] {
  if (dims <= 3) {
    return [ratings.e, ratings.m, ratings.c].slice(0, dims);
  }
  return [ratings.e, ratings.m, ratings.c, ratings.p ?? DEFAULT_RATING].slice(0, dims);
}

function buildFallbackPerceptualVector(ratings: TagRatings): number[] {
  const energy = clamp01((ratings.e - 1) / 4);
  const mood = clamp01((ratings.m - 1) / 4);
  const complexity = clamp01((ratings.c - 1) / 4);
  return [
    energy,
    1 - mood,
    complexity,
    energy,
    0.5,
    complexity,
    mood,
    1 - mood,
    energy,
    complexity,
    0.5,
    0.5,
    0.5,
    0.5,
    0,
    0,
    0,
    0,
    0,
    energy,
    mood,
    complexity,
    0.5,
    0.5,
  ];
}

function sanitizeVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const vector = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return vector.length > 0 ? vector : null;
}

function resolveTargetVectorDimensions(classifications: ClassificationRecord[], dims?: number): number {
  if (typeof dims === "number" && Number.isFinite(dims) && dims > 0) {
    return Math.max(1, Math.floor(dims));
  }

  const maxStoredDimensions = classifications.reduce((max, classification) => {
    const stored = sanitizeVector(classification.vector)?.length ?? 0;
    return Math.max(max, stored);
  }, 0);

  return maxStoredDimensions > 4 ? maxStoredDimensions : 4;
}

function resolveClassificationVector(classification: ClassificationRecord, targetDimensions: number): number[] {
  if (targetDimensions <= 4) {
    return buildLegacyVector(classification.ratings, targetDimensions);
  }

  const storedVector = sanitizeVector(classification.vector);
  if (storedVector && storedVector.length >= targetDimensions) {
    return storedVector.slice(0, targetDimensions);
  }
  let base: number[];
  if (storedVector && storedVector.length > 0) {
    base = [...storedVector, ...buildFallbackPerceptualVector(classification.ratings).slice(storedVector.length)];
  } else {
    base = buildFallbackPerceptualVector(classification.ratings);
  }
  if (base.length >= targetDimensions) {
    return base.slice(0, targetDimensions);
  }
  // Pad with zeros so callers always receive exactly targetDimensions elements,
  // preventing inconsistent vector lengths in the export DB and manifest metadata.
  return [...base, ...new Array(targetDimensions - base.length).fill(0)];
}

function classificationToTrack(
  classification: ClassificationRecord,
  feedback: AggregatedFeedback | undefined,
  dims: number,
): SimilarityExportTrack {
  const { e, m, c, p } = classification.ratings;
  const songIndex = normalizeSongIndex(classification.song_index);
  const vector = resolveClassificationVector(classification, dims);
  return {
    track_id: buildSimilarityTrackId(classification.sid_path, songIndex),
    sid_path: classification.sid_path,
    song_index: songIndex,
    vector,
    e,
    m,
    c,
    p,
    likes: feedback?.likes ?? 0,
    dislikes: feedback?.dislikes ?? 0,
    skips: feedback?.skips ?? 0,
    plays: feedback?.plays ?? 0,
    decayed_likes: feedback?.decayedLikes ?? 0,
    decayed_dislikes: feedback?.decayedDislikes ?? 0,
    decayed_skips: feedback?.decayedSkips ?? 0,
    decayed_plays: feedback?.decayedPlays ?? 0,
    last_played: feedback?.lastPlayed,
    classified_at: classification.classified_at,
    source: classification.source,
    render_engine: classification.render_engine,
    features_json: classification.features ? JSON.stringify(classification.features) : undefined,
  };
}

function hasValidRatings(classification: ClassificationRecord): boolean {
  const ratings = classification.ratings as Partial<ClassificationRecord["ratings"]> | undefined;
  return Boolean(
    ratings &&
    typeof ratings.e === "number" &&
    typeof ratings.m === "number" &&
    typeof ratings.c === "number"
  );
}

function dedupeClassifications(classifications: ClassificationRecord[]): ClassificationRecord[] {
  const deduped = new Map<string, ClassificationRecord>();
  for (const classification of classifications) {
    const trackId = buildSimilarityTrackId(classification.sid_path, classification.song_index);
    const existing = deduped.get(trackId);
    if (!existing) {
      deduped.set(trackId, classification);
      continue;
    }

    const existingTimestamp = existing.classified_at ?? "";
    const nextTimestamp = classification.classified_at ?? "";
    if (nextTimestamp >= existingTimestamp) {
      deduped.set(trackId, classification);
    }
  }

  return Array.from(deduped.values());
}

function buildCentroid(vectors: number[][], weights?: number[]): number[] {
  if (vectors.length === 0) {
    throw new Error("At least one vector is required");
  }

  const dimensionCount = vectors.reduce((max, vector) => Math.max(max, vector.length), 0);
  const centroid = new Array(dimensionCount).fill(0);
  let totalWeight = 0;
  for (let index = 0; index < vectors.length; index += 1) {
    const weight = weights?.[index] ?? 1;
    totalWeight += weight;
    for (let dimension = 0; dimension < dimensionCount; dimension += 1) {
      centroid[dimension] += (vectors[index][dimension] ?? 0) * weight;
    }
  }

  return centroid.map((value) => value / Math.max(totalWeight, 1));
}

function computeDefaultManifestPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.manifest.json`);
}

async function computeDirectoryChecksum(dirPath: string): Promise<string> {
  if (!(await pathExists(dirPath))) {
    return "empty";
  }

  const hash = createHash("sha256");
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(dirPath);
  files.sort();
  for (const filePath of files) {
    hash.update(await readFile(filePath));
  }
  return hash.digest("hex");
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function insertNeighbors(database: Database, profile: SimilarityExportProfile, tracks: SimilarityExportTrack[], neighborCount: number): number {
  if (neighborCount <= 0 || tracks.length === 0) {
    return 0;
  }

  const insert = database.query(
    "INSERT INTO neighbors (profile, seed_track_id, neighbor_track_id, rank, similarity) VALUES (?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  for (const seedTrack of tracks) {
    const ranked = tracks
      .filter((candidate) => candidate.track_id !== seedTrack.track_id)
      .map((candidate) => ({
        track_id: candidate.track_id,
        similarity: cosineSimilarity(seedTrack.vector, candidate.vector),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, neighborCount);

    ranked.forEach((neighbor, index) => {
      insert.run(profile, seedTrack.track_id, neighbor.track_id, index + 1, Number(neighbor.similarity.toFixed(8)));
      inserted += 1;
    });
  }
  return inserted;
}

function trackRowToRecommendation(row: PersistedTrackRow, score: number, rank: number): SimilarityExportRecommendation {
  return {
    track_id: row.track_id,
    sid_path: row.sid_path,
    song_index: row.song_index,
    score,
    rank,
    e: row.e,
    m: row.m,
    c: row.c,
    p: row.p ?? undefined,
    likes: row.likes,
    dislikes: row.dislikes,
    skips: row.skips,
    plays: row.plays,
    decayed_likes: row.decayed_likes,
    decayed_dislikes: row.decayed_dislikes,
    decayed_skips: row.decayed_skips,
    decayed_plays: row.decayed_plays,
    last_played: row.last_played ?? undefined,
  };
}

function persistedTrackRowToSimilarityRow(row: PersistedTrackRow): SimilarityTrackRow {
  return {
    track_id: row.track_id,
    sid_path: row.sid_path,
    song_index: row.song_index,
    e: row.e,
    m: row.m,
    c: row.c,
    p: row.p,
    likes: row.likes,
    dislikes: row.dislikes,
    skips: row.skips,
    plays: row.plays,
    decayed_likes: row.decayed_likes,
    decayed_dislikes: row.decayed_dislikes,
    decayed_skips: row.decayed_skips,
    decayed_plays: row.decayed_plays,
    last_played: row.last_played,
  };
}

function getTrackColumnSupport(database: Database): TrackColumnSupport {
  const columns = database.query("PRAGMA table_info(tracks)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  return {
    hasTrackId: names.has("track_id"),
    hasSongIndex: names.has("song_index"),
    hasDecayedFeedback:
      names.has("decayed_likes")
      && names.has("decayed_dislikes")
      && names.has("decayed_skips")
      && names.has("decayed_plays"),
  };
}

function qualifyTrackColumn(column: string, tableAlias?: string): string {
  return tableAlias ? `${tableAlias}.${column}` : column;
}

function buildTrackIdExpression(columnSupport: TrackColumnSupport, tableAlias?: string): string {
  if (columnSupport.hasTrackId) {
    return qualifyTrackColumn("track_id", tableAlias);
  }
  const sidPath = qualifyTrackColumn("sid_path", tableAlias);
  const songIndex = columnSupport.hasSongIndex ? qualifyTrackColumn("song_index", tableAlias) : "1";
  return `(${sidPath} || '#' || ${songIndex})`;
}

function buildSongIndexExpression(columnSupport: TrackColumnSupport, tableAlias?: string): string {
  return columnSupport.hasSongIndex ? qualifyTrackColumn("song_index", tableAlias) : "1";
}

function buildTrackSelectList(columnSupport: TrackColumnSupport, tableAlias?: string): string {
  const selectParts = [
    `${buildTrackIdExpression(columnSupport, tableAlias)} AS track_id`,
    `${qualifyTrackColumn("sid_path", tableAlias)} AS sid_path`,
    `${buildSongIndexExpression(columnSupport, tableAlias)} AS song_index`,
    `${qualifyTrackColumn("vector_json", tableAlias)} AS vector_json`,
    `${qualifyTrackColumn("e", tableAlias)} AS e`,
    `${qualifyTrackColumn("m", tableAlias)} AS m`,
    `${qualifyTrackColumn("c", tableAlias)} AS c`,
    `${qualifyTrackColumn("p", tableAlias)} AS p`,
    `${qualifyTrackColumn("likes", tableAlias)} AS likes`,
    `${qualifyTrackColumn("dislikes", tableAlias)} AS dislikes`,
    `${qualifyTrackColumn("skips", tableAlias)} AS skips`,
    `${qualifyTrackColumn("plays", tableAlias)} AS plays`,
  ];

  if (columnSupport.hasDecayedFeedback) {
    selectParts.push(
      `${qualifyTrackColumn("decayed_likes", tableAlias)} AS decayed_likes`,
      `${qualifyTrackColumn("decayed_dislikes", tableAlias)} AS decayed_dislikes`,
      `${qualifyTrackColumn("decayed_skips", tableAlias)} AS decayed_skips`,
      `${qualifyTrackColumn("decayed_plays", tableAlias)} AS decayed_plays`,
    );
  } else {
    selectParts.push(
      "0 AS decayed_likes",
      "0 AS decayed_dislikes",
      "0 AS decayed_skips",
      "0 AS decayed_plays",
    );
  }

  selectParts.push(`${qualifyTrackColumn("last_played", tableAlias)} AS last_played`);
  return selectParts.join(", ");
}

function buildTrackIdentityWhereClause(
  columnSupport: TrackColumnSupport,
  trackIds: readonly string[],
  tableAlias?: string,
): { clause: string; params: Array<number | string> } {
  if (trackIds.length === 0) {
    return { clause: "0", params: [] };
  }

  if (columnSupport.hasTrackId) {
    return {
      clause: `${qualifyTrackColumn("track_id", tableAlias)} IN (${trackIds.map(() => "?").join(", ")})`,
      params: [...trackIds],
    };
  }

  const conditions: string[] = [];
  const params: Array<number | string> = [];
  for (const trackId of trackIds) {
    const parsed = parseSimilarityTrackId(trackId);
    if (columnSupport.hasSongIndex) {
      conditions.push(`(${qualifyTrackColumn("sid_path", tableAlias)} = ? AND ${qualifyTrackColumn("song_index", tableAlias)} = ?)`);
      params.push(parsed.sid_path, parsed.song_index);
      continue;
    }
    conditions.push(`${qualifyTrackColumn("sid_path", tableAlias)} = ?`);
    params.push(parsed.sid_path);
  }

  return { clause: conditions.join(" OR "), params };
}

function openReadonlyDatabase(dbPath: string): Database {
  return new Database(dbPath, { readonly: true });
}

function computeTemporaryOutputPath(outputPath: string): string {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `.${parsed.base}.tmp-${Date.now()}`);
}

export async function buildSimilarityExport(options: BuildSimilarityExportOptions): Promise<BuildSimilarityExportResult> {
  const startedAt = Date.now();
  const profile = options.profile ?? "full";
  const includeVectors = options.includeVectors ?? true;
  const neighborCount = Math.max(0, options.neighbors ?? 0);
  const manifestPath = options.manifestPath ?? computeDefaultManifestPath(options.outputPath);

  const [classifications, feedbackEvents] = await Promise.all([
    readClassificationsForExport(options.classifiedPath),
    readJsonlFiles<FeedbackRecord>(options.feedbackPath),
  ]);

  const dedupedClassifications = dedupeClassifications(classifications);
  const dims = resolveTargetVectorDimensions(dedupedClassifications, options.dims);
  const feedbackByTrackId = aggregateFeedbackRecordsByKey(
    feedbackEvents,
    (event) => buildSimilarityTrackId(event.sid_path, event.song_index),
  );
  const tracks = dedupedClassifications
    .filter((classification) => hasValidRatings(classification))
    .map((classification) => classificationToTrack(
      classification,
      feedbackByTrackId.get(buildSimilarityTrackId(classification.sid_path, classification.song_index)),
      dims,
    ))
    .sort((left, right) => {
      const sidPathCompare = left.sid_path.localeCompare(right.sid_path);
      if (sidPathCompare !== 0) {
        return sidPathCompare;
      }
      return left.song_index - right.song_index;
    });

  await ensureDir(path.dirname(options.outputPath));
  const temporaryOutputPath = computeTemporaryOutputPath(options.outputPath);
  await rm(temporaryOutputPath, { force: true });

  let neighborRowCount = 0;
  const database = new Database(temporaryOutputPath, { create: true, strict: true });
  try {
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE tracks (
        track_id TEXT PRIMARY KEY,
        sid_path TEXT NOT NULL,
        song_index INTEGER NOT NULL,
        vector_json TEXT,
        e REAL NOT NULL,
        m REAL NOT NULL,
        c REAL NOT NULL,
        p REAL,
        likes INTEGER NOT NULL,
        dislikes INTEGER NOT NULL,
        skips INTEGER NOT NULL,
        plays INTEGER NOT NULL,
        decayed_likes REAL NOT NULL,
        decayed_dislikes REAL NOT NULL,
        decayed_skips REAL NOT NULL,
        decayed_plays REAL NOT NULL,
        last_played TEXT,
        classified_at TEXT,
        source TEXT,
        render_engine TEXT,
        feature_schema_version TEXT,
        features_json TEXT
      ) WITHOUT ROWID;
      CREATE TABLE neighbors (
        profile TEXT NOT NULL,
        seed_track_id TEXT NOT NULL,
        neighbor_track_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        similarity REAL NOT NULL,
        PRIMARY KEY (profile, seed_track_id, rank)
      ) WITHOUT ROWID;
      CREATE INDEX tracks_sid_path_idx ON tracks (sid_path, song_index);
    `);

    const insertTrack = database.query(
      `INSERT INTO tracks (
        track_id,
        sid_path,
        song_index,
        vector_json,
        e,
        m,
        c,
        p,
        likes,
        dislikes,
        skips,
        plays,
        decayed_likes,
        decayed_dislikes,
        decayed_skips,
        decayed_plays,
        last_played,
        classified_at,
        source,
        render_engine,
        feature_schema_version,
        features_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const track of tracks) {
      insertTrack.run(
        track.track_id,
        track.sid_path,
        track.song_index,
        includeVectors ? JSON.stringify(track.vector) : null,
        track.e,
        track.m,
        track.c,
        track.p ?? null,
        track.likes,
        track.dislikes,
        track.skips,
        track.plays,
        track.decayed_likes,
        track.decayed_dislikes,
        track.decayed_skips,
        track.decayed_plays,
        track.last_played ?? null,
        track.classified_at ?? null,
        track.source ?? null,
        track.render_engine ?? null,
        FEATURE_SCHEMA_VERSION,
        profile === "full" ? (track.features_json ?? null) : null,
      );
    }

    neighborRowCount = insertNeighbors(database, profile, tracks, neighborCount);

    const classifiedChecksum = await computeDirectoryChecksum(options.classifiedPath);
    const feedbackChecksum = await computeDirectoryChecksum(options.feedbackPath);
    const placeholderManifest: SimilarityExportManifest = {
      schema_version: SIMILARITY_EXPORT_SCHEMA_VERSION,
      export_profile: profile,
      generated_at: new Date().toISOString(),
      corpus_version: options.corpusVersion ?? "custom",
      feature_schema_version: FEATURE_SCHEMA_VERSION,
      vector_dimensions: dims,
      include_vectors: includeVectors,
      neighbor_count_per_track: neighborCount,
      track_count: tracks.length,
      neighbor_row_count: neighborRowCount,
      paths: {
        sqlite: options.outputPath,
        manifest: manifestPath,
      },
      source_checksums: {
        classified: classifiedChecksum,
        feedback: feedbackChecksum,
      },
      file_checksums: {
        sqlite_sha256: "pending",
      },
      tables: ["meta", "tracks", "neighbors"],
    };

    const insertMeta = database.query("INSERT INTO meta (key, value) VALUES (?, ?)");
    insertMeta.run("schema_version", SIMILARITY_EXPORT_SCHEMA_VERSION);
    insertMeta.run("manifest_json", JSON.stringify(placeholderManifest));
  } finally {
    database.close();
  }

  const sqliteChecksum = await computeFileChecksum(temporaryOutputPath);
  const manifest: SimilarityExportManifest = {
    schema_version: SIMILARITY_EXPORT_SCHEMA_VERSION,
    export_profile: profile,
    generated_at: new Date().toISOString(),
    corpus_version: options.corpusVersion ?? "custom",
    feature_schema_version: FEATURE_SCHEMA_VERSION,
    vector_dimensions: dims,
    include_vectors: includeVectors,
    neighbor_count_per_track: neighborCount,
    track_count: tracks.length,
    neighbor_row_count: neighborCount > 0 ? tracks.length * neighborCount : 0,
    paths: {
      sqlite: options.outputPath,
      manifest: manifestPath,
    },
    source_checksums: {
      classified: await computeDirectoryChecksum(options.classifiedPath),
      feedback: await computeDirectoryChecksum(options.feedbackPath),
    },
    file_checksums: {
      sqlite_sha256: sqliteChecksum,
    },
    tables: ["meta", "tracks", "neighbors"],
  };

  const writerDatabase = new Database(temporaryOutputPath, { create: true });
  try {
    writerDatabase.query("UPDATE meta SET value = ? WHERE key = ?").run(JSON.stringify(manifest), "manifest_json");
  } finally {
    writerDatabase.close();
  }

  await rm(options.outputPath, { force: true });
  await rename(temporaryOutputPath, options.outputPath);

  await writeCanonicalJsonFile(manifestPath, manifest as unknown as import("./json.js").JsonValue, {
    details: {
      kind: "similarity-export-manifest",
      trackCount: manifest.track_count,
      neighborRowCount: manifest.neighbor_row_count,
      sqliteSha256: manifest.file_checksums.sqlite_sha256,
    },
  });

  return {
    outputPath: options.outputPath,
    manifestPath,
    manifest,
    durationMs: Date.now() - startedAt,
  };
}

export async function readSimilarityExportManifest(manifestPath: string): Promise<SimilarityExportManifest> {
  const contents = await readFile(manifestPath, "utf8");
  return JSON.parse(contents) as SimilarityExportManifest;
}

export function readSimilarityExportManifestFromDatabase(dbPath: string): SimilarityExportManifest {
  const database = openReadonlyDatabase(dbPath);
  try {
    const row = database.query("SELECT value FROM meta WHERE key = ?").get("manifest_json") as { value: string } | null;
    if (!row) {
      throw new Error(`Similarity export manifest missing from ${dbPath}`);
    }
    return JSON.parse(row.value) as SimilarityExportManifest;
  } finally {
    database.close();
  }
}

export function recommendFromSeedTrack(
  dbPath: string,
  options: RecommendFromSeedTrackOptions,
): SimilarityExportRecommendation[] {
  const database = openReadonlyDatabase(dbPath);
  try {
    const limit = options.limit ?? 20;
    const profile = options.profile ?? "full";
    const excluded = new Set([options.seedTrackId, ...(options.excludeTrackIds ?? [])]);
    const columnSupport = getTrackColumnSupport(database);

    const rows = columnSupport.hasTrackId
      ? database.query(
        `SELECT ${buildTrackSelectList(columnSupport, "t")}, n.similarity, n.rank
         FROM neighbors n
         JOIN tracks t ON t.track_id = n.neighbor_track_id
         WHERE n.profile = ? AND n.seed_track_id = ?
         ORDER BY n.rank ASC
         LIMIT ?`,
      ).all(profile, options.seedTrackId, limit + excluded.size) as Array<PersistedTrackRow & { similarity: number; rank: number }>
      : [];

    if (rows.length > 0) {
      return rows
        .filter((row) => !excluded.has(row.track_id))
        .slice(0, limit)
        .map((row, index) => trackRowToRecommendation(row, row.similarity, index + 1));
    }

    const seedIdentity = buildTrackIdentityWhereClause(columnSupport, [options.seedTrackId]);
    const seed = database
      .query(`SELECT vector_json FROM tracks WHERE ${seedIdentity.clause}`)
      .get(...seedIdentity.params) as { vector_json: string | null } | null;
    if (!seed?.vector_json) {
      throw new Error(`Seed track ${options.seedTrackId} missing vector data in similarity export`);
    }
    const seedVector = JSON.parse(seed.vector_json) as number[];
    const candidates = database.query(
      `SELECT ${buildTrackSelectList(columnSupport)} FROM tracks`,
    ).all() as PersistedTrackRow[];

    return candidates
      .filter((row) => row.vector_json && !excluded.has(row.track_id))
      .map((row) => ({ row, score: cosineSimilarity(seedVector, JSON.parse(row.vector_json as string) as number[]) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry, index) => trackRowToRecommendation(entry.row, entry.score, index + 1));
  } finally {
    database.close();
  }
}

export function recommendFromFavorites(
  dbPath: string,
  options: RecommendFromFavoritesOptions,
): SimilarityExportRecommendation[] {
  if (options.favoriteTrackIds.length === 0) {
    return [];
  }

  const database = openReadonlyDatabase(dbPath);
  try {
    const limit = options.limit ?? 20;
    const excluded = new Set([...options.favoriteTrackIds, ...(options.excludeTrackIds ?? [])]);
    const columnSupport = getTrackColumnSupport(database);
    const favoriteIdentity = buildTrackIdentityWhereClause(columnSupport, options.favoriteTrackIds);
    const favoriteRows = database.query(
      `SELECT ${buildTrackSelectList(columnSupport)}
       FROM tracks
       WHERE ${favoriteIdentity.clause}`,
    ).all(...favoriteIdentity.params) as PersistedTrackRow[];

    if (favoriteRows.length === 0) {
      throw new Error("None of the favorite track IDs were found in the similarity export");
    }

    const vectors = favoriteRows.map((row) => {
      if (!row.vector_json) {
        throw new Error("Favorite-based recommendation requires vector data in the similarity export");
      }
      return JSON.parse(row.vector_json) as number[];
    });
    const weights = favoriteRows.map((row) => options.weightsByTrackId?.[row.track_id] ?? 1);
    const centroid = buildCentroid(vectors, weights);
    const candidates = database.query(
      `SELECT ${buildTrackSelectList(columnSupport)} FROM tracks`,
    ).all() as PersistedTrackRow[];

    return candidates
      .filter((row) => row.vector_json && !excluded.has(row.track_id))
      .map((row) => ({ row, score: cosineSimilarity(centroid, JSON.parse(row.vector_json as string) as number[]) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry, index) => trackRowToRecommendation(entry.row, entry.score, index + 1));
  } finally {
    database.close();
  }
}

export function openSqliteSimilarityDataset(dbPath: string): SimilarityDataset {
  const database = openReadonlyDatabase(dbPath);
  try {
    const trackCountRow = database.query("SELECT COUNT(*) AS count FROM tracks").get() as { count: number };
    const vectorCountRow = database
      .query("SELECT COUNT(*) AS count FROM tracks WHERE vector_json IS NOT NULL AND vector_json != ''")
      .get() as { count: number };

    return {
      info: {
        format: "sqlite",
        schemaVersion: SIMILARITY_EXPORT_SCHEMA_VERSION,
        sourcePath: dbPath,
        trackCount: trackCountRow.count,
        hasTrackIdentity: true,
        hasVectorData: vectorCountRow.count > 0,
      },
      readRandomTracksExcluding(limit, excludedTrackIds, random) {
        const readonlyDatabase = openReadonlyDatabase(dbPath);
        try {
          const columnSupport = getTrackColumnSupport(readonlyDatabase);
          const rows = readonlyDatabase
            .query(`SELECT ${buildTrackSelectList(columnSupport)} FROM tracks ORDER BY sid_path ASC, song_index ASC`)
            .all() as PersistedTrackRow[];
          return pickRandomRows(rows, limit, excludedTrackIds, random).map((row) => persistedTrackRowToSimilarityRow(row));
        } finally {
          readonlyDatabase.close();
        }
      },
      resolveTracks(trackIds) {
        if (trackIds.length === 0) {
          return new Map();
        }

        const readonlyDatabase = openReadonlyDatabase(dbPath);
        try {
          const columnSupport = getTrackColumnSupport(readonlyDatabase);
          const identity = buildTrackIdentityWhereClause(columnSupport, trackIds);
          const rows = readonlyDatabase
            .query(`SELECT ${buildTrackSelectList(columnSupport)} FROM tracks WHERE ${identity.clause}`)
            .all(...identity.params) as PersistedTrackRow[];
          return new Map(rows.map((row) => [row.track_id, persistedTrackRowToSimilarityRow(row)]));
        } finally {
          readonlyDatabase.close();
        }
      },
      resolveTrack(trackId) {
        const rows = this.resolveTracks([trackId]);
        return rows.get(trackId) ?? null;
      },
      getTrackVectors(trackIds) {
        if (trackIds.length === 0) {
          return new Map();
        }

        const readonlyDatabase = openReadonlyDatabase(dbPath);
        try {
          const columnSupport = getTrackColumnSupport(readonlyDatabase);
          const identity = buildTrackIdentityWhereClause(columnSupport, trackIds);
          const rows = readonlyDatabase
            .query(`SELECT ${buildTrackIdExpression(columnSupport)} AS track_id, vector_json FROM tracks WHERE ${identity.clause}`)
            .all(...identity.params) as Array<{ track_id: string; vector_json: string | null }>;

          return new Map(rows.flatMap((row) => row.vector_json ? [[row.track_id, JSON.parse(row.vector_json) as number[]]] : []));
        } finally {
          readonlyDatabase.close();
        }
      },
      getNeighbors(trackId, limit = 20, excludeTrackIds = []) {
        return recommendFromSeedTrack(dbPath, {
          seedTrackId: trackId,
          limit,
          excludeTrackIds: [...excludeTrackIds],
        });
      },
      getStyleMask(trackId) {
        const row = this.resolveTrack(trackId);
        return row ? computeSimilarityStyleMask(row) : null;
      },
      recommendFromFavorites(options) {
        return recommendFromFavorites(dbPath, options);
      },
    };
  } finally {
    database.close();
  }
}