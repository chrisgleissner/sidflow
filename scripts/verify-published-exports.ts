#!/usr/bin/env bun
/**
 * Proves a published export bundle actually builds stations, for all three profiles.
 *
 * The station CLI is interactive, so it cannot be the gate on a release. This exercises the
 * same libraries the station uses, against the real bundles, and asserts the properties
 * that have actually broken before:
 *
 *   - the tiny profile once resolved NOTHING against a real nested HVSC layout, because it
 *     stores files by a 48-bit MD5 prefix relative to the music root while the SQLite and
 *     lite exports record whatever path the operator configured. Every lookup returned
 *     null, every station came back empty, and the bundle reported correct track counts
 *     throughout;
 *   - `recommendFromSeedTrack` served the precomputed neighbour cache whenever it held even
 *     one row, so with the export default of three a request for a hundred candidates
 *     returned three;
 *   - the stored vector silently narrowed to 4 dimensions, which scores close to random.
 *
 *   bun run scripts/verify-published-exports.ts --exports data/exports --hvsc workspace/hvsc
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildSimilarityTrackId,
  openLiteSimilarityDataset,
  openTinySimilarityDataset,
  readSimilarityExportManifest,
  recommendFromFavorites,
  recommendFromSeedTrack,
} from "../packages/sidflow-common/src/index.js";
import { Database } from "bun:sqlite";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const EXPORTS = arg("--exports") ?? "data/exports";
const HVSC = arg("--hvsc") ?? "workspace/hvsc";
/** A station keeps at least 100 songs, so that is the number worth proving. */
const STATION_SIZE = Number.parseInt(arg("--station-size") ?? "100", 10);

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

const sqlitePath = findBundle("-sidcorr-1.sqlite");
const litePath = findBundle("-sidcorr-lite-1.sidcorr");
const tinyPath = findBundle("-sidcorr-tiny-1.sidcorr");

process.stdout.write("=== bundles ===\n");
check("full SQLite bundle present", sqlitePath !== null, sqlitePath ?? "");
check("lite bundle present", litePath !== null, litePath ?? "");
check("tiny bundle present", tinyPath !== null, tinyPath ?? "");
if (!sqlitePath || !litePath || !tinyPath) {
  process.stderr.write("\nCannot verify without all three bundles.\n");
  process.exit(1);
}

// ---- manifest ----
process.stdout.write("\n=== manifest ===\n");
const manifest = await readSimilarityExportManifest(`${sqlitePath.replace(/\.sqlite$/, "")}.manifest.json`);
check("declares a vector width", typeof manifest.vector_dimensions === "number", String(manifest.vector_dimensions));
check(
  "vector width is the shipping 58, not the legacy 4",
  manifest.vector_dimensions === 58,
  `${manifest.vector_dimensions} dimensions`,
);
check("records the SID emulation", typeof manifest.sid_engine === "string", String(manifest.sid_engine));
check("records the normalisation", manifest.vector_normalisation === "rank-uniform", String(manifest.vector_normalisation));
check("track count is the whole corpus", manifest.track_count > 80_000, String(manifest.track_count));

// ---- full SQLite ----
process.stdout.write("\n=== full SQLite profile ===\n");
const database = new Database(sqlitePath, { readonly: true });
const widths = database.query("select json_array_length(vector_json) as w, count(*) as n from tracks group by 1").all() as Array<{ w: number; n: number }>;
check("every stored vector has one width", widths.length === 1, widths.map((row) => `${row.w}x${row.n}`).join(", "));
check("that width is 58", widths[0]?.w === 58, String(widths[0]?.w));
const engines = database.query("select count(distinct render_engine) as n from tracks").get() as { n: number };
check("a single render engine", engines.n === 1);
const ratingSpread = database.query("select count(distinct e) as e, count(distinct m) as m, count(distinct c) as c from tracks").get() as { e: number; m: number; c: number };
check(
  "all three rating scales use five levels",
  ratingSpread.e === 5 && ratingSpread.m === 5 && ratingSpread.c === 5,
  `e=${ratingSpread.e} m=${ratingSpread.m} c=${ratingSpread.c}`,
);
const seedRow = database.query("select sid_path, song_index from tracks where vector_json is not null limit 1").get() as { sid_path: string; song_index: number };
database.close();

const seedTrackId = buildSimilarityTrackId(seedRow.sid_path, seedRow.song_index);
const fromSeed = recommendFromSeedTrack(sqlitePath, { seedTrackId, limit: STATION_SIZE });
check(
  `a seed yields ${STATION_SIZE} recommendations, not the stored neighbour count`,
  fromSeed.length === STATION_SIZE,
  `${fromSeed.length} returned`,
);
check("the seed is never recommended back", !fromSeed.some((entry) => entry.track_id === seedTrackId));
check("recommendations are ranked by descending similarity", fromSeed.every((entry, index) => index === 0 || entry.score <= fromSeed[index - 1]!.score));
check("similarity stays in [0,1]", fromSeed.every((entry) => entry.score >= 0 && entry.score <= 1 + 1e-9));
check("no duplicate recommendations", new Set(fromSeed.map((entry) => entry.track_id)).size === fromSeed.length);

const fromFavorites = recommendFromFavorites(sqlitePath, { favoriteTrackIds: [seedTrackId], limit: STATION_SIZE });
check(`favourites yield ${STATION_SIZE} recommendations`, fromFavorites.length === STATION_SIZE, `${fromFavorites.length} returned`);

// ---- lite ----
process.stdout.write("\n=== lite profile ===\n");
const lite = await openLiteSimilarityDataset(litePath);
check("reports the whole corpus", lite.info.trackCount > 80_000, String(lite.info.trackCount));
const liteRecommendations = lite.recommendFromFavorites({ favoriteTrackIds: [seedTrackId], limit: STATION_SIZE });
check(`builds a ${STATION_SIZE}-track station`, liteRecommendations.length === STATION_SIZE, `${liteRecommendations.length} returned`);
check("never returns the seed", !liteRecommendations.some((entry) => entry.track_id === seedTrackId));

// ---- tiny ----
process.stdout.write("\n=== tiny profile ===\n");
const tiny = await openTinySimilarityDataset(tinyPath, { hvscRoot: HVSC });
check("reports the whole corpus", tiny.info.trackCount > 80_000, String(tiny.info.trackCount));
// The regression that mattered: resolution against a real nested HVSC layout.
const resolved = tiny.resolveTrack(seedTrackId);
check("resolves a track id against a real HVSC layout", resolved !== null, seedTrackId);
const tinyRecommendations = tiny.recommendFromFavorites({ favoriteTrackIds: [seedTrackId], limit: STATION_SIZE });
check("returns recommendations at all", tinyRecommendations.length > 0, `${tinyRecommendations.length} returned`);
check("never returns the seed", !tinyRecommendations.every((entry) => entry.track_id === seedTrackId));

process.stdout.write(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
