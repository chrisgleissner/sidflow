import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  pathExists,
  writeCanonicalJsonFile,
  type JsonValue,
} from "@sidflow/common";
import type {
  PersistedStationPlaylistState,
  PersistedStationPlaylistSummary,
  PersistedStationSelectionState,
} from "./types.js";
import { STATION_PLAYLISTS_DIR, STATION_SELECTIONS_DIR } from "./constants.js";
import { safeReadJsonFile } from "./dataset.js";
import { normalizeRating } from "./formatting.js";

export function buildSelectionStatePath(cwd: string, dbPath: string, hvscRoot: string): string {
  const digest = createHash("sha256").update(`${dbPath}\n${hvscRoot}`).digest("hex").slice(0, 16);
  return path.resolve(cwd, STATION_SELECTIONS_DIR, `${digest}.json`);
}

function slugifyPlaylistName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "playlist";
}

export function buildPlaylistStatePath(cwd: string, dbPath: string, hvscRoot: string, name: string): string {
  const digest = createHash("sha256").update(`${dbPath}\n${hvscRoot}\n${name.trim()}`).digest("hex").slice(0, 16);
  return path.resolve(cwd, STATION_PLAYLISTS_DIR, `${slugifyPlaylistName(name)}-${digest}.json`);
}

function sanitizePersistedRatings(value: Record<string, number> | undefined): Map<string, number> {
  const ratings = new Map<string, number>();
  if (!value) {
    return ratings;
  }

  for (const [trackId, rating] of Object.entries(value)) {
    if (typeof rating === "number" && Number.isFinite(rating)) {
      ratings.set(trackId, normalizeRating(rating));
    }
  }
  return ratings;
}

export async function readPersistedStationSelections(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
): Promise<Map<string, number>> {
  const state = await safeReadJsonFile<PersistedStationSelectionState>(statePath);
  if (!state) {
    return new Map();
  }
  if (state.dbPath !== dbPath || state.hvscRoot !== hvscRoot) {
    return new Map();
  }
  return sanitizePersistedRatings(state.ratings);
}

export async function writePersistedStationSelections(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
  ratedTarget: number,
  ratings: Map<string, number>,
  savedAt: string,
): Promise<void> {
  const persistedRatings = Object.fromEntries([...ratings.entries()].sort(([left], [right]) => left.localeCompare(right)));
  await writeCanonicalJsonFile(statePath, {
    dbPath,
    hvscRoot,
    ratedTarget,
    ratings: persistedRatings,
    savedAt,
  } as unknown as JsonValue, {
    action: "data:modify",
  });
}

export async function listPersistedStationPlaylists(
  cwd: string,
  dbPath: string,
  hvscRoot: string,
): Promise<PersistedStationPlaylistSummary[]> {
  const directory = path.resolve(cwd, STATION_PLAYLISTS_DIR);
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const playlists: PersistedStationPlaylistSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const statePath = path.resolve(directory, entry.name);
    const state = await safeReadJsonFile<PersistedStationPlaylistState>(statePath);
    if (!state || state.dbPath !== dbPath || state.hvscRoot !== hvscRoot || !Array.isArray(state.trackIds)) {
      continue;
    }
    playlists.push({
      currentIndex: Math.max(0, Math.min(state.currentIndex, Math.max(0, state.trackIds.length - 1))),
      name: state.name,
      savedAt: state.savedAt,
      statePath,
      trackIds: [...state.trackIds],
    });
  }

  return playlists.sort((left, right) => left.name.localeCompare(right.name) || right.savedAt.localeCompare(left.savedAt));
}

export async function readPersistedStationPlaylist(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
): Promise<PersistedStationPlaylistState | null> {
  const state = await safeReadJsonFile<PersistedStationPlaylistState>(statePath);
  if (!state) {
    return null;
  }
  if (state.dbPath !== dbPath || state.hvscRoot !== hvscRoot || !Array.isArray(state.trackIds)) {
    return null;
  }
  const trackIds = state.trackIds.filter((trackId) => typeof trackId === "string" && trackId.length > 0);
  return {
    ...state,
    currentIndex: Math.max(0, Math.min(state.currentIndex, Math.max(0, trackIds.length - 1))),
    name: state.name.trim(),
    trackIds,
  };
}

export async function writePersistedStationPlaylist(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
  name: string,
  currentIndex: number,
  trackIds: string[],
  savedAt: string,
): Promise<void> {
  const uniqueTrackIds = [...new Set(trackIds)];
  await writeCanonicalJsonFile(statePath, {
    dbPath,
    hvscRoot,
    name: name.trim(),
    savedAt,
    currentIndex: Math.max(0, Math.min(currentIndex, Math.max(0, uniqueTrackIds.length - 1))),
    trackIds: uniqueTrackIds,
  } as unknown as JsonValue, {
    action: "data:modify",
  });
}
