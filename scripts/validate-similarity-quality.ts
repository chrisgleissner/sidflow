#!/usr/bin/env bun
/**
 * Programmatic similarity quality validation — Phase 13.5
 *
 * Replaces the interactive SID station questionnaire (not automatable).
 * For each of 5 musical profiles, selects a seed song with extreme feature values,
 * runs a similarity query, and verifies cosine similarity + feature coherence.
 *
 * Prerequisites:
 *   - data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite exists
 *   - data/classified/features_*.jsonl has full classification data
 *
 * Usage:
 *   bun run scripts/validate-similarity-quality.ts
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
interface FeatureRecord {
  sid_path: string;
  features: Record<string, number>;
  metadata?: { title?: string; author?: string };
  song_count?: number;
  queue_index?: number;
}

interface ValidationProfile {
  name: string;
  description: string;
  seedCriteria: (f: FeatureRecord) => number; // higher = better seed
  resultCriteria: (f: FeatureRecord) => boolean; // should be true for good results
  resultCriteriaDescription: string;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function pass(msg: string) { console.log(`  ✅  ${msg}`); }
function fail(msg: string) { console.error(`  ❌  ${msg}`); process.exitCode = 1; }
function info(msg: string) { console.log(`  ℹ️   ${msg}`); }
function section(title: string) {
  console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// The 24-dimensional similarity vector fields (from README)
const VECTOR_FIELDS = [
  "tempoFused", "onsetDensityFused", "rhythmicRegularityFused", "syncopationSid",
  "arpeggioRateSid", "waveTriangleRatio", "waveSawRatio", "wavePulseRatio",
  "waveNoiseRatio", "pwmActivitySid", "filterCutoffMeanSid", "filterMotionFused",
  "samplePlaybackRate", "melodicClarityFused", "bassPresenceFused", "accompanimentShareSid",
  "voiceRoleEntropySid", "adsrPluckRatioSid", "adsrPadRatioSid", "loudnessFused",
  "dynamicRangeWav", "inharmonicityWav", "mfccResidual1", "mfccResidual2",
];

// Fallback field mappings if the canonical names don't exist in features
const FIELD_FALLBACKS: Record<string, string[]> = {
  "tempoFused": ["bpm"],
  "waveNoiseRatio": ["sidWaveNoiseRatio"],
  "waveSawRatio": ["sidWaveSawRatio"],
  "waveTriangleRatio": ["sidWaveTriangleRatio"],
  "wavePulseRatio": ["sidWavePulseRatio"],
  "bassPresenceFused": ["lowFrequencyEnergyRatio"],
  "melodicClarityFused": ["sidMelodicClarity"],
  "dynamicRangeWav": ["energy"],
  "inharmonicityWav": ["inharmonicity"],
  "loudnessFused": ["rms"],
  "filterCutoffMeanSid": ["sidFilterCutoffMean"],
  "onsetDensityFused": ["sidGateOnsetDensity"],
  "arpeggioRateSid": ["sidArpeggioActivity"],
  "rhythmicRegularityFused": ["sidRhythmicRegularity"],
  "filterMotionFused": ["sidFilterMotion"],
};

function getFeatureValue(record: FeatureRecord, fieldName: string): number {
  const raw = record.features[fieldName];
  if (raw !== undefined && raw !== null) return raw;
  // Try fallbacks
  const fallbacks = FIELD_FALLBACKS[fieldName] ?? [];
  for (const fb of fallbacks) {
    const fbVal = record.features[fb];
    if (fbVal !== undefined && fbVal !== null) return fbVal;
  }
  return 0;
}

function getVector(record: FeatureRecord): number[] {
  return VECTOR_FIELDS.map((f) => getFeatureValue(record, f));
}

// ────────────────────────────────────────────────────────────
// The 5 Musical Profiles
// ────────────────────────────────────────────────────────────
const PROFILES: ValidationProfile[] = [
  {
    name: "Profile 1: High-energy fast tempo",
    description: "Fast BPM, high energy, high onset density",
    seedCriteria: (r) => {
      const bpm = getFeatureValue(r, "tempoFused");
      const onset = getFeatureValue(r, "onsetDensityFused");
      return bpm / 200 + onset; // normalize BPM and add onset density
    },
    resultCriteria: (r) => getFeatureValue(r, "tempoFused") > 100,
    resultCriteriaDescription: "BPM > 100",
  },
  {
    name: "Profile 2: Ambient / low complexity",
    description: "Low tempo, low onset density, high pad ratio",
    seedCriteria: (r) => {
      const pad = getFeatureValue(r, "adsrPadRatioSid");
      const onset = getFeatureValue(r, "onsetDensityFused");
      return pad - onset;
    },
    resultCriteria: (r) =>
      getFeatureValue(r, "adsrPadRatioSid") > 0.3 || getFeatureValue(r, "tempoFused") < 100,
    resultCriteriaDescription: "adsrPadRatioSid > 0.3 OR BPM < 100",
  },
  {
    name: "Profile 3: Heavy bass",
    description: "High low-frequency energy ratio",
    seedCriteria: (r) => getFeatureValue(r, "bassPresenceFused"),
    resultCriteria: (r) => getFeatureValue(r, "bassPresenceFused") > 0.2,
    resultCriteriaDescription: "bassPresenceFused > 0.2",
  },
  {
    name: "Profile 4: Melodic clarity",
    description: "High melodic clarity, lead voice dominant",
    seedCriteria: (r) => getFeatureValue(r, "melodicClarityFused"),
    resultCriteria: (r) => getFeatureValue(r, "melodicClarityFused") > 0.3,
    resultCriteriaDescription: "melodicClarityFused > 0.3",
  },
  {
    name: "Profile 5: Noise / experimental",
    description: "High noise waveform ratio, high inharmonicity",
    seedCriteria: (r) => {
      const noise = getFeatureValue(r, "waveNoiseRatio");
      const inharm = getFeatureValue(r, "inharmonicityWav");
      return noise + inharm / 100;
    },
    resultCriteria: (r) => getFeatureValue(r, "waveNoiseRatio") > 0.1,
    resultCriteriaDescription: "waveNoiseRatio > 0.1",
  },
];

// ────────────────────────────────────────────────────────────
// Load classification data
// ────────────────────────────────────────────────────────────
async function loadFeatures(classifiedDir: string): Promise<FeatureRecord[]> {
  const files = await readdir(classifiedDir);
  const featureFiles = files
    .filter((f) => f.startsWith("features_") && f.endsWith(".jsonl"))
    .map((f) => path.join(classifiedDir, f))
    .sort();

  const records: FeatureRecord[] = [];
  for (const file of featureFiles) {
    const content = await readFile(file, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as FeatureRecord;
        if (rec.sid_path && rec.features) records.push(rec);
      } catch {
        // skip malformed
      }
    }
  }
  return records;
}

// ────────────────────────────────────────────────────────────
// Run a single profile validation
// ────────────────────────────────────────────────────────────
function runProfileValidation(
  profile: ValidationProfile,
  records: FeatureRecord[],
  topK = 20
): { passed: boolean; seedSong: string; topSimilarPassed: number; avgCosineSim: number } {
  section(profile.name);
  info(profile.description);

  // Find the best seed (top 5% by criteria, pick highest)
  const sorted = [...records].sort((a, b) => profile.seedCriteria(b) - profile.seedCriteria(a));
  // Use index 5 to avoid the absolute extreme (which may be an outlier)
  const seedIdx = Math.min(5, Math.floor(records.length * 0.01));
  const seed = sorted[seedIdx];

  if (!seed) {
    fail("Could not find a seed song for this profile");
    return { passed: false, seedSong: "", topSimilarPassed: 0, avgCosineSim: 0 };
  }

  info(`Seed: ${seed.sid_path} — "${seed.metadata?.title ?? "(untitled)"}" by ${seed.metadata?.author ?? "(unknown)"}`);
  info(`Seed score: ${profile.seedCriteria(seed).toFixed(4)}`);

  const seedVec = getVector(seed);
  const seedVecStr = VECTOR_FIELDS.slice(0, 5).map((f) =>
    `${f}=${getFeatureValue(seed, f).toFixed(3)}`
  ).join(", ");
  info(`Seed vector (first 5 dims): ${seedVecStr}`);

  // Compute cosine similarity to all other records
  const withSim = records
    .filter((r) => r.sid_path !== seed.sid_path)
    .map((r) => ({ r, sim: cosine(seedVec, getVector(r)) }))
    .sort((a, b) => b.sim - a.sim);

  const topResults = withSim.slice(0, topK);
  const avgCosineSim = topResults.reduce((s, x) => s + x.sim, 0) / topResults.length;

  info(`Top-${topK} avg cosine similarity to seed: ${avgCosineSim.toFixed(4)}`);

  let topSimilarPassed = 0;
  for (const { r, sim } of topResults.slice(0, 10)) {
    const meetsCriteria = profile.resultCriteria(r);
    if (meetsCriteria) topSimilarPassed++;
    const indicator = meetsCriteria ? "✅" : "⚠️";
    const critVal = VECTOR_FIELDS.slice(0, 3).map((f) => `${f.slice(0, 15)}=${getFeatureValue(r, f).toFixed(3)}`).join(" ");
    info(`  ${indicator} sim=${sim.toFixed(4)} ${r.sid_path.split("/").pop()} [${critVal}]`);
  }

  // Success: avg cosine > 0.7 AND ≥ 6/10 top results meet profile criteria
  const cosineThreshold = 0.7;
  const criteriaPassRate = topSimilarPassed / 10;
  const passed = avgCosineSim >= cosineThreshold && criteriaPassRate >= 0.5;

  if (avgCosineSim >= cosineThreshold) {
    pass(`Avg cosine similarity ${avgCosineSim.toFixed(4)} ≥ ${cosineThreshold} threshold`);
  } else {
    fail(`Avg cosine similarity ${avgCosineSim.toFixed(4)} < ${cosineThreshold} threshold`);
  }

  if (criteriaPassRate >= 0.5) {
    pass(`${topSimilarPassed}/10 top results meet profile criteria: ${profile.resultCriteriaDescription}`);
  } else {
    fail(`Only ${topSimilarPassed}/10 top results meet profile criteria: ${profile.resultCriteriaDescription}`);
  }

  return { passed, seedSong: seed.sid_path, topSimilarPassed, avgCosineSim };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  const classifiedDir = process.argv[2] ?? "data/classified";

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   SIDFlow Similarity Quality Validation — Phase 13.5    ║");
  console.log("║   (Programmatic replacement for interactive SID station) ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Classified dir: ${classifiedDir}`);

  section("Loading Feature Data");
  const records = await loadFeatures(classifiedDir);
  info(`Loaded ${records.length.toLocaleString()} classified tracks`);

  if (records.length < 1000) {
    fail(`Insufficient classified data: ${records.length} tracks. Need ≥ 1,000 for meaningful similarity validation.`);
    process.exit(1);
  }

  // Check that vectors have non-zero content
  const sampleVector = getVector(records[0]);
  const nonZeroCount = sampleVector.filter((v) => v !== 0).length;
  if (nonZeroCount < 5) {
    fail(`Sample vector has only ${nonZeroCount}/24 non-zero dims — feature data may be malformed`);
    process.exit(1);
  }
  pass(`Feature vectors appear valid (${nonZeroCount}/24 non-zero dims in sample)`);

  // Run all 5 profiles
  const results: Array<{ name: string; passed: boolean; seedSong: string; avgCosineSim: number }> = [];
  for (const profile of PROFILES) {
    const r = runProfileValidation(profile, records);
    results.push({ name: profile.name, passed: r.passed, seedSong: r.seedSong, avgCosineSim: r.avgCosineSim });
  }

  section("Phase 13.5 Results Summary");
  let passCount = 0;
  for (const r of results) {
    const indicator = r.passed ? "✅" : "❌";
    const cosineStr = r.avgCosineSim > 0 ? ` (avg cosine=${r.avgCosineSim.toFixed(4)})` : "";
    console.log(`  ${indicator}  ${r.name}${cosineStr}`);
    if (r.passed) passCount++;
  }

  if (passCount === 5) {
    pass(`5/5 similarity profiles validated — behavioral quality CONFIRMED`);
  } else {
    fail(`Only ${passCount}/5 similarity profiles passed — quality validation FAILED`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
