import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWavCache,
  fallbackMetadataFromPath,
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
  type ClassificationPlan
} from "../packages/sidflow-classify/src/index.js";
import { stringifyDeterministic } from "../packages/sidflow-common/src/json.js";
import { ensureDir } from "../packages/sidflow-common/src/fs.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-sample-");

async function createConfig(root: string): Promise<string> {
  const sidPath = path.join(root, "hvsc");
  const wavCachePath = path.join(root, "wav-cache");
  const tagsPath = path.join(root, "tags");

  await Promise.all([
    mkdir(path.join(sidPath, "C64Music", "MUSICIANS", "A"), { recursive: true }),
    mkdir(path.join(sidPath, "C64Music", "MUSICIANS", "B"), { recursive: true }),
    mkdir(wavCachePath, { recursive: true }),
    mkdir(tagsPath, { recursive: true })
  ]);

  const manualSid = path.join(sidPath, "C64Music", "MUSICIANS", "A", "Manual.sid");
  const autoSid = path.join(sidPath, "C64Music", "MUSICIANS", "B", "Auto.sid");
  await Promise.all([writeFile(manualSid, "manual"), writeFile(autoSid, "auto")]);

  const manualTagPath = path.join(tagsPath, "C64Music", "MUSICIANS", "A", "Manual.sid.sid.tags.json");
  await ensureDir(path.dirname(manualTagPath));
  await writeFile(
    manualTagPath,
    stringifyDeterministic({
      s: 4,
      m: 2,
      c: 5,
      source: "manual",
      timestamp: "2025-01-01T00:00:00.000Z"
    })
  );

  const configPath = path.join(root, "sample.sidflow.json");
  const config = {
    sidPath,
    wavCachePath,
    tagsPath,
    threads: 0,
    classificationDepth: 2
  } satisfies ClassificationPlan["config"];

  await writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

async function renderPlaceholderWavs(plan: ClassificationPlan): Promise<void> {
  const { rendered } = await buildWavCache(plan, {
    render: async ({ wavFile }) => {
      await ensureDir(path.dirname(wavFile));
      await writeFile(wavFile, "sample-wav");
    }
  });
  console.log(`Rendered ${rendered.length} placeholder WAV files.`);
}

async function main(): Promise<void> {
  const root = await mkdtemp(TEMP_PREFIX);
  try {
    const configPath = await createConfig(root);
    const plan = await planClassification({ configPath, forceRebuild: true });

    await renderPlaceholderWavs(plan);

    const result = await generateAutoTags(plan, {
      extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
      featureExtractor: heuristicFeatureExtractor,
      predictRatings: heuristicPredictRatings
    });

    console.log("Sample classification complete:");
    console.log(`Auto-tagged entries: ${result.autoTagged.length}`);
    console.log(`Manual entries: ${result.manualEntries.length}`);
    console.log(`Mixed entries: ${result.mixedEntries.length}`);
    console.log(`Metadata files: ${result.metadataFiles.length}`);
    console.log(`Auto tag files: ${result.tagFiles.length}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
