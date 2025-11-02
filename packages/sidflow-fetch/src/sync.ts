import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, opendir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

import { createLogger, ensureDir, loadConfig, type SidflowConfig } from "@sidflow/common";

import { fetchHvscManifest, DEFAULT_BASE_URL } from "./manifest.js";
import { loadHvscVersion, saveHvscVersion } from "./version.js";
import type {
  HvscArchiveDescriptor,
  HvscManifest,
  HvscSyncDependencies,
  HvscSyncOptions,
  HvscSyncResult,
  HvscVersionRecord
} from "./types.js";

const VERSION_FILENAME = "hvsc-version.json";

export async function syncHvsc(options: HvscSyncOptions = {}): Promise<HvscSyncResult> {
  const config = await loadConfig(options.configPath);
  const logger = options.dependencies?.logger ?? createLogger("sidflow-fetch");
  const dependencies = withDefaultDependencies(options.dependencies);
  const hvscPath = path.resolve(config.hvscPath);
  const versionPath = resolveVersionPath(config, options.hvscVersionPath);

  await ensureDir(path.dirname(versionPath));
  await ensureDir(hvscPath);

  const manifest = await dependencies.fetchManifest(options.remoteBaseUrl ?? DEFAULT_BASE_URL);
  const currentVersion = await loadHvscVersion(versionPath);

  const hvscEmpty = await isDirectoryEmpty(hvscPath);
  const baseResult = await syncBase({
    config,
    manifest,
    hvscPath,
    hvscEmpty,
    currentVersion,
    dependencies,
    versionPath,
    logger
  });

  const appliedDeltas = await syncDeltas({
    manifest,
    hvscPath,
    versionPath,
    currentVersion: baseResult.record,
    dependencies,
    logger
  });

  return {
    baseUpdated: baseResult.updated,
    appliedDeltas
  };
}

interface SyncBaseContext {
  config: SidflowConfig;
  manifest: HvscManifest;
  hvscPath: string;
  hvscEmpty: boolean;
  currentVersion: HvscVersionRecord | null;
  dependencies: ResolvedDependencies;
  versionPath: string;
  logger: ReturnType<typeof createLogger>;
}

interface SyncBaseResult {
  updated: boolean;
  record: HvscVersionRecord;
}

async function syncBase(context: SyncBaseContext): Promise<SyncBaseResult> {
  const { manifest, hvscPath, currentVersion, hvscEmpty, dependencies, versionPath, logger } = context;
  const remoteVersion = manifest.base.version;
  const localVersion = currentVersion?.baseVersion ?? null;

  const needsBase = hvscEmpty || localVersion === null || remoteVersion > localVersion;
  if (!needsBase) {
    if (!currentVersion) {
      throw new Error("HVSC metadata is missing for existing archive");
    }
    return {
      updated: false,
      record: currentVersion
    };
  }

  logger.info(`Syncing HVSC base archive v${remoteVersion}`);

  await rm(hvscPath, { recursive: true, force: true });
  await mkdir(hvscPath, { recursive: true });

  const archivePath = await downloadArchive(manifest.base, dependencies);
  await dependencies.extractArchive(archivePath, hvscPath);
  const checksum = await dependencies.computeChecksum(archivePath);

  const timestamp = dependencies.now().toISOString();
  const record: HvscVersionRecord = {
    baseVersion: remoteVersion,
    baseFilename: manifest.base.filename,
    baseChecksum: checksum,
    baseAppliedAt: timestamp,
    deltas: [],
    lastUpdated: timestamp
  };
  await saveHvscVersion(versionPath, record);

  await cleanupTemp(path.dirname(archivePath));

  return {
    updated: true,
    record
  };
}

interface SyncDeltasContext {
  manifest: HvscManifest;
  hvscPath: string;
  versionPath: string;
  currentVersion: HvscVersionRecord;
  dependencies: ResolvedDependencies;
  logger: ReturnType<typeof createLogger>;
}

async function syncDeltas(context: SyncDeltasContext): Promise<number[]> {
  const { manifest, hvscPath, currentVersion, dependencies, versionPath, logger } = context;
  const applied = new Set(currentVersion.deltas.map((delta) => delta.version));
  let record = currentVersion;
  const appliedNow: number[] = [];

  for (const descriptor of manifest.deltas) {
    if (descriptor.version < record.baseVersion) {
      continue;
    }

    if (applied.has(descriptor.version)) {
      continue;
    }

    logger.info(`Applying HVSC delta ${descriptor.filename}`);
    const archivePath = await downloadArchive(descriptor, dependencies);
    await dependencies.extractArchive(archivePath, hvscPath);
    const checksum = await dependencies.computeChecksum(archivePath);

    const timestamp = dependencies.now().toISOString();
    record = {
      ...record,
      deltas: [...record.deltas, {
        version: descriptor.version,
        filename: descriptor.filename,
        checksum,
        appliedAt: timestamp
      }],
      lastUpdated: timestamp
    };
    await saveHvscVersion(versionPath, record);

    await cleanupTemp(path.dirname(archivePath));

    appliedNow.push(descriptor.version);
    applied.add(descriptor.version);
  }

  return appliedNow;
}

async function downloadArchive(descriptor: HvscArchiveDescriptor, dependencies: ResolvedDependencies): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-hvsc-"));
  const destination = path.join(tempDir, descriptor.filename);
  await dependencies.downloadArchive(descriptor, destination);
  return destination;
}

async function cleanupTemp(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

async function isDirectoryEmpty(dir: string): Promise<boolean> {
  try {
    const stats = await stat(dir);
    if (!stats.isDirectory()) {
      return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }

  const directory = await opendir(dir);
  const entry = await directory.read();
  await directory.close();
  return entry === null;
}

interface ResolvedDependencies {
  fetchManifest: (baseUrl: string) => Promise<HvscManifest>;
  downloadArchive: (descriptor: HvscArchiveDescriptor, destination: string) => Promise<void>;
  extractArchive: (archivePath: string, destination: string) => Promise<void>;
  computeChecksum: (archivePath: string) => Promise<string>;
  now: () => Date;
}

function withDefaultDependencies(dependencies: HvscSyncDependencies = {}): ResolvedDependencies {
  return {
    fetchManifest: dependencies.fetchManifest ?? fetchHvscManifest,
    downloadArchive: dependencies.downloadArchive ?? defaultDownloadArchive,
    extractArchive: dependencies.extractArchive ?? defaultExtractArchive,
    computeChecksum: dependencies.computeChecksum ?? defaultChecksum,
    now: dependencies.now ?? (() => new Date())
  };
}

async function defaultDownloadArchive(descriptor: HvscArchiveDescriptor, destination: string): Promise<void> {
  const response = await fetch(descriptor.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${descriptor.url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destination, Buffer.from(arrayBuffer));
}

async function defaultChecksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  return await new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => {
      hash.update(chunk as Buffer);
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

/* c8 ignore start */
async function defaultExtractArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("7z", ["x", archivePath, `-o${destination}`, "-y"], {
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`7z exited with code ${code}`));
      }
    });
  });
}
/* c8 ignore stop */

function resolveVersionPath(config: SidflowConfig, override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  const hvscDir = path.resolve(config.hvscPath);
  const parent = path.dirname(hvscDir);
  return path.join(parent, VERSION_FILENAME);
}

export const __internal = {
  downloadArchive,
  cleanupTemp,
  isDirectoryEmpty,
  withDefaultDependencies,
  defaultDownloadArchive,
  defaultChecksum,
  defaultExtractArchive,
  resolveVersionPath
};