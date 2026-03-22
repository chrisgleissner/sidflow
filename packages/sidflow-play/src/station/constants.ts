import path from "node:path";

export const MINIMUM_RATED_TRACKS = 5;
export const MINIMUM_STATION_TRACKS = 100;
export const U64_SID_VOLUME_REGISTERS = [0xD418, 0xD438, 0xD458] as const;
export const MINIMUM_PLAYLIST_WINDOW_ROWS = 7;
export const STATION_SCREEN_RESERVED_ROWS = 22;
export const STATION_CACHE_DIR = path.join("data", "cache", "station-demo", "sidflow-data");
export const STATION_CACHE_STATE = "latest-release.json";
export const STATION_SELECTIONS_DIR = path.join("data", "cache", "station-demo", "selections");
export const STATION_PLAYLISTS_DIR = path.join("data", "cache", "station-demo", "playlists");
export const STATION_RELEASE_REPO = "chrisgleissner/sidflow-data";
export const STATION_RELEASE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
