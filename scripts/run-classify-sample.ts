import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";

import {
  buildAudioCache,
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

function createSilentWav(options?: {
  sampleRate?: number;
  channels?: number;
  seconds?: number;
}): Uint8Array {
  const sampleRate = options?.sampleRate ?? 44_100;
  const channels = options?.channels ?? 1;
  const seconds = options?.seconds ?? 1;
  const numSamples = Math.max(1, Math.floor(sampleRate * seconds));
  const bytesPerSample = 2; // PCM16
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const header = Buffer.alloc(44);
  let offset = 0;
  header.write("RIFF", offset); offset += 4;
  header.writeUInt32LE(36 + dataSize, offset); offset += 4;
  header.write("WAVE", offset); offset += 4;
  header.write("fmt ", offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4; // PCM header size
  header.writeUInt16LE(1, offset); offset += 2; // PCM
  header.writeUInt16LE(channels, offset); offset += 2;
  header.writeUInt32LE(sampleRate, offset); offset += 4;
  header.writeUInt32LE(byteRate, offset); offset += 4;
  header.writeUInt16LE(blockAlign, offset); offset += 2;
  header.writeUInt16LE(bytesPerSample * 8, offset); offset += 2;
  header.write("data", offset); offset += 4;
  header.writeUInt32LE(dataSize, offset); offset += 4;

  const pcm = Buffer.alloc(dataSize); // silence
  return Buffer.concat([header, pcm]);
}

async function createConfig(root: string): Promise<string> {
  const sidPath = path.join(root, "hvsc");
  const audioCachePath = path.join(root, "audio-cache");
  const tagsPath = path.join(root, "tags");

  await Promise.all([
    mkdir(path.join(sidPath, "C64Music", "MUSICIANS", "A"), { recursive: true }),
    mkdir(path.join(sidPath, "C64Music", "MUSICIANS", "B"), { recursive: true }),
    mkdir(audioCachePath, { recursive: true }),
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
    audioCachePath,
    tagsPath,
    threads: 0,
    classificationDepth: 2
  } satisfies ClassificationPlan["config"];

  await writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

async function renderPlaceholderWavs(plan: ClassificationPlan): Promise<void> {
  const silentWav = createSilentWav({ seconds: 1, channels: 1, sampleRate: 44_100 });
  const { rendered } = await buildAudioCache(plan, {
    render: async ({ wavFile }) => {
      await ensureDir(path.dirname(wavFile));
      await writeFile(wavFile, silentWav);
    }
  });
  console.log(`Rendered ${rendered.length} placeholder WAV files.`);
}

async function main(): Promise<void> {
  const root = await mkdtemp(TEMP_PREFIX);
  try {
    const configPath = await createConfig(root);
    // Keep the sample fast and dependency-free: we render valid placeholder WAVs and then run
    // heuristic extraction on them (no SID rendering engine required).
    const plan = await planClassification({ configPath, forceRebuild: false });

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

main()
  .then(() => {
    // Some native dependencies (e.g. tfjs-node) can keep the event loop alive even after work completes.
    // This script is used in CI smoke pipelines, so we exit explicitly once finished.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
