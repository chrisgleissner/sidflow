#!/usr/bin/env bun
/**
 * Build a small but complete similarity export chain, so CI can run the release gate.
 *
 * The gate that matters is `scripts/verify-published-exports.ts`, and until now it could
 * only run against a real 1 GB HVSC export — which means it ran when someone remembered
 * to run it, which is how a release shipped a station tile that could never play anything
 * and a manifest digest that had never matched its file.
 *
 * This produces the same three profiles plus a features sidecar from a synthetic corpus
 * small enough to build in seconds, going through `buildSimilarityExport` ->
 * `buildLiteSimilarityExport` -> `buildTinySimilarityExport` rather than writing bundles
 * directly. A fixture assembled by hand would prove only that the fixture is
 * well-formed.
 *
 * The corpus is sized past the population gate's semantic-check threshold on purpose, so
 * CI exercises the tie-fraction and distinctness checks rather than the small-corpus
 * escape hatch.
 *
 *   bun run scripts/ci/build-similarity-fixture.ts --out workspace/similarity-fixture
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildFeaturesSidecarExport,
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  SIMILARITY_VECTOR_WEIGHTS,
} from "../../packages/sidflow-common/src/index.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};

const OUT = path.resolve(arg("--out") ?? "workspace/similarity-fixture");
const TRACK_COUNT = Number.parseInt(arg("--tracks") ?? "1200", 10);
const NEIGHBORS = Number.parseInt(arg("--neighbors") ?? "25", 10);

/**
 * A geometry with genuine structure rather than noise.
 *
 * Tracks sit on a low-frequency manifold so neighbours are meaningful and the lite
 * quantiser has something to preserve; ratings cycle through all 125 (e, m, c) cells so
 * no persona is starved by the fixture itself.
 */
function vectorFor(index: number): number[] {
  const angle = (index / TRACK_COUNT) * Math.PI * 2;
  return Array.from({ length: SIMILARITY_VECTOR_WEIGHTS.length }, (_unused, dimension) => (
    Math.sin(angle * (1 + (dimension % 5))) * (1 + (dimension % 3))
    + (0.01 * ((index * (dimension + 7)) % 17))
  ));
}

async function main(): Promise<number> {
  const classifiedPath = path.join(OUT, "classified");
  const feedbackPath = path.join(OUT, "feedback");
  const hvscRoot = path.join(OUT, "hvsc");
  const musicRoot = path.join(hvscRoot, "C64Music");
  const exportsPath = path.join(OUT, "exports");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(classifiedPath, { recursive: true });
  await mkdir(feedbackPath, { recursive: true });
  await mkdir(exportsPath, { recursive: true });

  const categories = ["MUSICIANS", "GAMES", "DEMOS"];
  const lines: string[] = [];

  /**
   * A long-tailed composer distribution, like the real thing.
   *
   * On HVSC, 68% of composers have exactly one tune while a handful have hundreds, and
   * `composer_focus` is scored on how large a body of work a composer has. A fixture with
   * five equally prolific composers gives that signal five distinct values, which collapses
   * the station onto `melodic` — the population gate catches it, correctly, and refuses to
   * build. `floor(sqrt())` reproduces the shape cheaply: composer 0 gets 1 tune, composer
   * 30 gets 61.
   */
  const composerFor = (index: number): string => `Composer_${String(Math.floor(Math.sqrt(index))).padStart(3, "0")}`;

  for (let index = 0; index < TRACK_COUNT; index += 1) {
    const category = categories[index % categories.length]!;
    const composer = composerFor(index);
    const relative = category === "MUSICIANS"
      ? `MUSICIANS/${composer[0]}/${composer}/Tune_${index}.sid`
      : `${category}/${String.fromCharCode(65 + (index % 6))}/Tune_${index}.sid`;

    const onDisk = path.join(musicRoot, relative);
    await mkdir(path.dirname(onDisk), { recursive: true });
    // A minimal PSID header, so the tiny builder's metadata parse has something real to
    // read rather than falling back to the path for every track.
    const header = Buffer.alloc(0x7c);
    header.write("PSID", 0, "ascii");
    header.writeUInt16BE(2, 4);
    header.writeUInt16BE(0x7c, 6);
    header.writeUInt16BE(1, 14);
    header.writeUInt16BE(1, 16);
    header.write(`Tune ${index} Adventure Quest`.slice(0, 31), 0x16, "latin1");
    header.write(composer.replace(/_/g, " ").slice(0, 31), 0x36, "latin1");
    header.write(`${1982 + (index % 40)} ${composer}`.slice(0, 31), 0x56, "latin1");
    await writeFile(onDisk, Buffer.concat([header, Buffer.from(`payload-${index}`, "utf8")]));

    lines.push(JSON.stringify({
      sid_path: relative,
      song_index: 1,
      ratings: {
        e: (index % 5) + 1,
        m: (Math.floor(index / 5) % 5) + 1,
        c: (Math.floor(index / 25) % 5) + 1,
        p: 3,
      },
      features: { bpm: 90 + (index % 80), rms: (index % 100) / 100 },
      vector: vectorFor(index),
      classified_at: new Date(Date.UTC(2026, 6, 27, 0, 0, index % 60)).toISOString(),
      source: "auto",
      render_engine: "wasm",
      sid_engine: "sidlite",
    }));
  }

  await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

  const sqlitePath = path.join(exportsPath, "sidcorr-fixture-full-sidcorr-1.sqlite");
  const litePath = path.join(exportsPath, "sidcorr-fixture-full-sidcorr-lite-1.sidcorr");
  const tinyPath = path.join(exportsPath, "sidcorr-fixture-full-sidcorr-tiny-1.sidcorr");
  const featuresPath = path.join(exportsPath, "sidcorr-fixture-full-features-1.jsonl.gz");

  process.stdout.write(`Building fixture corpus of ${TRACK_COUNT} tracks in ${OUT}\n`);

  const full = await buildSimilarityExport({
    classifiedPath,
    feedbackPath,
    outputPath: sqlitePath,
    corpusVersion: "fixture",
    hvscVersion: "HVSC fixture",
    neighbors: NEIGHBORS,
  });
  process.stdout.write(`  full  ${full.manifest.track_count} tracks, ${full.manifest.vector_dimensions} dims, ${full.manifest.neighbor_row_count} neighbour rows\n`);

  const lite = await buildLiteSimilarityExport({
    sourceSqlitePath: sqlitePath,
    outputPath: litePath,
    corpusVersion: "fixture",
  });
  process.stdout.write(`  lite  ${lite.manifest.bundle_bytes} bytes\n`);

  const tiny = await buildTinySimilarityExport({
    sourceLitePath: litePath,
    hvscRoot: musicRoot,
    outputPath: tinyPath,
    corpusVersion: "fixture",
    neighborSqlitePath: sqlitePath,
  });
  process.stdout.write(`  tiny  ${tiny.manifest.bundle_bytes} bytes\n`);
  for (const [styleKey, count] of Object.entries(tiny.manifest.style_populations ?? {})) {
    process.stdout.write(`        ${styleKey.padEnd(16)} ${count}\n`);
  }

  const features = await buildFeaturesSidecarExport({
    sourceSqlitePath: sqlitePath,
    outputPath: featuresPath,
    corpusVersion: "fixture",
  });
  process.stdout.write(`  features ${features.manifest.bundle_bytes} bytes\n`);

  process.stdout.write(`\nFixture ready. Verify it with:\n`);
  process.stdout.write(
    `  bun run scripts/verify-published-exports.ts --scale fixture --exports ${exportsPath} --hvsc ${hvscRoot}\n`,
  );
  return 0;
}

process.exit(await main());
