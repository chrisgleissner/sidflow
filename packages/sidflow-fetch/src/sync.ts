import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, opendir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";

import { createLogger, ensureDir, extractSevenZipArchive, loadConfig, retry, type SidflowConfig } from "@sidflow/common";

import { fetchHvscManifest, DEFAULT_BASE_URL } from "./manifest.js";
import { loadHvscVersion, saveHvscVersion } from "./version.js";
import type {
  DownloadProgressHandler,
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
  const sidPath = path.resolve(config.sidPath);
  const versionPath = resolveVersionPath(config, options.hvscVersionPath);

  await ensureDir(path.dirname(versionPath));
  await ensureDir(sidPath);

  const manifest = await dependencies.fetchManifest(options.remoteBaseUrl ?? DEFAULT_BASE_URL);
  const currentVersion = await loadHvscVersion(versionPath);

  const hvscEmpty = await isDirectoryEmpty(sidPath);
  const baseResult = await syncBase({
    config,
    manifest,
    sidPath,
    hvscEmpty,
    currentVersion,
    dependencies,
    versionPath,
    logger
  });

  const appliedDeltas = await syncDeltas({
    manifest,
    sidPath,
    versionPath,
    currentVersion: baseResult.record,
    dependencies,
    logger
  });

  return {
    baseUpdated: baseResult.updated,
    appliedDeltas,
    baseVersion: baseResult.record.baseVersion,
    baseSyncedAt: baseResult.record.baseAppliedAt
  };
}

interface SyncBaseContext {
  config: SidflowConfig;
  manifest: HvscManifest;
  sidPath: string;
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
  const { manifest, sidPath, currentVersion, hvscEmpty, dependencies, versionPath, logger } = context;
  const remoteVersion = manifest.base.version;
  const localVersion = currentVersion?.baseVersion ?? null;

  const needsBase = hvscEmpty || localVersion === null || remoteVersion > localVersion;
  if (!needsBase) {
    if (!currentVersion) {
      throw new Error("HVSC metadata is missing for existing archive");
    }
    logger.info(
      `HVSC base archive already up to date (v${currentVersion.baseVersion}) last downloaded ${currentVersion.baseAppliedAt}`
    );
    return {
      updated: false,
      record: currentVersion
    };
  }

  logger.info(`Syncing HVSC base archive v${remoteVersion}`);

  await rm(sidPath, { recursive: true, force: true });
  await mkdir(sidPath, { recursive: true });

  logger.info(`Downloading base archive ${manifest.base.filename}`);
  const baseProgress = createProgressReporter(logger, manifest.base.filename);
  const archivePath = await downloadArchive(manifest.base, dependencies, baseProgress);
  logger.info(`Download complete: ${manifest.base.filename}`);
  await dependencies.extractArchive(archivePath, sidPath);
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
  sidPath: string;
  versionPath: string;
  currentVersion: HvscVersionRecord;
  dependencies: ResolvedDependencies;
  logger: ReturnType<typeof createLogger>;
}

async function syncDeltas(context: SyncDeltasContext): Promise<number[]> {
  const { manifest, sidPath, currentVersion, dependencies, versionPath, logger } = context;
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
    logger.info(`Downloading delta ${descriptor.filename}`);
    const progress = createProgressReporter(logger, descriptor.filename);
    const archivePath = await downloadArchive(descriptor, dependencies, progress);
    logger.info(`Download complete: ${descriptor.filename}`);
    await dependencies.extractArchive(archivePath, sidPath);
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

async function downloadArchive(
  descriptor: HvscArchiveDescriptor,
  dependencies: ResolvedDependencies,
  onProgress?: DownloadProgressHandler
): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-hvsc-"));
  const destination = path.join(tempDir, descriptor.filename);
  await dependencies.downloadArchive(descriptor, destination, onProgress);
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
  downloadArchive: (
    descriptor: HvscArchiveDescriptor,
    destination: string,
    onProgress?: DownloadProgressHandler
  ) => Promise<void>;
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

async function defaultDownloadArchive(
  descriptor: HvscArchiveDescriptor,
  destination: string,
  onProgress?: DownloadProgressHandler
): Promise<void> {
  const response = await retry(async () => {
    try {
      const result = await fetch(descriptor.url);
      if (!result.ok) {
        throw new Error(`Failed to download ${descriptor.url}: ${result.status} ${result.statusText}`);
      }
      return result;
    } catch (error) {
      throw new Error(`Failed to download ${descriptor.url}: ${(error as Error).message}`);
    }
  });

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? Number(contentLength) : undefined;

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(destination, buffer);
    onProgress?.({ downloadedBytes: buffer.length, totalBytes: buffer.length });
    return;
  }

  const reader = response.body.getReader();
  const fileStream = createWriteStream(destination, { flags: "w" });
  let downloaded = 0;
  if (totalBytes !== undefined && !Number.isNaN(totalBytes)) {
    onProgress?.({ downloadedBytes: 0, totalBytes });
  }

  await new Promise<void>((resolve, reject) => {
    fileStream.once("error", reject);
    fileStream.once("finish", resolve);

    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            const chunk = Buffer.from(value);
            downloaded += chunk.length;
            if (!fileStream.write(chunk)) {
              await once(fileStream, "drain");
            }
            onProgress?.({ downloadedBytes: downloaded, totalBytes });
          }
        }
        fileStream.end();
      } catch (error) {
        fileStream.destroy(error as Error);
        reject(error as Error);
      }
    };

    void pump();
  });

  if (downloaded > 0) {
    onProgress?.({ downloadedBytes: downloaded, totalBytes });
  }
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
  await extractSevenZipArchive(archivePath, destination);
}
/* c8 ignore stop */

function createProgressReporter(
  logger: ReturnType<typeof createLogger>,
  filename: string
): DownloadProgressHandler {
  let lastPercentLogged = -10;
  let lastBytesLogged = 0;
  const threshold = 50 * 1024 * 1024;

  return ({ downloadedBytes, totalBytes }) => {
    if (totalBytes && totalBytes > 0 && !Number.isNaN(totalBytes)) {
      if (totalBytes <= 0) {
        return;
      }
      const percent = Math.floor((downloadedBytes / totalBytes) * 100);
      if (percent <= 0) {
        return;
      }
      if (percent >= lastPercentLogged + 10 || percent >= 100) {
        logger.info(
          `Downloading ${filename}: ${percent}% (${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)})`
        );
        lastPercentLogged = Math.min(100, Math.floor(percent / 10) * 10);
      }
      return;
    }

    if (downloadedBytes === 0) {
      return;
    }

    if (downloadedBytes - lastBytesLogged >= threshold) {
      logger.info(`Downloading ${filename}: ${formatBytes(downloadedBytes)} downloaded`);
      lastBytesLogged = downloadedBytes;
    }
  };
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const formatted = value >= 10 || value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[index]}`;
}

function resolveVersionPath(config: SidflowConfig, override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  const hvscDir = path.resolve(config.sidPath);
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
  createProgressReporter,
  resolveVersionPath
};