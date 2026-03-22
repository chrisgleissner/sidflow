import type { ChildProcess } from "node:child_process";
import type {
  loadConfig,
  lookupSongDurationMs,
  parseSidFile,
  SidFileMetadata,
  SidflowConfig,
} from "@sidflow/common";

export type PlaybackMode = "local" | "c64u" | "none";
export type Phase = "rating" | "station";

export interface StationCliOptions {
  config?: string;
  db?: string;
  localDb?: string;
  forceLocalDb?: boolean;
  resetSelections?: boolean;
  hvsc?: string;
  featuresJsonl?: string;
  playback?: PlaybackMode;
  sidplayPath?: string;
  c64uHost?: string;
  c64uPassword?: string;
  c64uHttps?: boolean;
  adventure?: number;
  sampleSize?: number;
  stationSize?: number;
  minDuration?: number;
}

export interface StationTrackRow {
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
  last_played: string | null;
}

export interface StationTrackDetails extends StationTrackRow {
  absolutePath: string;
  title: string;
  author: string;
  released: string;
  year?: string;
  durationMs?: number;
  songs?: number;
}

export interface MetadataResolver {
  parseSidFile: typeof parseSidFile;
  lookupSongDurationMs: typeof lookupSongDurationMs;
}

export interface PlaybackAdapter {
  start(track: StationTrackDetails): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

export interface StationRuntime extends MetadataResolver {
  loadConfig: typeof loadConfig;
  createPlaybackAdapter?: (mode: PlaybackMode, config: SidflowConfig, options: StationCliOptions) => Promise<PlaybackAdapter>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  cwd: () => string;
  now: () => Date;
  prompt?: (message: string) => Promise<string>;
  random: () => number;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  offSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

export interface ExportDatabaseInfo {
  trackCount: number;
  hasTrackIdentity: boolean;
  hasVectorData: boolean;
}

export type SeedAction =
  | { type: "rate"; rating: number }
  | { type: "skip" }
  | { type: "back" }
  | { type: "refresh" }
  | { type: "quit" };

export type StationAction =
  | { type: "rate"; rating: number }
  | { type: "skip" }
  | { type: "next" }
  | { type: "back" }
  | { type: "cursorUp" }
  | { type: "cursorDown" }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "playSelected" }
  | { type: "togglePause" }
  | { type: "setFilter"; value: string; editing: boolean }
  | { type: "setRatingFilter"; value: string; editing: boolean }
  | { type: "clearFilters" }
  | { type: "cancelInput" }
  | { type: "openSavePlaylistDialog" }
  | { type: "openLoadPlaylistDialog" }
  | { type: "updateSavePlaylistName"; value: string }
  | { type: "submitSavePlaylistDialog"; value: string }
  | { type: "movePlaylistDialogSelection"; delta: -1 | 1 }
  | { type: "confirmPlaylistDialog" }
  | { type: "cancelPlaylistDialog" }
  | { type: "shuffle" }
  | { type: "rebuild" }
  | { type: "refresh" }
  | { type: "quit" }
  | { type: "timeout" };

export interface InputController {
  close(): void;
  readSeedAction(): Promise<SeedAction>;
  readStationAction(timeoutMs: number, onTick?: () => void): Promise<StationAction>;
}

export interface StationScreenState {
  phase: Phase;
  current: StationTrackDetails;
  index: number;
  selectedIndex?: number;
  playlistWindowStart?: number;
  total: number;
  ratedCount: number;
  ratedTarget: number;
  ratings: Map<string, number>;
  playbackMode: PlaybackMode;
  adventure: number;
  dataSource: string;
  dbPath: string;
  featuresJsonl?: string;
  currentRating?: number;
  queue?: StationTrackDetails[];
  elapsedMs?: number;
  durationMs?: number;
  playlistElapsedMs?: number;
  playlistDurationMs?: number;
  filterQuery?: string;
  filterEditing?: boolean;
  ratingFilterQuery?: string;
  ratingFilterEditing?: boolean;
  minimumRating?: number;
  filterMatchCount?: number;
  minDurationSeconds?: number;
  paused?: boolean;
  statusLine?: string;
  hintLine?: string;
  dialog?: StationDialogState;
}

export interface StationTrackVectorRow {
  track_id: string;
  vector_json: string | null;
}

export interface CachedStationDatasetState {
  assetName: string;
  assetUrl: string;
  bundleDir: string;
  checkedAt: string;
  dbPath: string;
  manifestPath?: string;
  publishedAt: string;
  releaseTag: string;
}

export interface PersistedStationSelectionState {
  dbPath: string;
  hvscRoot: string;
  ratedTarget: number;
  ratings: Record<string, number>;
  savedAt: string;
}

export interface PersistedStationPlaylistState {
  dbPath: string;
  hvscRoot: string;
  name: string;
  savedAt: string;
  currentIndex: number;
  trackIds: string[];
}

export interface PersistedStationPlaylistSummary {
  currentIndex: number;
  name: string;
  savedAt: string;
  statePath: string;
  trackIds: string[];
}

export interface StationDialogState {
  mode: "save-playlist" | "load-playlist";
  inputValue?: string;
  playlists?: PersistedStationPlaylistSummary[];
  selectedPlaylistIndex?: number;
}

export interface GitHubReleaseAsset {
  browser_download_url?: string;
  name?: string;
}

export interface GitHubRelease {
  assets?: GitHubReleaseAsset[];
  published_at?: string;
  tag_name?: string;
}

export interface StationDatasetResolution {
  dataSource: string;
  dbPath: string;
  featuresJsonl?: string;
}
