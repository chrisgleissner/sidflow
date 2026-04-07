import { PERSONA_IDS } from "./persona.js";
import { scoreAllPersonas } from "./persona-scorer.js";
import type { SimilarityExportRecommendation } from "./similarity-export.js";

export type SimilarityDatasetFormat = "sqlite" | "lite" | "tiny";
export type PortableSimilarityFormat = Exclude<SimilarityDatasetFormat, "sqlite">;

export interface SimilarityTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
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

export interface SimilarityDatasetInfo {
  format: SimilarityDatasetFormat;
  schemaVersion: string;
  sourcePath: string;
  trackCount: number;
  hasTrackIdentity: boolean;
  hasVectorData: boolean;
}

export interface PortableRecommendFromFavoritesOptions {
  favoriteTrackIds: string[];
  limit?: number;
  excludeTrackIds?: string[];
  weightsByTrackId?: Record<string, number>;
}

export interface SimilarityDataset {
  readonly info: SimilarityDatasetInfo;
  readRandomTracksExcluding(limit: number, excludedTrackIds: Iterable<string>, random?: () => number): SimilarityTrackRow[];
  resolveTracks(trackIds: string[]): Map<string, SimilarityTrackRow>;
  resolveTrack(trackId: string): SimilarityTrackRow | null;
  getTrackVectors(trackIds: string[]): Map<string, number[]>;
  getNeighbors(trackId: string, limit?: number, excludeTrackIds?: Iterable<string>): SimilarityExportRecommendation[];
  getStyleMask(trackId: string): number | null;
  recommendFromFavorites(options: PortableRecommendFromFavoritesOptions): SimilarityExportRecommendation[];
}

export type PortableSimilarityTrackRow = SimilarityTrackRow;
export type PortableSimilarityDatasetInfo = SimilarityDatasetInfo;
export type PortableSimilarityDataset = SimilarityDataset;

function normalizeCompactRating(value: number): number {
  return Math.max(0, Math.min(15, Math.round(value)));
}

export function packCompactRatings(track: Pick<SimilarityTrackRow, "e" | "m" | "c" | "p">): number {
  const energy = normalizeCompactRating(track.e);
  const mood = normalizeCompactRating(track.m);
  const complexity = normalizeCompactRating(track.c);
  const preference = track.p == null ? 0 : normalizeCompactRating(track.p);
  return energy | (mood << 4) | (complexity << 8) | (preference << 12);
}

export function unpackCompactRatings(value: number): Pick<SimilarityTrackRow, "e" | "m" | "c" | "p"> {
  const energy = value & 0x0f;
  const mood = (value >>> 4) & 0x0f;
  const complexity = (value >>> 8) & 0x0f;
  const preference = (value >>> 12) & 0x0f;
  return {
    e: energy,
    m: mood,
    c: complexity,
    p: preference === 0 ? null : preference,
  };
}

export function computeSimilarityStyleMask(track: Pick<SimilarityTrackRow, "e" | "m" | "c" | "p">): number {
  const energy = Math.max(0, Math.min(1, (track.e - 1) / 4));
  const mood = Math.max(0, Math.min(1, (track.m - 1) / 4));
  const complexity = Math.max(0, Math.min(1, (track.c - 1) / 4));
  const preference = track.p == null ? 0.5 : Math.max(0, Math.min(1, (track.p - 1) / 4));

  const scores = scoreAllPersonas({
    metrics: {
      melodicComplexity: complexity,
      rhythmicDensity: energy,
      timbralRichness: (complexity + preference) / 2,
      nostalgiaBias: mood,
      experimentalTolerance: (complexity + (1 - mood) + preference) / 3,
    },
    ratings: {
      e: track.e,
      m: track.m,
      c: track.c,
    },
  });

  const ranked = PERSONA_IDS
    .map((personaId) => ({ personaId, score: scores[personaId] }))
    .sort((left, right) => right.score - left.score || left.personaId.localeCompare(right.personaId))
    .slice(0, 3);

  let mask = 0;
  for (const entry of ranked) {
    const bit = PERSONA_IDS.indexOf(entry.personaId);
    if (bit >= 0) {
      mask |= (1 << bit);
    }
  }
  return mask;
}

export function pickRandomRows<T extends { track_id: string }>(
  rows: readonly T[],
  limit: number,
  excludedTrackIds: Iterable<string>,
  random: () => number = Math.random,
): T[] {
  const excluded = new Set(excludedTrackIds);
  const pool = rows.filter((row) => !excluded.has(row.track_id));
  const target = Math.max(0, Math.min(limit, pool.length));
  for (let index = 0; index < target; index += 1) {
    const swapIndex = index + Math.floor(random() * (pool.length - index));
    const next = pool[index]!;
    pool[index] = pool[swapIndex]!;
    pool[swapIndex] = next;
  }
  return pool.slice(0, target);
}