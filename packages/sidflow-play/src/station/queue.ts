import path from "node:path";
import { Database } from "bun:sqlite";
import {
  pathExists,
  recommendFromFavorites,
  type SidFileMetadata,
  type SimilarityExportRecommendation,
} from "@sidflow/common";
import type {
  ExportDatabaseInfo,
  MetadataResolver,
  StationTrackDetails,
  StationTrackRow,
  StationTrackVectorRow,
  StationRuntime,
} from "./types.js";
import { extractYear, isTrackLongEnough, resolveTrackDurationMs } from "./formatting.js";

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

export function inspectExportDatabase(dbPath: string): ExportDatabaseInfo {
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

export function readRandomTracksExcluding(dbPath: string, limit: number, excludedTrackIds: Iterable<string>): StationTrackRow[] {
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

export function readTrackRowsByIds(dbPath: string, trackIds: string[]): Map<string, StationTrackRow> {
  if (trackIds.length === 0) {
    return new Map();
  }

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

function readTrackRowById(dbPath: string, trackId: string): StationTrackRow | null {
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

function readTrackVectorsByIds(dbPath: string, trackIds: string[]): Map<string, number[]> {
  if (trackIds.length === 0) {
    return new Map();
  }

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

function buildWeightsByTrackId(ratings: Map<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [trackId, rating] of ratings) {
    if (rating >= 5) {
      result[trackId] = 9;
      continue;
    }
    if (rating >= 4) {
      result[trackId] = 4;
      continue;
    }
    if (rating >= 3) {
      result[trackId] = 1.5;
      continue;
    }
    result[trackId] = 0.1;
  }
  return result;
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

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const dimensions = Math.min(left.length, right.length);
  for (let index = 0; index < dimensions; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
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

  const chosen: SimilarityExportRecommendation[] = [];
  const used = new Set<string>();
  const bucketCounts = new Map<string, number>();
  const sorted = [...recommendations].sort((left, right) => right.score - left.score || left.rank - right.rank);
  const bestScore = sorted[0]?.score ?? 0;
  const worstScore = sorted[sorted.length - 1]?.score ?? bestScore;
  const scoreExponent = Math.max(1.15, 3.05 - (Math.max(1, adventure) * 0.35));
  const candidatesByBucket = new Map<string, SimilarityExportRecommendation[]>();

  for (const recommendation of sorted) {
    const bucketKey = deriveStationBucketKey(recommendation.sid_path);
    const bucket = candidatesByBucket.get(bucketKey) ?? [];
    bucket.push(recommendation);
    candidatesByBucket.set(bucketKey, bucket);
  }

  for (let index = 0; index < stationSize && used.size < sorted.length; index += 1) {
    const bucketEntries = [...candidatesByBucket.entries()].filter(([, bucketCandidates]) => bucketCandidates.some((entry) => !used.has(entry.track_id)));
    if (bucketEntries.length === 0) {
      break;
    }

    const minBucketCount = Math.min(...bucketEntries.map(([bucketKey]) => bucketCounts.get(bucketKey) ?? 0));
    const eligibleBuckets = bucketEntries.filter(([bucketKey]) => (bucketCounts.get(bucketKey) ?? 0) === minBucketCount);

    const weightedBuckets = eligibleBuckets.map(([bucketKey, bucketCandidates]) => {
      const nextCandidate = bucketCandidates.find((entry) => !used.has(entry.track_id));
      const normalizedScore = !nextCandidate || bestScore === worstScore
        ? 1
        : Math.max(0, Math.min(1, (nextCandidate.score - worstScore) / (bestScore - worstScore)));
      const scoreWeight = Math.pow(0.05 + (normalizedScore * 0.95), scoreExponent);
      return {
        bucketCandidates,
        bucketKey,
        weight: Math.max(0.0001, scoreWeight),
      };
    });

    const totalBucketWeight = weightedBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);
    let bucketCursor = random() * totalBucketWeight;
    let selectedBucket = weightedBuckets[weightedBuckets.length - 1]!;
    for (const bucket of weightedBuckets) {
      bucketCursor -= bucket.weight;
      if (bucketCursor <= 0) {
        selectedBucket = bucket;
        break;
      }
    }

    const bucketCandidates = selectedBucket.bucketCandidates.filter((entry) => !used.has(entry.track_id));
    if (bucketCandidates.length === 0) {
      continue;
    }

    const weightedCandidates = bucketCandidates.map((entry) => {
      const normalizedScore = bestScore === worstScore
        ? 1
        : Math.max(0, Math.min(1, (entry.score - worstScore) / (bestScore - worstScore)));
      const scoreWeight = Math.pow(0.05 + (normalizedScore * 0.95), scoreExponent);
      return {
        entry,
        weight: Math.max(0.0001, scoreWeight),
      };
    });

    const totalWeight = weightedCandidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let cursor = random() * totalWeight;
    let picked = weightedCandidates[weightedCandidates.length - 1]!;

    for (const candidate of weightedCandidates) {
      cursor -= candidate.weight;
      if (cursor <= 0) {
        picked = candidate;
        break;
      }
    }

    chosen.push(picked.entry);
    used.add(picked.entry.track_id);
    bucketCounts.set(selectedBucket.bucketKey, (bucketCounts.get(selectedBucket.bucketKey) ?? 0) + 1);
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
  dbPath: string,
  hvscRoot: string,
  ratings: Map<string, number>,
  stationSize: number,
  adventure: number,
  minDurationSeconds: number,
  runtime: StationRuntime,
  metadataCache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails[]> {
  const favoriteTrackIds = pickFavoriteTrackIds(ratings);
  if (favoriteTrackIds.length === 0) {
    return [];
  }

  const excludeTrackIds = [...ratings.entries()].filter(([, rating]) => rating <= 2).map(([trackId]) => trackId);
  const recommendationLimitFloor = Math.max(stationSize * (3 + adventure), stationSize + 128);
  let recommendationLimit = recommendationLimitFloor;
  let details: StationTrackDetails[] = [];
  let previousCandidateCount = -1;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidates = recommendFromFavorites(dbPath, {
      favoriteTrackIds,
      excludeTrackIds,
      weightsByTrackId: buildWeightsByTrackId(ratings),
      limit: recommendationLimit,
    });

    if (candidates.length === previousCandidateCount) {
      break;
    }
    previousCandidateCount = candidates.length;

    const detailByTrackId = new Map<string, StationTrackDetails>();
    const filteredCandidates: SimilarityExportRecommendation[] = [];
    for (const recommendation of candidates) {
      const row = readTrackRowById(dbPath, recommendation.track_id);
      if (!row) {
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
      readTrackVectorsByIds(dbPath, chosen.map((recommendation) => recommendation.track_id)),
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
