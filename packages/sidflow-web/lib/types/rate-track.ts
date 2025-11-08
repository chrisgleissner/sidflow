export interface RateTrackMetadata {
  title?: string;
  author?: string;
  released?: string;
  songs: number;
  startSong: number;
  sidType: string;
  version: number;
  sidModel: string;
  sidModelSecondary?: string;
  sidModelTertiary?: string;
  clock: string;
  length?: string;
  fileSizeBytes: number;
}

export interface RateTrackInfo {
  sidPath: string;
  relativePath: string;
  filename: string;
  displayName: string;
  selectedSong: number;
  metadata: RateTrackMetadata;
  durationSeconds: number;
}
