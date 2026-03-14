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

export const SIMILARITY_EXPORT_SCHEMA_VERSION = "sidcorr-1";

export type SimilarityExportProfile = "full" | "mobile";

export interface SimilarityExportTrack {
  sid_path: string;
  vector: number[];
  e: number;
  m: number;
  c: number;
  p?: number;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
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
  dims?: 3 | 4;
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
  sid_path: string;
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
  last_played?: string;
}

export interface RecommendFromSeedTrackOptions {
  seedSidPath: string;
  limit?: number;
  profile?: SimilarityExportProfile;
  excludeSidPaths?: string[];
}

export interface RecommendFromFavoritesOptions {
  favoriteSidPaths: string[];
  limit?: number;
  excludeSidPaths?: string[];
  weightsBySidPath?: Record<string, number>;
}

interface FeedbackAggregate {
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  lastPlayed?: string;
}

interface PersistedTrackRow {
  sid_path: string;
  vector_json: string | null;
  e: number;
  m: number;
  c: number;
  p: number | null;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  last_played: string | null;
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

function aggregateFeedback(events: FeedbackRecord[]): Map<string, FeedbackAggregate> {
  const aggregates = new Map<string, FeedbackAggregate>();
  for (const event of events) {
    const aggregate = aggregates.get(event.sid_path) ?? {
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
    };
    switch (event.action) {
      case "like":
        aggregate.likes += 1;
        break;
      case "dislike":
        aggregate.dislikes += 1;
        break;
      case "skip":
        aggregate.skips += 1;
        break;
      case "play":
        aggregate.plays += 1;
        break;
    }
    if ((event.action === "play" || event.action === "like") && (!aggregate.lastPlayed || event.ts > aggregate.lastPlayed)) {
      aggregate.lastPlayed = event.ts;
    }
    aggregates.set(event.sid_path, aggregate);
  }
  return aggregates;
}

function classificationToTrack(
  classification: ClassificationRecord,
  feedback: FeedbackAggregate | undefined,
  dims: 3 | 4,
): SimilarityExportTrack {
  const { e, m, c, p } = classification.ratings;
  const vector = dims === 3
    ? [e, m, c]
    : [e, m, c, p ?? DEFAULT_RATING];
  return {
    sid_path: classification.sid_path,
    vector,
    e,
    m,
    c,
    p,
    likes: feedback?.likes ?? 0,
    dislikes: feedback?.dislikes ?? 0,
    skips: feedback?.skips ?? 0,
    plays: feedback?.plays ?? 0,
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
    const existing = deduped.get(classification.sid_path);
    if (!existing) {
      deduped.set(classification.sid_path, classification);
      continue;
    }

    const existingTimestamp = existing.classified_at ?? "";
    const nextTimestamp = classification.classified_at ?? "";
    if (nextTimestamp >= existingTimestamp) {
      deduped.set(classification.sid_path, classification);
    }
  }

  return Array.from(deduped.values());
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Vector dimensions must match");
  }

  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildCentroid(vectors: number[][], weights?: number[]): number[] {
  if (vectors.length === 0) {
    throw new Error("At least one vector is required");
  }

  const centroid = new Array(vectors[0].length).fill(0);
  let totalWeight = 0;
  for (let index = 0; index < vectors.length; index += 1) {
    const weight = weights?.[index] ?? 1;
    totalWeight += weight;
    for (let dimension = 0; dimension < vectors[index].length; dimension += 1) {
      centroid[dimension] += vectors[index][dimension] * weight;
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
    "INSERT INTO neighbors (profile, seed_sid_path, neighbor_sid_path, rank, similarity) VALUES (?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  for (const seedTrack of tracks) {
    const ranked = tracks
      .filter((candidate) => candidate.sid_path !== seedTrack.sid_path)
      .map((candidate) => ({
        sid_path: candidate.sid_path,
        similarity: cosineSimilarity(seedTrack.vector, candidate.vector),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, neighborCount);

    ranked.forEach((neighbor, index) => {
      insert.run(profile, seedTrack.sid_path, neighbor.sid_path, index + 1, Number(neighbor.similarity.toFixed(8)));
      inserted += 1;
    });
  }
  return inserted;
}

function trackRowToRecommendation(row: PersistedTrackRow, score: number, rank: number): SimilarityExportRecommendation {
  return {
    sid_path: row.sid_path,
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
    last_played: row.last_played ?? undefined,
  };
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
  const dims = options.dims ?? 4;
  const includeVectors = options.includeVectors ?? true;
  const neighborCount = Math.max(0, options.neighbors ?? 0);
  const manifestPath = options.manifestPath ?? computeDefaultManifestPath(options.outputPath);

  const [classifications, feedbackEvents] = await Promise.all([
    readClassificationsForExport(options.classifiedPath),
    readJsonlFiles<FeedbackRecord>(options.feedbackPath),
  ]);

  const dedupedClassifications = dedupeClassifications(classifications);
  const feedbackBySidPath = aggregateFeedback(feedbackEvents);
  const tracks = dedupedClassifications
    .filter((classification) => hasValidRatings(classification))
    .map((classification) => classificationToTrack(classification, feedbackBySidPath.get(classification.sid_path), dims))
    .sort((left, right) => left.sid_path.localeCompare(right.sid_path));

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
      );
      CREATE TABLE tracks (
        sid_path TEXT PRIMARY KEY,
        vector_json TEXT,
        e REAL NOT NULL,
        m REAL NOT NULL,
        c REAL NOT NULL,
        p REAL,
        likes INTEGER NOT NULL,
        dislikes INTEGER NOT NULL,
        skips INTEGER NOT NULL,
        plays INTEGER NOT NULL,
        last_played TEXT,
        classified_at TEXT,
        source TEXT,
        render_engine TEXT,
        feature_schema_version TEXT,
        features_json TEXT
      );
      CREATE TABLE neighbors (
        profile TEXT NOT NULL,
        seed_sid_path TEXT NOT NULL,
        neighbor_sid_path TEXT NOT NULL,
        rank INTEGER NOT NULL,
        similarity REAL NOT NULL,
        PRIMARY KEY (profile, seed_sid_path, rank)
      );
      CREATE INDEX neighbors_seed_idx ON neighbors (profile, seed_sid_path, rank);
    `);

    const insertTrack = database.query(
      `INSERT INTO tracks (
        sid_path,
        vector_json,
        e,
        m,
        c,
        p,
        likes,
        dislikes,
        skips,
        plays,
        last_played,
        classified_at,
        source,
        render_engine,
        feature_schema_version,
        features_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const track of tracks) {
      insertTrack.run(
        track.sid_path,
        includeVectors ? JSON.stringify(track.vector) : null,
        track.e,
        track.m,
        track.c,
        track.p ?? null,
        track.likes,
        track.dislikes,
        track.skips,
        track.plays,
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
    const excluded = new Set([options.seedSidPath, ...(options.excludeSidPaths ?? [])]);

    const rows = database.query(
      `SELECT t.sid_path, t.e, t.m, t.c, t.p, t.likes, t.dislikes, t.skips, t.plays, t.last_played, n.similarity, n.rank
       FROM neighbors n
       JOIN tracks t ON t.sid_path = n.neighbor_sid_path
       WHERE n.profile = ? AND n.seed_sid_path = ?
       ORDER BY n.rank ASC
       LIMIT ?`,
    ).all(profile, options.seedSidPath, limit + excluded.size) as Array<PersistedTrackRow & { similarity: number; rank: number }>;

    if (rows.length > 0) {
      return rows
        .filter((row) => !excluded.has(row.sid_path))
        .slice(0, limit)
        .map((row, index) => trackRowToRecommendation(row, row.similarity, index + 1));
    }

    const seed = database.query("SELECT vector_json FROM tracks WHERE sid_path = ?").get(options.seedSidPath) as { vector_json: string | null } | null;
    if (!seed?.vector_json) {
      throw new Error(`Seed track ${options.seedSidPath} missing vector data in similarity export`);
    }
    const seedVector = JSON.parse(seed.vector_json) as number[];
    const candidates = database.query(
      "SELECT sid_path, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played FROM tracks",
    ).all() as PersistedTrackRow[];

    return candidates
      .filter((row) => row.vector_json && !excluded.has(row.sid_path))
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
  if (options.favoriteSidPaths.length === 0) {
    return [];
  }

  const database = openReadonlyDatabase(dbPath);
  try {
    const limit = options.limit ?? 20;
    const excluded = new Set([...options.favoriteSidPaths, ...(options.excludeSidPaths ?? [])]);
    const favoriteRows = database.query(
      `SELECT sid_path, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played
       FROM tracks
       WHERE sid_path IN (${options.favoriteSidPaths.map(() => "?").join(", ")})`,
    ).all(...options.favoriteSidPaths) as PersistedTrackRow[];

    if (favoriteRows.length === 0) {
      throw new Error("None of the favorite SID paths were found in the similarity export");
    }

    const vectors = favoriteRows.map((row) => {
      if (!row.vector_json) {
        throw new Error("Favorite-based recommendation requires vector data in the similarity export");
      }
      return JSON.parse(row.vector_json) as number[];
    });
    const weights = favoriteRows.map((row) => options.weightsBySidPath?.[row.sid_path] ?? 1);
    const centroid = buildCentroid(vectors, weights);
    const candidates = database.query(
      "SELECT sid_path, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played FROM tracks",
    ).all() as PersistedTrackRow[];

    return candidates
      .filter((row) => row.vector_json && !excluded.has(row.sid_path))
      .map((row) => ({ row, score: cosineSimilarity(centroid, JSON.parse(row.vector_json as string) as number[]) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry, index) => trackRowToRecommendation(entry.row, entry.score, index + 1));
  } finally {
    database.close();
  }
}