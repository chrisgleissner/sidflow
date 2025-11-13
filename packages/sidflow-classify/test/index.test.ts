import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "fs/promises";
import { createHash } from "node:crypto";
import os from "os";
import path from "path";

import {
  buildWavCache,
  collectSidFiles,
  fallbackMetadataFromPath,
  generateAutoTags,
  generateJsonlOutput,
  defaultExtractMetadata,
  needsWavRefresh,
  parseSidMetadataOutput,
  planClassification,
  resolveWavPath,
  __setClassifyTestOverrides,
  type ClassificationPlan
} from "@sidflow/classify";
import {
  resolveAutoTagFilePath,
  resolveManualTagPath,
  resolveRelativeSidPath
} from "@sidflow/common";
import { WAV_HASH_EXTENSION, type RenderWavOptions } from "../src/render/wav-renderer.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-");

function createSidBuffer(options: { songs: number; title: string; author: string; released: string }): Buffer {
  const buffer = Buffer.alloc(0x80);
  buffer.write("PSID", 0, "ascii");
  buffer.writeUInt16BE(2, 0x04);
  buffer.writeUInt16BE(0x007c, 0x06);
  buffer.writeUInt16BE(0x1000, 0x08);
  buffer.writeUInt16BE(0x1000, 0x0a);
  buffer.writeUInt16BE(0x1003, 0x0c);
  buffer.writeUInt16BE(options.songs, 0x0e);
  buffer.writeUInt16BE(1, 0x10);
  buffer.write(options.title, 0x16, "latin1");
  buffer.write(options.author, 0x36, "latin1");
  buffer.write(options.released, 0x56, "latin1");
  return buffer;
}

describe("planClassification", () => {
  it("maps config into plan", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    const configPath = path.join(dir, ".sidflow.json");
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      threads: 2,
      classificationDepth: 5
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const plan = await planClassification({ configPath, forceRebuild: true });
    expect(plan.forceRebuild).toBeTrue();
    expect(plan.classificationDepth).toBe(5);
    expect(plan.hvscPath).toBe(path.normalize(payload.hvscPath));

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
      tagsPath: "/repo/tags"
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
      tagsPath: "/repo/tags"
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
  const hashFile = `${wavFile}${WAV_HASH_EXTENSION}`;
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
      tagsPath: path.join(root, "tags")
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
      tagsPath: path.join(root, "tags")
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

    // Progress snapshots should always report a valid percentage
    for (const update of progressUpdates) {
      expect(update.percentComplete).toBeGreaterThanOrEqual(0);
      expect(update.percentComplete).toBeLessThanOrEqual(100);
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
      tagsPath: path.join(root, "tags")
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

  it("passes HVSC song lengths to renderer", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const hvscPath = path.join(root, "hvsc");
    const wavCachePath = path.join(root, "wav");
    const docsPath = path.join(hvscPath, "C64Music", "DOCUMENTS");
    const demoDir = path.join(hvscPath, "C64Music", "DEMOS", "A-F");

    await mkdir(demoDir, { recursive: true });
    await mkdir(docsPath, { recursive: true });

    const sidFile = path.join(demoDir, "Song.sid");
    const sidContent = Buffer.from("song-content");
    await writeFile(sidFile, sidContent);
    const hash = createHash("md5").update(sidContent).digest("hex");

    const songlengths = [
      "[Database]",
      "; /DEMOS/A-F/Song.sid",
      `${hash}=0:30.500`
    ].join("\n");
    await writeFile(path.join(docsPath, "Songlengths.md5"), songlengths, "utf8");

    const plan = {
      config: {} as ClassificationPlan["config"],
      forceRebuild: false,
      classificationDepth: 3,
      hvscPath,
      wavCachePath,
      tagsPath: path.join(root, "tags")
    } as unknown as ClassificationPlan;

    let observedDuration: number | undefined;
    await buildWavCache(plan, {
      render: async (options: RenderWavOptions) => {
        observedDuration = options.targetDurationMs;
        await mkdir(path.dirname(options.wavFile), { recursive: true });
        await writeFile(options.wavFile, "wav");
      }
    });

    expect(observedDuration).toBe(30_500);

    await rm(root, { recursive: true, force: true });
  });
});

describe("metadata helpers", () => {
  it("parses sidplay output into metadata", () => {
    const output = [
      "| Title  :  Galactic Voyage  |",
      "| Author :  Demo Composer    |",
      "| Released : 1987           |",
      "Other lines"
    ].join("\n");

    const metadata = parseSidMetadataOutput(output);
    expect(metadata).toEqual({
      title: "Galactic Voyage",
      author: "Demo Composer",
      released: "1987"
    });
  });

  it("falls back to path metadata when extraction fails", () => {
    const metadata = fallbackMetadataFromPath("MUSICIANS/Example/Space_Odyssey.sid");
    expect(metadata.title).toBe("Space Odyssey");
    expect(metadata.author).toBe("Example");
  });

  it("prefers metadata parsed directly from the SID header", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    try {
      const sidFile = path.join(root, "Parsed.sid");
      await writeFile(
        sidFile,
        createSidBuffer({ songs: 1, title: "Parsed", author: "Composer", released: "1988" })
      );

      const metadata = await defaultExtractMetadata({
        sidFile,
        relativePath: "MUSICIANS/Composer/Parsed.sid"
      });

      expect(metadata).toEqual({ title: "Parsed", author: "Composer", released: "1988" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to SidAudioEngine tune info when header parsing fails", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const parseStub = async (): Promise<never> => {
      throw new Error("parse failed");
    };
    try {
      const sidFile = path.join(root, "TuneInfo.sid");
      await writeFile(sidFile, Buffer.from([0, 1, 2, 3]));

      __setClassifyTestOverrides({
        parseSidFile: parseStub,
        createEngine: async () => ({
          loadSidBuffer: async () => {
            return;
          },
          getTuneInfo: () => ({ infoStrings: ["Tune Title", "Tune Author", "1999"] })
        }) as unknown as import("@sidflow/libsidplayfp-wasm").SidAudioEngine
      });

      const metadata = await defaultExtractMetadata({
        sidFile,
        relativePath: "MUSICIANS/Example/TuneInfo.sid"
      });

      expect(metadata).toEqual({ title: "Tune Title", author: "Tune Author", released: "1999" });
    } finally {
      __setClassifyTestOverrides();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("derives metadata from the file path when tune info is unavailable", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const parseStub = async (): Promise<never> => {
      throw new Error("parse failed");
    };
    try {
      const sidFile = path.join(root, "Path_Only.sid");
      await writeFile(sidFile, Buffer.from([5, 4, 3, 2]));

      __setClassifyTestOverrides({
        parseSidFile: parseStub,
        createEngine: async () => ({
          loadSidBuffer: async () => {
            return;
          },
          getTuneInfo: () => null
        }) as unknown as import("@sidflow/libsidplayfp-wasm").SidAudioEngine
      });

      const metadata = await defaultExtractMetadata({
        sidFile,
        relativePath: "MUSICIANS/Fallback/Path_Only.sid"
      });

      expect(metadata.title).toBe("Path Only");
      expect(metadata.author).toBe("Fallback");
      expect(metadata.released).toBeUndefined();
    } finally {
      __setClassifyTestOverrides();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("generateAutoTags", () => {
  it("writes metadata and auto-tag files with mixed sources", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    try {
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      const tagsPath = path.join(root, "tags");
      const classifiedPath = path.join(root, "classified");
      await Promise.all([
        mkdir(path.join(hvscPath, "MUSICIANS"), { recursive: true }),
        mkdir(wavCachePath, { recursive: true }),
        mkdir(tagsPath, { recursive: true }),
        mkdir(classifiedPath, { recursive: true })
      ]);

      const multiSid = path.join(hvscPath, "MUSICIANS", "Multi.sid");
      const manualSid = path.join(hvscPath, "MUSICIANS", "Manual.sid");
      const partialSid = path.join(hvscPath, "MUSICIANS", "Partial.sid");

      await Promise.all([
        writeFile(
          multiSid,
          createSidBuffer({ songs: 2, title: "Multi", author: "Composer", released: "1991" })
        ),
        writeFile(
          manualSid,
          createSidBuffer({ songs: 1, title: "Manual", author: "Artist", released: "1985" })
        ),
        writeFile(
          partialSid,
          createSidBuffer({ songs: 1, title: "Partial", author: "Mixer", released: "1986" })
        )
      ]);

      const config: ClassificationPlan["config"] = {
        hvscPath,
        wavCachePath,
        tagsPath,
        threads: 2,
        classificationDepth: 2,
        classifiedPath
      };

      const plan: ClassificationPlan = {
        config,
        wavCachePath,
        tagsPath,
        forceRebuild: false,
        classificationDepth: config.classificationDepth,
        hvscPath
      };

      // Prepare WAV cache files
      for (const sidFile of [multiSid, manualSid, partialSid]) {
        const relative = resolveRelativeSidPath(hvscPath, sidFile);
        const baseDir = path.join(wavCachePath, path.dirname(relative));
        await mkdir(baseDir, { recursive: true });
        if (sidFile === multiSid) {
          const wav1 = resolveWavPath(plan, sidFile, 1);
          const wav2 = resolveWavPath(plan, sidFile, 2);
          await writeFile(wav1, "wav-1");
          await writeFile(wav2, "wav-2");
        } else {
          const wav = resolveWavPath(plan, sidFile);
          await writeFile(wav, "wav-single");
        }
      }

      // Manual tags: full ratings for manualSid, partial for partialSid
      const manualTagPath = resolveManualTagPath(hvscPath, tagsPath, manualSid);
      await mkdir(path.dirname(manualTagPath), { recursive: true });
      await writeFile(
        manualTagPath,
        JSON.stringify({ e: 5, m: 4, c: 3, p: 2, timestamp: "2025-01-01", source: "test" }),
        "utf8"
      );

      const partialTagPath = resolveManualTagPath(hvscPath, tagsPath, partialSid);
      await mkdir(path.dirname(partialTagPath), { recursive: true });
      await writeFile(
        partialTagPath,
        JSON.stringify({ e: 4, timestamp: "2025-02-02" }),
        "utf8"
      );

      const progressPhases: string[] = [];
      const result = await generateAutoTags(plan, {
        extractMetadata: async ({ relativePath }) => ({
          title: `Meta ${relativePath}`,
          author: "Extractor",
          released: "1999"
        }),
        featureExtractor: async ({ wavFile }) => ({ energy: (await readFile(wavFile, "utf8")).length }),
        predictRatings: async ({ relativePath }) => ({
          e: relativePath.includes("Multi") ? 3 : 2,
          m: 4,
          c: 5
        }),
        onProgress: (progress) => {
          progressPhases.push(progress.phase);
        }
      });

      expect(new Set(progressPhases)).toEqual(new Set(["metadata", "tagging"]));
      const posixMulti = "MUSICIANS/Multi.sid";
      const posixManual = "MUSICIANS/Manual.sid";
      const posixPartial = "MUSICIANS/Partial.sid";
      expect(result.autoTagged.sort()).toEqual([
        `${posixMulti}:1`,
        `${posixMulti}:2`
      ]);
      expect(result.manualEntries).toEqual([posixManual]);
      expect(result.mixedEntries).toEqual([posixPartial]);
      expect(result.metadataFiles).toHaveLength(3);
      expect(result.tagFiles).toHaveLength(1);

      const autoTagFile = result.tagFiles[0];
      const autoTagContent = JSON.parse(await readFile(autoTagFile, "utf8")) as Record<string, unknown>;
      const tagKeys = Object.keys(autoTagContent).sort();
      expect(tagKeys).toEqual(["Manual.sid", "Multi.sid:1", "Multi.sid:2", "Partial.sid"]);
      expect(autoTagContent["Multi.sid:1"]).toEqual({ e: 3, m: 4, c: 5, source: "auto" });
      const partialEntry = autoTagContent["Partial.sid"] as { source: string };
      expect(partialEntry.source).toBe("mixed");
      const manualEntry = autoTagContent["Manual.sid"] as { p?: number };
      expect(manualEntry.p).toBe(2);

      const metadataContent = JSON.parse(await readFile(result.metadataFiles[0], "utf8")) as Record<string, unknown>;
      expect(metadataContent.title).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("generateJsonlOutput", () => {
  it("exports JSONL for songs with and without WAV cache", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    try {
      const hvscPath = path.join(root, "hvsc");
      const wavCachePath = path.join(root, "wav");
      const tagsPath = path.join(root, "tags");
      const classifiedPath = path.join(root, "classified");
      await Promise.all([
        mkdir(path.join(hvscPath, "DEMOS"), { recursive: true }),
        mkdir(wavCachePath, { recursive: true }),
        mkdir(tagsPath, { recursive: true }),
        mkdir(classifiedPath, { recursive: true })
      ]);

      const wavSid = path.join(hvscPath, "DEMOS", "WithWav.sid");
      const noWavSid = path.join(hvscPath, "DEMOS", "NoWav.sid");

      await Promise.all([
        writeFile(
          wavSid,
          createSidBuffer({ songs: 1, title: "With", author: "Composer", released: "1990" })
        ),
        writeFile(
          noWavSid,
          createSidBuffer({ songs: 2, title: "No", author: "Composer", released: "1992" })
        )
      ]);

      const config: ClassificationPlan["config"] = {
        hvscPath,
        wavCachePath,
        tagsPath,
        threads: 1,
        classificationDepth: 1,
        classifiedPath
      };

      const plan: ClassificationPlan = {
        config,
        wavCachePath,
        tagsPath,
        forceRebuild: false,
        classificationDepth: config.classificationDepth,
        hvscPath
      };

      // Prepare WAV file for first SID
      const wavPath = resolveWavPath(plan, wavSid);
      await mkdir(path.dirname(wavPath), { recursive: true });
      await writeFile(wavPath, "wav-data");

      // Manual tags
      const manualTagPath = resolveManualTagPath(hvscPath, tagsPath, wavSid);
      await mkdir(path.dirname(manualTagPath), { recursive: true });
      await writeFile(manualTagPath, JSON.stringify({ e: 4, m: 3, c: 5 }), "utf8");

      const progressPhases: string[] = [];
      const result = await generateJsonlOutput(plan, {
        extractMetadata: async ({ relativePath }) => ({
          title: `Meta ${relativePath}`,
          author: "Extractor",
          released: "2000"
        }),
        featureExtractor: async ({ wavFile }) => ({ size: (await readFile(wavFile, "utf8")).length }),
        predictRatings: async () => ({ e: 2, m: 2, c: 2 }),
        onProgress: (progress) => {
          progressPhases.push(progress.phase);
        }
      });

      expect(progressPhases.includes("jsonl")).toBeTrue();
      const fileContent = await readFile(result.jsonlFile, "utf8");
      const lines = fileContent.trim().split("\n").map((line) => JSON.parse(line));
      expect(result.recordCount).toBe(lines.length);

      const withWavRecord = lines.find((line) => line.sid_path === "DEMOS/WithWav.sid");
      expect(withWavRecord.features).toBeDefined();
      expect(withWavRecord.ratings).toEqual({ e: 4, m: 3, c: 5 });

      const noWavRecords = lines.filter((line) => line.sid_path === "DEMOS/NoWav.sid");
      expect(noWavRecords).toHaveLength(2);
      for (const record of noWavRecords) {
        expect(record.features).toBeUndefined();
        expect(record.song_index).toBeGreaterThanOrEqual(1);
        expect(record.ratings).toBeDefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
