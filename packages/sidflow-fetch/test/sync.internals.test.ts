/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { __internal } from "../src/sync.js";
import type { HvscArchiveDescriptor } from "../src/types.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-sync-int-");
const originalFetch = globalThis.fetch;

const {
  downloadArchive,
  cleanupTemp,
  isDirectoryEmpty,
  withDefaultDependencies,
  defaultDownloadArchive,
  defaultChecksum,
  resolveVersionPath
} = __internal;

type ResolvedDependencies = Parameters<typeof downloadArchive>[1];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  globalThis.fetch = originalFetch;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(TEMP_PREFIX);
  tempDirs.push(dir);
  return dir;
}

function setFetchStub(factory: () => Promise<Response> | Response): void {
  const stub = (async (..._args: Parameters<typeof fetch>) => factory()) as typeof fetch;
  Object.assign(stub, originalFetch);
  globalThis.fetch = stub;
}

describe("sync internals", () => {
  it("resolves the version metadata path", async () => {
    const dir = await createTempDir();
    const config = {
      hvscPath: path.join(dir, "hvsc"),
      wavCachePath: path.join(dir, "wav"),
      tagsPath: path.join(dir, "tags"),
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 0,
      classificationDepth: 3
    };

    const resolved = resolveVersionPath(config, undefined);
    expect(resolved).toBe(path.join(dir, "hvsc-version.json"));

    const override = resolveVersionPath(config, path.join(dir, "custom.json"));
    expect(override).toBe(path.join(dir, "custom.json"));
  });

  it("detects empty and non-empty directories", async () => {
    const dir = await createTempDir();
    const missing = path.join(dir, "missing");
    expect(await isDirectoryEmpty(missing)).toBeTrue();

    const filePath = path.join(dir, "file.txt");
    await writeFile(filePath, "data", "utf8");
    expect(await isDirectoryEmpty(filePath)).toBeTrue();

    const emptyDir = path.join(dir, "empty");
    await mkdir(emptyDir, { recursive: true });
    expect(await isDirectoryEmpty(emptyDir)).toBeTrue();

    const filledDir = path.join(dir, "filled");
    await mkdir(filledDir, { recursive: true });
    await writeFile(path.join(filledDir, "entry"), "x", "utf8");
    expect(await isDirectoryEmpty(filledDir)).toBeFalse();
  });

  it("downloads archives into temp directories", async () => {
    const descriptor: HvscArchiveDescriptor = {
      version: 100,
      filename: "archive.7z",
      url: "https://example.invalid/archive.7z"
    };

    const destinations: string[] = [];
    const dependencies: ResolvedDependencies = {
      fetchManifest: async () => ({ base: descriptor, deltas: [] }),
      downloadArchive: async (_, destination) => {
        destinations.push(destination);
        await writeFile(destination, "payload", "utf8");
      },
      extractArchive: async () => { /* noop for test */ },
      computeChecksum: async () => "checksum",
      now: () => new Date()
    };

    const archivePath = await downloadArchive(descriptor, dependencies);
    expect(path.basename(archivePath)).toBe("archive.7z");
    expect(destinations).toHaveLength(1);
  expect(await readFile(archivePath, "utf8")).toBe("payload");

    const tempDir = path.dirname(archivePath);
    await cleanupTemp(tempDir);
    try {
      await stat(tempDir);
      throw new Error("expected temp directory to be removed");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });

  it("merges provided dependencies with defaults", () => {
    const custom = {
      fetchManifest: async () => ({ base: { version: 1, filename: "base", url: "" }, deltas: [] }),
      downloadArchive: async () => {},
      extractArchive: async () => {},
      computeChecksum: async () => "custom",
      now: () => new Date("2025-01-01T00:00:00.000Z")
    } satisfies Partial<ResolvedDependencies>;

    const resolved = withDefaultDependencies(custom);
    expect(resolved.fetchManifest).toBe(custom.fetchManifest);
    expect(resolved.downloadArchive).toBe(custom.downloadArchive);
    expect(resolved.computeChecksum).toBe(custom.computeChecksum);
    expect(resolved.now()).toEqual(new Date("2025-01-01T00:00:00.000Z"));
  });

  it("downloads using the default downloader", async () => {
    const dir = await createTempDir();
    const descriptor: HvscArchiveDescriptor = {
      version: 101,
      filename: "HVSC_101-all-of-them.7z",
      url: "https://example.invalid/HVSC_101-all-of-them.7z"
    };

  setFetchStub(async () => new Response("archive-bytes", { status: 200 }));

    const destination = path.join(dir, descriptor.filename);
  await defaultDownloadArchive(descriptor, destination);
    expect(await readFile(destination, "utf8")).toBe("archive-bytes");
  });

  it("fails the default downloader on HTTP errors", async () => {
    const descriptor: HvscArchiveDescriptor = {
      version: 102,
      filename: "HVSC_102-all-of-them.7z",
      url: "https://example.invalid/HVSC_102-all-of-them.7z"
    };

  setFetchStub(async () => new Response("", { status: 404, statusText: "Not Found" }));

    await expect(defaultDownloadArchive(descriptor, path.join(await createTempDir(), descriptor.filename))).rejects.toThrow(
      "Failed to download"
    );
  });

  it("computes deterministic checksums", async () => {
    const dir = await createTempDir();
    const filePath = path.join(dir, "file.bin");
    await writeFile(filePath, "hello", "utf8");

    const checksum = await defaultChecksum(filePath);
    expect(checksum).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
