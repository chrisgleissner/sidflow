#!/usr/bin/env node
/**
 * Build “station” folders containing WAVs based on feature similarity.
 *
 * No workspace imports (runs without `bun install`).
 *
 * Usage:
 *   node scripts/build-stations-from-jsonl.mjs \
 *     --jsonl tmp/demos-gl/classified/<file>.jsonl \
 *     --wav-cache tmp/demos-gl/audio-cache \
 *     --out tmp/demos-gl/stations \
 *     --stations 10 \
 *     --size 20 \
 *     --seed 42
 */

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    jsonl: undefined,
    wavCache: "tmp/demos-gl/audio-cache",
    out: "tmp/demos-gl/stations",
    stations: 10,
    size: 20,
    seed: 42,
    seedKey: undefined,
     seedMode: "extremes", // random | extremes
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jsonl") args.jsonl = argv[++i];
    else if (a === "--wav-cache") args.wavCache = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--stations") args.stations = Number(argv[++i]);
    else if (a === "--size") args.size = Number(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--seed-key") args.seedKey = argv[++i];
    else if (a === "--seed-mode") args.seedMode = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage:\n  node scripts/build-stations-from-jsonl.mjs --jsonl <file> [--wav-cache <dir>] [--out <dir>] [--stations N] [--size N] [--seed N] [--seed-key <sid_path[:index]>] [--seed-mode random|extremes]`
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }

  if (!args.jsonl) {
    console.error("Missing required --jsonl <file>");
    process.exit(2);
  }

  if (!Number.isFinite(args.stations) || args.stations <= 0) {
    console.error("--stations must be a positive number");
    process.exit(2);
  }
  if (!Number.isFinite(args.size) || args.size <= 0) {
    console.error("--size must be a positive number");
    process.exit(2);
  }
  if (!Number.isFinite(args.seed)) {
    console.error("--seed must be a number");
    process.exit(2);
  }

  if (args.seedMode !== "random" && args.seedMode !== "extremes") {
    console.error("--seed-mode must be one of: random, extremes");
    process.exit(2);
  }

  return args;
}

function normalizeZ(v, mean, std) {
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = (v[i] - mean[i]) / (std[i] || 1);
  }
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function pickExtremeIndex(usable, zVectors, scoreFn, pickedSet) {
  let bestIdx = -1;
  let bestScore = undefined;
  let bestKey = "";
  for (let i = 0; i < usable.length; i++) {
    if (pickedSet.has(i)) continue;
    const score = scoreFn(zVectors[i], usable[i]);
    if (!Number.isFinite(score)) continue;
    if (bestIdx < 0 || score > bestScore || (score === bestScore && usable[i].key < bestKey)) {
      bestIdx = i;
      bestScore = score;
      bestKey = usable[i].key;
    }
  }
  return bestIdx;
}

function pickFarthestIndices(usable, zVectors, count, pickedSet) {
  if (count <= 0) return [];
  const selected = [];
  while (selected.length < count) {
    let bestIdx = -1;
    let bestDist = -1;
    let bestKey = "";
    for (let i = 0; i < usable.length; i++) {
      if (pickedSet.has(i)) continue;

      let minDist = Infinity;
      for (const j of pickedSet) {
        const d = distanceZ(zVectors[i], zVectors[j], new Array(zVectors[i].length).fill(1), null, -1, 1, 1);
        if (d < minDist) minDist = d;
      }
      if (!Number.isFinite(minDist)) continue;
      if (bestIdx < 0 || minDist > bestDist || (minDist === bestDist && usable[i].key < bestKey)) {
        bestIdx = i;
        bestDist = minDist;
        bestKey = usable[i].key;
      }
    }
    if (bestIdx < 0) break;
    pickedSet.add(bestIdx);
    selected.push(bestIdx);
  }
  return selected;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pickUniqueIndices(count, maxExclusive, rnd) {
  const selected = new Set();
  while (selected.size < count) {
    selected.add(Math.floor(rnd() * maxExclusive));
  }
  return [...selected];
}

function findSeedIndex(usable, seedKey) {
  if (!seedKey) return -1;
  for (let i = 0; i < usable.length; i++) {
    const u = usable[i];
    if (u.key === seedKey) return i;
    if (u.record?.sid_path === seedKey) return i;
  }
  return -1;
}

function sanitizeForPath(s) {
  return String(s)
    .replace(/\.sid$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
    .slice(0, 80);
}

function recordKey(record) {
  const sidPath = record.sid_path;
  const idx = record.song_index;
  return idx ? `${sidPath}:${idx}` : sidPath;
}

function wavNameForRecord(record) {
  const sidPath = record.sid_path;
  const base = path.basename(sidPath, path.extname(sidPath));
  const idx = record.song_index;
  const baseName = idx ? `${base}-${idx}.wav` : `${base}.wav`;
  const dir = path.dirname(sidPath);
  const rel = dir === "." ? baseName : path.join(dir, baseName);
  return { rel, baseName };
}

function getVector(record, dims) {
  const f = record.features;
  if (!f) return null;
  const v = [];
  for (const d of dims) {
    const val = f[d];
    if (typeof val !== "number" || Number.isNaN(val)) return null;
    v.push(val);
  }
  return v;
}

function computeStats(vectors, dims) {
  const n = vectors.length;
  const mean = new Array(dims.length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) mean[i] += v[i];
  }
  for (let i = 0; i < mean.length; i++) mean[i] /= n;

  const variance = new Array(dims.length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) {
      const diff = v[i] - mean[i];
      variance[i] += diff * diff;
    }
  }
  const std = variance.map((x) => Math.sqrt(x / n) || 1);

  return { mean, std };
}

function clamp01(x) {
  if (typeof x !== "number" || Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function distanceZ(a, b, std, weights, bpmIndex, aBpmConfidence, bBpmConfidence) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    let w = weights?.[i] ?? 1;
    if (i === bpmIndex) {
      const c = Math.sqrt(clamp01(aBpmConfidence) * clamp01(bBpmConfidence));
      w *= c;
    }
    const z = (a[i] - b[i]) / std[i];
    const weighted = w * z;
    sum += weighted * weighted;
  }
  return Math.sqrt(sum);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);

  const jsonlAbs = path.resolve(args.jsonl);
  const wavCacheAbs = path.resolve(args.wavCache);
  const outAbs = path.resolve(args.out);

  const content = await fs.readFile(jsonlAbs, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  const records = [];
  for (const line of lines) {
    const r = JSON.parse(line);
    records.push(r);
  }

  const dims = [
    "energy",
    "rms",
    "zeroCrossingRate",
    "bpm",
    "spectralCentroid",
    "spectralRolloff",
    "spectralFlatnessDb",
    "spectralCrest",
    "spectralEntropy",
    "spectralHfc",
    "spectralContrastMean",
    "spectralContrastStd",
    "mfccMean1",
    "mfccMean2",
    "mfccMean3",
    "mfccMean4",
    "mfccMean5",
    "mfccStd1",
    "mfccStd2",
    "mfccStd3",
    "mfccStd4",
    "mfccStd5",
  ];

  const baseWeightsByDim = {
    energy: 1,
    rms: 1,
    zeroCrossingRate: 0.5,
    bpm: 2,
    spectralCentroid: 1,
    spectralRolloff: 1,
    spectralFlatnessDb: 1,
    spectralCrest: 0.75,
    spectralEntropy: 0.75,
    spectralHfc: 0.75,
    spectralContrastMean: 1,
    spectralContrastStd: 0.75,
    mfccMean1: 1,
    mfccMean2: 1,
    mfccMean3: 1,
    mfccMean4: 1,
    mfccMean5: 1,
    mfccStd1: 0.5,
    mfccStd2: 0.5,
    mfccStd3: 0.5,
    mfccStd4: 0.5,
    mfccStd5: 0.5,
  };
  const weights = dims.map((d) => baseWeightsByDim[d] ?? 1);
  const bpmIndex = dims.indexOf("bpm");

  const vectors = [];
  const usable = [];
  for (const r of records) {
    const v = getVector(r, dims);
    if (!v) continue;
    vectors.push(v);
    usable.push({ record: r, vector: v, key: recordKey(r), bpmConfidence: r?.features?.confidence });
  }

  if (usable.length < args.stations) {
    throw new Error(`Not enough usable records (${usable.length}) for stations (${args.stations})`);
  }

  const { mean, std } = computeStats(vectors, dims);
  const rnd = mulberry32(args.seed);

  await ensureDir(outAbs);

  const explicitSeedIndex = findSeedIndex(usable, args.seedKey);
  if (args.seedKey && explicitSeedIndex < 0) {
    throw new Error(`--seed-key not found in JSONL records: ${args.seedKey}`);
  }

  const seedIndices = [];
  if (explicitSeedIndex >= 0) {
    seedIndices.push(explicitSeedIndex);
  }

  if (seedIndices.length < args.stations) {
    if (args.seedMode === "extremes") {
      const zVectors = usable.map((u) => normalizeZ(u.vector, mean, std));
      const pickedSet = new Set(seedIndices);

      const idxBpm = dims.indexOf("bpm");
      const idxEnergy = dims.indexOf("energy");
      const idxCentroid = dims.indexOf("spectralCentroid");
      const idxFlatness = dims.indexOf("spectralFlatnessDb");
      const idxHfc = dims.indexOf("spectralHfc");

      const bpmConfidenceWeight = (u) => {
        const c = typeof u?.bpmConfidence === "number" ? clamp01(u.bpmConfidence) : 0;
        // Prefer confident BPM. c=0.15 => 0.5 weight; c=1 => 1 weight.
        return Math.min(1, Math.max(0, (c - 0.15) / 0.85)) * 0.5 + 0.5;
      };

      // Scores are maximized; use negatives to pick minima.
      const extremeSelectors = [
        // slow + low energy
        (z, u) => -0.5 * (z[idxBpm] + z[idxEnergy]) * bpmConfidenceWeight(u),
        // fast + high energy
        (z, u) => 0.5 * (z[idxBpm] + z[idxEnergy]) * bpmConfidenceWeight(u),
        // dark
        (z) => -z[idxCentroid],
        // bright
        (z) => z[idxCentroid],
        // tonal (low flatness)
        (z) => -z[idxFlatness],
        // noisy (high flatness)
        (z) => z[idxFlatness],
        // percussive/attacky (high HFC)
        (z) => z[idxHfc],
      ];

      for (const scoreFn of extremeSelectors) {
        if (pickedSet.size >= args.stations) break;
        const idx = pickExtremeIndex(usable, zVectors, scoreFn, pickedSet);
        if (idx >= 0) {
          pickedSet.add(idx);
          seedIndices.push(idx);
        }
      }

      const remaining = args.stations - seedIndices.length;
      if (remaining > 0 && pickedSet.size > 0) {
        const far = pickFarthestIndices(usable, zVectors, remaining, pickedSet);
        seedIndices.push(...far);
      }

      // If still short (should be rare), fall back to random fill.
      while (seedIndices.length < args.stations) {
        const idx = Math.floor(rnd() * usable.length);
        if (seedIndices.includes(idx)) continue;
        seedIndices.push(idx);
      }
    } else {
      while (seedIndices.length < args.stations) {
        const idx = Math.floor(rnd() * usable.length);
        if (seedIndices.includes(idx)) continue;
        seedIndices.push(idx);
      }
    }
  }
  const stationsIndex = [];

  for (let s = 0; s < seedIndices.length; s++) {
    const seed = usable[seedIndices[s]];

    const scored = [];
    for (const candidate of usable) {
      if (candidate.key === seed.key) continue;
      const dist = distanceZ(seed.vector, candidate.vector, std, weights, bpmIndex, seed.bpmConfidence, candidate.bpmConfidence);
      scored.push({ candidate, dist, similarity: 1 / (1 + dist) });
    }
    scored.sort((a, b) => a.dist - b.dist);

    const take = Math.min(args.size, scored.length);
    const picked = scored.slice(0, take);

    const seedWav = wavNameForRecord(seed.record);
    const seedLabel = sanitizeForPath(recordKey(seed.record));
    const stationId = `station-${String(s + 1).padStart(2, "0")}-${seedLabel}`;
    const stationDir = path.join(outAbs, stationId);

    await fs.rm(stationDir, { recursive: true, force: true });
    await ensureDir(stationDir);

    const manifest = {
      stationId,
      createdAt: new Date().toISOString(),
      input: {
        jsonl: path.relative(process.cwd(), jsonlAbs),
        wavCache: path.relative(process.cwd(), wavCacheAbs),
        dims,
        weights,
        distance: "euclidean(z-scored)",
        seed: args.seed,
        seedMode: args.seedMode,
        size: args.size,
      },
      seed: {
        key: seed.key,
        sid_path: seed.record.sid_path,
        song_index: seed.record.song_index ?? null,
        wav: seedWav.baseName,
        features: seed.record.features,
        ratings: seed.record.ratings,
      },
      tracks: [],
      warnings: [],
    };

    // Copy seed first
    const seedSrc = path.join(wavCacheAbs, seedWav.rel);
    const seedDst = path.join(stationDir, `00-${seedWav.baseName}`);
    try {
      await fs.copyFile(seedSrc, seedDst);
    } catch {
      manifest.warnings.push(`Missing seed WAV: ${seedWav.rel}`);
    }

    // Copy neighbors
    const bpmValues = [];
    const energyValues = [];
    const centroidValues = [];
    const flatnessValues = [];
    for (let rank = 0; rank < picked.length; rank++) {
      const { candidate, dist, similarity } = picked[rank];
      const wav = wavNameForRecord(candidate.record);
      const src = path.join(wavCacheAbs, wav.rel);
      const dst = path.join(stationDir, `${String(rank + 1).padStart(2, "0")}-${wav.baseName}`);

      try {
        await fs.copyFile(src, dst);
      } catch {
        manifest.warnings.push(`Missing WAV: ${wav.rel}`);
        continue;
      }

      manifest.tracks.push({
        rank: rank + 1,
        key: candidate.key,
        sid_path: candidate.record.sid_path,
        song_index: candidate.record.song_index ?? null,
        wav: wav.baseName,
        distance: dist,
        similarity,
        features: candidate.record.features,
        ratings: candidate.record.ratings,
      });

      const bpm = candidate.record?.features?.bpm;
      const conf = candidate.record?.features?.confidence;
      if (typeof bpm === "number" && Number.isFinite(bpm) && typeof conf === "number" && conf >= 0.15) {
        bpmValues.push(bpm);
      }

      const energy = candidate.record?.features?.energy;
      if (typeof energy === "number" && Number.isFinite(energy)) energyValues.push(energy);
      const centroid = candidate.record?.features?.spectralCentroid;
      if (typeof centroid === "number" && Number.isFinite(centroid)) centroidValues.push(centroid);
      const flatness = candidate.record?.features?.spectralFlatnessDb;
      if (typeof flatness === "number" && Number.isFinite(flatness)) flatnessValues.push(flatness);
    }

    await fs.writeFile(path.join(stationDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    stationsIndex.push({
      stationId,
      dir: path.relative(process.cwd(), stationDir),
      seed: {
        key: seed.key,
        sid_path: seed.record.sid_path,
        song_index: seed.record.song_index ?? null,
        wav: seedWav.baseName,
      },
      trackCount: manifest.tracks.length + 1,
      warnings: manifest.warnings,
    });

    const dists = picked.map((p) => p.dist);
    const meanDist = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
    const maxDist = dists.length ? Math.max(...dists) : 0;

    const summarize = (values, label, digits = 2) => {
      if (!values || values.length < 2) return `${label}=n/a`;
      const minV = Math.min(...values);
      const maxV = Math.max(...values);
      const meanV = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((acc, x) => acc + (x - meanV) * (x - meanV), 0) / values.length;
      const sdV = Math.sqrt(Math.max(0, variance));
      return `${label}[min=${minV.toFixed(digits)} mean=${meanV.toFixed(digits)} max=${maxV.toFixed(digits)} sd=${sdV.toFixed(digits)} n=${values.length}]`;
    };

    let bpmSummary = "bpm=n/a";
    if (bpmValues.length >= 2) {
      const minBpm = Math.min(...bpmValues);
      const maxBpm = Math.max(...bpmValues);
      const meanBpm = bpmValues.reduce((a, b) => a + b, 0) / bpmValues.length;
      const variance = bpmValues.reduce((acc, x) => acc + (x - meanBpm) * (x - meanBpm), 0) / bpmValues.length;
      const stdBpm = Math.sqrt(Math.max(0, variance));
      bpmSummary = `bpm[min=${minBpm.toFixed(1)} mean=${meanBpm.toFixed(1)} max=${maxBpm.toFixed(1)} sd=${stdBpm.toFixed(1)} n=${bpmValues.length}]`;
    }

    const energySummary = summarize(energyValues, "energy", 2);
    const centroidSummary = summarize(centroidValues, "centroid", 1);
    const flatnessSummary = summarize(flatnessValues, "flatnessDb", 2);

    console.log(
      `Created ${stationId}: ${manifest.tracks.length + 1} WAVs; dist[mean=${meanDist.toFixed(3)} max=${maxDist.toFixed(3)}] ${bpmSummary} ${energySummary} ${centroidSummary} ${flatnessSummary}` +
        `${manifest.warnings.length ? ` (warnings=${manifest.warnings.length})` : ""}`
    );
  }

  await fs.writeFile(path.join(outAbs, "index.json"), JSON.stringify({ createdAt: new Date().toISOString(), stations: stationsIndex }, null, 2));

  const totalWarnings = stationsIndex.reduce((acc, s) => acc + (s.warnings?.length ?? 0), 0);
  console.log(`\nDone. Stations: ${stationsIndex.length}. Total warnings: ${totalWarnings}. Output: ${path.relative(process.cwd(), outAbs)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
