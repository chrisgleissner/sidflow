import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HVSC_E2E_SUBSET_TARGET_COUNT,
  getHvscE2eProblematicPaths,
  loadHvscE2eSubsetManifest,
  materializeHvscE2eSubset,
  type ClassificationRecord,
  type SidflowConfig,
} from "../packages/sidflow-common/src/index.js";

import { planClassification, generateAutoTags } from "../packages/sidflow-classify/src/index.js";
import { hasRealisticCompleteFeatureVector } from "../packages/sidflow-classify/src/deterministic-ratings.js";
import {
  runPersonaStationCli,
  type ParallelPersonaStationResult,
  type PersonaStationOutput,
} from "../packages/sidflow-play/src/persona-station.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const LOCAL_HVSC_ROOT = path.join(REPO_ROOT, "workspace", "hvsc");
const MANIFEST_PATH = path.join(REPO_ROOT, "integration-tests", "fixtures", "hvsc-persona-300-manifest.json");
const STATION_ANALYSIS_DIR = path.join(REPO_ROOT, "station-analysis");
const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-hvsc-persona-e2e-");

const HVSC_SUBSET_CACHE_DIR = path.join(REPO_ROOT, "workspace", "hvsc-e2e-subset-cache");
const NETWORK_E2E_ENV = "SIDFLOW_ENABLE_NETWORK_E2E_MATERIALIZATION";

const MAX_OVERLAP_PCT = 40;
const STATION_SIZE = 50;

function hasWarmSubsetCache(): boolean {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { entries?: Array<{ sidPath: string }> };
    const entries = manifest.entries ?? [];
    return entries.length > 0
      && entries.every((entry) => existsSync(path.join(HVSC_SUBSET_CACHE_DIR, "C64Music", normalizeSubsetSidPath(entry.sidPath))));
  } catch {
    return false;
  }
}

const SHOULD_SKIP_NETWORK_MATERIALIZATION =
  !existsSync(LOCAL_HVSC_ROOT)
  && !hasWarmSubsetCache()
  && process.env[NETWORK_E2E_ENV] !== "1";

function normalizeSubsetSidPath(sidPath: string): string {
  return sidPath.startsWith("C64Music/") ? sidPath.slice("C64Music/".length) : sidPath;
}

function readJsonlRecords(filePath: string): Promise<ClassificationRecord[]> {
  return readFile(filePath, "utf8").then((content) => (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ClassificationRecord)
  ));
}

// ---------------------------------------------------------------------------
// Artifact generation helpers
// ---------------------------------------------------------------------------

async function writeStationAnalysisArtifacts(
  analysisDir: string,
  result: ParallelPersonaStationResult,
): Promise<void> {
  await mkdir(analysisDir, { recursive: true });

  // 1. Per-persona station JSON files
  for (let i = 0; i < result.stations.length; i++) {
    const station = result.stations[i];
    await writeFile(
      path.join(analysisDir, `persona-${i + 1}-station.json`),
      JSON.stringify({
        personaId: station.personaId,
        personaLabel: station.personaLabel,
        trackCount: station.trackCount,
        tracks: station.tracks,
      }, null, 2),
      "utf8",
    );
  }

  // 2. Per-persona distribution JSON files
  for (let i = 0; i < result.stations.length; i++) {
    const station = result.stations[i];
    await writeFile(
      path.join(analysisDir, `persona-${i + 1}-distribution.json`),
      JSON.stringify({
        personaId: station.personaId,
        personaLabel: station.personaLabel,
        distribution: station.distribution,
      }, null, 2),
      "utf8",
    );
  }

  // 3. Overlap matrix
  await writeFile(
    path.join(analysisDir, "persona-overlap-matrix.json"),
    JSON.stringify({
      maxAllowedOverlapPct: MAX_OVERLAP_PCT,
      overlapValid: result.overlapValid,
      pairs: result.overlapMatrix,
    }, null, 2),
    "utf8",
  );

  // 4. Divergence report
  const lines: string[] = [
    "# Persona Divergence Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Architecture",
    "",
    "Parallel independent model: each persona independently scores ALL tracks and selects its top 50.",
    "NO cross-persona filtering. NO intersection. NO allAccepted requirement.",
    "",
    "## Personas",
    "",
    "| # | ID | Label |",
    "|---|-------|-------|",
    ...result.personas.map((p, i) => `| ${i + 1} | ${p.id} | ${p.label} |`),
    "",
    "## Distribution Summary",
    "",
    "| Persona | avgRhythmicDensity | avgMelodicComplexity | avgTimbralRichness | avgNostalgiaBias | avgExperimentalTolerance |",
    "|---------|-------------------|---------------------|-------------------|-----------------|------------------------|",
    ...result.stations.map((s) =>
      `| ${s.personaLabel} | ${s.distribution.avgRhythmicDensity.toFixed(4)} | ${s.distribution.avgMelodicComplexity.toFixed(4)} | ${s.distribution.avgTimbralRichness.toFixed(4)} | ${s.distribution.avgNostalgiaBias.toFixed(4)} | ${s.distribution.avgExperimentalTolerance.toFixed(4)} |`,
    ),
    "",
    "## Distribution Assertions",
    "",
    "| Metric | Direction | Expected Persona | Actual Persona | Value | Passed |",
    "|--------|-----------|-----------------|----------------|-------|--------|",
    ...result.distributionAssertions.map((a) =>
      `| ${a.metric} | ${a.direction} | ${a.expectedPersona} | ${a.actualPersona} | ${a.actualValue.toFixed(4)} | ${a.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    "## Overlap Matrix",
    "",
    `Max allowed overlap: ${MAX_OVERLAP_PCT}%`,
    "",
    "| Persona A | Persona B | Shared Tracks | Overlap % | Status |",
    "|-----------|-----------|---------------|-----------|--------|",
    ...result.overlapMatrix.map((e) =>
      `| ${e.personaA} | ${e.personaB} | ${e.sharedCount} | ${e.overlapPct}% | ${e.overlapPct <= MAX_OVERLAP_PCT ? "PASS" : "FAIL"} |`,
    ),
    "",
    "## Anti-Collapse Validation",
    "",
    "- All stations independent: YES (parallel model, no sequential filtering)",
    "- No station is derived from intersection: YES (each persona scores full pool)",
    `- Overlap valid (all pairs <= ${MAX_OVERLAP_PCT}%): ${result.overlapValid ? "YES" : "NO"}`,
    `- Distribution valid (leader assertions): ${result.distributionValid ? "YES" : "NO"}`,
    "",
    "## Per-Persona Top 5 Tracks",
    "",
  ];

  for (const station of result.stations) {
    lines.push(`### ${station.personaLabel}`);
    lines.push("");
    lines.push("| Rank | Track ID | Score | Explanation |");
    lines.push("|------|----------|-------|-------------|");
    for (const track of station.tracks.slice(0, 5)) {
      lines.push(`| ${track.rank} | \`${track.trackId}\` | ${track.score.toFixed(4)} | ${track.explanation} |`);
    }
    lines.push("");
  }

  await writeFile(path.join(analysisDir, "persona-divergence-report.md"), lines.join("\n"), "utf8");
}

async function writeDeterminismProof(
  analysisDir: string,
  outputA: string,
  outputB: string,
): Promise<void> {
  const identical = outputA === outputB;
  const lines = [
    "# Determinism Proof",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Result",
    "",
    identical
      ? "IDENTICAL — two independent runs produced byte-identical JSON output."
      : "NOT IDENTICAL — the two runs produced different output. Non-determinism detected.",
    "",
    "## Evidence",
    "",
    `- Run A output length: ${outputA.length} bytes`,
    `- Run B output length: ${outputB.length} bytes`,
    `- SHA comparison: ${identical ? "MATCH" : "MISMATCH"}`,
    "",
  ];

  if (!identical) {
    let firstDiff = -1;
    for (let i = 0; i < Math.min(outputA.length, outputB.length); i++) {
      if (outputA[i] !== outputB[i]) {
        firstDiff = i;
        break;
      }
    }
    lines.push(`First differing position: ${firstDiff}`);
    lines.push(`A context: ${outputA.slice(Math.max(0, firstDiff - 40), firstDiff + 40)}`);
    lines.push(`B context: ${outputB.slice(Math.max(0, firstDiff - 40), firstDiff + 40)}`);
  }

  await writeFile(path.join(analysisDir, "determinism-proof.md"), lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("HVSC 300-file persona station E2E", () => {
  let tempRoot = "";

  afterAll(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  (SHOULD_SKIP_NETWORK_MATERIALIZATION ? test.skip : test)(
    "materializes the deterministic subset, classifies it, and builds 5 independent persona stations with verified divergence",
    async () => {
      // -----------------------------------------------------------------------
      // Phase 1: Manifest validation
      // -----------------------------------------------------------------------
      const manifest = await loadHvscE2eSubsetManifest(MANIFEST_PATH);
      expect(manifest.entries).toHaveLength(HVSC_E2E_SUBSET_TARGET_COUNT);

      const selectedPaths = new Set(manifest.entries.map((entry) => normalizeSubsetSidPath(entry.sidPath)));
      expect(selectedPaths.size).toBe(HVSC_E2E_SUBSET_TARGET_COUNT);

      for (const problematicPath of getHvscE2eProblematicPaths()) {
        expect(selectedPaths.has(problematicPath)).toBe(true);
      }

      // -----------------------------------------------------------------------
      // Phase 2: Materialization + classification
      // -----------------------------------------------------------------------
      tempRoot = await mkdtemp(TEMP_PREFIX);
      const hvscRoot = HVSC_SUBSET_CACHE_DIR;
      const audioCachePath = path.join(tempRoot, "audio-cache");
      const tagsPath = path.join(tempRoot, "tags");
      const classifiedPath = path.join(tempRoot, "classified");
      const configPath = path.join(tempRoot, "sidflow.persona-e2e.json");
      const personaJsonA = path.join(tempRoot, "persona-station-a.json");
      const personaJsonB = path.join(tempRoot, "persona-station-b.json");
      const personaM3u = path.join(tempRoot, "persona-station.m3u8");

      await materializeHvscE2eSubset(manifest, hvscRoot, {
        localHvscRoot: existsSync(LOCAL_HVSC_ROOT) ? LOCAL_HVSC_ROOT : undefined,
        concurrency: 8,
        allowNetworkFetch: process.env[NETWORK_E2E_ENV] === "1",
      });

      const config: SidflowConfig = {
        sidPath: hvscRoot,
        audioCachePath,
        tagsPath,
        classifiedPath,
        threads: 4,
        classificationDepth: 3,
        introSkipSec: 15,
        maxClassifySec: 15,
        maxRenderSec: 30,
        render: {
          preferredEngines: ["wasm"],
        },
      } as SidflowConfig;
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

      const plan = await planClassification({ configPath, forceRebuild: true });
      const classResult = await generateAutoTags(plan, {
        threads: 4,
        deleteWavAfterClassification: true,
        lifecycleLogPath: path.join(tempRoot, "classification-lifecycle.jsonl"),
      });

      // -----------------------------------------------------------------------
      // Phase 3: Classification result validation
      // -----------------------------------------------------------------------
      expect(classResult.metrics.failedCount).toBe(0);
      expect(classResult.metrics.degradedCount).toBe(0);
      expect(classResult.metrics.metadataOnlyCount).toBe(0);
      expect(classResult.jsonlRecordCount).toBeGreaterThanOrEqual(HVSC_E2E_SUBSET_TARGET_COUNT);

      const records = await readJsonlRecords(classResult.jsonlFile);
      expect(records.length).toBe(classResult.jsonlRecordCount);

      const classifiedSidPaths = new Set(records.map((record) => normalizeSubsetSidPath(record.sid_path)));
      expect(classifiedSidPaths.size).toBe(HVSC_E2E_SUBSET_TARGET_COUNT);
      expect([...classifiedSidPaths].every((sidPath) => selectedPaths.has(sidPath))).toBe(true);

      for (const record of records) {
        expect(record.features).toBeDefined();
        expect(hasRealisticCompleteFeatureVector(record.features ?? {})).toBe(true);
        expect(Array.isArray(record.vector)).toBe(true);
        expect(record.vector).toHaveLength(24);
        expect((record.vector ?? []).every((value) => typeof value === "number" && Number.isFinite(value))).toBe(true);
      }

      // -----------------------------------------------------------------------
      // Phase 4: Persona station — run A
      // -----------------------------------------------------------------------
      const exitCodeA = await runPersonaStationCli([
        "--classification-jsonl",
        classResult.jsonlFile,
        "--subset-manifest",
        MANIFEST_PATH,
        "--output-json",
        personaJsonA,
        "--output-m3u",
        personaM3u,
      ]);
      expect(exitCodeA).toBe(0);

      // -----------------------------------------------------------------------
      // Phase 5: Persona station — run B (determinism check)
      // -----------------------------------------------------------------------
      const exitCodeB = await runPersonaStationCli([
        "--classification-jsonl",
        classResult.jsonlFile,
        "--subset-manifest",
        MANIFEST_PATH,
        "--output-json",
        personaJsonB,
      ]);
      expect(exitCodeB).toBe(0);

      const [personaOutputA, personaOutputB] = await Promise.all([
        readFile(personaJsonA, "utf8"),
        readFile(personaJsonB, "utf8"),
      ]);

      // -----------------------------------------------------------------------
      // Phase 6: Determinism — byte-identical output
      // -----------------------------------------------------------------------
      expect(personaOutputA).toBe(personaOutputB);

      const personaResult = JSON.parse(personaOutputA) as ParallelPersonaStationResult;

      // -----------------------------------------------------------------------
      // Phase 7: Structural assertions — 5 independent stations
      // -----------------------------------------------------------------------
      expect(personaResult.personas).toHaveLength(5);
      expect(personaResult.stations).toHaveLength(5);

      // Each station has exactly STATION_SIZE tracks
      for (const station of personaResult.stations) {
        expect(station.trackCount).toBe(STATION_SIZE);
        expect(station.tracks).toHaveLength(STATION_SIZE);

        // All track IDs unique within a station
        const ids = new Set(station.tracks.map((t) => t.trackId));
        expect(ids.size).toBe(STATION_SIZE);

        // Ranks are 1..50
        for (let i = 0; i < station.tracks.length; i++) {
          expect(station.tracks[i].rank).toBe(i + 1);
        }

        // Scores are monotonically non-increasing
        for (let i = 1; i < station.tracks.length; i++) {
          expect(station.tracks[i].score).toBeLessThanOrEqual(station.tracks[i - 1].score);
        }

        // Every track has an explanation string
        for (const track of station.tracks) {
          expect(typeof track.explanation).toBe("string");
          expect(track.explanation.length).toBeGreaterThan(0);
        }

        // Every track has valid metrics
        for (const track of station.tracks) {
          for (const key of ["melodicComplexity", "rhythmicDensity", "timbralRichness", "nostalgiaBias", "experimentalTolerance"] as const) {
            expect(typeof track.metrics[key]).toBe("number");
            expect(track.metrics[key]).toBeGreaterThanOrEqual(0);
            expect(track.metrics[key]).toBeLessThanOrEqual(1);
          }
        }

        // Distribution is computed
        expect(typeof station.distribution.avgRhythmicDensity).toBe("number");
        expect(typeof station.distribution.avgMelodicComplexity).toBe("number");
        expect(typeof station.distribution.avgTimbralRichness).toBe("number");
        expect(typeof station.distribution.avgNostalgiaBias).toBe("number");
        expect(typeof station.distribution.avgExperimentalTolerance).toBe("number");
      }

      // -----------------------------------------------------------------------
      // Phase 8: Anti-collapse — no two stations are identical
      // -----------------------------------------------------------------------
      for (let i = 0; i < personaResult.stations.length; i++) {
        const idsA = personaResult.stations[i].tracks.map((t) => t.trackId).join(",");
        for (let j = i + 1; j < personaResult.stations.length; j++) {
          const idsB = personaResult.stations[j].tracks.map((t) => t.trackId).join(",");
          expect(idsA).not.toBe(idsB);
        }
      }

      // -----------------------------------------------------------------------
      // Phase 9: Overlap constraint — every pair <= MAX_OVERLAP_PCT
      // -----------------------------------------------------------------------
      expect(personaResult.overlapMatrix.length).toBe(10); // C(5,2)
      expect(personaResult.overlapValid).toBe(true);

      for (const entry of personaResult.overlapMatrix) {
        expect(entry.overlapPct).toBeLessThanOrEqual(MAX_OVERLAP_PCT);
      }

      // -----------------------------------------------------------------------
      // Phase 10: Distribution assertions
      // -----------------------------------------------------------------------
      expect(personaResult.distributionValid).toBe(true);
      expect(personaResult.distributionAssertions.length).toBe(5);

      for (const assertion of personaResult.distributionAssertions) {
        expect(assertion.passed).toBe(true);
      }

      // Verify specific leaders directly from station data:
      const stationByPersona = (id: string): PersonaStationOutput =>
        personaResult.stations.find((s) => s.personaId === id)!;

      // Fast Paced must have highest avgRhythmicDensity
      const fastPaced = stationByPersona("fast_paced");
      for (const other of personaResult.stations) {
        if (other.personaId !== "fast_paced") {
          expect(fastPaced.distribution.avgRhythmicDensity)
            .toBeGreaterThan(other.distribution.avgRhythmicDensity);
        }
      }

      // Slow/Ambient must have lowest avgRhythmicDensity
      const slowAmbient = stationByPersona("slow_ambient");
      for (const other of personaResult.stations) {
        if (other.personaId !== "slow_ambient") {
          expect(slowAmbient.distribution.avgRhythmicDensity)
            .toBeLessThan(other.distribution.avgRhythmicDensity);
        }
      }

      // Experimental must have highest avgExperimentalTolerance
      const experimental = stationByPersona("experimental");
      for (const other of personaResult.stations) {
        if (other.personaId !== "experimental") {
          expect(experimental.distribution.avgExperimentalTolerance)
            .toBeGreaterThan(other.distribution.avgExperimentalTolerance);
        }
      }

      // Nostalgic must have highest avgNostalgiaBias
      const nostalgic = stationByPersona("nostalgic");
      for (const other of personaResult.stations) {
        if (other.personaId !== "nostalgic") {
          expect(nostalgic.distribution.avgNostalgiaBias)
            .toBeGreaterThan(other.distribution.avgNostalgiaBias);
        }
      }

      // Melodic must have highest avgMelodicComplexity
      const melodic = stationByPersona("melodic");
      for (const other of personaResult.stations) {
        if (other.personaId !== "melodic") {
          expect(melodic.distribution.avgMelodicComplexity)
            .toBeGreaterThan(other.distribution.avgMelodicComplexity);
        }
      }

      // -----------------------------------------------------------------------
      // Phase 11: Metric variance across stations — anti-collapse guard
      // -----------------------------------------------------------------------
      const metricKeys = ["avgRhythmicDensity", "avgMelodicComplexity", "avgTimbralRichness", "avgNostalgiaBias", "avgExperimentalTolerance"] as const;
      for (const key of metricKeys) {
        const values = personaResult.stations.map((s) => s.distribution[key]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
        // Variance must be non-trivial (> 0.0001) to prove real divergence
        expect(variance).toBeGreaterThan(0.0001);
      }

      // -----------------------------------------------------------------------
      // Phase 12: Deterministic output across runs
      // -----------------------------------------------------------------------
      // Already asserted personaOutputA === personaOutputB above.
      // Parse B as well and verify structural equality.
      const resultB = JSON.parse(personaOutputB) as ParallelPersonaStationResult;
      for (let i = 0; i < 5; i++) {
        const tracksA = personaResult.stations[i].tracks.map((t) => t.trackId);
        const tracksB = resultB.stations[i].tracks.map((t) => t.trackId);
        expect(tracksA).toEqual(tracksB);
      }

      // -----------------------------------------------------------------------
      // Phase 13: Generate station-analysis artifacts
      // -----------------------------------------------------------------------
      await writeStationAnalysisArtifacts(STATION_ANALYSIS_DIR, personaResult);
      await writeDeterminismProof(STATION_ANALYSIS_DIR, personaOutputA, personaOutputB);
    },
    1_200_000,
  );
});
