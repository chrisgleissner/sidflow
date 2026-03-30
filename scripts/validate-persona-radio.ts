#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  loadConfig,
  cosineSimilarity,
  type SidflowConfig,
} from "../packages/sidflow-common/src/index.js";
import {
  inspectExportDatabase,
} from "../packages/sidflow-play/src/station/index.js";

type RatingTriple = {
  e: number;
  m: number;
  c: number;
};

type PersonaDefinition = {
  id: string;
  label: string;
  target: RatingTriple;
};

type ResolvedPersonaDefinition = PersonaDefinition & {
  triple: RatingTriple;
  candidateCount: number;
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
  triple: RatingTriple;
  candidateCount: number;
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
    target: { e: 5, m: 1, c: 1 },
  },
  {
    id: "dream_drifter",
    label: "Dream Drifter",
    target: { e: 1, m: 5, c: 1 },
  },
  {
    id: "maze_architect",
    label: "Maze Architect",
    target: { e: 1, m: 1, c: 5 },
  },
  {
    id: "anthem_driver",
    label: "Anthem Driver",
    target: { e: 5, m: 5, c: 1 },
  },
  {
    id: "noir_cartographer",
    label: "Noir Cartographer",
    target: { e: 1, m: 5, c: 5 },
  },
];

function formatTriple(triple: RatingTriple): string {
  return `(${triple.e.toFixed(1)}, ${triple.m.toFixed(1)}, ${triple.c.toFixed(1)})`;
}

function tripleKey(triple: RatingTriple): string {
  return `${triple.e}|${triple.m}|${triple.c}`;
}

function triplesMatch(left: RatingTriple, right: RatingTriple): boolean {
  return left.e === right.e && left.m === right.m && left.c === right.c;
}

function tripleDistance(left: RatingTriple, right: RatingTriple): number {
  return Math.abs(left.e - right.e) + Math.abs(left.m - right.m) + Math.abs(left.c - right.c);
}

function resolvePersonas(tracks: TrackRecord[]): ResolvedPersonaDefinition[] {
  const counts = new Map<string, { triple: RatingTriple; count: number }>();
  for (const track of tracks) {
    const triple = { e: track.e, m: track.m, c: track.c };
    const key = tripleKey(triple);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(key, { triple, count: 1 });
  }

  const candidates = [...counts.values()]
    .filter((entry) => entry.count >= 10)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (left.triple.e !== right.triple.e) {
        return left.triple.e - right.triple.e;
      }
      if (left.triple.m !== right.triple.m) {
        return left.triple.m - right.triple.m;
      }
      return left.triple.c - right.triple.c;
    });

  if (candidates.length < PERSONAS.length) {
    throw new Error(`Need at least ${PERSONAS.length} rating buckets with >=10 tracks, found ${candidates.length}`);
  }

  const usedKeys = new Set<string>();
  return PERSONAS.map((persona) => {
    const match = candidates
      .filter((candidate) => !usedKeys.has(tripleKey(candidate.triple)))
      .sort((left, right) => {
        const leftDistance = tripleDistance(left.triple, persona.target);
        const rightDistance = tripleDistance(right.triple, persona.target);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return tripleKey(left.triple).localeCompare(tripleKey(right.triple));
      })[0];

    if (!match) {
      throw new Error(`Unable to resolve persona ${persona.id} to a populated rating bucket`);
    }

    usedKeys.add(tripleKey(match.triple));
    return {
      ...persona,
      triple: match.triple,
      candidateCount: match.count,
    };
  });
}

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
  persona: ResolvedPersonaDefinition,
  tracks: TrackRecord[],
  usedTrackIds: Set<string>,
  existingCentroids: number[][],
): TrackRecord[] {
  const candidates = tracks.filter((track) => triplesMatch(track, persona.triple) && !usedTrackIds.has(track.trackId));
  if (candidates.length < 10) {
    throw new Error(
      `Persona ${persona.id} only has ${candidates.length} candidate tracks in resolved bucket ${formatTriple(persona.triple)}`,
    );
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

function buildPersonaStations(
  tracks: TrackRecord[],
  personas: ResolvedPersonaDefinition[],
  centroids: Map<string, number[]>,
  stationSize: number,
): Map<string, TrackRecord[]> {
  const rankedCandidates = new Map<string, Array<{ track: TrackRecord; ownSimilarity: number; margin: number }>>();

  for (const persona of personas) {
    const ranked = tracks.map((track) => {
      const scores = personas.map((candidatePersona) => {
        const centroid = centroids.get(candidatePersona.id);
        if (!centroid) {
          throw new Error(`Missing centroid for ${candidatePersona.id}`);
        }
        return {
          personaId: candidatePersona.id,
          similarity: cosineSimilarity(track.vector, centroid),
        };
      }).sort((left, right) => {
        if (right.similarity !== left.similarity) {
          return right.similarity - left.similarity;
        }
        return left.personaId.localeCompare(right.personaId);
      });

      const ownScore = scores.find((entry) => entry.personaId === persona.id);
      const nearestOther = scores.find((entry) => entry.personaId !== persona.id);
      if (!ownScore) {
        throw new Error(`Missing own score for ${persona.id}`);
      }

      return {
        track,
        ownSimilarity: ownScore.similarity,
        margin: ownScore.similarity - (nearestOther?.similarity ?? -1),
      };
    }).sort((left, right) => {
      if (right.ownSimilarity !== left.ownSimilarity) {
        return right.ownSimilarity - left.ownSimilarity;
      }
      if (right.margin !== left.margin) {
        return right.margin - left.margin;
      }
      return left.track.trackId.localeCompare(right.track.trackId);
    });

    rankedCandidates.set(persona.id, ranked);
  }

  const usedTrackIds = new Set<string>();
  const cursorByPersona = new Map<string, number>(personas.map((persona) => [persona.id, 0]));
  const queues = new Map<string, TrackRecord[]>(personas.map((persona) => [persona.id, []]));

  let madeProgress = true;
  while (madeProgress && [...queues.values()].some((queue) => queue.length < stationSize)) {
    madeProgress = false;
    for (const persona of personas) {
      const queue = queues.get(persona.id);
      const candidates = rankedCandidates.get(persona.id);
      if (!queue || !candidates || queue.length >= stationSize) {
        continue;
      }

      let cursor = cursorByPersona.get(persona.id) ?? 0;
      while (cursor < candidates.length) {
        const candidate = candidates[cursor];
        cursor += 1;
        if (!usedTrackIds.has(candidate.track.trackId)) {
          queue.push(candidate.track);
          usedTrackIds.add(candidate.track.trackId);
          cursorByPersona.set(persona.id, cursor);
          madeProgress = true;
          break;
        }
      }
    }
  }

  for (const persona of personas) {
    const assigned = queues.get(persona.id) ?? [];
    if (assigned.length < stationSize) {
      throw new Error(`Persona ${persona.id} only produced ${assigned.length}/${stationSize} assigned tracks`);
    }
  }

  return queues;
}

function summarizePersonaRun(
  persona: ResolvedPersonaDefinition,
  seeds: TrackRecord[],
  queue: TrackRecord[],
  centroids: Map<string, number[]>,
  trackById: Map<string, TrackRecord>,
): PersonaRunSummary {
  const ownCentroid = centroids.get(persona.id);
  if (!ownCentroid) {
    throw new Error(`Missing centroid for ${persona.id}`);
  }

  const stationTrackIds = queue.map((track) => track.trackId);
  const stationSidPaths = queue.map((track) => track.sidPath);
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
    triple: persona.triple,
    candidateCount: persona.candidateCount,
    seedTrackIds: seeds.map((track) => track.trackId),
    seedSidPaths: seeds.map((track) => track.sidPath),
    stationTrackIds,
    stationSidPaths,
    meanOwnSimilarity,
    meanNearestOtherSimilarity,
    minMargin: Math.min(...margins),
    contaminationCount,
    cliOutputSnippet: "deterministic-centroid-assignment",
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
    lines.push(`- Resolved rating bucket: ${formatTriple(summary.triple)} (${summary.candidateCount} candidate tracks)`);
    lines.push(`- Seed count: ${summary.seedTrackIds.length}`);
    lines.push(`- Station count: ${summary.stationTrackIds.length}`);
    lines.push(`- Mean own-centroid similarity: ${summary.meanOwnSimilarity.toFixed(4)}`);
    lines.push(`- Mean nearest-other-centroid similarity: ${summary.meanNearestOtherSimilarity.toFixed(4)}`);
    lines.push(`- Min purity margin: ${summary.minMargin.toFixed(4)}`);
    lines.push(`- Contamination count: ${summary.contaminationCount}`);
    lines.push(`- First 3 seeds: ${summary.seedSidPaths.slice(0, 3).join(", ")}`);
    lines.push(`- Generation mode: ${summary.cliOutputSnippet}`);
    lines.push("");
    lines.push("#### Station Tracks");
    for (let index = 0; index < summary.stationSidPaths.length; index += 1) {
      const trackId = summary.stationTrackIds[index] ?? "unknown";
      const sidPath = summary.stationSidPaths[index] ?? "unknown";
      lines.push(`- ${trackId} :: ${sidPath}`);
    }
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
  const personas = resolvePersonas(tracks);
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const usedTrackIds = new Set<string>();
  const personaCentroids = new Map<string, number[]>();
  const personaSeeds = new Map<string, TrackRecord[]>();
  const summaries: PersonaRunSummary[] = [];

  for (const persona of personas) {
    const seeds = chooseSeedsForPersona(persona, tracks, usedTrackIds, [...personaCentroids.values()]);
    for (const seed of seeds) {
      usedTrackIds.add(seed.trackId);
    }

    const centroid = averageVector(seeds.map((seed) => seed.vector));
    personaCentroids.set(persona.id, centroid);
    personaSeeds.set(persona.id, seeds);
  }

  const personaStations = buildPersonaStations(tracks, personas, personaCentroids, args.stationSize);
  for (const persona of personas) {
    const seeds = personaSeeds.get(persona.id);
    const queue = personaStations.get(persona.id);
    if (!seeds || !queue) {
      throw new Error(`Missing persona artifacts for ${persona.id}`);
    }

    const summary = summarizePersonaRun(persona, seeds, queue, personaCentroids, trackById);
    summaries.push(summary);
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
