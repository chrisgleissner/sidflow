import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import os from "os";
import path from "path";

import {
  buildWavCache,
  collectSidFiles,
  needsWavRefresh,
  planClassification,
  resolveWavPath,
  type ClassificationPlan
} from "@sidflow/classify";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-");

describe("planClassification", () => {
  it("maps config into plan", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    const configPath = path.join(dir, ".sidflow.json");
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 2,
      classificationDepth: 5
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const plan = await planClassification({ configPath, forceRebuild: true });
    expect(plan.forceRebuild).toBeTrue();
    expect(plan.classificationDepth).toBe(5);
    const extendedPlan = plan as unknown as { hvscPath: string; sidplayPath: string };
    expect(extendedPlan.hvscPath).toBe(path.normalize(payload.hvscPath));
    expect(extendedPlan.sidplayPath).toBe(payload.sidplayPath);

    await rm(dir, { recursive: true, force: true });
  });
});

  describe("classification helpers", () => {
    it("resolves wav paths mirroring HVSC layout", () => {
      const plan = {
        config: {} as ClassificationPlan["config"],
        forceRebuild: false,
        classificationDepth: 3,
        hvscPath: "/repo/hvsc",
        wavCachePath: "/repo/wav-cache",
        tagsPath: "/repo/tags",
        sidplayPath: "sidplayfp"
      } as unknown as ClassificationPlan;
      const sidFile = "/repo/hvsc/C64Music/Authors/Track.sid";
      expect(resolveWavPath(plan, sidFile)).toBe(
        path.join("/repo/wav-cache", "C64Music", "Authors", "Track.wav")
      );
    });

    it("collects sid files recursively", async () => {
      const root = await mkdtemp(TEMP_PREFIX);
      const hvscPath = path.join(root, "hvsc");
      await mkdir(path.join(hvscPath, "A"), { recursive: true });
      const sidA = path.join(hvscPath, "A", "first.sid");
      const sidB = path.join(hvscPath, "second.SID");
      await Promise.all([writeFile(sidA, "a"), writeFile(sidB, "b")]);

      const result = await collectSidFiles(hvscPath);
      expect(result).toEqual([sidA, sidB]);

      await rm(root, { recursive: true, force: true });
    });

    it("detects when wav cache needs refresh", async () => {
      const root = await mkdtemp(TEMP_PREFIX);
      const sidFile = path.join(root, "track.sid");
      const wavFile = path.join(root, "track.wav");
      await writeFile(sidFile, "initial");

      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeTrue();

      await writeFile(wavFile, "wav");
      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeFalse();

      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFile(sidFile, "updated");
      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeTrue();

      await rm(root, { recursive: true, force: true });
    });

    it("builds wav cache using injected renderer", async () => {
      const root = await mkdtemp(TEMP_PREFIX);
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      await mkdir(hvscPath, { recursive: true });
      const sidFile = path.join(hvscPath, "song.sid");
      await writeFile(sidFile, "content");

      const plan = {
        config: {} as ClassificationPlan["config"],
        forceRebuild: false,
        classificationDepth: 3,
        hvscPath,
        wavCachePath,
        tagsPath: path.join(root, "tags"),
        sidplayPath: "sidplayfp"
      } as unknown as ClassificationPlan;

      const rendered: string[] = [];
      const result = await buildWavCache(plan, {
        render: async ({ wavFile }: { wavFile: string }) => {
          rendered.push(wavFile);
          await mkdir(path.dirname(wavFile), { recursive: true });
          await writeFile(wavFile, "wav");
        }
      });

      expect(rendered).toHaveLength(1);
      expect(result.rendered).toEqual(rendered);
      expect(result.skipped).toHaveLength(0);

      let invoked = false;
      const resultSecond = await buildWavCache(plan, {
        render: async ({ wavFile }: { wavFile: string }) => {
          invoked = true;
          await mkdir(path.dirname(wavFile), { recursive: true });
          await writeFile(wavFile, "re-render");
        }
      });

      expect(resultSecond.rendered).toHaveLength(0);
      expect(resultSecond.skipped).toHaveLength(1);
      expect(invoked).toBeFalse();

      await rm(root, { recursive: true, force: true });
    });
  });
