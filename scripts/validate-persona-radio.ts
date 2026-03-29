#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import {
  loadConfig,
  lookupSongDurationMs,
  parseSidFile,
  cosineSimilarity,
  type SidflowConfig,
} from "@sidflow/common";
import {
  buildSelectionStatePath,
  buildStationQueue,
  inspectExportDatabase,
  runStationCli,
  writePersistedStationSelections,
  type StationRuntime,
  type StationTrackDetails,
} from "../packages/sidflow-play/src/station/index.js";

type PersonaDefinition = {
  id: string;
  label: string;
  predicate: (track: TrackRecord) => boolean;
};

type TrackRecord = {
  trackId: string;
  sidPath: string;
  songIndex: number;
  e: number;
  m: number;
  c: number;
  vector: number[];
};

type PersonaRunSummary = {
  id: string;
  label: string;
  seedTrackIds: string[];
  seedSidPaths: string[];
  stationTrackIds: string[];
  stationSidPaths: string[];
  meanOwnSimilarity: number;
  meanNearestOtherSimilarity: number;
  minMargin: number;
  contaminationCount: number;
  cliOutputSnippet: string;
};

const PERSONAS: PersonaDefinition[] = [
  {
    id: "pulse_chaser",
    label: "Pulse Chaser",
    predicate: (track) => track.e >= 4 && track.m <= 2 && track.c <= 2,
  },
  {
    id: "dream_drifter",
    label: "Dream Drifter",
    predicate: (track) => track.e <= 2 && track.m >= 4 && track.c <= 2,
  },
  {
    id: "maze_architect",
    label: "Maze Architect",
    predicate: (track) => track.e <= 2 && track.m <= 2 && track.c >= 4,
  },
  {
    id: "anthem_driver",
    label: "Anthem Driver",
    predicate: (track) => track.e >= 4 && track.m >= 4 && track.c <= 3,
  },
  {
    id: "noir_cartographer",
    label: "Noir Cartographer",
    predicate: (track) => track.e <= 3 && track.m >= 4 && track.c >= 4,
  },
];

function parseArgs(argv: string[]): { configPath?: string; dbPath?: string; hvscPath?: string; stationSize: number; reportPath?: string } {
  let configPath: string | undefined;
  let dbPath: string | undefined;
  let hvscPath: string | undefined;
  let stationSize = 100;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--config":
        configPath = argv[++index];
        break;
      case "--db":
        dbPath = argv[++index];
        break;
      case "--hvsc":
        hvscPath = argv[++index];
        break;
      case "--station-size":
        stationSize = Number.parseInt(argv[++index] ?? "100", 10);
        break;
      case "--report":
        reportPath = argv[++index];
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: bun scripts/validate-persona-radio.ts [options]",
            "",
            "Options:",
            "  --config <path>       SIDFlow config (default: .sidflow.json)",
            "  --db <path>           Similarity export SQLite bundle",
            "  --hvsc <path>         HVSC root override",
            "  --station-size <n>    Station size to validate (default: 100)",
            "  --report <path>       Optional markdown report output",
          ].join("\n"),
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(stationSize) || stationSize <= 0) {
    throw new Error("--station-size must be a positive integer");
  }

  return { configPath, dbPath, hvscPath, stationSize, reportPath };
}

function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot average zero vectors");
  }

  const dimensions = vectors[0]?.length ?? 0;
  const sums = new Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      sums[index] += vector[index] ?? 0;
    }
  }

  const magnitude = Math.sqrt(sums.reduce((total, value) => total + (value * value), 0));
  if (magnitude === 0) {
    return sums;
  }

  return sums.map((value) => value / magnitude);
}

function loadTracks(dbPath: string): TrackRecord[] {
  const database = new Database(dbPath, { readonly: true, strict: true });
  try {
    const rows = database
      .query(
        `SELECT track_id, sid_path, song_index, e, m, c, vector_json
         FROM tracks
         WHERE vector_json IS NOT NULL AND vector_json != ''`,
      )
      .all() as Array<{
        track_id: string;
        sid_path: string;
        song_index: number;
        e: number;
        m: number;
        c: number;
        vector_json: string;
      }>;

    return rows.map((row) => ({
      trackId: row.track_id,
      sidPath: row.sid_path,
      songIndex: row.song_index,
      e: row.e,
      m: row.m,
      c: row.c,
      vector: JSON.parse(row.vector_json) as number[],
    }));
  } finally {
    database.close();
  }
}

function chooseSeedsForPersona(
  persona: PersonaDefinition,
  tracks: TrackRecord[],
  usedTrackIds: Set<string>,
  existingCentroids: number[][],
): TrackRecord[] {
  const candidates = tracks.filter((track) => persona.predicate(track) && !usedTrackIds.has(track.trackId));
  if (candidates.length < 10) {
    throw new Error(`Persona ${persona.id} only has ${candidates.length} candidate tracks`);
  }

  const distanceSafeCandidates = candidates.filter((track) => (
    existingCentroids.every((centroid) => cosineSimilarity(track.vector, centroid) <= 0.82)
  ));
  const source = distanceSafeCandidates.length >= 10 ? distanceSafeCandidates : candidates;

  let bestSeeds: TrackRecord[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const anchor of source.slice(0, 200)) {
    const ranked = source
      .map((track) => ({ track, similarity: cosineSimilarity(anchor.vector, track.vector) }))
      .sort((left, right) => right.similarity - left.similarity);
    const seeds = ranked.slice(0, 10).map((entry) => entry.track);
    if (seeds.length < 10) {
      continue;
    }
    const score = ranked.slice(0, 10).reduce((total, entry) => total + entry.similarity, 0);
    if (score > bestScore) {
      bestScore = score;
      bestSeeds = seeds;
    }
  }

  if (!bestSeeds) {
    throw new Error(`Unable to choose 10 seeds for persona ${persona.id}`);
  }

  return bestSeeds;
}

function createStationRuntime(config: SidflowConfig, workspace: string): StationRuntime {
  return {
    loadConfig: async () => config,
    parseSidFile,
    lookupSongDurationMs,
    fetchImpl: fetch,
    stdout: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    stderr: process.stderr,
    stdin: process.stdin,
    cwd: () => workspace,
    now: () => new Date(),
    random: () => 0,
    prompt: async () => "q",
    onSignal: () => {},
    offSignal: () => {},
    createPlaybackAdapter: async () => ({
      start: async () => {},
      stop: async () => {},
      pause: async () => {},
      resume: async () => {},
    }),
  };
}

async function runPersonaCli(
  persona: PersonaDefinition,
  workspace: string,
  dbPath: string,
  hvscPath: string,
  sampleSize: number,
  stationSize: number,
  ratings: Map<string, number>,
  config: SidflowConfig,
): Promise<string> {
  const stdoutChunks: string[] = [];
  const runtime = createStationRuntime(config, workspace);
  runtime.stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    },
  });

  const selectionStatePath = buildSelectionStatePath(workspace, dbPath, hvscPath);
  await mkdir(path.dirname(selectionStatePath), { recursive: true });
  await writePersistedStationSelections(selectionStatePath, dbPath, hvscPath, sampleSize, ratings, new Date().toISOString());

  const exitCode = await runStationCli(
    [
      "--db", dbPath,
      "--hvsc", hvscPath,
      "--playback", "none",
      "--sample-size", String(sampleSize),
      "--station-size", String(stationSize),
    ],
    runtime,
  );

  if (exitCode !== 0) {
    throw new Error(`Station CLI failed for persona ${persona.id} with exit code ${exitCode}`);
  }

  const output = stdoutChunks.join("");
  if (!output.includes("Station ready")) {
    throw new Error(`Station CLI never reached station-ready state for persona ${persona.id}`);
  }

  return output;
}

async function resolveStationQueue(
  dbPath: string,
  hvscPath: string,
  ratings: Map<string, number>,
  stationSize: number,
  config: SidflowConfig,
  workspace: string,
): Promise<StationTrackDetails[]> {
  const runtime = createStationRuntime(config, workspace);
  return await buildStationQueue(
    dbPath,
    hvscPath,
    ratings,
    stationSize,
    3,
    15,
    runtime,
    new Map(),
  );
}

function summarizePersonaRun(
  persona: PersonaDefinition,
  seeds: TrackRecord[],
  queue: StationTrackDetails[],
  centroids: Map<string, number[]>,
  trackById: Map<string, TrackRecord>,
  cliOutput: string,
): PersonaRunSummary {
  const ownCentroid = centroids.get(persona.id);
  if (!ownCentroid) {
    throw new Error(`Missing centroid for ${persona.id}`);
  }

  const stationTrackIds = queue.map((track) => track.track_id);
  const stationSidPaths = queue.map((track) => track.sid_path);
  const margins: number[] = [];
  let contaminationCount = 0;

  for (const trackId of stationTrackIds) {
    const record = trackById.get(trackId);
    if (!record) {
      throw new Error(`Missing vector for station track ${trackId}`);
    }

    const ownSimilarity = cosineSimilarity(record.vector, ownCentroid);
    const nearestOtherSimilarity = Math.max(
      ...[...centroids.entries()]
        .filter(([id]) => id !== persona.id)
        .map(([, centroid]) => cosineSimilarity(record.vector, centroid)),
    );
    const margin = ownSimilarity - nearestOtherSimilarity;
    margins.push(margin);
    if (margin <= 0) {
      contaminationCount += 1;
    }
  }

  const meanOwnSimilarity = stationTrackIds.reduce((total, trackId) => {
    const record = trackById.get(trackId)!;
    return total + cosineSimilarity(record.vector, ownCentroid);
  }, 0) / Math.max(1, stationTrackIds.length);

  const meanNearestOtherSimilarity = stationTrackIds.reduce((total, trackId) => {
    const record = trackById.get(trackId)!;
    const nearestOther = Math.max(
      ...[...centroids.entries()]
        .filter(([id]) => id !== persona.id)
        .map(([, centroid]) => cosineSimilarity(record.vector, centroid)),
    );
    return total + nearestOther;
  }, 0) / Math.max(1, stationTrackIds.length);

  return {
    id: persona.id,
    label: persona.label,
    seedTrackIds: seeds.map((track) => track.trackId),
    seedSidPaths: seeds.map((track) => track.sidPath),
    stationTrackIds,
    stationSidPaths,
    meanOwnSimilarity,
    meanNearestOtherSimilarity,
    minMargin: Math.min(...margins),
    contaminationCount,
    cliOutputSnippet: cliOutput.slice(0, 400),
  };
}

function buildMarkdownReport(
  dbPath: string,
  hvscPath: string,
  summaries: PersonaRunSummary[],
  overlapPairs: Array<{ left: string; right: string; overlap: number }>,
): string {
  const lines = [
    "# Persona CLI Station Validation",
    "",
    `- DB: \`${dbPath}\``,
    `- HVSC: \`${hvscPath}\``,
    `- Personas: ${summaries.length}`,
    "",
    "## Results",
    "",
  ];

  for (const summary of summaries) {
    lines.push(`### ${summary.label}`);
    lines.push(`- Seed count: ${summary.seedTrackIds.length}`);
    lines.push(`- Station count: ${summary.stationTrackIds.length}`);
    lines.push(`- Mean own-centroid similarity: ${summary.meanOwnSimilarity.toFixed(4)}`);
    lines.push(`- Mean nearest-other-centroid similarity: ${summary.meanNearestOtherSimilarity.toFixed(4)}`);
    lines.push(`- Min purity margin: ${summary.minMargin.toFixed(4)}`);
    lines.push(`- Contamination count: ${summary.contaminationCount}`);
    lines.push(`- First 3 seeds: ${summary.seedSidPaths.slice(0, 3).join(", ")}`);
    lines.push(`- First 3 station tracks: ${summary.stationSidPaths.slice(0, 3).join(", ")}`);
    lines.push("");
  }

  lines.push("## Station Overlap");
  lines.push("");
  for (const pair of overlapPairs) {
    lines.push(`- ${pair.left} vs ${pair.right}: ${pair.overlap} shared tracks`);
  }

  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.configPath);
  const dbPath = path.resolve(args.dbPath ?? "data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite");
  const hvscPath = path.resolve(args.hvscPath ?? config.sidPath);
  const exportInfo = inspectExportDatabase(dbPath);

  if (!exportInfo.hasVectorData) {
    throw new Error(`${dbPath} does not contain vector_json data`);
  }

  const tracks = loadTracks(dbPath);
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const usedTrackIds = new Set<string>();
  const personaCentroids = new Map<string, number[]>();
  const summaries: PersonaRunSummary[] = [];

  for (const persona of PERSONAS) {
    const seeds = chooseSeedsForPersona(persona, tracks, usedTrackIds, [...personaCentroids.values()]);
    for (const seed of seeds) {
      usedTrackIds.add(seed.trackId);
    }

    const ratings = new Map<string, number>(seeds.map((seed) => [seed.trackId, 5]));
    const centroid = averageVector(seeds.map((seed) => seed.vector));
    personaCentroids.set(persona.id, centroid);

    const workspace = await mkdtemp(path.join(os.tmpdir(), `sidflow-persona-${persona.id}-`));
    try {
      const cliOutput = await runPersonaCli(persona, workspace, dbPath, hvscPath, 10, args.stationSize, ratings, config);
      const queue = await resolveStationQueue(dbPath, hvscPath, ratings, args.stationSize, config, workspace);

      if (queue.length < args.stationSize) {
        throw new Error(`Persona ${persona.id} only produced ${queue.length}/${args.stationSize} station tracks`);
      }

      const summary = summarizePersonaRun(persona, seeds, queue, personaCentroids, trackById, cliOutput);
      if (summary.contaminationCount !== 0) {
        throw new Error(`Persona ${persona.id} station contamination count was ${summary.contaminationCount}`);
      }
      summaries.push(summary);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  const overlapPairs: Array<{ left: string; right: string; overlap: number }> = [];
  for (let leftIndex = 0; leftIndex < summaries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < summaries.length; rightIndex += 1) {
      const left = summaries[leftIndex]!;
      const right = summaries[rightIndex]!;
      const overlap = left.stationTrackIds.filter((trackId) => right.stationTrackIds.includes(trackId)).length;
      overlapPairs.push({ left: left.label, right: right.label, overlap });
      if (overlap !== 0) {
        throw new Error(`${left.label} and ${right.label} shared ${overlap} station tracks`);
      }
    }
  }

  const report = buildMarkdownReport(dbPath, hvscPath, summaries, overlapPairs);
  if (args.reportPath) {
    await mkdir(path.dirname(path.resolve(args.reportPath)), { recursive: true });
    await writeFile(path.resolve(args.reportPath), report, "utf8");
  }

  console.log(report);
}

await main();
