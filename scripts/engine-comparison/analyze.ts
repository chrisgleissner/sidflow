#!/usr/bin/env bun
/**
 * Compare two SID engines on one corpus, and say which is fit for classification.
 *
 * ## What "accuracy" can and cannot mean here
 *
 * There is no labelled ground truth for "these two SID tunes are similar", so
 * any claim of classification *accuracy* has to be anchored to something
 * external. This analysis uses two anchors and keeps them separate, because
 * they answer different questions and have different strengths:
 *
 *   A. reSIDfp as reference. reSIDfp is a cycle-accurate model of the MOS 6581 /
 *      8580 and is validated in this repo against a native libsidplayfp build at
 *      the same pinned refs (.github/workflows/engine-parity.yaml), which is in
 *      turn the emulator the community treats as correct. Deviation from it is
 *      therefore *error*, not merely difference. This makes reSIDfp scores
 *      trivially perfect, so on its own it cannot rank the engines fairly.
 *
 *   B. An engine-independent acoustic anchor. For every track a timbre
 *      fingerprint is computed directly from the rendered WAV, in log-spaced
 *      bands, by code that shares nothing with the classification pipeline. An
 *      engine's feature vector is then scored by how well the neighbours it
 *      proposes agree with this anchor. This does not privilege either engine
 *      and is the metric that can legitimately say one is worse.
 *
 * Anchor B is the one that carries the recommendation; anchor A quantifies how
 * far SIDLite sits from the reference.
 *
 * ## Metrics
 *
 * 1. Feature completeness — fraction of tracks whose feature vector is fully
 *    populated. A missing feature is a hard defect: it degrades every downstream
 *    decision for that track regardless of how good the rest looks.
 * 2. Rating agreement — exact agreement and Cohen's kappa on e/m/c. Kappa
 *    because raw agreement is inflated when one class dominates, which it does
 *    here.
 * 3. Neighbour-set agreement — recall@k of SIDLite's neighbours against
 *    reSIDfp's. This is what a "songs like this one" station actually consumes.
 * 4. Acoustic separation (anchor B) — for each engine, the mean fingerprint
 *    distance between a seed and its proposed neighbours, versus random pairs
 *    from the same corpus. Reported as a separation ratio (random/neighbour;
 *    >1 means the engine finds genuinely closer-sounding tracks) with a
 *    bootstrap 95% CI and Cohen's d.
 *
 * Every comparison is paired by track_id, so both engines are scored on exactly
 * the same tunes; tracks missing from either side are excluded and counted.
 *
 *   bun run scripts/engine-comparison/analyze.ts [--work <dir>] [--json <file>]
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";

const REPO = process.cwd();
const workIndex = process.argv.indexOf("--work");
const WORK = workIndex > 0 ? process.argv[workIndex + 1]! : path.join(REPO, "workspace/engine-comparison");
const jsonIndex = process.argv.indexOf("--json");
const JSON_OUT = jsonIndex > 0 ? process.argv[jsonIndex + 1]! : path.join(WORK, "results.json");

const ENGINES = ["residfp", "sidlite"] as const;
type Engine = (typeof ENGINES)[number];

const TOP_K = 5;
const BOOTSTRAP = 2000;

// ---------------------------------------------------------------- statistics

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((s, v) => s + v, 0) / xs.length);
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};

/** Deterministic LCG, so every reported interval is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Percentile bootstrap CI of the mean — no normality assumption. */
function bootstrapMeanCI(xs: number[], iterations = BOOTSTRAP): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  const rand = makeRandom(0x2545f491);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let j = 0; j < xs.length; j++) total += xs[(rand() * xs.length) | 0]!;
    means.push(total / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iterations * 0.025)]!, means[Math.floor(iterations * 0.975)]!];
}

/**
 * CI for a RATIO OF MEANS.
 *
 * Not the mean of per-pair ratios: mean(R/dᵢ) ≠ R/mean(dᵢ) by Jensen's
 * inequality, and using the former produced an interval that did not even
 * contain its own point estimate. Both samples are resampled independently and
 * the ratio recomputed each iteration.
 */
function bootstrapRatioOfMeansCI(numerator: number[], denominator: number[], iterations = BOOTSTRAP): [number, number] {
  if (numerator.length === 0 || denominator.length === 0) return [NaN, NaN];
  const rand = makeRandom(0x9e3779b9);
  const ratios: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let num = 0;
    for (let j = 0; j < numerator.length; j++) num += numerator[(rand() * numerator.length) | 0]!;
    let den = 0;
    for (let j = 0; j < denominator.length; j++) den += denominator[(rand() * denominator.length) | 0]!;
    ratios.push(num / numerator.length / (den / denominator.length));
  }
  ratios.sort((a, b) => a - b);
  return [ratios[Math.floor(iterations * 0.025)]!, ratios[Math.floor(iterations * 0.975)]!];
}

/**
 * Paired bootstrap CI for the mean difference between two engines measured on
 * the SAME seeds. Paired because the seeds are identical, which removes
 * between-tune variance and is far more sensitive than comparing two
 * independent means.
 */
function bootstrapPairedDiffCI(a: number[], b: number[], iterations = BOOTSTRAP): { diff: number; ci: [number, number] } {
  const diffs = a.map((v, i) => v - b[i]!);
  const rand = makeRandom(0x85ebca6b);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (let j = 0; j < diffs.length; j++) total += diffs[(rand() * diffs.length) | 0]!;
    means.push(total / diffs.length);
  }
  means.sort((x, y) => x - y);
  return {
    diff: mean(diffs),
    ci: [means[Math.floor(iterations * 0.025)]!, means[Math.floor(iterations * 0.975)]!],
  };
}

function cohensD(a: number[], b: number[]): number {
  const sa = sd(a);
  const sb = sd(b);
  const pooled = Math.sqrt((sa * sa + sb * sb) / 2);
  return pooled === 0 ? 0 : (mean(b) - mean(a)) / pooled;
}

/** Cohen's kappa for two raters over the same items. */
function cohensKappa(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return NaN;
  const labels = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
  const po = agree / a.length;
  let pe = 0;
  for (const label of labels) {
    const pa = a.filter((v) => v === label).length / a.length;
    const pb = b.filter((v) => v === label).length / b.length;
    pe += pa * pb;
  }
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

// ------------------------------------------------------------ audio anchor

function readWav(file: string): { channels: number; sampleRate: number; pcm: Int16Array } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length < 44) return null;
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("latin1", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) return null;
  return { channels: fmt.channels, sampleRate: fmt.sampleRate, pcm: new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2)) };
}

/**
 * Log-spaced band energies, mean-removed so overall loudness drops out and only
 * spectral shape remains. Deliberately independent of Essentia and of the
 * pipeline's feature set, so it cannot rubber-stamp the thing it is judging.
 */
const BAND_EDGES = [40, 80, 150, 260, 430, 700, 1100, 1700, 2600, 4000, 6200, 9500, 15000];

function fingerprint(wav: { channels: number; sampleRate: number; pcm: Int16Array }): Float64Array | null {
  const frames = Math.floor(wav.pcm.length / wav.channels);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < wav.channels; c++) acc += wav.pcm[i * wav.channels + c]! / 32768;
    mono[i] = acc / wav.channels;
  }
  const N = 4096;
  const bands = new Float64Array(BAND_EDGES.length - 1);
  let used = 0;
  for (let start = 0; start + N <= mono.length && used < 40; start += N) {
    for (let b = 0; b < BAND_EDGES.length - 1; b++) {
      const lo = BAND_EDGES[b]!;
      const hi = BAND_EDGES[b + 1]!;
      let energy = 0;
      for (let p = 0; p < 3; p++) {
        const freq = lo * Math.pow(hi / lo, (p + 0.5) / 3);
        const coeff = 2 * Math.cos((2 * Math.PI * freq) / wav.sampleRate);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < N; i++) {
          const s0 = mono[start + i]! + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        energy += s1 * s1 + s2 * s2 - coeff * s1 * s2;
      }
      bands[b]! += energy / 3;
    }
    used++;
  }
  if (used === 0) return null;
  const out = new Float64Array(bands.length);
  for (let b = 0; b < bands.length; b++) out[b] = Math.log10(bands[b]! / used + 1e-12);
  const m = out.reduce((s, v) => s + v, 0) / out.length;
  for (let b = 0; b < out.length; b++) out[b]! -= m;
  return out;
}

const distance = (a: Float64Array, b: Float64Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / a.length);
};

// ------------------------------------------------------------------- inputs

interface Track {
  track_id: string;
  sid_path: string;
  e: number;
  m: number;
  c: number;
  render_engine: string;
}

interface EngineData {
  engine: Engine;
  elapsedSeconds: number | null;
  tracks: Map<string, Track>;
  neighbours: Map<string, string[]>;
  featureRows: number;
  completeFeatures: number;
  missingByFeature: Record<string, number>;
  vectorDimensions: number | null;
  fingerprints: Map<string, Float64Array>;
}

const FEATURE_KEYS = [
  "bpm", "rms", "spectralCentroid", "spectralCentroidStd", "spectralRolloff",
  "spectralFlatnessDb", "spectralEntropy", "spectralCrest", "spectralHfc",
  "zeroCrossingRate", "spectralContrastMean", "mfccMean1", "mfccMean2",
  "mfccMean3", "mfccMean4", "mfccMean5", "onsetDensity", "rhythmicRegularity",
  "spectralFluxMean", "dynamicRange", "pitchSalience", "inharmonicity",
  "lowFrequencyEnergyRatio",
];

function walkFiles(dir: string, predicate: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

function loadEngine(engine: Engine): EngineData {
  const root = path.join(WORK, engine);
  const elapsedFile = path.join(root, "elapsed.txt");
  const elapsed = existsSync(elapsedFile)
    ? Number.parseFloat(readFileSync(elapsedFile, "utf8").replace(/[^0-9.]/g, ""))
    : null;

  const tracks = new Map<string, Track>();
  const neighbours = new Map<string, string[]>();
  let vectorDimensions: number | null = null;

  const dbPath = path.join(root, "export.sqlite");
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    for (const row of db.query("select track_id, sid_path, e, m, c, render_engine from tracks").all() as Track[]) {
      tracks.set(row.track_id, row);
    }
    const raw = db.query("select seed_track_id, neighbor_track_id, rank from neighbors order by seed_track_id, rank").all() as Array<{
      seed_track_id: string;
      neighbor_track_id: string;
      rank: number;
    }>;
    for (const row of raw) {
      const list = neighbours.get(row.seed_track_id) ?? [];
      list.push(row.neighbor_track_id);
      neighbours.set(row.seed_track_id, list);
    }
    const meta = db.query("select value from meta where key = 'manifest_json'").get() as { value: string } | null;
    if (meta) vectorDimensions = JSON.parse(meta.value).vector_dimensions ?? null;
  }

  let featureRows = 0;
  let completeFeatures = 0;
  const missingByFeature: Record<string, number> = {};
  for (const file of walkFiles(path.join(root, "data/classified"), (n) => n.startsWith("features_") && n.endsWith(".jsonl"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let record: { features?: Record<string, unknown> };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      featureRows++;
      const features = record.features ?? {};
      let complete = true;
      for (const key of FEATURE_KEYS) {
        if (features[key] === null || features[key] === undefined) {
          missingByFeature[key] = (missingByFeature[key] ?? 0) + 1;
          complete = false;
        }
      }
      if (complete) completeFeatures++;
    }
  }

  // Fingerprints come from the WAVs this engine actually produced.
  const fingerprints = new Map<string, Float64Array>();
  const cacheRoot = path.join(root, "workspace/audio-cache");
  for (const [trackId, track] of tracks) {
    const wavPath = path.join(cacheRoot, track.sid_path.replace(/\.sid$/i, ".wav"));
    if (!existsSync(wavPath)) continue;
    const wav = readWav(wavPath);
    if (!wav) continue;
    const fp = fingerprint(wav);
    if (fp) fingerprints.set(trackId, fp);
  }

  return { engine, elapsedSeconds: elapsed, tracks, neighbours, featureRows, completeFeatures, missingByFeature, vectorDimensions, fingerprints };
}

// ------------------------------------------------------------------ analysis

const data = Object.fromEntries(ENGINES.map((engine) => [engine, loadEngine(engine)])) as Record<Engine, EngineData>;

const shared = [...data.residfp.tracks.keys()].filter((id) => data.sidlite.tracks.has(id));

/**
 * Anchor B: are an engine's proposed neighbours acoustically close?
 *
 * Both engines are judged in ONE fingerprint space — the reference audio
 * rendered by reSIDfp. Scoring each engine against its own rendering would
 * conflate two different things: how good its feature vector is at picking
 * similar tunes, and how its audio happens to sound. Only the first is a
 * property of the classifier, so the reference space is held fixed and only the
 * neighbour lists vary.
 */
const referenceFingerprints = data.residfp.fingerprints;

function acousticSeparation(engine: Engine) {
  const neighbourLists = data[engine].neighbours;
  const neighbourDistances: number[] = [];
  /** Per-seed mean, kept separately so the two engines can be compared paired. */
  const perSeedMean = new Map<string, number>();

  for (const [seed, list] of neighbourLists) {
    const seedFp = referenceFingerprints.get(seed);
    if (!seedFp) continue;
    const seedDistances: number[] = [];
    for (const neighbour of list.slice(0, TOP_K)) {
      const fp = referenceFingerprints.get(neighbour);
      if (fp) seedDistances.push(distance(seedFp, fp));
    }
    if (seedDistances.length === 0) continue;
    neighbourDistances.push(...seedDistances);
    perSeedMean.set(seed, mean(seedDistances));
  }

  const ids = [...referenceFingerprints.keys()];
  const randomDistances: number[] = [];
  const rand = makeRandom(0xc2b2ae35);
  for (let i = 0; i < Math.max(4000, neighbourDistances.length * 4) && ids.length > 2; i++) {
    const a = ids[(rand() * ids.length) | 0]!;
    const b = ids[(rand() * ids.length) | 0]!;
    if (a !== b) randomDistances.push(distance(referenceFingerprints.get(a)!, referenceFingerprints.get(b)!));
  }

  const nMean = mean(neighbourDistances);
  const rMean = mean(randomDistances);
  return {
    neighbourPairs: neighbourDistances.length,
    randomPairs: randomDistances.length,
    neighbourMean: nMean,
    randomMean: rMean,
    separationRatio: rMean / nMean,
    separationRatioCI95: bootstrapRatioOfMeansCI(randomDistances, neighbourDistances),
    cohensD: cohensD(neighbourDistances, randomDistances),
    perSeedMean,
  };
}

/** How often does SIDLite propose the same neighbours reSIDfp does? */
function neighbourRecall() {
  const perSeed: number[] = [];
  for (const seed of shared) {
    const reference = (data.residfp.neighbours.get(seed) ?? []).slice(0, TOP_K);
    const candidate = new Set((data.sidlite.neighbours.get(seed) ?? []).slice(0, TOP_K));
    if (reference.length === 0) continue;
    const hit = reference.filter((id) => candidate.has(id)).length;
    perSeed.push(hit / reference.length);
  }
  return { seeds: perSeed.length, recallAtK: mean(perSeed), recallCI95: bootstrapMeanCI(perSeed) };
}

function ratingAgreement() {
  const out: Record<string, { exact: number; kappa: number }> = {};
  for (const dim of ["e", "m", "c"] as const) {
    const a: number[] = [];
    const b: number[] = [];
    for (const id of shared) {
      a.push(data.residfp.tracks.get(id)![dim]);
      b.push(data.sidlite.tracks.get(id)![dim]);
    }
    const exact = a.filter((v, i) => v === b[i]).length / a.length;
    out[dim] = { exact, kappa: cohensKappa(a, b) };
  }
  return out;
}

const acousticByEngine = Object.fromEntries(ENGINES.map((e) => [e, acousticSeparation(e)])) as Record<
  Engine,
  ReturnType<typeof acousticSeparation>
>;

/**
 * Head-to-head on identical seeds, in the reference fingerprint space.
 *
 * This is the decisive test: for every seed both engines proposed neighbours
 * for, how much closer (or farther) are SIDLite's picks than reSIDfp's? A CI
 * straddling zero means the two are not distinguishable on this measure.
 */
function pairedHeadToHead() {
  const seeds = [...acousticByEngine.residfp.perSeedMean.keys()].filter((seed) =>
    acousticByEngine.sidlite.perSeedMean.has(seed),
  );
  const reference = seeds.map((seed) => acousticByEngine.residfp.perSeedMean.get(seed)!);
  const candidate = seeds.map((seed) => acousticByEngine.sidlite.perSeedMean.get(seed)!);
  const { diff, ci } = bootstrapPairedDiffCI(candidate, reference);
  const wins = seeds.filter((_, i) => candidate[i]! < reference[i]!).length;
  return {
    seeds: seeds.length,
    residfpMean: mean(reference),
    sidliteMean: mean(candidate),
    // Positive => SIDLite's neighbours are FARTHER, i.e. worse.
    meanDifference: diff,
    difference95CI: ci,
    distinguishable: ci[0] > 0 || ci[1] < 0,
    sidliteCloserOnSeeds: wins,
    sidliteCloserFraction: wins / seeds.length,
  };
}

const results = {
  generatedAt: new Date().toISOString(),
  corpus: {
    requested: 500,
    tracksResidfp: data.residfp.tracks.size,
    tracksSidlite: data.sidlite.tracks.size,
    sharedTracks: shared.length,
  },
  completeness: Object.fromEntries(
    ENGINES.map((engine) => [
      engine,
      {
        featureRows: data[engine].featureRows,
        complete: data[engine].completeFeatures,
        completeFraction: data[engine].featureRows === 0 ? NaN : data[engine].completeFeatures / data[engine].featureRows,
        missingByFeature: data[engine].missingByFeature,
      },
    ]),
  ),
  vectorDimensions: Object.fromEntries(ENGINES.map((e) => [e, data[e].vectorDimensions])),
  ratingAgreement: ratingAgreement(),
  neighbourRecall: neighbourRecall(),
  acoustic: Object.fromEntries(
    ENGINES.map((e) => {
      const { perSeedMean: _omit, ...rest } = acousticByEngine[e];
      return [e, rest];
    }),
  ),
  pairedHeadToHead: pairedHeadToHead(),
  timing: Object.fromEntries(ENGINES.map((e) => [e, data[e].elapsedSeconds])),
};

writeFileSync(JSON_OUT, `${JSON.stringify(results, null, 2)}\n`);

const pct = (v: number) => (Number.isFinite(v) ? `${(100 * v).toFixed(1)}%` : "n/a");
const num = (v: number, digits = 4) => (Number.isFinite(v) ? v.toFixed(digits) : "n/a");

console.log(`\ncorpus: ${shared.length} tracks classified by both engines`);
console.log(`vector dimensions: residfp=${results.vectorDimensions.residfp} sidlite=${results.vectorDimensions.sidlite}`);

console.log(`\n--- 1. feature completeness (a missing feature is a hard defect) ---`);
for (const engine of ENGINES) {
  const c = results.completeness[engine]!;
  const worst = Object.entries(c.missingByFeature).sort((x, y) => y[1] - x[1]).slice(0, 3);
  console.log(`  ${engine.padEnd(8)} ${c.complete}/${c.featureRows} complete (${pct(c.completeFraction)})` +
    (worst.length ? `   most-missing: ${worst.map(([k, v]) => `${k}=${v}`).join(", ")}` : ""));
}

console.log(`\n--- 2. rating agreement between engines (paired) ---`);
for (const [dim, v] of Object.entries(results.ratingAgreement)) {
  console.log(`  ${dim}: exact ${pct(v.exact)}   Cohen's kappa ${num(v.kappa, 3)}`);
}

console.log(`\n--- 3. neighbour-set agreement (recall@${TOP_K}, SIDLite vs reSIDfp) ---`);
console.log(`  ${pct(results.neighbourRecall.recallAtK)} over ${results.neighbourRecall.seeds} seeds` +
  `   95% CI [${pct(results.neighbourRecall.recallCI95[0])}, ${pct(results.neighbourRecall.recallCI95[1])}]`);

console.log(`\n--- 4. acoustic separation (engine-independent anchor; >1 is better than chance) ---`);
for (const engine of ENGINES) {
  const a = results.acoustic[engine]!;
  console.log(`  ${engine.padEnd(8)} ratio ${num(a.separationRatio, 4)}` +
    `  95% CI [${num(a.separationRatioCI95[0], 4)}, ${num(a.separationRatioCI95[1], 4)}]` +
    `  d=${num(a.cohensD, 3)}  (n=${a.neighbourPairs})`);
}

console.log(`\n--- 5. head-to-head, paired on identical seeds, in reference audio space ---`);
{
  const h = results.pairedHeadToHead;
  console.log(`  mean neighbour distance: residfp ${num(h.residfpMean)}   sidlite ${num(h.sidliteMean)}`);
  console.log(`  difference (sidlite - residfp): ${num(h.meanDifference)}` +
    `   95% CI [${num(h.difference95CI[0])}, ${num(h.difference95CI[1])}]`);
  console.log(`  distinguishable at 95%: ${h.distinguishable ? "YES" : "NO — the interval straddles zero"}`);
  console.log(`  sidlite picked closer neighbours on ${h.sidliteCloserOnSeeds}/${h.seeds} seeds (${pct(h.sidliteCloserFraction)})`);
}

console.log(`\n--- 6. wall clock for the same corpus ---`);
for (const engine of ENGINES) {
  const t = results.timing[engine];
  console.log(`  ${engine.padEnd(8)} ${t === null ? "n/a" : `${t.toFixed(1)}s`}`);
}
const tR = results.timing.residfp;
const tS = results.timing.sidlite;
if (tR && tS) {
  console.log(`  reSIDfp / SIDLite throughput ratio: ${(tR / tS).toFixed(2)}x`);
}

console.log(`\nwritten: ${JSON_OUT}`);
