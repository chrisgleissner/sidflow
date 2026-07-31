/**
 * The tiny bundle's neighbour graph is a navigable proximity index.
 *
 * ## What it is not, any more
 *
 * Through 0.8.0 and 0.8.2 the exported edges were required to form a directed acyclic graph,
 * which is a playback policy — "never play the same tune twice" — expressed as a structural
 * constraint on the artefact. 0.8.0 satisfied it by orienting edges by track ordinal, which is
 * alphabetical `sid_path` position: measured on that published bundle over 87,868 tracks, 28.08%
 * of tracks had no incoming edge, 3.17% had no outgoing edge, and 6.69% of the slot capacity
 * shipped empty. 0.8.2 satisfied it by threading a Hamiltonian path through the graph, which
 * made a forward walk long but left the graph unsearchable and 14.76% of its capacity empty, and
 * has been withdrawn.
 *
 * The artefact now carries no traversal order and makes no acyclicity promise. Not revisiting a
 * track is the player's job, and every player already keeps a set of what it has played.
 *
 * Every assertion below reads the shipped bytes rather than the builder's return value, because
 * the bytes are what a consumer gets. `doc/neighbour-graph-design.md` records the corpus-scale
 * measurements these properties were chosen from.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  SIMILARITY_VECTOR_WEIGHTS,
} from "../src/index.js";

const TRACK_COUNT_FIELD = 12;
const GRAPH_FLAGS_FIELD = 30;
const NEIGHBORS_OFFSET_FIELD = 48;
const NEIGHBORS_PER_TRACK = 3;
const NEIGHBOR_RECORD_BYTES = 4;
const EMPTY_NEIGHBOR = 0xffffff;
const GRAPH_FLAG_ACYCLIC = 1 << 0;
const GRAPH_FLAG_RESERVED_LEGACY = (1 << 1) | (1 << 2);
const GRAPH_FLAG_FLOW_SUCCESSOR_FIRST = 1 << 3;

const TRACK_COUNT = 1200;
/**
 * Per-test timeout for every test that touches the fixture.
 *
 * The fixture must not be built in `beforeAll`. Bun caps hooks at a hardcoded 5 seconds
 * and ignores the `timeout` setting in `bunfig.toml` for them, on both the pinned 1.3.1
 * and the 1.3.11 used by CI. Building this chain takes roughly 2 seconds locally and
 * about 4.5 seconds on a CI runner, so a `beforeAll` sat just under the cap and crossed
 * it whenever the runner was slower than usual — the failure seen in CI run 30637626423,
 * reported as "a beforeEach/afterEach hook timed out for this test".
 *
 * Passing an explicit timeout to `beforeAll` is not a portable fix either: 1.3.11 accepts
 * the argument but 1.3.1 rejects it, and the rejection happens at collection time, so
 * every test in the file errors out before it runs.
 *
 * The fixture is therefore built lazily by `getFixture()` and awaited by each test, which
 * does honour an explicit per-test timeout. It is still built only once for the file.
 */
const FIXTURE_TIMEOUT_MS = 180_000;

interface Graph {
  trackCount: number;
  graphFlags: number;
  /** `targets[track][slot]`, with unpopulated slots dropped. */
  targets: number[][];
  /** `similarities[track][slot]`, aligned with `targets`. */
  similarities: number[][];
}

function readGraph(payload: Buffer): Graph {
  const trackCount = payload.readUInt32LE(TRACK_COUNT_FIELD);
  const neighborsOffset = payload.readUInt32LE(NEIGHBORS_OFFSET_FIELD);
  const targets: number[][] = [];
  const similarities: number[][] = [];
  for (let track = 0; track < trackCount; track += 1) {
    const row: number[] = [];
    const scores: number[] = [];
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const offset = neighborsOffset
        + (track * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES)
        + (slot * NEIGHBOR_RECORD_BYTES);
      const target = payload[offset]! | (payload[offset + 1]! << 8) | (payload[offset + 2]! << 16);
      if (target !== EMPTY_NEIGHBOR) {
        row.push(target);
        scores.push(((payload[offset + 3]! / 255) * 2) - 1);
      }
    }
    targets.push(row);
    similarities.push(scores);
  }
  return { trackCount, graphFlags: payload.readUInt16LE(GRAPH_FLAGS_FIELD), targets, similarities };
}

/** Kahn's algorithm; returns a topological order, or null if the graph has a cycle. */
function topologicalOrder(graph: Graph): number[] | null {
  const inDegree = new Int32Array(graph.trackCount);
  for (const row of graph.targets) {
    for (const target of row) {
      inDegree[target] += 1;
    }
  }
  const queue: number[] = [];
  for (let track = 0; track < graph.trackCount; track += 1) {
    if (inDegree[track] === 0) {
      queue.push(track);
    }
  }
  const order: number[] = [];
  while (queue.length > 0) {
    const track = queue.pop()!;
    order.push(track);
    for (const target of graph.targets[track]!) {
      inDegree[target] -= 1;
      if (inDegree[target] === 0) {
        queue.push(target);
      }
    }
  }
  return order.length === graph.trackCount ? order : null;
}

interface Fixture {
  tempRoot: string;
  musicRoot: string;
  sqlitePath: string;
  litePath: string;
  tinyPath: string;
  graph: Graph;
  payload: Buffer;
}

describe("tiny profile neighbour graph", () => {
  let fixturePromise: Promise<Fixture> | null = null;
  /**
   * Recorded as soon as the directory exists, rather than read back from the resolved
   * fixture, so that a build which fails after `mkdtemp` still gets cleaned up.
   */
  let tempRootForCleanup: string | null = null;

  /** Builds the chain on first call and hands every later caller the same result. */
  function getFixture(): Promise<Fixture> {
    fixturePromise ??= buildFixture();
    return fixturePromise;
  }

  async function buildFixture(): Promise<Fixture> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-flow-"));
    tempRootForCleanup = tempRoot;
    const classifiedPath = path.join(tempRoot, "classified");
    const musicRoot = path.join(tempRoot, "hvsc", "C64Music");
    const sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    const litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    const tinyPath = path.join(tempRoot, "exports", "tiny.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    const lines: string[] = [];
    for (let index = 0; index < TRACK_COUNT; index += 1) {
      // The same long-tailed composer distribution the populations fixture uses, because
      // the style gate runs on this chain too and a flat distribution fails it.
      const composer = `Composer_${String(Math.floor(Math.sqrt(index))).padStart(3, "0")}`;
      const relative = `MUSICIANS/C/${composer}/Tune_${index}.sid`;
      const onDisk = path.join(musicRoot, relative);
      await mkdir(path.dirname(onDisk), { recursive: true });

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

      const angle = (index / TRACK_COUNT) * Math.PI * 2;
      lines.push(JSON.stringify({
        sid_path: relative,
        song_index: 1,
        ratings: {
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
        classified_at: `2026-07-30T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
        source: "auto",
        render_engine: "wasm",
      }));
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      corpusVersion: "flow",
      neighbors: 25,
    });
    await buildLiteSimilarityExport({
      sourceSqlitePath: sqlitePath,
      outputPath: litePath,
      corpusVersion: "flow",
    });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: musicRoot,
      outputPath: tinyPath,
      corpusVersion: "flow",
      neighborSqlitePath: sqlitePath,
    });

    const payload = await readFile(tinyPath);
    return { tempRoot, musicRoot, sqlitePath, litePath, tinyPath, payload, graph: readGraph(payload) };
  }

  afterAll(async () => {
    // Wait for an in-flight build before removing anything, so the directory is not deleted
    // underneath it. The failure itself is reported by whichever test awaited the fixture;
    // it is logged here only because it must not stop the cleanup below.
    if (fixturePromise !== null) {
      await fixturePromise.catch((error: unknown) => {
        console.debug(`[tiny-graph] fixture build failed, cleaning up anyway: ${String(error)}`);
      });
    }
    if (tempRootForCleanup !== null) {
      await rm(tempRootForCleanup, { recursive: true, force: true });
    }
  });

  test("the header no longer claims acyclicity or a flow successor", async () => {
    const { graph } = await getFixture();
    // Withdrawn deliberately, not by accident: the promise was never the artefact's to make.
    // The two legacy reserved bits stay set, because a consumer may depend on the literal value
    // even though the specification tells it not to.
    expect(graph.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(0);
    expect(graph.graphFlags & GRAPH_FLAG_FLOW_SUCCESSOR_FIRST).toBe(0);
    expect(graph.graphFlags & GRAPH_FLAG_RESERVED_LEGACY).toBe(GRAPH_FLAG_RESERVED_LEGACY);
  }, FIXTURE_TIMEOUT_MS);

  test("every slot carries a real edge", async () => {
    const { graph } = await getFixture();
    // 0.8.0 shipped 6.69% of its slot capacity as sentinels and 0.8.2 shipped 14.76%, both
    // because an edge that would have violated acyclicity was dropped rather than replaced.
    // With no such constraint there is no reason for any slot to be empty on a corpus this size.
    for (let track = 0; track < graph.trackCount; track += 1) {
      expect(graph.targets[track]!.length).toBe(NEIGHBORS_PER_TRACK);
    }
  }, FIXTURE_TIMEOUT_MS);

  test("no row repeats a target or points at itself", async () => {
    const { graph } = await getFixture();
    for (let track = 0; track < graph.trackCount; track += 1) {
      const row = graph.targets[track]!;
      expect(new Set(row).size).toBe(row.length);
      expect(row).not.toContain(track);
    }
  }, FIXTURE_TIMEOUT_MS);

  test("every row is in descending similarity order", async () => {
    const { graph } = await getFixture();
    // Slot 0 is the nearest kept neighbour again. 0.8.2 put a traversal successor there, which
    // left 46.09% of the published rows out of similarity order and broke the assumption
    // c64commander's rank weighting (`neighbors - slot`) makes.
    for (let track = 0; track < graph.trackCount; track += 1) {
      const scores = graph.similarities[track]!;
      for (let slot = 1; slot < scores.length; slot += 1) {
        expect(scores[slot - 1]!).toBeGreaterThanOrEqual(scores[slot]!);
      }
    }
  }, FIXTURE_TIMEOUT_MS);

  test("every track has an incoming edge and an outgoing edge", async () => {
    const { graph } = await getFixture();
    // A track with no incoming edge is one a forward-only walk can never arrive at; on the
    // published 0.8.0 bundle that was 24,669 tracks. The construction's reverse-insertion pass
    // and its reachability repair together are what make this exact rather than approximate.
    const inDegree = new Int32Array(graph.trackCount);
    for (let track = 0; track < graph.trackCount; track += 1) {
      expect(graph.targets[track]!.length).toBeGreaterThan(0);
      for (const target of graph.targets[track]!) {
        inDegree[target] += 1;
      }
    }
    expect([...inDegree].filter((degree) => degree === 0)).toHaveLength(0);
  }, FIXTURE_TIMEOUT_MS);

  test("the corpus is a single undirected component", async () => {
    const { graph } = await getFixture();
    // What a station actually needs: it traverses forward and reverse edges, so a pocket it
    // cannot leave is a station that ends. Measured undirected for the same reason.
    const parent = new Int32Array(graph.trackCount);
    for (let track = 0; track < graph.trackCount; track += 1) {
      parent[track] = track;
    }
    const find = (node: number): number => {
      let root = node;
      while (parent[root] !== root) {
        root = parent[root]!;
      }
      return root;
    };
    for (let track = 0; track < graph.trackCount; track += 1) {
      for (const target of graph.targets[track]!) {
        const left = find(track);
        const right = find(target);
        if (left !== right) {
          parent[left] = right;
        }
      }
    }
    const roots = new Set<number>();
    for (let track = 0; track < graph.trackCount; track += 1) {
      roots.add(find(track));
    }
    expect(roots.size).toBe(1);
  }, FIXTURE_TIMEOUT_MS);

  test("the graph is no longer acyclic, and that is the point", async () => {
    const { graph } = await getFixture();
    // Not an incidental consequence. If A's nearest neighbour is B and B's is A, both edges are
    // true, and 0.8.0 discarded half the source graph's edges to avoid saying so.
    expect(topologicalOrder(graph)).toBeNull();
  }, FIXTURE_TIMEOUT_MS);

  test("edges reach beyond the seed's own nearest neighbours", async () => {
    const { graph } = await getFixture();
    // The property the pruning rule alone could not deliver. Every candidate the source export
    // offers sits within a narrow shell around the seed, so a graph confined to that pool has no
    // edge that crosses the space and cannot be searched. The construction draws its candidates
    // from a search over the graph instead, so some edges are much longer than the shell.
    //
    // Stated as a spread rather than an absolute threshold, because the fixture's geometry is
    // synthetic and only the corpus-scale numbers in the design document are meaningful.
    const allScores = graph.similarities.flat();
    const lowest = Math.min(...allScores);
    const highest = Math.max(...allScores);
    expect(highest - lowest).toBeGreaterThan(0.1);
  }, FIXTURE_TIMEOUT_MS);

  test("the build is deterministic", async () => {
    const { tempRoot, musicRoot, sqlitePath, litePath, payload } = await getFixture();
    const repeatPath = path.join(tempRoot, "exports", "tiny-repeat.sidcorr");
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot: musicRoot,
      outputPath: repeatPath,
      corpusVersion: "flow",
      neighborSqlitePath: sqlitePath,
    });
    expect(await readFile(repeatPath)).toEqual(payload);
  }, FIXTURE_TIMEOUT_MS);
});
