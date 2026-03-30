import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HVSC_E2E_SUBSET_TARGET_COUNT,
  getHvscE2eProblematicPaths,
  loadHvscE2eSubsetManifest,
  materializeHvscE2eSubset,
  stringifyDeterministic,
  type ClassificationRecord,
  type SidflowConfig,
} from "../packages/sidflow-common/src/index.js";

import { planClassification, generateAutoTags } from "../packages/sidflow-classify/src/index.js";
import { hasRealisticCompleteFeatureVector } from "../packages/sidflow-classify/src/deterministic-ratings.js";
import { runPersonaStationCli } from "../packages/sidflow-play/src/persona-station.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const LOCAL_HVSC_ROOT = path.join(REPO_ROOT, "workspace", "hvsc");
const MANIFEST_PATH = path.join(REPO_ROOT, "integration-tests", "fixtures", "hvsc-persona-300-manifest.json");
const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-hvsc-persona-e2e-");

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

describe("HVSC 300-file persona station E2E", () => {
  let tempRoot = "";

  afterAll(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test(
    "materializes the deterministic subset, classifies it without failures, and converges to a deterministic 50-track persona playlist",
    async () => {
      const manifest = await loadHvscE2eSubsetManifest(MANIFEST_PATH);
      expect(manifest.entries).toHaveLength(HVSC_E2E_SUBSET_TARGET_COUNT);

      const selectedPaths = new Set(manifest.entries.map((entry) => normalizeSubsetSidPath(entry.sidPath)));
      expect(selectedPaths.size).toBe(HVSC_E2E_SUBSET_TARGET_COUNT);

      for (const problematicPath of getHvscE2eProblematicPaths()) {
        expect(selectedPaths.has(problematicPath)).toBe(true);
      }

      tempRoot = await mkdtemp(TEMP_PREFIX);
      const hvscRoot = path.join(tempRoot, "hvsc");
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
      await writeFile(configPath, stringifyDeterministic(config), "utf8");

      const plan = await planClassification({ configPath, forceRebuild: true });
      const result = await generateAutoTags(plan, {
        threads: 4,
        deleteWavAfterClassification: true,
        lifecycleLogPath: path.join(tempRoot, "classification-lifecycle.jsonl"),
      });

      expect(result.metrics.failedCount).toBe(0);
      expect(result.metrics.degradedCount).toBe(0);
      expect(result.metrics.metadataOnlyCount).toBe(0);
      expect(result.jsonlRecordCount).toBeGreaterThanOrEqual(HVSC_E2E_SUBSET_TARGET_COUNT);

      const records = await readJsonlRecords(result.jsonlFile);
      expect(records.length).toBe(result.jsonlRecordCount);

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

      const exitCodeA = await runPersonaStationCli([
        "--classification-jsonl",
        result.jsonlFile,
        "--subset-manifest",
        MANIFEST_PATH,
        "--output-json",
        personaJsonA,
        "--output-m3u",
        personaM3u,
      ]);
      expect(exitCodeA).toBe(0);

      const exitCodeB = await runPersonaStationCli([
        "--classification-jsonl",
        result.jsonlFile,
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
      expect(personaOutputA).toBe(personaOutputB);

      const personaResult = JSON.parse(personaOutputA) as {
        stages: Array<{ approvedCount: number; targetSize: number }>;
        finalPlaylistTrackIds: string[];
      };
      expect(personaResult.stages).toHaveLength(5);
      expect(personaResult.finalPlaylistTrackIds).toHaveLength(50);
      expect(new Set(personaResult.finalPlaylistTrackIds).size).toBe(50);
      expect(personaResult.stages.at(-1)?.approvedCount).toBe(50);
      expect(personaResult.stages.at(-1)?.targetSize).toBe(50);
    },
    1_200_000,
  );
});