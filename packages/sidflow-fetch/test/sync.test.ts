import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { syncHvsc } from "../src/sync.js";
import type { HvscSyncDependencies, HvscArchiveDescriptor } from "../src/types.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-fetch-");

interface Harness {
  configPath: string;
  sidPath: string;
  dataDir: string;
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(TEMP_PREFIX);
  const dataDir = path.join(root, "workspace");
  const sidPath = path.join(dataDir, "hvsc");
  await mkdir(sidPath, { recursive: true });

  const config = {
    sidPath,
    wavCachePath: path.join(dataDir, "wav"),
    tagsPath: path.join(dataDir, "tags"),
    sidplayPath: "sidplayfp",
    threads: 0,
    classificationDepth: 3
  };
  const configPath = path.join(root, ".sidflow.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");

  return {
    configPath,
    sidPath,
    dataDir,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function createNowGenerator(timestamps: string[]): () => Date {
  let index = 0;
  return () => {
    const value = timestamps[Math.min(index, timestamps.length - 1)];
    index += 1;
    return new Date(value);
  };
}

describe("syncHvsc", () => {
  it("downloads base archive and applies deltas", async () => {
    const harness = await createHarness();
    const downloads: string[] = [];
    const extracted: string[] = [];

    const dependencies: HvscSyncDependencies = {
      fetchManifest: async () => ({
        base: {
          version: 83,
          filename: "HVSC_83-all-of-them.7z",
          url: "https://example.com/HVSC_83-all-of-them.7z"
        },
        deltas: [
          { version: 83, filename: "HVSC_Update_83.7z", url: "https://example.com/HVSC_Update_83.7z" },
          { version: 84, filename: "HVSC_Update_84.7z", url: "https://example.com/HVSC_Update_84.7z" }
        ]
      }),
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        downloads.push(descriptor.filename);
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: async (archivePath: string, destination: string) => {
        extracted.push(path.basename(archivePath));
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, `${path.basename(archivePath)}.applied`), "ok", "utf8");
      },
      computeChecksum: async (archivePath: string) => `checksum:${path.basename(archivePath)}`,
      now: createNowGenerator([
        "2025-01-01T00:00:00.000Z",
        "2025-01-01T01:00:00.000Z",
        "2025-01-01T02:00:00.000Z"
      ])
    };

    const result = await syncHvsc({ configPath: harness.configPath, dependencies });
    expect(result.baseUpdated).toBeTrue();
    expect(result.appliedDeltas).toEqual([83, 84]);
  expect(result.baseVersion).toBe(83);
  expect(result.baseSyncedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(downloads).toEqual([
      "HVSC_83-all-of-them.7z",
      "HVSC_Update_83.7z",
      "HVSC_Update_84.7z"
    ]);
    expect(extracted).toHaveLength(3);

    const versionPath = path.join(harness.dataDir, "hvsc-version.json");
    const version = JSON.parse(await readFile(versionPath, "utf8"));
    expect(version.baseVersion).toBe(83);
    expect(version.deltas.map((delta: { version: number }) => delta.version)).toEqual([83, 84]);
    expect(version.baseChecksum).toBe("checksum:HVSC_83-all-of-them.7z");
    expect(version.deltas.map((delta: { checksum: string }) => delta.checksum)).toEqual([
      "checksum:HVSC_Update_83.7z",
      "checksum:HVSC_Update_84.7z"
    ]);

    await harness.cleanup();
  });

  it("applies only new deltas on subsequent runs", async () => {
    const harness = await createHarness();

    const baseDependencies: HvscSyncDependencies = {
      fetchManifest: async () => ({
        base: {
          version: 83,
          filename: "HVSC_83-all-of-them.7z",
          url: "https://example.com/HVSC_83-all-of-them.7z"
        },
        deltas: [
          { version: 83, filename: "HVSC_Update_83.7z", url: "https://example.com/HVSC_Update_83.7z" }
        ]
      }),
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: async (archivePath: string, destination: string) => {
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, `${path.basename(archivePath)}.applied`), "ok", "utf8");
      },
      computeChecksum: async (archivePath: string) => `checksum:${path.basename(archivePath)}`,
      now: createNowGenerator([
        "2025-01-02T00:00:00.000Z",
        "2025-01-02T01:00:00.000Z"
      ])
    };

    await syncHvsc({ configPath: harness.configPath, dependencies: baseDependencies });

    const downloads: string[] = [];
    const deltaDependencies: HvscSyncDependencies = {
      fetchManifest: async () => ({
        base: {
          version: 83,
          filename: "HVSC_83-all-of-them.7z",
          url: "https://example.com/HVSC_83-all-of-them.7z"
        },
        deltas: [
          { version: 83, filename: "HVSC_Update_83.7z", url: "https://example.com/HVSC_Update_83.7z" },
          { version: 84, filename: "HVSC_Update_84.7z", url: "https://example.com/HVSC_Update_84.7z" }
        ]
      }),
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        downloads.push(descriptor.filename);
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: async (archivePath: string, destination: string) => {
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, `${path.basename(archivePath)}.applied`), "ok", "utf8");
      },
      computeChecksum: async (archivePath: string) => `checksum:${path.basename(archivePath)}`,
      now: createNowGenerator([
        "2025-01-03T00:00:00.000Z",
        "2025-01-03T01:00:00.000Z"
      ])
    };

    const result = await syncHvsc({ configPath: harness.configPath, dependencies: deltaDependencies });
    expect(result.baseUpdated).toBeFalse();
    expect(result.appliedDeltas).toEqual([84]);
  expect(result.baseVersion).toBe(83);
  expect(result.baseSyncedAt).toBe("2025-01-02T00:00:00.000Z");
    expect(downloads).toEqual(["HVSC_Update_84.7z"]);

    const versionPath = path.join(harness.dataDir, "hvsc-version.json");
    const version = JSON.parse(await readFile(versionPath, "utf8"));
    expect(version.deltas.map((delta: { version: number }) => delta.version)).toEqual([83, 84]);

    await harness.cleanup();
  });

  it("is idempotent when no updates are available", async () => {
    const harness = await createHarness();

    const manifest = {
      base: {
        version: 83,
        filename: "HVSC_83-all-of-them.7z",
        url: "https://example.com/HVSC_83-all-of-them.7z"
      },
      deltas: [
        { version: 83, filename: "HVSC_Update_83.7z", url: "https://example.com/HVSC_Update_83.7z" }
      ]
    };

    const baseDependencies: HvscSyncDependencies = {
      fetchManifest: async () => manifest,
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: async (archivePath: string, destination: string) => {
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, `${path.basename(archivePath)}.applied`), "ok", "utf8");
      },
      computeChecksum: async (archivePath: string) => `checksum:${path.basename(archivePath)}`,
      now: createNowGenerator([
        "2025-01-04T00:00:00.000Z",
        "2025-01-04T01:00:00.000Z"
      ])
    };

    await syncHvsc({ configPath: harness.configPath, dependencies: baseDependencies });

    const downloads: string[] = [];
    const noopDependencies: HvscSyncDependencies = {
      fetchManifest: async () => manifest,
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        downloads.push(descriptor.filename);
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: baseDependencies.extractArchive,
      computeChecksum: baseDependencies.computeChecksum,
      now: createNowGenerator([
        "2025-01-05T00:00:00.000Z"
      ])
    };

    const result = await syncHvsc({ configPath: harness.configPath, dependencies: noopDependencies });
    expect(result.baseUpdated).toBeFalse();
    expect(result.appliedDeltas).toEqual([]);
  expect(result.baseVersion).toBe(83);
  expect(result.baseSyncedAt).toBe("2025-01-04T00:00:00.000Z");
    expect(downloads).toEqual([]);

    await harness.cleanup();
  });

  it("propagates checksum failures", async () => {
    const harness = await createHarness();

    const dependencies: HvscSyncDependencies = {
      fetchManifest: async () => ({
        base: {
          version: 83,
          filename: "HVSC_83-all-of-them.7z",
          url: "https://example.com/HVSC_83-all-of-them.7z"
        },
        deltas: []
      }),
      downloadArchive: async (descriptor: HvscArchiveDescriptor, destination: string) => {
        await writeFile(destination, `archive:${descriptor.filename}`, "utf8");
      },
      extractArchive: async (archivePath: string, destination: string) => {
        await mkdir(destination, { recursive: true });
        await writeFile(path.join(destination, "flag"), "ok", "utf8");
      },
      computeChecksum: async () => {
        throw new Error("checksum failed");
      },
      now: createNowGenerator(["2025-01-06T00:00:00.000Z"])
    };

    await expect(syncHvsc({ configPath: harness.configPath, dependencies })).rejects.toThrow("checksum failed");

    await harness.cleanup();
  });
});
