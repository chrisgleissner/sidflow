/**
 * The tiny bundle's neighbour graph carries a stream, not a drain.
 *
 * Until 0.8.2 the exported edges were oriented by track ordinal, which is alphabetical
 * `sid_path` position. Measured on the published 0.8.0 bundle over 87,868 tracks: the
 * longest forward path from the median track was 17, the longest anywhere was 79, 28.08%
 * of tracks had no incoming edge, 3.17% had no outgoing edge, and a rank-greedy forward
 * walk ran a median of 5 tracks. A station could only work by ignoring the direction the
 * export had gone to the trouble of enforcing.
 *
 * The edges are now oriented by a corpus-wide flow order and slot 0 of every row is the
 * track's flow successor, so the exported graph contains a Hamiltonian path and a forward
 * walk from any track can keep going until the order runs out.
 *
 * Every assertion below reads the shipped bytes rather than the builder's return value,
 * because the bytes are what a consumer gets. Three of them fail against the pre-0.8.2
 * builder: the Hamiltonian slot-0 chain, the absence of an ordinal constraint on edges,
 * and the forward-path depth.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
const GRAPH_FLAG_FLOW_SUCCESSOR_FIRST = 1 << 3;

const TRACK_COUNT = 1200;
/**
 * Per-test timeout for the two tests that build an export chain.
 *
 * `beforeAll` takes no timeout argument on the pinned Bun (1.3.1) — passing one makes the
 * whole file error out before a single test runs — so the fixture relies on the 120s
 * default from `bunfig.toml` and only the tests that build carry an explicit allowance.
 */
const FIXTURE_TIMEOUT_MS = 180_000;

interface Graph {
  trackCount: number;
  graphFlags: number;
  /** `targets[track][slot]`, with unpopulated slots dropped. */
  targets: number[][];
}

function readGraph(payload: Buffer): Graph {
  const trackCount = payload.readUInt32LE(TRACK_COUNT_FIELD);
  const neighborsOffset = payload.readUInt32LE(NEIGHBORS_OFFSET_FIELD);
  const targets: number[][] = [];
  for (let track = 0; track < trackCount; track += 1) {
    const row: number[] = [];
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const offset = neighborsOffset
        + (track * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES)
        + (slot * NEIGHBOR_RECORD_BYTES);
      const target = payload[offset]! | (payload[offset + 1]! << 8) | (payload[offset + 2]! << 16);
      if (target !== EMPTY_NEIGHBOR) {
        row.push(target);
      }
    }
    targets.push(row);
  }
  return { trackCount, graphFlags: payload.readUInt16LE(GRAPH_FLAGS_FIELD), targets };
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

/** Longest forward path from each track, computed over a topological order. */
function longestPaths(graph: Graph, order: number[]): Int32Array {
  const longest = new Int32Array(graph.trackCount);
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const track = order[index]!;
    let best = 0;
    for (const target of graph.targets[track]!) {
      if (longest[target]! + 1 > best) {
        best = longest[target]! + 1;
      }
    }
    longest[track] = best;
  }
  return longest;
}

function median(values: ArrayLike<number>): number {
  const sorted = [...Array.from(values)].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("tiny profile neighbour flow", () => {
  let tempRoot: string;
  let musicRoot: string;
  let sqlitePath: string;
  let litePath: string;
  let tinyPath: string;
  let graph: Graph;
  let payload: Buffer;

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-flow-"));
    const classifiedPath = path.join(tempRoot, "classified");
    musicRoot = path.join(tempRoot, "hvsc", "C64Music");
    sqlitePath = path.join(tempRoot, "exports", "full.sqlite");
    litePath = path.join(tempRoot, "exports", "lite.sidcorr");
    tinyPath = path.join(tempRoot, "exports", "tiny.sidcorr");
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

    payload = await readFile(tinyPath);
    graph = readGraph(payload);
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("the header declares an acyclic graph whose slot 0 is the flow successor", () => {
    expect(graph.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(GRAPH_FLAG_ACYCLIC);
    expect(graph.graphFlags & GRAPH_FLAG_FLOW_SUCCESSOR_FIRST).toBe(GRAPH_FLAG_FLOW_SUCCESSOR_FIRST);
  });

  test("the exported edges are acyclic", () => {
    expect(topologicalOrder(graph)).not.toBeNull();
  });

  test("edge direction no longer follows the track ordinal", () => {
    // The pre-0.8.2 rule was "every populated target MUST be a track ordinal strictly
    // smaller than the current track ordinal", which is what made the graph shallow. A
    // flow-oriented graph points both ways in ordinal terms.
    let forwardInOrdinal = 0;
    for (let track = 0; track < graph.trackCount; track += 1) {
      for (const target of graph.targets[track]!) {
        if (target > track) {
          forwardInOrdinal += 1;
        }
      }
    }
    expect(forwardInOrdinal).toBeGreaterThan(0);
  });

  test("slot 0 chains every track into a single path over the corpus", () => {
    const successor = new Int32Array(graph.trackCount).fill(-1);
    const successorInDegree = new Int32Array(graph.trackCount);
    let withoutSuccessor = 0;
    for (let track = 0; track < graph.trackCount; track += 1) {
      const first = graph.targets[track]![0];
      if (first === undefined) {
        withoutSuccessor += 1;
        continue;
      }
      successor[track] = first;
      successorInDegree[first] += 1;
    }
    // A path has exactly one end and exactly one start.
    expect(withoutSuccessor).toBe(1);
    expect([...successorInDegree].filter((degree) => degree === 0)).toHaveLength(1);
    expect([...successorInDegree].every((degree) => degree <= 1)).toBe(true);

    const start = [...successorInDegree].indexOf(0);
    const visited = new Set<number>([start]);
    let current = start;
    while (successor[current] !== -1) {
      current = successor[current]!;
      expect(visited.has(current)).toBe(false);
      visited.add(current);
    }
    expect(visited.size).toBe(graph.trackCount);
  });

  test("every track can be reached and every track but one can go somewhere", () => {
    const inDegree = new Int32Array(graph.trackCount);
    let withoutOut = 0;
    for (let track = 0; track < graph.trackCount; track += 1) {
      if (graph.targets[track]!.length === 0) {
        withoutOut += 1;
      }
      for (const target of graph.targets[track]!) {
        inDegree[target] += 1;
      }
    }
    expect(withoutOut).toBe(1);
    expect([...inDegree].filter((degree) => degree === 0)).toHaveLength(1);
  });

  test("a forward walk from the median track covers a large part of the corpus", () => {
    const order = topologicalOrder(graph);
    expect(order).not.toBeNull();
    const longest = longestPaths(graph, order!);
    // With a Hamiltonian path embedded, the median track reaches about half the corpus.
    // The published 0.8.0 bundle's median was 17 of 87,868.
    expect(median(longest)).toBeGreaterThanOrEqual(Math.floor(graph.trackCount / 4));
    expect(Math.min(...longest)).toBe(0);
    expect(Math.max(...longest)).toBe(graph.trackCount - 1);
  });

  test("the build is deterministic", async () => {
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
