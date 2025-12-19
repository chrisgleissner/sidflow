#!/usr/bin/env bun
/**
 * Verify that WAVs grouped into each station are actually similar by
 * re-extracting features directly from the station WAV files.
 *
 * This is intentionally independent of the JSONL features used to *build*
 * stations, so it can catch mismatches (bad windows, corrupted features,
 * cache issues, etc.).
 *
 * Usage:
 *   bun scripts/verify-stations-wav-similarity.ts \
 *     --stations tmp/demos-gl/stations \
 *     --config tmp/demos-gl/.sidflow.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  destroyFeatureExtractionPool,
  getFeatureExtractionPool,
} from "../packages/sidflow-classify/src/feature-extraction-pool.js";

type StationManifest = {
  stationId: string;
  input: {
    jsonl: string;
    dims: string[];
    weights?: number[];
    seed?: number;
    seedMode?: string;
  };
  seed: {
    sid_path: string;
    song_index: number | null;
    wav: string;
    features: Record<string, unknown>;
  };
  tracks: Array<{
    sid_path: string;
    song_index: number | null;
    wav: string;
    features: Record<string, unknown>;
  }>;
};

type Args = {
  stationsDir: string;
  configPath: string;
  jsonlPath?: string;
  poolSize: number;
  maxStations?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    stationsDir: "tmp/demos-gl/stations",
    configPath: "tmp/demos-gl/.sidflow.json",
    jsonlPath: undefined,
    poolSize: Math.max(1, Math.min(4, os.cpus().length || 1)),
    maxStations: undefined,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stations") args.stationsDir = argv[++i] ?? args.stationsDir;
    else if (a === "--config") args.configPath = argv[++i] ?? args.configPath;
    else if (a === "--jsonl") args.jsonlPath = argv[++i];
    else if (a === "--pool-size") args.poolSize = Number(argv[++i]);
    else if (a === "--max-stations") args.maxStations = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/verify-stations-wav-similarity.ts \\",
          "    --stations <dir> \\",
          "    --config <sidflow.json> [--jsonl <classification.jsonl>] [--pool-size N] [--max-stations N]",
        ].join("\n")
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }

  if (!args.stationsDir) {
    console.error("Missing required --stations <dir>");
    process.exit(2);
  }
  if (!args.configPath) {
    console.error("Missing required --config <sidflow.json>");
    process.exit(2);
  }
  if (!Number.isFinite(args.poolSize) || args.poolSize <= 0) {
    console.error("--pool-size must be a positive integer");
    process.exit(2);
  }
  if (args.maxStations !== undefined && (!Number.isFinite(args.maxStations) || args.maxStations <= 0)) {
    console.error("--max-stations must be a positive integer");
    process.exit(2);
  }

  return args;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

function clamp01(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function distanceZ(
  a: number[],
  b: number[],
  std: number[],
  weights: number[] | undefined,
  bpmIndex: number,
  aBpmConfidence: number,
  bBpmConfidence: number
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    let w = weights?.[i] ?? 1;
    if (i === bpmIndex) {
      const c = Math.sqrt(clamp01(aBpmConfidence) * clamp01(bBpmConfidence));
      w *= c;
    }
    const z = (a[i] - b[i]) / (std[i] || 1);
    const weighted = w * z;
    sum += weighted * weighted;
  }
  return Math.sqrt(sum);
}

function getVector(features: Record<string, unknown>, dims: string[]): number[] | null {
  const v: number[] = [];
  for (const d of dims) {
    const val = features[d];
    if (typeof val !== "number" || Number.isNaN(val)) return null;
    v.push(val);
  }
  return v;
}

async function readJsonlRecords(jsonlAbs: string): Promise<any[]> {
  const content = await fs.readFile(jsonlAbs, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const out: any[] = [];
  for (const line of lines) {
    out.push(JSON.parse(line));
  }
  return out;
}

function computeStats(vectors: number[][], dims: string[]): { mean: number[]; std: number[] } {
  const n = vectors.length;
  const meanArr = new Array(dims.length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) meanArr[i] += v[i];
  }
  for (let i = 0; i < meanArr.length; i++) meanArr[i] /= n;

  const variance = new Array(dims.length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) {
      const diff = v[i] - meanArr[i];
      variance[i] += diff * diff;
    }
  }
  const stdArr = variance.map((x) => Math.sqrt(x / n) || 1);
  return { mean: meanArr, std: stdArr };
}

async function listStationDirs(stationsDirAbs: string): Promise<string[]> {
  const entries = await fs.readdir(stationsDirAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("station-"))
    .map((e) => path.join(stationsDirAbs, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readManifest(stationDirAbs: string): Promise<StationManifest> {
  const manifestPath = path.join(stationDirAbs, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as StationManifest;
}

async function findWavInStationDir(stationDirAbs: string, wavBaseName: string): Promise<string> {
  const entries = await fs.readdir(stationDirAbs, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(wavBaseName.toLowerCase()))
    .map((e) => e.name)
    .sort();

  if (matches.length === 0) {
    throw new Error(`Missing WAV in station dir: ${wavBaseName}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous WAV match for ${wavBaseName}: ${matches.join(", ")}`);
  }

  return path.join(stationDirAbs, matches[0]);
}

function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return "NaN";
  if (Math.abs(x) >= 1000 || Math.abs(x) < 0.01) return x.toExponential(3);
  return x.toFixed(4);
}

function zRmse(a: number[], b: number[], std: number[]): { rmse: number; maxAbsZ: number } {
  if (a.length !== b.length) {
    return { rmse: Number.NaN, maxAbsZ: Number.NaN };
  }
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < a.length; i++) {
    const s = std[i] || 1;
    const z = (a[i] - b[i]) / s;
    const az = Math.abs(z);
    if (az > maxAbs) maxAbs = az;
    sumSq += z * z;
  }
  return { rmse: Math.sqrt(sumSq / a.length), maxAbsZ: maxAbs };
}

function rankOfValue(sortedAscending: number[], value: number): number {
  // 1-based rank (1 = smallest). If duplicates exist, returns the first matching index.
  let lo = 0;
  let hi = sortedAscending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAscending[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

async function main() {
  const args = parseArgs(process.argv);

  const stationsDirAbs = path.resolve(args.stationsDir);
  const configAbs = path.resolve(args.configPath);

  process.env.SIDFLOW_CONFIG = configAbs;

  const configRaw = await fs.readFile(configAbs, "utf8");
  const configJson = JSON.parse(configRaw) as { sidPath?: string };
  const sidRootAbs = path.resolve(configJson.sidPath ?? "workspace/hvsc");

  const stationDirsAll = await listStationDirs(stationsDirAbs);
  const stationDirs =
    args.maxStations !== undefined ? stationDirsAll.slice(0, args.maxStations) : stationDirsAll;

  if (stationDirs.length === 0) {
    console.error(`No station directories found under: ${stationsDirAbs}`);
    process.exit(1);
  }

  const firstManifest = await readManifest(stationDirs[0]);
  const dims = firstManifest.input.dims;
  const weights = firstManifest.input.weights;
  const bpmIndex = dims.indexOf("bpm");

  if (dims.length === 0) {
    console.error("Station manifest has empty dims list");
    process.exit(1);
  }
  if (bpmIndex < 0) {
    console.error("Station dims do not include bpm; cannot apply confidence gating");
    process.exit(1);
  }

  const jsonlAbs = path.resolve(args.jsonlPath ?? firstManifest.input.jsonl);

  const records = await readJsonlRecords(jsonlAbs);
  const usableVectors: number[][] = [];
  for (const r of records) {
    const v = getVector((r.features ?? {}) as Record<string, unknown>, dims);
    if (v) usableVectors.push(v);
  }

  if (usableVectors.length < 10) {
    console.error(`Not enough usable vectors in JSONL (${usableVectors.length}) to compute stats`);
    process.exit(1);
  }

  const { std } = computeStats(usableVectors, dims);

  console.log(
    [
      `Stations: ${stationDirs.length} (dir=${args.stationsDir})`,
      `Config: ${args.configPath}`,
      `JSONL: ${args.jsonlPath ?? firstManifest.input.jsonl}`,
      `Dims: ${dims.length}`,
      `Pool size: ${args.poolSize}`,
      "",
    ].join("\n")
  );

  const pool = getFeatureExtractionPool(args.poolSize);

  try {
    const overallWorst: Array<{ stationId: string; meanDist: number; maxDist: number; worstTrack: string }> = [];

    for (const stationDir of stationDirs) {
      const manifest = await readManifest(stationDir);

      const members = [
        {
          label: "seed",
          sid_path: manifest.seed.sid_path,
          wav: manifest.seed.wav,
          manifestFeatures: manifest.seed.features,
        },
        ...manifest.tracks.map((t) => ({
          label: "track",
          sid_path: t.sid_path,
          wav: t.wav,
          manifestFeatures: t.features,
        })),
      ];

      const extracted: Array<{
        wav: string;
        sid_path: string;
        vec: number[];
        bpmConfidence: number;
        manifestVec: number[] | null;
      }> = [];

      // Extract sequentially; workers provide parallelism across stations/files.
      for (const m of members) {
        const wavPathAbs = await findWavInStationDir(stationDir, m.wav);
        const sidPathAbs = path.join(sidRootAbs, m.sid_path);

        const features = await pool.extract(wavPathAbs, sidPathAbs);

        const vec = getVector((features ?? {}) as Record<string, unknown>, dims);
        if (!vec) {
          throw new Error(`Extracted features missing dims for ${manifest.stationId}: ${m.wav}`);
        }

        const bpmConfidence = typeof (features as any).confidence === "number" ? (features as any).confidence : 0;
        const manifestVec = getVector(m.manifestFeatures, dims);

        extracted.push({
          wav: m.wav,
          sid_path: m.sid_path,
          vec,
          bpmConfidence,
          manifestVec,
        });
      }

      const seed = extracted[0];
      const distances: Array<{ wav: string; sid_path: string; dist: number }> = [];
      const mismatchStats: Array<{ wav: string; rmse: number; maxAbsZ: number }> = [];

      // For rank/percentile context: distance from seed to every usable record in the JSONL.
      // This tells us whether a station's members are among the closest neighbors in the dataset.
      const seedToDatasetDistances: number[] = [];
      for (const v of usableVectors) {
        // Skip comparing the seed against itself if it happens to be present verbatim.
        // (We still want a stable distribution for ranking.)
        seedToDatasetDistances.push(
          distanceZ(seed.vec, v, std, weights, bpmIndex, seed.bpmConfidence, 1)
        );
      }
      seedToDatasetDistances.sort((a, b) => a - b);

      for (let i = 1; i < extracted.length; i++) {
        const t = extracted[i];
        const dist = distanceZ(seed.vec, t.vec, std, weights, bpmIndex, seed.bpmConfidence, t.bpmConfidence);
        distances.push({ wav: t.wav, sid_path: t.sid_path, dist });

        if (t.manifestVec) {
          const { rmse, maxAbsZ } = zRmse(t.manifestVec, t.vec, std);
          mismatchStats.push({ wav: t.wav, rmse, maxAbsZ });
        }
      }

      distances.sort((a, b) => b.dist - a.dist);
      mismatchStats.sort((a, b) => (b.maxAbsZ - a.maxAbsZ) || (b.rmse - a.rmse));

      const distValues = distances.map((d) => d.dist);
      const meanDist = mean(distValues);
      const sdDist = stddev(distValues);
      const maxDist = distValues.length ? distValues[0] : 0;

      // Pairwise cohesion (not just seed-to-track)
      const pairwise: number[] = [];
      for (let i = 0; i < extracted.length; i++) {
        for (let j = i + 1; j < extracted.length; j++) {
          pairwise.push(
            distanceZ(
              extracted[i].vec,
              extracted[j].vec,
              std,
              weights,
              bpmIndex,
              extracted[i].bpmConfidence,
              extracted[j].bpmConfidence
            )
          );
        }
      }
      const pairMean = mean(pairwise);
      const pairMax = pairwise.length ? Math.max(...pairwise) : 0;

      // Rank of each station member within the dataset distance distribution.
      const ranks = distances.map((d) => rankOfValue(seedToDatasetDistances, d.dist));
      const meanRank = mean(ranks);
      const maxRank = ranks.length ? Math.max(...ranks) : 0;

      const worst = distances[0];
      overallWorst.push({
        stationId: manifest.stationId,
        meanDist,
        maxDist,
        worstTrack: worst ? path.basename(worst.sid_path) : "",
      });

      console.log(`${manifest.stationId}`);
      console.log(
        `  dist(seed→track): mean=${formatNumber(meanDist)} sd=${formatNumber(sdDist)} max=${formatNumber(maxDist)}`
      );
      console.log(
        `  rank(seed→track) within dataset: mean=${formatNumber(meanRank)} max=${formatNumber(maxRank)} (lower is better)`
      );
      console.log(`  dist(pairwise): mean=${formatNumber(pairMean)} max=${formatNumber(pairMax)}`);

      for (const d of distances.slice(0, 3)) {
        console.log(`  farthest: dist=${formatNumber(d.dist)} sid=${d.sid_path}`);
      }

      if (mismatchStats.length > 0) {
        const top = mismatchStats[0];
        const meanRmse = mean(mismatchStats.map((m) => m.rmse));
        console.log(
          `  manifestΔ(z): meanRmse=${formatNumber(meanRmse)} worstMaxAbsZ=${formatNumber(top.maxAbsZ)} wav=${top.wav}`
        );
      }

      console.log("");
    }

    overallWorst.sort((a, b) => b.maxDist - a.maxDist);
    const topWorst = overallWorst.slice(0, 3);
    console.log("Worst stations by max distance:");
    for (const w of topWorst) {
      console.log(
        `  ${w.stationId}: mean=${formatNumber(w.meanDist)} max=${formatNumber(w.maxDist)} worst=${w.worstTrack}`
      );
    }
  } finally {
    await destroyFeatureExtractionPool();
  }
}

await main();
