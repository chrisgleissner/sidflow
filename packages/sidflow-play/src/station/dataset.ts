import path from "node:path";
import process from "node:process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  ensureDir,
  pathExists,
  writeCanonicalJsonFile,
  type JsonValue,
  type SidflowConfig,
} from "@sidflow/common";
import type {
  CachedStationDatasetState,
  GitHubRelease,
  StationCliOptions,
  StationDatasetResolution,
  StationRuntime,
} from "./types.js";
import {
  STATION_CACHE_DIR,
  STATION_CACHE_STATE,
  STATION_RELEASE_CHECK_INTERVAL_MS,
  STATION_RELEASE_REPO,
} from "./constants.js";
import { renderRelativePath } from "./formatting.js";

function isStaleTimestamp(value: string | undefined, now: Date): boolean {
  if (!value) {
    return true;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return now.getTime() - parsed >= STATION_RELEASE_CHECK_INTERVAL_MS;
}

export async function safeReadJsonFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function findFilesWithSuffix(rootPath: string, suffix: string): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const results: string[] = [];
  const queue = [rootPath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function resolveLatestLocalExportDb(exportsDir: string): Promise<string | undefined> {
  if (!(await pathExists(exportsDir))) {
    return undefined;
  }

  const { stat } = await import("node:fs/promises");
  const entries = await readdir(exportsDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
      .map(async (entry) => {
        const filePath = path.join(exportsDir, entry.name);
        const fileStat = await stat(filePath);
        return {
          filePath,
          mtimeMs: fileStat.mtimeMs,
        };
      }),
  );

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.filePath.localeCompare(left.filePath));
  return candidates[0]?.filePath;
}

export async function resolveLatestFeaturesJsonl(classifiedPath: string): Promise<string | undefined> {
  if (!(await pathExists(classifiedPath))) {
    return undefined;
  }

  const entries = await readdir(classifiedPath, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("features_") && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();
  const latest = names.at(-1);
  return latest ? path.join(classifiedPath, latest) : undefined;
}

async function fetchGitHubLatestRelease(runtime: StationRuntime): Promise<GitHubRelease> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sidflow-station",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await runtime.fetchImpl(
    `https://api.github.com/repos/${STATION_RELEASE_REPO}/releases/latest`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`GitHub latest-release check failed with HTTP ${response.status}`);
  }
  return await response.json() as GitHubRelease;
}

function selectReleaseAsset(release: GitHubRelease): { name: string; url: string } {
  const assets = release.assets ?? [];
  const preferred = assets.find((asset) =>
    typeof asset.name === "string"
      && typeof asset.browser_download_url === "string"
      && asset.name.endsWith(".tar.gz")
      && asset.name.includes("sidcorr-1"),
  ) ?? assets.find((asset) =>
    typeof asset.name === "string"
      && typeof asset.browser_download_url === "string"
      && asset.name.endsWith(".tar.gz"),
  );

  if (!preferred?.name || !preferred.browser_download_url) {
    throw new Error("Latest sidflow-data release does not expose a .tar.gz similarity bundle asset.");
  }

  return {
    name: preferred.name,
    url: preferred.browser_download_url,
  };
}

async function downloadToFile(runtime: StationRuntime, url: string, destinationPath: string): Promise<void> {
  const response = await runtime.fetchImpl(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "sidflow-station",
    },
  });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }
  const payload = new Uint8Array(await response.arrayBuffer());
  await ensureDir(path.dirname(destinationPath));
  await writeFile(destinationPath, payload);
}

async function extractTarGz(archivePath: string, destinationPath: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await ensureDir(destinationPath);
  await rm(destinationPath, { force: true, recursive: true });
  await ensureDir(destinationPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destinationPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tar extraction failed for ${archivePath}: ${stderrChunks.join("").trim() || `exit ${code ?? "unknown"}`}`));
    });
  });
}

async function resolveCachedReleaseState(statePath: string): Promise<CachedStationDatasetState | undefined> {
  const cached = await safeReadJsonFile<CachedStationDatasetState>(statePath);
  if (!cached?.dbPath || !(await pathExists(cached.dbPath))) {
    return undefined;
  }
  return cached;
}

async function writeCachedReleaseState(statePath: string, state: CachedStationDatasetState): Promise<void> {
  await writeCanonicalJsonFile(statePath, state as unknown as JsonValue, {
    action: "data:modify",
  });
}

async function materializeReleaseBundle(
  runtime: StationRuntime,
  cacheRoot: string,
  releaseTag: string,
  publishedAt: string,
  assetName: string,
  assetUrl: string,
): Promise<CachedStationDatasetState> {
  const releaseRoot = path.join(cacheRoot, "releases", releaseTag);
  const archivePath = path.join(releaseRoot, assetName);
  const bundleDir = path.join(releaseRoot, "bundle");
  await ensureDir(releaseRoot);

  if (!(await pathExists(archivePath))) {
    await downloadToFile(runtime, assetUrl, archivePath);
  }

  await extractTarGz(archivePath, bundleDir);
  const sqliteFiles = await findFilesWithSuffix(bundleDir, ".sqlite");
  if (sqliteFiles.length === 0) {
    throw new Error(`Release asset ${assetName} did not contain a similarity SQLite database.`);
  }

  const manifestFiles = await findFilesWithSuffix(bundleDir, ".manifest.json");
  return {
    assetName,
    assetUrl,
    bundleDir,
    checkedAt: runtime.now().toISOString(),
    dbPath: sqliteFiles[0]!,
    manifestPath: manifestFiles[0],
    publishedAt,
    releaseTag,
  };
}

async function resolveRemoteStationDataset(
  runtime: StationRuntime,
  cwd: string,
): Promise<StationDatasetResolution> {
  const cacheRoot = path.resolve(cwd, STATION_CACHE_DIR);
  const statePath = path.join(cacheRoot, STATION_CACHE_STATE);
  const cached = await resolveCachedReleaseState(statePath);
  const now = runtime.now();

  if (cached && !isStaleTimestamp(cached.checkedAt, now)) {
    return {
      dataSource: `sidflow-data release ${cached.releaseTag} (cached)`,
      dbPath: cached.dbPath,
    };
  }

  try {
    const release = await fetchGitHubLatestRelease(runtime);
    const releaseTag = release.tag_name;
    const publishedAt = release.published_at;
    if (!releaseTag || !publishedAt) {
      throw new Error("GitHub latest-release response was missing tag_name/published_at.");
    }
    const asset = selectReleaseAsset(release);

    if (cached && cached.releaseTag === releaseTag && await pathExists(cached.dbPath)) {
      const refreshed: CachedStationDatasetState = {
        ...cached,
        checkedAt: now.toISOString(),
      };
      await writeCachedReleaseState(statePath, refreshed);
      return {
        dataSource: `sidflow-data release ${releaseTag} (cached, checked today)`,
        dbPath: refreshed.dbPath,
      };
    }

    const materialized = await materializeReleaseBundle(runtime, cacheRoot, releaseTag, publishedAt, asset.name, asset.url);
    await writeCachedReleaseState(statePath, materialized);
    return {
      dataSource: `sidflow-data release ${releaseTag} (downloaded ${publishedAt.slice(0, 10)})`,
      dbPath: materialized.dbPath,
    };
  } catch (error) {
    if (cached) {
      return {
        dataSource: `sidflow-data release ${cached.releaseTag} (cached, latest check failed)`,
        dbPath: cached.dbPath,
      };
    }
    throw error;
  }
}

export async function resolveStationDataset(
  runtime: StationRuntime,
  options: StationCliOptions,
  config: SidflowConfig,
): Promise<StationDatasetResolution> {
  const cwd = runtime.cwd();
  const classifiedPath = path.resolve(cwd, config.classifiedPath ?? "data/classified");
  const explicitLocalDb = options.localDb ?? options.db;

  if (explicitLocalDb) {
    return {
      dataSource: `local SQLite override ${renderRelativePath(cwd, path.resolve(cwd, explicitLocalDb))}`,
      dbPath: path.resolve(cwd, explicitLocalDb),
      featuresJsonl: options.featuresJsonl ? path.resolve(cwd, options.featuresJsonl) : undefined,
    };
  }

  if (options.forceLocalDb) {
    const exportsDir = path.resolve(cwd, "data/exports");
    const latestLocalDb = await resolveLatestLocalExportDb(exportsDir);
    if (!latestLocalDb) {
      throw new Error(`No local similarity export .sqlite files were found under ${exportsDir}`);
    }
    return {
      dataSource: `latest local export ${renderRelativePath(cwd, latestLocalDb)}`,
      dbPath: latestLocalDb,
      featuresJsonl: options.featuresJsonl
        ? path.resolve(cwd, options.featuresJsonl)
        : await resolveLatestFeaturesJsonl(classifiedPath),
    };
  }

  const remote = await resolveRemoteStationDataset(runtime, cwd);
  return {
    ...remote,
    featuresJsonl: options.featuresJsonl ? path.resolve(cwd, options.featuresJsonl) : undefined,
  };
}
