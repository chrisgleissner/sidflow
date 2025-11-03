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

    it("resolves wav paths with song index", () => {
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
      expect(resolveWavPath(plan, sidFile, 1)).toBe(
        path.join("/repo/wav-cache", "C64Music", "Authors", "Track-1.wav")
      );
      expect(resolveWavPath(plan, sidFile, 3)).toBe(
        path.join("/repo/wav-cache", "C64Music", "Authors", "Track-3.wav")
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
      const hashFile = `${wavFile}.hash`;
      await writeFile(sidFile, "initial");

      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeTrue();

      await writeFile(wavFile, "wav");
      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeFalse();

      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFile(sidFile, "updated");
      // Without hash file, should trigger refresh
      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeTrue();

      // Now simulate having a hash file
      const crypto = await import("node:crypto");
      const currentHash = crypto.createHash("sha256").update("updated").digest("hex");
      await writeFile(hashFile, currentHash);

      // Touch the SID file to change timestamp but keep same content
      await new Promise((resolve) => setTimeout(resolve, 5));
      const now = new Date();
      const { utimes } = await import("node:fs/promises");
      await utimes(sidFile, now, now);

      // Should not trigger refresh because hash matches
      expect(await needsWavRefresh(sidFile, wavFile, false)).toBeFalse();

      // Change content again
      await writeFile(sidFile, "changed-content");
      // Should trigger refresh because hash doesn't match
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
      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalFiles).toBe(1);
      expect(result.metrics.rendered).toBe(1);
      expect(result.metrics.skipped).toBe(0);
      expect(result.metrics.cacheHitRate).toBe(0);
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);

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
      expect(resultSecond.metrics).toBeDefined();
      expect(resultSecond.metrics.totalFiles).toBe(1);
      expect(resultSecond.metrics.rendered).toBe(0);
      expect(resultSecond.metrics.skipped).toBe(1);
      expect(resultSecond.metrics.cacheHitRate).toBe(1);

      await rm(root, { recursive: true, force: true });
    });

    it("reports progress during WAV cache building", async () => {
      const root = await mkdtemp(TEMP_PREFIX);
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      await mkdir(hvscPath, { recursive: true });

      // Create multiple SID files to test progress
      for (let i = 0; i < 5; i++) {
        await writeFile(path.join(hvscPath, `song${i}.sid`), `content${i}`);
      }

      const plan = {
        config: {} as ClassificationPlan["config"],
        forceRebuild: false,
        classificationDepth: 3,
        hvscPath,
        wavCachePath,
        tagsPath: path.join(root, "tags"),
        sidplayPath: "sidplayfp"
      } as unknown as ClassificationPlan;

      const progressUpdates: any[] = [];
      await buildWavCache(plan, {
        render: async ({ wavFile }: { wavFile: string }) => {
          await mkdir(path.dirname(wavFile), { recursive: true });
          await writeFile(wavFile, "wav");
        },
        onProgress: (progress) => {
          progressUpdates.push({ ...progress });
        }
      });

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Should have both analyzing and building phases
      const analyzingUpdates = progressUpdates.filter((p) => p.phase === "analyzing");
      const buildingUpdates = progressUpdates.filter((p) => p.phase === "building");
      expect(analyzingUpdates.length).toBeGreaterThan(0);
      expect(buildingUpdates.length).toBeGreaterThan(0);

      // Progress should increase
      for (let i = 1; i < progressUpdates.length; i++) {
        expect(progressUpdates[i].processedFiles).toBeGreaterThanOrEqual(
          progressUpdates[i - 1].processedFiles
        );
      }

      await rm(root, { recursive: true, force: true });
    });

    it("handles multi-song SID files", async () => {
      const root = await mkdtemp(TEMP_PREFIX);
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      await mkdir(hvscPath, { recursive: true });
      
      // Create a valid multi-song SID file (3 songs)
      const sidFile = path.join(hvscPath, "multi.sid");
      const sidBuffer = Buffer.alloc(124);
      
      // Magic ID: "PSID"
      sidBuffer.write("PSID", 0, "ascii");
      
      // Version: 2
      sidBuffer.writeUInt16BE(2, 0x04);
      
      // Data offset: 0x007C
      sidBuffer.writeUInt16BE(0x007c, 0x06);
      
      // Addresses
      sidBuffer.writeUInt16BE(0x1000, 0x08);
      sidBuffer.writeUInt16BE(0x1000, 0x0a);
      sidBuffer.writeUInt16BE(0x1003, 0x0c);
      
      // Songs: 3
      sidBuffer.writeUInt16BE(3, 0x0e);
      
      // Start song: 1
      sidBuffer.writeUInt16BE(1, 0x10);
      
      // Title
      sidBuffer.write("Multi Song", 0x16, "latin1");
      
      // Author
      sidBuffer.write("Test Author", 0x36, "latin1");
      
      // Released
      sidBuffer.write("2025", 0x56, "latin1");
      
      await writeFile(sidFile, sidBuffer);
      
      const plan = {
        config: {} as ClassificationPlan["config"],
        forceRebuild: false,
        classificationDepth: 3,
        hvscPath,
        wavCachePath,
        tagsPath: path.join(root, "tags"),
        sidplayPath: "sidplayfp"
      } as unknown as ClassificationPlan;

      const rendered: Array<{ wavFile: string; songIndex?: number }> = [];
      const result = await buildWavCache(plan, {
        render: async ({ wavFile, songIndex }) => {
          rendered.push({ wavFile, songIndex });
          await mkdir(path.dirname(wavFile), { recursive: true });
          await writeFile(wavFile, `wav-${songIndex}`);
        }
      });

      // Should render 3 WAV files (one per song)
      expect(rendered).toHaveLength(3);
      expect(result.rendered).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);
      expect(result.metrics.totalFiles).toBe(3);
      expect(result.metrics.rendered).toBe(3);
      
      // Check that song indices are correct
      expect(rendered[0].songIndex).toBe(1);
      expect(rendered[1].songIndex).toBe(2);
      expect(rendered[2].songIndex).toBe(3);
      
      // Check that file names include song index
      expect(rendered[0].wavFile).toContain("multi-1.wav");
      expect(rendered[1].wavFile).toContain("multi-2.wav");
      expect(rendered[2].wavFile).toContain("multi-3.wav");

      await rm(root, { recursive: true, force: true });
    });
  });
