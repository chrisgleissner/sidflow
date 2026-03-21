export type {
  PlaybackMode,
  Phase,
  StationCliOptions,
  StationTrackRow,
  StationTrackDetails,
  MetadataResolver,
  PlaybackAdapter,
  StationRuntime,
  ExportDatabaseInfo,
  SeedAction,
  StationAction,
  InputController,
  StationScreenState,
  StationTrackVectorRow,
  CachedStationDatasetState,
  PersistedStationSelectionState,
  GitHubReleaseAsset,
  GitHubRelease,
  StationDatasetResolution,
} from "./types.js";

export {
  MINIMUM_RATED_TRACKS,
  MINIMUM_STATION_TRACKS,
  U64_SID_VOLUME_REGISTERS,
  MINIMUM_PLAYLIST_WINDOW_ROWS,
  STATION_SCREEN_RESERVED_ROWS,
  STATION_CACHE_DIR,
  STATION_CACHE_STATE,
  STATION_SELECTIONS_DIR,
  STATION_RELEASE_REPO,
  STATION_RELEASE_CHECK_INTERVAL_MS,
} from "./constants.js";

export { parseStationArgs, HELP_TEXT } from "./args.js";

export {
  getTerminalSize,
  resolveTrackDurationMs,
  isTrackLongEnough,
  formatDuration,
  normalizeRating,
  formatTrackSummary,
  RATING_COLUMN_WIDTH,
  supportsAnsi,
  colorize,
  bold,
  subtle,
  dim,
  truncate,
  formatPercent,
  renderProgressBar,
  renderLegend,
  renderProgressLine,
  renderStars,
  extractYear,
  renderRelativePath,
} from "./formatting.js";

export {
  normalizeFilterQuery,
  trackMatchesFilter,
  getFilteredTrackIndices,
  clampSelectionToMatches,
  moveSelectionInMatches,
  moveCurrentInMatches,
  resolvePlaylistWindowStart,
  resolvePlaylistWindowRows,
  resolvePlaylistWindowRowsForScreen,
  getStationReservedRows,
  renderStationScreen,
  ScreenRenderer,
} from "./screen.js";

export {
  mapSeedToken,
  mapStationToken,
  decodeTerminalInput,
  createInputController,
} from "./input.js";

export {
  createPlaybackAdapter,
} from "./playback-adapters.js";

export {
  safeReadJsonFile,
  resolveLatestFeaturesJsonl,
  resolveStationDataset,
} from "./dataset.js";

export {
  inspectExportDatabase,
  readRandomTracksExcluding,
  buildStationQueue,
  mergeQueueKeepingCurrent,
  shuffleQueueKeepingCurrent,
  sumPlaylistDurationMs,
  resolvePlaylistPositionMs,
  resolveTrackDetails,
  deriveStationBucketKey,
  chooseStationTracks,
  orderStationTracksByFlow,
  summarizeRatingAnchors,
} from "./queue.js";

export {
  buildSelectionStatePath,
  readPersistedStationSelections,
  writePersistedStationSelections,
} from "./persistence.js";

export { runStationCli } from "./run.js";
