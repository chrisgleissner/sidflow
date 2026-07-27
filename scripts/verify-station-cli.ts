#!/usr/bin/env bun
/**
 * Prove the CLI station still builds correct stations from a published export.
 *
 * `scripts/verify-published-exports.ts` checks that the artefacts are well-formed and that
 * the library can read them. This checks the thing a listener actually gets: that the
 * station layer, driven the way `sidflow-play station` drives it, produces a queue that is
 * full, in the right category, free of the failure modes the export audit found, and
 * consistent across the three profiles.
 *
 * It exists because those are different questions. A bundle can pass every structural check
 * and still build a station that opens with three subsongs of the tune you just rated.
 *
 *   bun run scripts/verify-station-cli.ts --exports data/exports --hvsc workspace/hvsc
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildStationQueue,
  openStationSimilarityDataset,
  type StationSimilarityFormat,
} from "../packages/sidflow-play/src/station/index.js";
import {
  buildSimilarityTrackId,
  countStylePopulations,
  PERSONA_IDS,
  PERSONAS,
} from "../packages/sidflow-common/src/index.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const EXPORTS = arg("--exports") ?? "data/exports";
const HVSC = arg("--hvsc") ?? "workspace/hvsc";
const STATION_SIZE = Number.parseInt(arg("--station-size") ?? "100", 10);
const SEED_COUNT = Number.parseInt(arg("--seeds") ?? "8", 10);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures += 1;
}

function findBundle(suffix: string): string | null {
  if (!existsSync(EXPORTS)) return null;
  const match = readdirSync(EXPORTS).find((name) => name.endsWith(suffix));
  return match ? path.join(EXPORTS, match) : null;
}

/** Deterministic, so a failure is reproducible rather than a story about one run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const sqlitePath = findBundle("-sidcorr-1.sqlite");
const litePath = findBundle("-sidcorr-lite-1.sidcorr");
const tinyPath = findBundle("-sidcorr-tiny-1.sidcorr");
if (!sqlitePath || !litePath || !tinyPath) {
  process.stderr.write("Cannot verify without all three bundles.\n");
  process.exit(1);
}

/**
 * Pick seeds the way the station's rating phase does: random tracks from the export, not a
 * hand-chosen set that happens to behave.
 */
const seedDataset = await openStationSimilarityDataset(sqlitePath, "sqlite", HVSC);
const random = createRandom(20260727);
const seedRows = seedDataset.readRandomTracksExcluding(SEED_COUNT, [], random);
const seedTrackIds = seedRows.map((row) => row.track_id);
const ratings = new Map<string, number>(seedTrackIds.map((trackId, index) => [trackId, index % 2 === 0 ? 5 : 4]));

process.stdout.write(`Seeds (${seedTrackIds.length}):\n`);
for (const row of seedRows) {
  process.stdout.write(`  ${row.track_id}  e=${row.e} m=${row.m} c=${row.c}\n`);
}

/**
 * A FRESH generator per profile.
 *
 * The station's selection and ordering steps draw from `runtime.random`, so reusing one
 * generator across the three builds leaves it in a different state for each — and the
 * profiles then disagree because they were handed different randomness, not because they
 * rank differently. Measured: sharing one generator dropped lite-vs-sqlite overlap@50 to
 * 0.10, which reads exactly like a retrieval defect and is not one.
 */
const makeRuntime = (): Parameters<typeof buildStationQueue>[6] => ({
  hvscRoot: path.resolve(HVSC),
  classifiedPath: "data/classified",
  random: createRandom(20260727),
} as unknown as Parameters<typeof buildStationQueue>[6]);

const queues = new Map<StationSimilarityFormat, Awaited<ReturnType<typeof buildStationQueue>>>();

for (const [format, bundlePath] of [
  ["sqlite", sqlitePath],
  ["lite", litePath],
  ["tiny", tinyPath],
] as Array<[StationSimilarityFormat, string]>) {
  process.stdout.write(`\n=== ${format} station ===\n`);
  const dataset = await openStationSimilarityDataset(bundlePath, format, HVSC);
  check("opens the bundle", dataset.info.trackCount > 0, `${dataset.info.trackCount} tracks`);

  const resolved = seedTrackIds.filter((trackId) => dataset.resolveTrack(trackId) !== null);
  check("resolves every seed", resolved.length === seedTrackIds.length, `${resolved.length}/${seedTrackIds.length}`);

  const queue = await buildStationQueue(dataset, HVSC, ratings, STATION_SIZE, 3, 15, makeRuntime(), new Map());
  queues.set(format, queue);
  check("builds a non-empty station", queue.length > 0, `${queue.length} tracks`);

  // Tiny's station is bounded by what its 3-neighbour graph reaches; the other two rank the
  // whole corpus and should fill.
  if (format === "tiny") {
    check("tiny fills a usable station", queue.length >= Math.min(STATION_SIZE, 50), `${queue.length}`);
  } else {
    check(`${format} fills the requested ${STATION_SIZE}`, queue.length === STATION_SIZE, `${queue.length}`);
  }

  const ids = new Set(queue.map((track) => track.track_id));
  check("no duplicate tracks", ids.size === queue.length);
  check("never returns a seed", !queue.some((track) => seedTrackIds.includes(track.track_id)));

  // The audit's 14.4% rank-1 sibling rate is why this matters: a station that opens with the
  // next subtune of the tune just rated is a poor listening result, however good the metric.
  const seedFiles = new Set(seedRows.map((row) => row.sid_path));
  const siblings = queue.filter((track) => seedFiles.has(track.sid_path));
  check("no same-file siblings of any seed", siblings.length === 0, `${siblings.length} found`);

  const perFile = new Map<string, number>();
  for (const track of queue) {
    perFile.set(track.sid_path, (perFile.get(track.sid_path) ?? 0) + 1);
  }
  const worstFile = Math.max(...perFile.values());
  check("no single tune dominates the queue", worstFile <= 3, `worst file contributes ${worstFile}`);

  const playable = queue.filter((track) => track.sid_path && track.title);
  check("every queued track carries what playback needs", playable.length === queue.length);
}

// ---- cross-profile agreement ----
process.stdout.write("\n=== cross-profile agreement ===\n");
const sqliteIds = (queues.get("sqlite") ?? []).map((track) => track.track_id);
const liteIds = (queues.get("lite") ?? []).map((track) => track.track_id);
const tinyIds = (queues.get("tiny") ?? []).map((track) => track.track_id);

const overlapAt = (left: string[], right: string[], depth: number): number => {
  const rightSet = new Set(right.slice(0, depth));
  const leftSlice = left.slice(0, depth);
  return leftSlice.length === 0 ? 0 : leftSlice.filter((id) => rightSet.has(id)).length / leftSlice.length;
};

/**
 * Agreement is asserted on RETRIEVAL, not on the finished queue.
 *
 * The queue is what retrieval produced after the station layer has filtered by rating
 * deviation and duration, capped per file, sampled an exploration band, and reordered for
 * flow. Those steps deliberately do not preserve the candidate ordering, so two profiles
 * that agree almost perfectly on candidates still land on visibly different queues.
 *
 * Measured on this corpus: sqlite and lite agree on 0.970 of their top 200 candidates and
 * on 0.420 of their finished 100-track queues — and BOTH figures are identical on the
 * 0.7.0 bundles. The queue divergence is a property of the selection layer, not something
 * this release introduced, so asserting on it here would be measuring the wrong thing and
 * would fail for the wrong reason.
 */
const sqliteRecommendations = seedDataset
  .recommendFromFavorites({ favoriteTrackIds: seedTrackIds, limit: 200 })
  .map((entry) => entry.track_id);
const liteDataset = await openStationSimilarityDataset(litePath, "lite", HVSC);
const liteRecommendations = liteDataset
  .recommendFromFavorites({ favoriteTrackIds: seedTrackIds, limit: 200 })
  .map((entry) => entry.track_id);

const rawOverlap = overlapAt(sqliteRecommendations, liteRecommendations, 200);
check(
  "lite reproduces the authoritative ranking",
  rawOverlap >= 0.9,
  `candidate overlap@200 = ${rawOverlap.toFixed(3)}`,
);

const liteQueueOverlap = overlapAt(sqliteIds, liteIds, 50);
const tinyQueueOverlap = overlapAt(sqliteIds, tinyIds, 50);
process.stdout.write(
  `  INFO  finished-queue overlap@50: lite ${liteQueueOverlap.toFixed(3)}, tiny ${tinyQueueOverlap.toFixed(3)}\n`,
);
process.stdout.write(
  "        Not asserted: the station layer samples an exploration band and caps per file,\n"
  + "        so queues diverge from an agreeing candidate pool. Identical on 0.7.0.\n",
);

// ---- style filtering ----
process.stdout.write("\n=== style masks drive station filtering ===\n");
const tinyDataset = await openStationSimilarityDataset(tinyPath, "tiny", HVSC);
const payload = readFileSync(tinyPath);
const trackCount = payload.readUInt32LE(12);
const styleMaskOffset = payload.readUInt32LE(44);
const masks = Array.from({ length: trackCount }, (_unused, index) => payload.readUInt16LE(styleMaskOffset + (index * 2)));
const populations = countStylePopulations(masks);

for (const personaId of PERSONA_IDS) {
  const count = populations[personaId] ?? 0;
  const share = ((count / trackCount) * 100).toFixed(1);
  check(`${PERSONAS[personaId].label} can build a station`, count >= 1000, `${count} tracks (${share}%)`);
}

// A station filter is only meaningful if a track's mask agrees with the published counts.
const sampled = tinyDataset.readRandomTracksExcluding(200, [], createRandom(7));
let maskedTracks = 0;
for (const row of sampled) {
  const mask = tinyDataset.getStyleMask(row.track_id);
  if (mask !== null && mask !== 0) {
    maskedTracks += 1;
  }
}
check(
  "sampled tracks carry style masks at about the published rate",
  maskedTracks > sampled.length * 0.5,
  `${maskedTracks}/${sampled.length} carry at least one style`,
);

process.stdout.write(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
