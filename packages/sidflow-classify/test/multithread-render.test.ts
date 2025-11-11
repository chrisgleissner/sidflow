import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildWavCache,
  resolveWavPath,
  type ClassificationPlan,
  type ThreadActivityUpdate
} from "@sidflow/classify";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-mt-");

async function copySampleSid(target: string): Promise<void> {
  const sourcePath = new URL("../../libsidplayfp-wasm/examples/assets/test-tone.sid", import.meta.url);
  const buffer = await readFile(sourcePath);
  await writeFile(target, buffer);
}

describe("defaultRenderWav with worker pool", () => {
  it("renders multiple SID files to WAV using parallel workers", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const previousMaxSeconds = process.env.SIDFLOW_MAX_RENDER_SECONDS;
    process.env.SIDFLOW_MAX_RENDER_SECONDS = "0.5";
    try {
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      const tagsPath = path.join(root, "tags");
      const classifiedPath = path.join(root, "classified");

      await Promise.all([
        mkdir(hvscPath, { recursive: true }),
        mkdir(wavCachePath, { recursive: true }),
        mkdir(tagsPath, { recursive: true }),
        mkdir(classifiedPath, { recursive: true })
      ]);

      const sidFiles: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const sidFile = path.join(hvscPath, `song-${index}.sid`);
        await copySampleSid(sidFile);
        sidFiles.push(sidFile);
      }

      const config: ClassificationPlan["config"] = {
        hvscPath,
        wavCachePath,
        tagsPath,
        threads: 2,
        classificationDepth: 1,
        classifiedPath
      };

      const plan: ClassificationPlan = {
        config,
        wavCachePath,
        tagsPath,
        hvscPath,
        forceRebuild: false,
        classificationDepth: 1
      };

      const threadUpdates: ThreadActivityUpdate[] = [];
      const result = await buildWavCache(plan, {
        forceRebuild: true,
        threads: 2,
        onThreadUpdate: (update) => {
          threadUpdates.push(update);
        }
      });

      expect(result.rendered).toHaveLength(sidFiles.length);
      expect(result.metrics.rendered).toBe(sidFiles.length);
      expect(result.skipped).toHaveLength(0);

      const uniqueThreads = new Set(
        threadUpdates
          .filter((update) => update.phase === "building")
          .map((update) => update.threadId)
      );
      expect(uniqueThreads.size).toBe(config.threads);

      for (const sidFile of sidFiles) {
        const wavFile = resolveWavPath(plan, sidFile);
        const wavStats = await stat(wavFile);
        expect(wavStats.size).toBeGreaterThan(44); // WAV header + samples
      }
    } finally {
      if (previousMaxSeconds === undefined) {
        delete process.env.SIDFLOW_MAX_RENDER_SECONDS;
      } else {
        process.env.SIDFLOW_MAX_RENDER_SECONDS = previousMaxSeconds;
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
