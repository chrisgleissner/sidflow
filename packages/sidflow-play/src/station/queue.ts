import path from "node:path";
import { Database } from "bun:sqlite";
import {
  cosineSimilarity,
  openLiteSimilarityDataset,
  openTinySimilarityDataset,
  pathExists,
  recommendFromFavorites as recommendFromFavoritesFromSqlite,
  type SidFileMetadata,
  type PortableSimilarityDataset,
  type SimilarityExportRecommendation,
} from "@sidflow/common";
import type {
  ExportDatabaseInfo,
  MetadataResolver,
  ResolvedStationSimilarityFormat,
  StationTrackDetails,
  StationTrackRow,
  StationTrackVectorRow,
  StationRuntime,
} from "./types.js";
import { extractYear, isTrackLongEnough, resolveTrackDurationMs } from "./formatting.js";
import { buildIntentModel, interleaveClusterResults, type IntentModel } from "./intent.js";

const DEFAULT_MIN_SIMILARITY = 0.75;
const COLD_START_MIN_SIMILARITY = 0.82;
const MAX_RATING_DEVIATION = 1.5;

/** C3: Minimum similarity floor (hard), regardless of adventure setting. */
const ADVENTURE_HARD_FLOOR = 0.50;
/** C3: Base minimum similarity at adventure=0. */
const ADVENTURE_BASE_SIM = 0.82;
/** C3: How much each adventure unit relaxes the threshold. */
const ADVENTURE_STEP = 0.03;
/** C3: Fraction of station slots filled from top-similarity candidates (exploitation). */
const EXPLOIT_FRACTION = 0.70;
/** C3: Width of the exploration band above min_sim. */
const EXPLORE_BAND_WIDTH = 0.10;

/**
 * C3: Compute the adventure-adjusted minimum similarity threshold.
 * min_sim = max(ADVENTURE_HARD_FLOOR, ADVENTURE_BASE_SIM - adventure * ADVENTURE_STEP)
 */
export function computeAdventureMinSimilarity(adventure: number): number {
  return Math.max(ADVENTURE_HARD_FLOOR, ADVENTURE_BASE_SIM - adventure * ADVENTURE_STEP);
}

export function buildStationSongKey(track: Pick<StationTrackRow, "sid_path" | "song_index">): string {
  return `${track.sid_path}#${track.song_index}`;
}

function dedupeQueueBySongKey<T extends Pick<StationTrackRow, "sid_path" | "song_index">>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const track of tracks) {
    const key = buildStationSongKey(track);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(track);
  }
  return deduped;
}

function openReadonlyDatabase(dbPath: string): Database {
  return new Database(dbPath, { readonly: true, strict: true });
}

export type StationSimilarityDatasetHandle =
  | { format: "sqlite"; dbPath: string }
  | { format: "lite" | "tiny"; dbPath: string; dataset: PortableSimilarityDataset };

type StationSimilarityDatasetInput = StationSimilarityDatasetHandle | string;

function normalizeDatasetHandle(input: StationSimilarityDatasetInput): StationSimilarityDatasetHandle {
  return typeof input === "string" ? { format: "sqlite", dbPath: input } : input;
}

function isPortableHandle(handle: StationSimilarityDatasetHandle): handle is Extract<StationSimilarityDatasetHandle, { dataset: PortableSimilarityDataset }> {
  return "dataset" in handle;
}

export async function openStationSimilarityDataset(
  dbPath: string,
  format: ResolvedStationSimilarityFormat,
  hvscRoot: string,
): Promise<StationSimilarityDatasetHandle> {
  if (format === "sqlite") {
    return { format, dbPath };
  }
  if (format === "lite") {
    return { format, dbPath, dataset: await openLiteSimilarityDataset(dbPath) };
  }
  return { format, dbPath, dataset: await openTinySimilarityDataset(dbPath, { hvscRoot }) };
}

export function inspectExportDatabase(datasetHandle: StationSimilarityDatasetInput): ExportDatabaseInfo {
  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  if (isPortableHandle(resolvedHandle)) {
    return {
      trackCount: resolvedHandle.dataset.info.trackCount,
      hasTrackIdentity: true,
      hasVectorData: resolvedHandle.dataset.info.hasVectorData,
    };
  }
  const dbPath = resolvedHandle.dbPath;
  const database = openReadonlyDatabase(dbPath);
  try {
    const columns = database.query("PRAGMA table_info(tracks)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const trackCountRow = database.query("SELECT COUNT(*) AS count FROM tracks").get() as { count: number };
    const vectorCountRow = database
      .query("SELECT COUNT(*) AS count FROM tracks WHERE vector_json IS NOT NULL AND vector_json != ''")
      .get() as { count: number };

    return {
      trackCount: trackCountRow.count,
      hasTrackIdentity: columnNames.has("track_id") && columnNames.has("song_index"),
      hasVectorData: vectorCountRow.count > 0,
    };
  } finally {
    database.close();
  }
}

export function readRandomTracksExcluding(
  datasetHandle: StationSimilarityDatasetInput,
  limit: number,
  excludedTrackIds: Iterable<string>,
): StationTrackRow[] {
  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  if (isPortableHandle(resolvedHandle)) {
    return resolvedHandle.dataset.readRandomTracksExcluding(limit, excludedTrackIds) as StationTrackRow[];
  }
  const dbPath = resolvedHandle.dbPath;
  const excluded = [...excludedTrackIds];
  const database = openReadonlyDatabase(dbPath);
  try {
    if (excluded.length === 0) {
      return database
        .query(
          `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
           FROM tracks
           ORDER BY RANDOM()
           LIMIT ?`,
        )
        .all(limit) as StationTrackRow[];
    }

    const placeholders = excluded.map(() => "?").join(", ");
    return database
      .query(
        `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
         FROM tracks
         WHERE track_id NOT IN (${placeholders})
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(...excluded, limit) as StationTrackRow[];
  } finally {
    database.close();
  }
}

export function readTrackRowsByIds(datasetHandle: StationSimilarityDatasetInput, trackIds: string[]): Map<string, StationTrackRow> {
  if (trackIds.length === 0) {
    return new Map();
  }

  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  if (isPortableHandle(resolvedHandle)) {
    return resolvedHandle.dataset.readTrackRowsByIds(trackIds) as Map<string, StationTrackRow>;
  }

  const dbPath = resolvedHandle.dbPath;
  const database = openReadonlyDatabase(dbPath);
  try {
    const placeholders = trackIds.map(() => "?").join(", ");
    const rows = database
      .query(
        `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
         FROM tracks
         WHERE track_id IN (${placeholders})`,
      )
      .all(...trackIds) as StationTrackRow[];
    return new Map(rows.map((row) => [row.track_id, row]));
  } finally {
    database.close();
  }
}

function readTrackRowById(datasetHandle: StationSimilarityDatasetInput, trackId: string): StationTrackRow | null {
  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  if (isPortableHandle(resolvedHandle)) {
    return resolvedHandle.dataset.readTrackRowById(trackId) as StationTrackRow | null;
  }
  const dbPath = resolvedHandle.dbPath;
  const database = openReadonlyDatabase(dbPath);
  try {
    return (
      (database
        .query(
          `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
           FROM tracks
           WHERE track_id = ?`,
        )
        .get(trackId) as StationTrackRow | null) ?? null
    );
  } finally {
    database.close();
  }
}

function readTrackVectorsByIds(datasetHandle: StationSimilarityDatasetInput, trackIds: string[]): Map<string, number[]> {
  if (trackIds.length === 0) {
    return new Map();
  }

  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  if (isPortableHandle(resolvedHandle)) {
    return resolvedHandle.dataset.readTrackVectorsByIds(trackIds);
  }

  const dbPath = resolvedHandle.dbPath;
  const database = openReadonlyDatabase(dbPath);
  try {
    const placeholders = trackIds.map(() => "?").join(", ");
    const rows = database
      .query(
        `SELECT track_id, vector_json
         FROM tracks
         WHERE track_id IN (${placeholders})`,
      )
      .all(...trackIds) as StationTrackVectorRow[];

    const result = new Map<string, number[]>();
    for (const row of rows) {
      if (!row.vector_json) {
        continue;
      }
      result.set(row.track_id, JSON.parse(row.vector_json) as number[]);
    }
    return result;
  } finally {
    database.close();
  }
}

export function buildWeightsByTrackId(ratings: Map<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [trackId, rating] of ratings) {
    if (rating >= 5) {
      result[trackId] = 3;
      continue;
    }
    if (rating >= 4) {
      result[trackId] = 2;
      continue;
    }
    if (rating >= 3) {
      result[trackId] = 1;
      continue;
    }
    if (rating >= 2) {
      result[trackId] = 0.3;
      continue;
    }
    result[trackId] = 0.1;
  }
  return result;
}

function resolveMinimumSimilarity(ratings: Map<string, number>, adventure?: number): number {
  // C3: If adventure is given, use radius-expansion formula
  if (adventure !== undefined) {
    return computeAdventureMinSimilarity(adventure);
  }
  // Phase A fallback: cold-start vs default
  return ratings.size < 10 ? COLD_START_MIN_SIMILARITY : DEFAULT_MIN_SIMILARITY;
}

function buildWeightedRatingCentroid(rows: StationTrackRow[], weightsByTrackId: Record<string, number>): Pick<StationTrackRow, "e" | "m" | "c"> | null {
  if (rows.length === 0) {
    return null;
  }

  let totalWeight = 0;
  let energy = 0;
  let mood = 0;
  let complexity = 0;
  for (const row of rows) {
    const weight = weightsByTrackId[row.track_id] ?? 1;
    totalWeight += weight;
    energy += row.e * weight;
    mood += row.m * weight;
    complexity += row.c * weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return {
    e: energy / totalWeight,
    m: mood / totalWeight,
    c: complexity / totalWeight,
  };
}

function passesDeviationFilter(
  candidate: Pick<StationTrackRow, "e" | "m" | "c">,
  centroid: Pick<StationTrackRow, "e" | "m" | "c"> | null,
): boolean {
  if (!centroid) {
    return true;
  }

  return Math.abs(candidate.e - centroid.e) <= MAX_RATING_DEVIATION
    && Math.abs(candidate.m - centroid.m) <= MAX_RATING_DEVIATION
    && Math.abs(candidate.c - centroid.c) <= MAX_RATING_DEVIATION;
}

function pickFavoriteTrackIds(ratings: Map<string, number>): string[] {
  const ordered = [...ratings.entries()].sort((left, right) => right[1] - left[1]);
  const loved = ordered.filter(([, rating]) => rating >= 4).map(([trackId]) => trackId);
  if (loved.length > 0) {
    return loved;
  }
  const liked = ordered.filter(([, rating]) => rating >= 3).map(([trackId]) => trackId);
  if (liked.length > 0) {
    return liked;
  }
  const fallback = ordered.find(([, rating]) => rating > 0);
  return fallback ? [fallback[0]] : [];
}

export function deriveStationBucketKey(sidPath: string): string {
  const segments = sidPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return sidPath;
  }

  const first = segments[0]!;
  const second = segments[1];
  if (["DEMOS", "GAMES", "MUSICIANS"].includes(first.toUpperCase()) && second) {
    return `${first}/${second}`;
  }
  return first;
}

export function chooseStationTracks(
  recommendations: SimilarityExportRecommendation[],
  stationSize: number,
  adventure: number,
  random: () => number,
): SimilarityExportRecommendation[] {
  if (recommendations.length <= stationSize) {
    return recommendations;
  }

  // C3: Adventure radius expansion — split into exploit (top 70%) and explore (boundary band 30%)
  const minSim = computeAdventureMinSimilarity(adventure);
  const exploitCount = Math.max(1, Math.round(stationSize * EXPLOIT_FRACTION));
  const exploreCount = stationSize - exploitCount;

  const sorted = [...recommendations].sort((left, right) => right.score - left.score || left.rank - right.rank);

  // Exploitation pool: all candidates above min_sim + explore_band_width (top similarity)
  const exploitPool = sorted.filter((r) => r.score > minSim + EXPLORE_BAND_WIDTH);
  // Exploration band: candidates between [min_sim, min_sim + explore_band_width]
  const explorePool = sorted.filter((r) => r.score >= minSim && r.score <= minSim + EXPLORE_BAND_WIDTH);

  // If exploit pool is too small, fold all candidates into it
  const useExploitExplore = exploitPool.length >= exploitCount && explorePool.length > 0;

  const chosen: SimilarityExportRecommendation[] = [];
  const used = new Set<string>();
  const bucketCounts = new Map<string, number>();

  function pickFromPoolBucketDiversified(pool: SimilarityExportRecommendation[], targetCount: number, weighted: boolean): void {
    const candidatesByBucket = new Map<string, SimilarityExportRecommendation[]>();
    for (const rec of pool) {
      if (used.has(rec.track_id)) continue;
      const key = deriveStationBucketKey(rec.sid_path);
      const arr = candidatesByBucket.get(key) ?? [];
      arr.push(rec);
      candidatesByBucket.set(key, arr);
    }

    const bestScore = pool[0]?.score ?? 0;
    const worstScore = pool[pool.length - 1]?.score ?? bestScore;

    for (let index = 0; index < targetCount; index++) {
      const bucketEntries = [...candidatesByBucket.entries()].filter(([, cands]) => cands.some((e) => !used.has(e.track_id)));
      if (bucketEntries.length === 0) break;

      const minBucketCount = Math.min(...bucketEntries.map(([key]) => bucketCounts.get(key) ?? 0));
      const eligibleBuckets = bucketEntries.filter(([key]) => (bucketCounts.get(key) ?? 0) === minBucketCount);

      const weightedBuckets = eligibleBuckets.map(([key, cands]) => {
        const next = cands.find((e) => !used.has(e.track_id));
        let w: number;
        if (!weighted || !next || bestScore === worstScore) {
          w = 1;
        } else {
          const norm = Math.max(0, Math.min(1, (next.score - worstScore) / (bestScore - worstScore)));
          w = Math.max(0.0001, Math.pow(0.05 + norm * 0.95, 2));
        }
        return { key, cands, w };
      });

      const totalW = weightedBuckets.reduce((s, b) => s + b.w, 0);
      let cursor = random() * totalW;
      let selBucket = weightedBuckets[weightedBuckets.length - 1]!;
      for (const b of weightedBuckets) {
        cursor -= b.w;
        if (cursor <= 0) { selBucket = b; break; }
      }

      const available = selBucket.cands.filter((e) => !used.has(e.track_id));
      if (available.length === 0) continue;

      // In explore band: uniform random pick; in exploit: score-weighted pick
      let pick: SimilarityExportRecommendation;
      if (!weighted) {
        pick = available[Math.floor(random() * available.length)]!;
      } else {
        const totalScore = available.reduce((s, e) => s + Math.max(0.0001, e.score), 0);
        let sc = random() * totalScore;
        pick = available[available.length - 1]!;
        for (const e of available) {
          sc -= Math.max(0.0001, e.score);
          if (sc <= 0) { pick = e; break; }
        }
      }

      chosen.push(pick);
      used.add(pick.track_id);
      bucketCounts.set(selBucket.key, (bucketCounts.get(selBucket.key) ?? 0) + 1);
    }
  }

  if (useExploitExplore) {
    pickFromPoolBucketDiversified(exploitPool, exploitCount, true);
    pickFromPoolBucketDiversified(explorePool, exploreCount, false);
  } else {
    // Fallback: prefer tracks at or above minSim; only widen to the full
    // sorted list when we cannot fill stationSize from the qualified pool.
    const filteredFallback = sorted.filter((r) => r.score >= minSim);
    const pool = filteredFallback.length >= stationSize ? filteredFallback : sorted;
    pickFromPoolBucketDiversified(pool, stationSize, true);
  }

  return chosen;
}

export function orderStationTracksByFlow(
  recommendations: SimilarityExportRecommendation[],
  vectorsByTrackId: Map<string, number[]>,
  adventure: number,
  random: () => number,
): SimilarityExportRecommendation[] {
  if (recommendations.length <= 2) {
    return [...recommendations];
  }

  const originalOrder = new Map(recommendations.map((recommendation, index) => [recommendation.track_id, index]));
  const remaining = [...recommendations].sort(
    (left, right) => right.score - left.score || (originalOrder.get(left.track_id)! - originalOrder.get(right.track_id)!),
  );
  const ordered = [remaining.shift()!];
  const shortlistSize = Math.max(1, Math.min(remaining.length, 1 + Math.floor(adventure / 2)));

  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1]!;
    const previousVector = vectorsByTrackId.get(previous.track_id);
    const scored = remaining
      .map((candidate) => {
        const candidateVector = vectorsByTrackId.get(candidate.track_id);
        const continuity = previousVector && candidateVector
          ? cosineSimilarity(previousVector, candidateVector)
          : candidate.score;
        const blended = (continuity * 0.72) + (candidate.score * 0.28);
        return { blended, candidate };
      })
      .sort(
        (left, right) => right.blended - left.blended
          || right.candidate.score - left.candidate.score
          || (originalOrder.get(left.candidate.track_id)! - originalOrder.get(right.candidate.track_id)!),
      );

    const picked = scored[Math.min(scored.length - 1, Math.floor(random() * Math.min(scored.length, shortlistSize)))]!.candidate;
    ordered.push(picked);
    remaining.splice(remaining.findIndex((entry) => entry.track_id === picked.track_id), 1);
  }

  return ordered;
}

export function summarizeRatingAnchors(ratings: Map<string, number>): { excluded: number; positive: number; strong: number } {
  let excluded = 0;
  let positive = 0;
  let strong = 0;
  for (const rating of ratings.values()) {
    if (rating <= 2) {
      excluded += 1;
    }
    if (rating >= 3) {
      positive += 1;
    }
    if (rating >= 4) {
      strong += 1;
    }
  }
  return { excluded, positive, strong };
}

async function resolvePlayableSidPath(hvscRoot: string, sidPath: string): Promise<string> {
  const candidates = [
    path.resolve(hvscRoot, sidPath),
    path.resolve(hvscRoot, "C64Music", sidPath),
    path.resolve(hvscRoot, "update", sidPath),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`SID file not found under ${hvscRoot}: ${sidPath}`);
}

export async function resolveTrackDetails(
  track: StationTrackRow,
  hvscRoot: string,
  runtime: MetadataResolver,
  cache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails> {
  const absolutePath = await resolvePlayableSidPath(hvscRoot, track.sid_path);

  if (!cache.has(track.sid_path)) {
    cache.set(
      track.sid_path,
      (async () => {
        try {
          const metadata = await runtime.parseSidFile(absolutePath);
          const durationMs = await runtime.lookupSongDurationMs(absolutePath, hvscRoot, track.song_index, hvscRoot);
          return { metadata, durationMs };
        } catch {
          return {};
        }
      })(),
    );
  }

  const resolved = await cache.get(track.sid_path)!;
  const metadata = resolved.metadata;
  return {
    ...track,
    absolutePath,
    title: metadata?.title ?? path.basename(track.sid_path),
    author: metadata?.author ?? "",
    released: metadata?.released ?? "",
    year: metadata ? extractYear(metadata.released) : undefined,
    durationMs: resolved.durationMs,
    songs: metadata?.songs,
  };
}

export async function buildStationQueue(
  datasetHandle: StationSimilarityDatasetInput,
  hvscRoot: string,
  ratings: Map<string, number>,
  stationSize: number,
  adventure: number,
  minDurationSeconds: number,
  runtime: StationRuntime,
  metadataCache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails[]> {
  const resolvedHandle = normalizeDatasetHandle(datasetHandle);
  const favoriteTrackIds = pickFavoriteTrackIds(ratings);
  if (favoriteTrackIds.length === 0) {
    return [];
  }

  const weightsByTrackId = buildWeightsByTrackId(ratings);
  const favoriteRows = [...readTrackRowsByIds(resolvedHandle, favoriteTrackIds).values()];
  const ratingCentroid = buildWeightedRatingCentroid(favoriteRows, weightsByTrackId);

  // C3: Use adventure-radius-expansion min_sim
  const minSimilarity = computeAdventureMinSimilarity(adventure);

  const excludeTrackIds = [...ratings.entries()].filter(([, rating]) => rating <= 2).map(([trackId]) => trackId);

  // C1: Build intent model to detect multi-cluster preferences
  const favoriteVectors = readTrackVectorsByIds(resolvedHandle, favoriteTrackIds);
  const weightsMap = new Map<string, number>(Object.entries(weightsByTrackId));
  const intentModel: IntentModel = buildIntentModel(favoriteTrackIds, favoriteVectors, weightsMap);

  const recommendationLimitFloor = Math.max(stationSize * (3 + adventure), stationSize + 128);
  let recommendationLimit = recommendationLimitFloor;
  let details: StationTrackDetails[] = [];
  let previousCandidateCount = -1;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    let candidates: SimilarityExportRecommendation[];

    if (intentModel.multiCluster) {
      // C1: Multi-centroid — fetch per cluster then interleave
      const halfLimit = Math.max(1, Math.floor(recommendationLimit / 2));
      const clusterCandidatesA = isPortableHandle(resolvedHandle)
        ? resolvedHandle.dataset.recommendFromFavorites({
          favoriteTrackIds: intentModel.clusters[0]!.trackIds,
          excludeTrackIds,
          weightsByTrackId: Object.fromEntries(intentModel.clusters[0]!.trackIds.map((id, i) => [id, intentModel.clusters[0]!.weights[i] ?? 1])),
          limit: halfLimit,
        })
        : recommendFromFavoritesFromSqlite(resolvedHandle.dbPath, {
        favoriteTrackIds: intentModel.clusters[0]!.trackIds,
        excludeTrackIds,
        weightsByTrackId: Object.fromEntries(intentModel.clusters[0]!.trackIds.map((id, i) => [id, intentModel.clusters[0]!.weights[i] ?? 1])),
        limit: halfLimit,
      });
      const clusterCandidatesB = isPortableHandle(resolvedHandle)
        ? resolvedHandle.dataset.recommendFromFavorites({
          favoriteTrackIds: intentModel.clusters[1]!.trackIds,
          excludeTrackIds,
          weightsByTrackId: Object.fromEntries(intentModel.clusters[1]!.trackIds.map((id, i) => [id, intentModel.clusters[1]!.weights[i] ?? 1])),
          limit: halfLimit,
        })
        : recommendFromFavoritesFromSqlite(resolvedHandle.dbPath, {
        favoriteTrackIds: intentModel.clusters[1]!.trackIds,
        excludeTrackIds,
        weightsByTrackId: Object.fromEntries(intentModel.clusters[1]!.trackIds.map((id, i) => [id, intentModel.clusters[1]!.weights[i] ?? 1])),
        limit: halfLimit,
      });
      // Interleave cluster results then dedupe by track_id
      const interleaved = interleaveClusterResults(clusterCandidatesA, clusterCandidatesB);
      const seenIds = new Set<string>();
      candidates = [];
      for (const c of interleaved) {
        if (!seenIds.has(c.track_id)) {
          seenIds.add(c.track_id);
          candidates.push(c);
        }
      }
    } else {
      candidates = isPortableHandle(resolvedHandle)
        ? resolvedHandle.dataset.recommendFromFavorites({
          favoriteTrackIds,
          excludeTrackIds,
          weightsByTrackId,
          limit: recommendationLimit,
        })
        : recommendFromFavoritesFromSqlite(resolvedHandle.dbPath, {
        favoriteTrackIds,
        excludeTrackIds,
        weightsByTrackId,
        limit: recommendationLimit,
      });
    }

    if (candidates.length === previousCandidateCount) {
      break;
    }
    previousCandidateCount = candidates.length;

    const detailByTrackId = new Map<string, StationTrackDetails>();
    const filteredCandidates: SimilarityExportRecommendation[] = [];
    for (const recommendation of candidates) {
      if (recommendation.score < minSimilarity) {
        continue;
      }
      const row = readTrackRowById(resolvedHandle, recommendation.track_id);
      if (!row) {
        continue;
      }
      if (!passesDeviationFilter(row, ratingCentroid)) {
        continue;
      }
      const detail = await resolveTrackDetails(row, hvscRoot, runtime, metadataCache);
      if (!isTrackLongEnough(detail, minDurationSeconds)) {
        continue;
      }
      detailByTrackId.set(detail.track_id, detail);
      filteredCandidates.push(recommendation);
    }

    const chosen = chooseStationTracks(dedupeQueueBySongKey(filteredCandidates), stationSize, adventure, runtime.random);
    const orderedChosen = orderStationTracksByFlow(
      chosen,
      readTrackVectorsByIds(resolvedHandle, chosen.map((recommendation) => recommendation.track_id)),
      adventure,
      runtime.random,
    );
    const nextDetails: StationTrackDetails[] = [];
    for (const recommendation of orderedChosen) {
      const detail = detailByTrackId.get(recommendation.track_id);
      if (detail) {
        nextDetails.push(detail);
      }
    }

    const uniqueNextDetails = dedupeQueueBySongKey(nextDetails);
    if (uniqueNextDetails.length > details.length) {
      details = uniqueNextDetails;
    }
    if (details.length >= stationSize || candidates.length < recommendationLimit) {
      break;
    }
    recommendationLimit = Math.max(recommendationLimit + stationSize, recommendationLimit * 2);
  }

  return dedupeQueueBySongKey(details);
}

export function mergeQueueKeepingCurrent(
  current: StationTrackDetails,
  rebuilt: StationTrackDetails[],
  currentIndex: number,
  pinCurrent = true,
): { queue: StationTrackDetails[]; index: number } {
  const deduped = dedupeQueueBySongKey(rebuilt.filter((track) => track.track_id !== current.track_id));
  if (!pinCurrent) {
    if (deduped.length === 0) {
      return { queue: [], index: 0 };
    }
    return { queue: deduped, index: Math.max(0, Math.min(currentIndex, deduped.length - 1)) };
  }
  const nextIndex = Math.min(currentIndex, deduped.length);
  deduped.splice(nextIndex, 0, current);
  return { queue: dedupeQueueBySongKey(deduped), index: nextIndex };
}

export function shuffleQueueKeepingCurrent(
  queue: StationTrackDetails[],
  currentIndex: number,
  random: () => number,
): StationTrackDetails[] {
  if (queue.length <= 2) {
    return dedupeQueueBySongKey([...queue]);
  }

  const current = queue[currentIndex]!;
  const tail = dedupeQueueBySongKey([...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1)]);
  for (let index = tail.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const next = tail[index]!;
    tail[index] = tail[swapIndex]!;
    tail[swapIndex] = next;
  }
  return dedupeQueueBySongKey([current, ...tail]);
}

export function sumPlaylistDurationMs(queue: StationTrackDetails[]): number {
  return queue.reduce((total, track) => total + resolveTrackDurationMs(track), 0);
}

export function resolvePlaylistPositionMs(
  queue: StationTrackDetails[],
  currentIndex: number,
  currentElapsedMs: number,
): number {
  const beforeCurrent = queue.slice(0, currentIndex).reduce((total, track) => total + resolveTrackDurationMs(track), 0);
  return beforeCurrent + Math.max(0, Math.min(currentElapsedMs, resolveTrackDurationMs(queue[currentIndex] ?? queue[0]!)));
}
