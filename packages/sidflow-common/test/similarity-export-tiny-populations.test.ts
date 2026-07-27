/**
 * The tiny bundle publishes its station populations, and a bundle built under a waiver
 * says so.
 *
 * The 0.7.0 export had no notion of how big a station was, which is why it shipped one
 * persona with 0 members and another with 673 while five carried ~45,000 each. Two
 * artefact-level guarantees close that:
 *
 *  - `style_populations` in the manifest matches a recount from the bundle's own mask
 *    table, so a consumer can size a station tile at download time without a full pass;
 *  - a bundle built with `--allow-sparse-styles` carries `style_population_waiver`
 *    listing what it bypassed, so it can never be mistaken for one that passed.
 *
 * The second matters more than it looks. The waiver is the only thing standing between a
 * deliberately-relaxed private build and a public release that quietly ships a dead
 * station, and a flag whose effect lives only in a build log is not a record.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  countStylePopulations,
  PERSONA_IDS,
  SIMILARITY_VECTOR_WEIGHTS,
  StylePopulationGateError,
} from "../src/index.js";

const STYLE_MASK_OFFSET_FIELD = 44;
const TRACK_COUNT_FIELD = 12;

function readStyleMasks(payload: Buffer): number[] {
  const trackCount = payload.readUInt32LE(TRACK_COUNT_FIELD);
  const styleMaskOffset = payload.readUInt32LE(STYLE_MASK_OFFSET_FIELD);
  return Array.from({ length: trackCount }, (_unused, index) => payload.readUInt16LE(styleMaskOffset + (index * 2)));
}

describe("tiny profile station populations", () => {
  let tempRoot: string;
  let hvscRoot: string;
  let musicRoot: string;
  let sqlitePath: string;
  let litePath: string;
  let tinyPath: string;

  /**
   * Build a corpus through the real export chain.
   *
   * `degenerate` collapses every track onto one rating cell, which is what a corpus with
   * no usable spread looks like to the gate: the personas rank it identically, so their
   * member sets become indistinguishable and the distinctness check fires.
   */
  async function buildChain(trackCount: number, degenerate: boolean): Promise<void> {
    const classifiedPath = path.join(tempRoot, "classified");
    await mkdir(classifiedPath, { recursive: true });

    const lines: string[] = [];
    for (let index = 0; index < trackCount; index += 1) {
      // A long-tailed composer distribution, like the real thing: on HVSC 68% of composers
      // have exactly one tune while a handful have hundreds, and composer_focus is scored
      // on how large a body of work a composer has. A fixture with 40 equally prolific
      // composers gives that signal almost no variation, and the gate correctly refuses to
      // build because composer_focus collapses onto melodic.
      const composer = `Composer_${String(Math.floor(Math.sqrt(index))).padStart(3, "0")}`;
      const relative = `MUSICIANS/C/${composer}/Tune_${index}.sid`;
      const onDisk = path.join(musicRoot, relative);
      await mkdir(path.dirname(onDisk), { recursive: true });

      // A minimal PSID header, so the hybrid personas read real metadata rather than
      // falling back to the path for every track — which is the condition the 0.7.0
      // export shipped under and the gate exists to catch.
      const header = Buffer.alloc(0x7c);
      header.write("PSID", 0, "ascii");
      header.writeUInt16BE(2, 4);
      header.writeUInt16BE(0x7c, 6);
      header.writeUInt16BE(1, 14);
      header.writeUInt16BE(1, 16);
      header.write(`Tune ${index} Adventure Quest Night`.slice(0, 31), 0x16, "latin1");
      header.write(composer.replace(/_/g, " ").slice(0, 31), 0x36, "latin1");
      header.write(`${1982 + (index % 40)} ${composer}`.slice(0, 31), 0x56, "latin1");
      await writeFile(onDisk, Buffer.concat([header, Buffer.from(`payload-${index}`, "utf8")]));

      const angle = (index / trackCount) * Math.PI * 2;
      lines.push(JSON.stringify({
        sid_path: relative,
        song_index: 1,
        ratings: degenerate
          ? { e: 3, m: 3, c: 3, p: 3 }
          : {
            e: (index % 5) + 1,
            m: (Math.floor(index / 5) % 5) + 1,
            c: (Math.floor(index / 25) % 5) + 1,
            p: 3,
          },
        features: { bpm: 100 + (index % 60) },
        vector: Array.from(
          { length: SIMILARITY_VECTOR_WEIGHTS.length },
          (_unused, dimension) => Math.sin(angle * (1 + (dimension % 5))) + (0.01 * ((index * dimension) % 13)),
        ),
        classified_at: `2026-07-27T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      corpusVersion: "populations",
      neighbors: 5,
    });
    await buildLiteSimilarityExport({
      sourceSqlitePath: sqlitePath,
      outputPath: litePath,
      corpusVersion: "populations",
    });
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-populations-"));
    hvscRoot = path.join(tempRoot, "hvsc");
    musicRoot = path.join(hvscRoot, "C64Music");
    sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    tinyPath = path.join(tempRoot, "exports", "tiny.sidcorr");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("the manifest's populations match a recount from the bundle", async () => {
    await buildChain(1500, false);
    const tiny = await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: musicRoot,
      outputPath: tinyPath,
      corpusVersion: "populations",
      neighborSqlitePath: sqlitePath,
    });

    expect(tiny.manifest.style_populations).toBeDefined();
    expect(tiny.manifest.style_population_policy).toBeDefined();
    // A build that passed carries no waiver at all, rather than an empty one.
    expect(tiny.manifest.style_population_waiver).toBeUndefined();

    const recounted = countStylePopulations(readStyleMasks(await readFile(tinyPath)));
    for (const personaId of PERSONA_IDS) {
      expect(tiny.manifest.style_populations?.[personaId]).toBe(recounted[personaId]);
      expect(recounted[personaId]).toBeGreaterThan(0);
    }
  });

  test("a corpus that cannot support nine stations fails the export", async () => {
    await buildChain(1500, true);
    await expect(buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: musicRoot,
      outputPath: tinyPath,
      corpusVersion: "populations",
      neighborSqlitePath: sqlitePath,
    })).rejects.toThrow(StylePopulationGateError);
  });

  test("--allow-sparse-styles permits the build and records the waiver in the manifest", async () => {
    await buildChain(1500, true);
    const tiny = await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: musicRoot,
      outputPath: tinyPath,
      corpusVersion: "populations",
      neighborSqlitePath: sqlitePath,
      allowSparseStyles: true,
    });

    expect(tiny.manifest.style_population_waiver).toBeDefined();
    expect(tiny.manifest.style_population_waiver!.length).toBeGreaterThan(0);
    // The waiver travels with the artefact rather than living in a build log, so reading
    // the published manifest is enough to tell the two kinds of bundle apart.
    const written = JSON.parse(await readFile(tiny.manifestPath, "utf8")) as {
      style_population_waiver?: string[];
    };
    expect(written.style_population_waiver).toEqual(tiny.manifest.style_population_waiver!);
  });
});
