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
 * Against a real release:
 *
 *   bun run scripts/verify-published-exports.ts --exports data/exports --hvsc workspace/hvsc
 *
 * Against a CI fixture built by scripts/ci/build-similarity-fixture.ts:
 *
 *   bun run scripts/verify-published-exports.ts --scale fixture \
 *     --exports <fixture>/exports --hvsc <fixture>/hvsc
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildSimilarityTrackId,
  countStylePopulations,
  DEFAULT_STYLE_POPULATION_POLICY,
  evaluateStylePopulationGate,
  openLiteSimilarityDataset,
  openTinySimilarityDataset,
  PERSONA_IDS,
  readSimilarityExportManifest,
  recommendFromFavorites,
  recommendFromSeedTrack,
  STYLE_CONFLICT_PAIRS,
  SIMILARITY_VECTOR_WEIGHTS,
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
/**
 * `release` asserts the properties of a full HVSC export; `fixture` runs the same checks
 * against a small corpus built in CI, skipping only the ones that are statements about
 * HVSC's size rather than about the export being correct.
 *
 * The distinction is kept explicit rather than inferred from track count, so a real
 * release can never quietly downgrade itself to the weaker check set.
 */
const SCALE = (arg("--scale") ?? "release") as "release" | "fixture";
if (SCALE !== "release" && SCALE !== "fixture") {
  process.stderr.write("Error: --scale must be release or fixture\n");
  process.exit(2);
}
const isRelease = SCALE === "release";

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
  "vector width is wider than the legacy ratings vector",
  manifest.vector_dimensions > 4,
  `${manifest.vector_dimensions} dimensions`,
);
if (isRelease) {
  check(
    "vector width is the shipping 58, not the legacy 4",
    manifest.vector_dimensions === 58,
    `${manifest.vector_dimensions} dimensions`,
  );
}
check("records the SID emulation", typeof manifest.sid_engine === "string", String(manifest.sid_engine));
check("records the normalisation", manifest.vector_normalisation === "rank-uniform", String(manifest.vector_normalisation));
if (isRelease) {
  check("track count is the whole corpus", manifest.track_count > 80_000, String(manifest.track_count));
  check(
    "records which HVSC release the paths belong to",
    typeof manifest.hvsc_version === "string" && manifest.hvsc_version !== "unknown",
    String(manifest.hvsc_version),
  );
} else {
  check("records an HVSC release field at all", typeof manifest.hvsc_version === "string", String(manifest.hvsc_version));
}

// F2 -- the metric was unpublishable until 0.8.0, and a consumer computing plain cosine
// against a weighted export agrees with the authoritative neighbours on half its results.
check("names the similarity metric", manifest.similarity_metric === "weighted-cosine", String(manifest.similarity_metric));
check(
  "publishes one weight per dimension",
  Array.isArray(manifest.vector_weights) && manifest.vector_weights.length === manifest.vector_dimensions,
  `${manifest.vector_weights?.length ?? 0} weights for ${manifest.vector_dimensions} dimensions`,
);
if (isRelease) {
  check(
    "the published weights are the ones the code applies",
    JSON.stringify(manifest.vector_weights) === JSON.stringify([...SIMILARITY_VECTOR_WEIGHTS]),
  );
}

// F1 -- the declared digest never matched the published file, in any release, because the
// exporter hashed the database and then wrote that hash into it.
const sqliteDigest = createHash("sha256").update(readFileSync(sqlitePath)).digest("hex");
check(
  "the manifest digest matches the published file",
  manifest.file_checksums.sqlite_sha256 === sqliteDigest,
  `manifest ${manifest.file_checksums.sqlite_sha256.slice(0, 12)} vs actual ${sqliteDigest.slice(0, 12)}`,
);

const sha256sumsPath = path.join(EXPORTS, "SHA256SUMS");
if (existsSync(sha256sumsPath)) {
  const declared = new Map(
    readFileSync(sha256sumsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [digest, name] = line.trim().split(/\s+/);
        return [name ?? "", digest ?? ""] as const;
      }),
  );
  const entry = declared.get(path.basename(sqlitePath));
  check("SHA256SUMS carries the full export", entry !== undefined);
  check("SHA256SUMS agrees with the manifest", entry === manifest.file_checksums.sqlite_sha256);
}

// The build host's filesystem layout is not a consumer's business, and it shipped in v3.
const manifestText = JSON.stringify(manifest);
check(
  "no manifest field carries an absolute path",
  !/"[^"]*(?:\/(?:home|mnt|Users|var|opt)\/|[A-Za-z]:\\\\)[^"]*"/.test(manifestText),
);

// ---- full SQLite ----
process.stdout.write("\n=== full SQLite profile ===\n");
const database = new Database(sqlitePath, { readonly: true });
const widths = database.query("select json_array_length(vector_json) as w, count(*) as n from tracks group by 1").all() as Array<{ w: number; n: number }>;
check("every stored vector has one width", widths.length === 1, widths.map((row) => `${row.w}x${row.n}`).join(", "));
check("that width matches the manifest", widths[0]?.w === manifest.vector_dimensions, String(widths[0]?.w));
const engines = database.query("select count(distinct render_engine) as n from tracks").get() as { n: number };
check("a single render engine", engines.n === 1);
const ratingSpread = database.query("select count(distinct e) as e, count(distinct m) as m, count(distinct c) as c from tracks").get() as { e: number; m: number; c: number };
check(
  "all three rating scales use five levels",
  ratingSpread.e === 5 && ratingSpread.m === 5 && ratingSpread.c === 5,
  `e=${ratingSpread.e} m=${ratingSpread.m} c=${ratingSpread.c}`,
);
// F1b -- the manifest reported tracks x k rather than the measured row count, and u64deck
// hard-fails its import on a mismatch with no fallback.
const neighborRows = database.query("select count(*) as n from neighbors").get() as { n: number };
check(
  "manifest neighbour count is the measured one",
  manifest.neighbor_row_count === neighborRows.n,
  `manifest ${manifest.neighbor_row_count} vs table ${neighborRows.n}`,
);
const seedRow = database.query("select sid_path, song_index from tracks where vector_json is not null limit 1").get() as { sid_path: string; song_index: number };
database.close();

const seedTrackId = buildSimilarityTrackId(seedRow.sid_path, seedRow.song_index);
const stationSize = Math.min(STATION_SIZE, Math.max(1, manifest.track_count - 1));
const fromSeed = recommendFromSeedTrack(sqlitePath, { seedTrackId, limit: stationSize });
check(
  `a seed yields ${stationSize} recommendations, not the stored neighbour count`,
  fromSeed.length === stationSize,
  `${fromSeed.length} returned`,
);
check("the seed is never recommended back", !fromSeed.some((entry) => entry.track_id === seedTrackId));
check("recommendations are ranked by descending similarity", fromSeed.every((entry, index) => index === 0 || entry.score <= fromSeed[index - 1]!.score));
check("similarity stays in [0,1]", fromSeed.every((entry) => entry.score >= 0 && entry.score <= 1 + 1e-9));
check("no duplicate recommendations", new Set(fromSeed.map((entry) => entry.track_id)).size === fromSeed.length);

const fromFavorites = recommendFromFavorites(sqlitePath, { favoriteTrackIds: [seedTrackId], limit: stationSize });
check(`favourites yield ${stationSize} recommendations`, fromFavorites.length === stationSize, `${fromFavorites.length} returned`);

// ---- lite ----
process.stdout.write("\n=== lite profile ===\n");
const lite = await openLiteSimilarityDataset(litePath);
check("reports the whole corpus", lite.info.trackCount === manifest.track_count, String(lite.info.trackCount));
const liteRecommendations = lite.recommendFromFavorites({ favoriteTrackIds: [seedTrackId], limit: stationSize });
check(`builds a ${stationSize}-track station`, liteRecommendations.length === stationSize, `${liteRecommendations.length} returned`);
check("never returns the seed", !liteRecommendations.some((entry) => entry.track_id === seedTrackId));

// ---- tiny ----
process.stdout.write("\n=== tiny profile ===\n");
const tiny = await openTinySimilarityDataset(tinyPath, { hvscRoot: HVSC });
check("reports the whole corpus", tiny.info.trackCount === manifest.track_count, String(tiny.info.trackCount));
// The regression that mattered: resolution against a real nested HVSC layout.
const resolved = tiny.resolveTrack(seedTrackId);
check("resolves a track id against a real HVSC layout", resolved !== null, seedTrackId);
// This profile stores no vectors. Reporting that it does was how a synthesised 4-element
// rating vector came to be handed to consumers doing centroid arithmetic.
check("declares that it carries no vectors", tiny.info.hasVectorData === false);
check("returns no vectors", tiny.getTrackVectors([seedTrackId]).size === 0);

const tinyRecommendations = tiny.recommendFromFavorites({ favoriteTrackIds: [seedTrackId], limit: stationSize });
check("returns recommendations at all", tinyRecommendations.length > 0, `${tinyRecommendations.length} returned`);
// `every` passes as soon as ONE recommendation differs from the seed, which is not the
// property anyone wanted asserted.
check("never returns the seed", !tinyRecommendations.some((entry) => entry.track_id === seedTrackId));

// F7 -- the favourites ranking computed a neighbour walk and then overwrote every score
// with a cosine over [e, m, c, p ?? 3]. The old assertion could not see it: the overwrite
// guaranteed a non-empty result for every seed.
const storedNeighbors = tiny.getNeighbors(seedTrackId, 3);
check("the seed has stored neighbour edges", storedNeighbors.length > 0, `${storedNeighbors.length} edges`);
if (storedNeighbors.length > 0) {
  const recommended = new Set(tinyRecommendations.map((entry) => entry.track_id));
  const present = storedNeighbors.filter((neighbor) => recommended.has(neighbor.track_id));
  check(
    "the seed's own stored neighbours appear in its recommendations",
    present.length === storedNeighbors.length,
    `${present.length}/${storedNeighbors.length}`,
  );
}
// The rating vector reaches at most 125 distinct values corpus-wide, so a ranking that
// takes more than that cannot be the rating cosine in disguise.
const distinctScores = new Set(tinyRecommendations.map((entry) => entry.score.toFixed(12)));
// Two things have gone wrong with this field, and each needs its own assertion.
//
// Clamping the accumulated walk score to [-1, 1] reported an entire top-100 as exactly
// 1.0, so the scores must take more than one value. A single distinct value is the
// signature of that defect and of nothing else.
check(
  "the ranking is not one flat value",
  distinctScores.size > 1,
  `${distinctScores.size} distinct over ${tinyRecommendations.length}`,
);

// Normalising against the strongest match reported a RANK rather than a similarity, and a
// rank is indistinguishable from a similarity by counting distinct values. What separates
// them is scale: a direct stored neighbour's reported score must BE its stored edge
// similarity, because its best path is one edge long. That also fails against the
// rating-cosine defect, whose scores had nothing to do with the graph.
//
// Counting distinct values is deliberately not used to catch either: the edge similarities
// are 8-bit quantised, so products along short paths land on a bounded set — 35 distinct
// over 100 on the shipped bundle — and a threshold tuned to that would be arbitrary.
if (storedNeighbors.length > 0) {
  const scoreByTrackId = new Map(tinyRecommendations.map((entry) => [entry.track_id, entry.score]));
  const mismatched = storedNeighbors.filter((neighbor) => {
    const reported = scoreByTrackId.get(neighbor.track_id);
    return reported === undefined || Math.abs(reported - neighbor.score) > 1e-6;
  });
  check(
    "a direct neighbour's score is its stored edge similarity",
    mismatched.length === 0,
    mismatched.map((neighbor) => `${neighbor.track_id} ${scoreByTrackId.get(neighbor.track_id)} vs ${neighbor.score}`).join("; "),
  );
}

// ---- station populations ----
process.stdout.write("\n=== station populations ===\n");
const tinyManifestPath = `${tinyPath.replace(/\.sidcorr$/, "")}.manifest.json`;
const tinyManifest = JSON.parse(readFileSync(tinyManifestPath, "utf8")) as {
  track_count: number;
  style_populations?: Record<string, number>;
  style_population_policy?: typeof DEFAULT_STYLE_POPULATION_POLICY;
  style_population_waiver?: string[];
};

check("publishes per-style populations", tinyManifest.style_populations !== undefined);
check("publishes the gate thresholds it ran with", tinyManifest.style_population_policy !== undefined);
// A bundle built under --allow-sparse-styles and published by mistake is exactly what this
// catches: the waiver travels with the artefact rather than living in a build log.
check(
  "was not built under a population waiver",
  tinyManifest.style_population_waiver === undefined,
  tinyManifest.style_population_waiver?.join("; ") ?? "",
);

// Recount from the mask table rather than trusting the manifest, and do it whether or not
// the manifest publishes populations at all. These are the checks that catch the 0.7.0
// defects -- a station with no members, two stations sharing 10.8% of the corpus -- and a
// bundle old enough to lack style_populations is exactly the one that has them.
{
  const payload = readFileSync(tinyPath);
  const trackCount = payload.readUInt32LE(12);
  const styleMaskOffset = payload.readUInt32LE(44);
  const masks: number[] = new Array(trackCount);
  for (let index = 0; index < trackCount; index += 1) {
    masks[index] = payload.readUInt16LE(styleMaskOffset + (index * 2));
  }
  const recounted = countStylePopulations(masks);
  if (tinyManifest.style_populations) {
    // Compare per key: the manifest is written with deterministic (sorted) key order and
    // the recount is in PERSONA_IDS order, so a whole-object stringify would compare
    // orderings rather than populations.
    const mismatched = PERSONA_IDS.filter(
      (personaId) => (tinyManifest.style_populations?.[personaId] ?? -1) !== (recounted[personaId] ?? -2),
    );
    check(
      "manifest populations match a recount from the bundle",
      mismatched.length === 0,
      mismatched.map((personaId) => `${personaId}: manifest ${tinyManifest.style_populations?.[personaId]} vs bundle ${recounted[personaId]}`).join("; "),
    );
  }

  for (const personaId of PERSONA_IDS) {
    const count = recounted[personaId] ?? 0;
    check(`${personaId} can play something`, count > 0, `${count} tracks`);
  }

  const policy = tinyManifest.style_population_policy ?? DEFAULT_STYLE_POPULATION_POLICY;
  const counts = PERSONA_IDS.map((personaId) => recounted[personaId] ?? 0);
  const floor = Math.min(
    Math.max(policy.minimumAbsolute, Math.ceil(policy.minimumShare * tinyManifest.track_count)),
    Math.max(1, Math.round(policy.targetShare * tinyManifest.track_count)),
  );
  check("every station clears the floor", Math.min(...counts) >= floor, `smallest ${Math.min(...counts)}, floor ${floor}`);
  check(
    "no station admits more than the ceiling",
    Math.max(...counts) <= Math.max(1, Math.floor(policy.maximumShare * tinyManifest.track_count)),
    `largest ${Math.max(...counts)}`,
  );
  check(
    "the spread between largest and smallest is bounded",
    Math.max(...counts) / Math.max(1, Math.min(...counts)) <= policy.maximumSpreadRatio,
    `${(Math.max(...counts) / Math.max(1, Math.min(...counts))).toFixed(2)}x`,
  );

  // 10.8% of the 0.7.0 corpus carried both fast_paced and slow_ambient -- two station
  // tiles a listener experiences as opposites, playing ~9,500 of the same tunes.
  for (const [left, right] of STYLE_CONFLICT_PAIRS) {
    const leftBit = 1 << PERSONA_IDS.indexOf(left);
    const rightBit = 1 << PERSONA_IDS.indexOf(right);
    const shared = masks.filter((mask) => (mask & leftBit) !== 0 && (mask & rightBit) !== 0).length;
    check(`${left} and ${right} share no tracks`, shared === 0, `${shared} shared`);
  }

  // Run the export's own gate against the finished artefact. The populations are all it
  // can recompute from bytes -- tie fractions and score distinctness need the scores --
  // but those are the checks that catch a starved or lopsided station after the fact.
  const gateViolations = evaluateStylePopulationGate(
    {
      populations: recounted,
      tieShareAtCut: Object.fromEntries(PERSONA_IDS.map((id) => [id, 0])) as Record<(typeof PERSONA_IDS)[number], number>,
      distinctScores: Object.fromEntries(PERSONA_IDS.map((id) => [id, Number.MAX_SAFE_INTEGER])) as Record<(typeof PERSONA_IDS)[number], number>,
      maximumPairwiseJaccard: 0,
      maximumPairwiseJaccardPersonas: null,
      conflictOverlaps: STYLE_CONFLICT_PAIRS.map(([left, right]) => {
        const leftBit = 1 << PERSONA_IDS.indexOf(left);
        const rightBit = 1 << PERSONA_IDS.indexOf(right);
        return {
          personas: [left, right] as [(typeof PERSONA_IDS)[number], (typeof PERSONA_IDS)[number]],
          tracks: masks.filter((mask) => (mask & leftBit) !== 0 && (mask & rightBit) !== 0).length,
        };
      }),
    },
    policy,
    tinyManifest.track_count,
  );
  check("the shipped bundle passes the export's own gate", gateViolations.length === 0, gateViolations.join("; "));
}

process.stdout.write(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
