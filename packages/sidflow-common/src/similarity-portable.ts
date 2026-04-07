import type { SimilarityExportRecommendation } from "./similarity-export.js";

export type PortableSimilarityFormat = "lite" | "tiny";

export interface PortableSimilarityTrackRow {
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

export interface PortableSimilarityDatasetInfo {
  format: PortableSimilarityFormat;
  schemaVersion: string;
  sourcePath: string;
  trackCount: number;
  hasTrackIdentity: true;
  hasVectorData: boolean;
}

export interface PortableRecommendFromFavoritesOptions {
  favoriteTrackIds: string[];
  limit?: number;
  excludeTrackIds?: string[];
  weightsByTrackId?: Record<string, number>;
}

export interface PortableSimilarityDataset {
  readonly info: PortableSimilarityDatasetInfo;
  readRandomTracksExcluding(limit: number, excludedTrackIds: Iterable<string>): PortableSimilarityTrackRow[];
  readTrackRowsByIds(trackIds: string[]): Map<string, PortableSimilarityTrackRow>;
  readTrackRowById(trackId: string): PortableSimilarityTrackRow | null;
  readTrackVectorsByIds(trackIds: string[]): Map<string, number[]>;
  recommendFromFavorites(options: PortableRecommendFromFavoritesOptions): SimilarityExportRecommendation[];
}