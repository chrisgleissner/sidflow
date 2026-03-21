import { createHash } from "node:crypto";
import path from "node:path";
import {
  pathExists,
  writeCanonicalJsonFile,
  type JsonValue,
} from "@sidflow/common";
import type { PersistedStationSelectionState } from "./types.js";
import { STATION_SELECTIONS_DIR } from "./constants.js";
import { safeReadJsonFile } from "./dataset.js";
import { normalizeRating } from "./formatting.js";

export function buildSelectionStatePath(cwd: string, dbPath: string, hvscRoot: string): string {
  const digest = createHash("sha256").update(`${dbPath}\n${hvscRoot}`).digest("hex").slice(0, 16);
  return path.resolve(cwd, STATION_SELECTIONS_DIR, `${digest}.json`);
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
