/**
 * SID Station — interactive CLI for SID music discovery and playback.
 *
 * This module re-exports the station implementation from `./station/` and
 * provides backward-compatible aliases for the old `station-demo-cli` names.
 */
import process from "node:process";

export * from "./station/index.js";
export { parseStationArgs as parseStationDemoArgs } from "./station/index.js";
export { runStationCli as runStationDemoCli } from "./station/index.js";

export type { StationCliOptions as StationDemoCliOptions } from "./station/index.js";
export type { StationRuntime as StationDemoRuntime } from "./station/index.js";

import {
  buildPlaylistStatePath,
  buildStationSongKey,
  buildStationQueue,
  buildSelectionStatePath,
  chooseStationTracks,
  deriveStationBucketKey,
  getTerminalSize,
  listPersistedStationPlaylists,
  orderStationTracksByFlow,
  readPersistedStationPlaylist,
  renderStationScreen,
  resolvePlaylistWindowRows,
  resolvePlaylistWindowStart,
  shuffleQueueKeepingCurrent,
  writePersistedStationPlaylist,
} from "./station/index.js";

/** @deprecated Use the named exports directly from `./station/index.js`. */
export const __stationDemoTestUtils = {
  buildPlaylistStatePath,
  buildStationSongKey,
  buildStationQueue,
  buildSelectionStatePath,
  chooseStationTracks,
  deriveStationBucketKey,
  getTerminalSize,
  listPersistedStationPlaylists,
  orderStationTracksByFlow,
  readPersistedStationPlaylist,
  renderStationScreen,
  resolvePlaylistWindowRows,
  resolvePlaylistWindowStart,
  shuffleQueueKeepingCurrent,
  writePersistedStationPlaylist,
};

if (import.meta.main) {
  const { runStationCli } = await import("./station/index.js");
  runStationCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
