import { assignSimilarityStyleMasks } from "./style-assignment.js";
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

/**
 * Corpus-relative style masks for a set of tracks, computed once and indexed by id.
 *
 * A station is "the most X tracks in this corpus", so a mask cannot be derived from one
 * track in isolation — which is what the previous per-track `computeSimilarityStyleMask`
 * tried to do, by taking each track's three highest-scoring personas unconditionally.
 * That gave every track exactly three labels whether any fitted or not, put 10.8% of
 * HVSC in both `fast_paced` and `slow_ambient`, and left `theme_hunter` with no members
 * at all. See style-assignment.ts for the measurements.
 *
 * Readers that hold a whole corpus (lite, and the SQLite export) use this. It is
 * audio-only: neither format carries SID header metadata, so the four hybrid personas
 * score on audio alone here. The authoritative masks are the ones the tiny builder
 * computes with metadata and ships in the bundle — this is what a reader can reconstruct
 * without a local HVSC, and the specs say so.
 */
export function buildStyleMaskIndex(
  tracks: readonly Pick<SimilarityTrackRow, "track_id" | "sid_path" | "e" | "m" | "c" | "p">[],
): Map<string, number> {
  const { masks } = assignSimilarityStyleMasks(
    tracks.map((track) => ({
      track_id: track.track_id,
      sid_path: track.sid_path,
      e: track.e,
      m: track.m,
      c: track.c,
      p: track.p,
    })),
    // A reader must never refuse to answer because the corpus it was handed is small or
    // lopsided. The gate belongs at export time, where someone can act on it.
    { allowSparseStyles: true },
  );
  return new Map(tracks.map((track, index) => [track.track_id, masks[index] ?? 0]));
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