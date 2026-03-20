#!/usr/bin/env bun

import { createHash } from "node:crypto";
import process from "node:process";
import path from "node:path";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { Database } from "bun:sqlite";
import {
  ensureDir,
  formatHelp,
  handleParseResult,
  loadConfig,
  lookupSongDurationMs,
  parseArgs,
  parseSidFile,
  pathExists,
  recommendFromFavorites,
  writeCanonicalJsonFile,
  type ArgDef,
  type JsonValue,
  type SidFileMetadata,
  type SidflowConfig,
  type SimilarityExportRecommendation,
  Ultimate64Client,
} from "@sidflow/common";

type PlaybackMode = "local" | "c64u" | "none";
type Phase = "rating" | "station";

interface StationDemoCliOptions {
  config?: string;
  db?: string;
  localDb?: string;
  forceLocalDb?: boolean;
  resetSelections?: boolean;
  hvsc?: string;
  featuresJsonl?: string;
  playback?: PlaybackMode;
  sidplayPath?: string;
  c64uHost?: string;
  c64uPassword?: string;
  c64uHttps?: boolean;
  adventure?: number;
  sampleSize?: number;
  stationSize?: number;
  minDuration?: number;
}

interface StationTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
  e: number;
  m: number;
  c: number;
  p: number | null;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  last_played: string | null;
}

interface StationTrackDetails extends StationTrackRow {
  absolutePath: string;
  title: string;
  author: string;
  released: string;
  year?: string;
  durationMs?: number;
  songs?: number;
}

interface MetadataResolver {
  parseSidFile: typeof parseSidFile;
  lookupSongDurationMs: typeof lookupSongDurationMs;
}

interface PlaybackAdapter {
  start(track: StationTrackDetails): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

interface StationDemoRuntime extends MetadataResolver {
  loadConfig: typeof loadConfig;
  createPlaybackAdapter?: (mode: PlaybackMode, config: SidflowConfig, options: StationDemoCliOptions) => Promise<PlaybackAdapter>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  cwd: () => string;
  now: () => Date;
  prompt?: (message: string) => Promise<string>;
  random: () => number;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  offSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

interface ExportDatabaseInfo {
  trackCount: number;
  hasTrackIdentity: boolean;
  hasVectorData: boolean;
}

type SeedAction =
  | { type: "rate"; rating: number }
  | { type: "skip" }
  | { type: "back" }
  | { type: "replay" }
  | { type: "quit" };

type StationAction =
  | { type: "rate"; rating: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "cursorUp" }
  | { type: "cursorDown" }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "playSelected" }
  | { type: "togglePause" }
  | { type: "setFilter"; value: string; editing: boolean }
  | { type: "shuffle" }
  | { type: "replay" }
  | { type: "rebuild" }
  | { type: "quit" }
  | { type: "timeout" };

interface InputController {
  close(): void;
  readSeedAction(): Promise<SeedAction>;
  readStationAction(timeoutMs: number, onTick?: () => void): Promise<StationAction>;
}

interface StationScreenState {
  phase: Phase;
  current: StationTrackDetails;
  index: number;
  selectedIndex?: number;
  playlistWindowStart?: number;
  total: number;
  ratedCount: number;
  ratedTarget: number;
  ratings: Map<string, number>;
  playbackMode: PlaybackMode;
  adventure: number;
  dataSource: string;
  dbPath: string;
  featuresJsonl?: string;
  currentRating?: number;
  queue?: StationTrackDetails[];
  elapsedMs?: number;
  durationMs?: number;
  playlistElapsedMs?: number;
  playlistDurationMs?: number;
  filterQuery?: string;
  filterEditing?: boolean;
  filterMatchCount?: number;
  minDurationSeconds?: number;
  paused?: boolean;
  statusLine?: string;
  hintLine?: string;
}

interface StationTrackVectorRow {
  track_id: string;
  vector_json: string | null;
}

interface CachedStationDatasetState {
  assetName: string;
  assetUrl: string;
  bundleDir: string;
  checkedAt: string;
  dbPath: string;
  manifestPath?: string;
  publishedAt: string;
  releaseTag: string;
}

interface PersistedStationSelectionState {
  dbPath: string;
  hvscRoot: string;
  ratedTarget: number;
  ratings: Record<string, number>;
  savedAt: string;
}

interface GitHubReleaseAsset {
  browser_download_url?: string;
  name?: string;
}

interface GitHubRelease {
  assets?: GitHubReleaseAsset[];
  published_at?: string;
  tag_name?: string;
}

interface StationDatasetResolution {
  dataSource: string;
  dbPath: string;
  featuresJsonl?: string;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json",
  },
  {
    name: "--db",
    type: "string",
    description: "Deprecated alias for --local-db",
  },
  {
    name: "--local-db",
    type: "string",
    description: "Path to a specific local similarity SQLite database",
  },
  {
    name: "--force-local-db",
    type: "boolean",
    description: "Use the latest local similarity export under data/exports",
  },
  {
    name: "--reset-selections",
    type: "boolean",
    description: "Discard any persisted station ratings and force fresh seed capture",
  },
  {
    name: "--hvsc",
    type: "string",
    description: "HVSC or SID collection root used to locate playable files",
  },
  {
    name: "--features-jsonl",
    type: "string",
    description: "Optional companion features JSONL path for provenance display",
  },
  {
    name: "--playback",
    type: "string",
    description: "Playback mode: local, c64u, none",
  },
  {
    name: "--sidplay-path",
    type: "string",
    description: "Override sidplayfp executable path for local playback",
  },
  {
    name: "--c64u-host",
    type: "string",
    description: "Override Ultimate64 host for remote playback",
  },
  {
    name: "--c64u-password",
    type: "string",
    description: "Override Ultimate64 API password",
  },
  {
    name: "--c64u-https",
    type: "boolean",
    description: "Use HTTPS for Ultimate64 playback",
  },
  {
    name: "--adventure",
    type: "integer",
    description: "Exploration factor from 1-5",
    defaultValue: 3,
    constraints: { min: 1, max: 5 },
  },
  {
    name: "--sample-size",
    type: "integer",
    description: "Minimum number of songs to rate before station generation (minimum effective target: 10)",
    defaultValue: 10,
    constraints: { min: 1 },
  },
  {
    name: "--station-size",
    type: "integer",
    description: "Number of recommendations to keep in the station queue (minimum effective queue: 100 songs)",
    defaultValue: 100,
    constraints: { min: 1 },
  },
  {
    name: "--min-duration",
    type: "integer",
    description: "Minimum allowed song duration in seconds for seeds and station tracks",
    defaultValue: 15,
    constraints: { min: 1 },
  },
];

const HELP_TEXT = formatHelp(
  "sidflow-play station-demo [options]",
  `Interactive demo proving the exported similarity SQLite DB is self-contained.
By default the station uses the latest cached sidflow-data release bundle and checks GitHub for a newer bundle at most once per day.
Use --force-local-db for the latest local export or --local-db to point at a specific local SQLite bundle.
Persisted station ratings are reused automatically for the same dataset unless --reset-selections is supplied.
The optional features JSONL is only shown as companion provenance for local data.

Workflow:
  1. Pull random tracks directly from the export DB.
  2. Keep rating until at least 10 songs are actually rated.
  3. Build a station from the export vectors.
  4. Navigate with arrows, replay, pause, or rebuild the queue without losing the current station context.
  5. Ignore tracks shorter than --min-duration.

Commands:
  Rating phase: 0-5 rate, l like(5), d dislike(0), s skip, b back, r replay, q quit
  Station phase: / filter title/artist, left/right play prev/next, up/down/pgup/pgdn browse, enter play selected, space pause/resume, h shuffle, s skip=dislike, l like(5), d dislike(0), r replay, u rebuild, 0-5 rate+rebuild, q quit`,
  ARG_DEFS,
  [
    "sidflow-play station-demo",
    "sidflow-play station-demo --playback none --sample-size 10 --station-size 100 --min-duration 20",
    "sidflow-play station-demo --c64u-host 192.168.1.13 --adventure 5",
  ],
);

const defaultRuntime: StationDemoRuntime = {
  loadConfig,
  parseSidFile,
  lookupSongDurationMs,
  fetchImpl: fetch,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  cwd: () => process.cwd(),
  now: () => new Date(),
  random: () => Math.random(),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  offSignal: (signal, handler) => {
    process.off(signal, handler);
  },
};

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
  brightBlack: "\u001b[90m",
  brightRed: "\u001b[91m",
  brightGreen: "\u001b[92m",
  brightYellow: "\u001b[93m",
  brightBlue: "\u001b[94m",
  brightMagenta: "\u001b[95m",
  brightCyan: "\u001b[96m",
};

const MINIMUM_RATED_TRACKS = 10;
const MINIMUM_STATION_TRACKS = 100;
const U64_SID_VOLUME_REGISTERS = [0xD418, 0xD438, 0xD458] as const;
const MINIMUM_PLAYLIST_WINDOW_ROWS = 7;
const STATION_SCREEN_RESERVED_ROWS = 22;
const STATION_DEMO_CACHE_DIR = path.join("data", "cache", "station-demo", "sidflow-data");
const STATION_DEMO_CACHE_STATE = "latest-release.json";
const STATION_DEMO_SELECTIONS_DIR = path.join("data", "cache", "station-demo", "selections");
const STATION_DEMO_RELEASE_REPO = "chrisgleissner/sidflow-data";
const STATION_DEMO_RELEASE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function parseStationDemoArgs(argv: string[]) {
  return parseArgs<StationDemoCliOptions>(argv, ARG_DEFS);
}

function mergeRuntime(overrides?: Partial<StationDemoRuntime>): StationDemoRuntime {
  if (!overrides) {
    return defaultRuntime;
  }
  return {
    ...defaultRuntime,
    ...overrides,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    stdin: overrides.stdin ?? process.stdin,
  };
}

function normalizePlaybackMode(value: string | undefined): PlaybackMode | null {
  if (!value) {
    return "local";
  }
  if (value === "local" || value === "c64u" || value === "none") {
    return value;
  }
  return null;
}

function resolvePlaybackMode(options: StationDemoCliOptions): PlaybackMode | null {
  if (options.playback) {
    return normalizePlaybackMode(options.playback);
  }
  if (options.c64uHost) {
    return "c64u";
  }
  return "local";
}

function resolveTrackDurationMs(track: StationTrackDetails): number {
  if (typeof track.durationMs === "number" && Number.isFinite(track.durationMs) && track.durationMs > 0) {
    return track.durationMs;
  }
  return 120_000;
}

function isTrackLongEnough(track: StationTrackDetails, minDurationSeconds: number): boolean {
  return resolveTrackDurationMs(track) >= Math.max(1, minDurationSeconds) * 1000;
}

function isStaleTimestamp(value: string | undefined, now: Date): boolean {
  if (!value) {
    return true;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return now.getTime() - parsed >= STATION_DEMO_RELEASE_CHECK_INTERVAL_MS;
}

async function safeReadJsonFile<T>(filePath: string): Promise<T | undefined> {
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

function buildSelectionStatePath(cwd: string, dbPath: string, hvscRoot: string): string {
  const digest = createHash("sha256").update(`${dbPath}\n${hvscRoot}`).digest("hex").slice(0, 16);
  return path.resolve(cwd, STATION_DEMO_SELECTIONS_DIR, `${digest}.json`);
}

function sanitizePersistedRatings(value: Record<string, number> | undefined): Map<string, number> {
  const ratings = new Map<string, number>();
  if (!value) {
    return ratings;
  }

  for (const [trackId, rating] of Object.entries(value)) {
    if (Number.isInteger(rating) && rating >= 0 && rating <= 5) {
      ratings.set(trackId, rating);
    }
  }
  return ratings;
}

async function readPersistedStationSelections(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
): Promise<Map<string, number>> {
  const state = await safeReadJsonFile<PersistedStationSelectionState>(statePath);
  if (!state) {
    return new Map();
  }
  if (state.dbPath !== dbPath || state.hvscRoot !== hvscRoot) {
    return new Map();
  }
  return sanitizePersistedRatings(state.ratings);
}

async function writePersistedStationSelections(
  statePath: string,
  dbPath: string,
  hvscRoot: string,
  ratedTarget: number,
  ratings: Map<string, number>,
  savedAt: string,
): Promise<void> {
  const persistedRatings = Object.fromEntries([...ratings.entries()].sort(([left], [right]) => left.localeCompare(right)));
  await writeCanonicalJsonFile(statePath, {
    dbPath,
    hvscRoot,
    ratedTarget,
    ratings: persistedRatings,
    savedAt,
  } as unknown as JsonValue, {
    action: "data:modify",
  });
}

function renderRelativePath(baseDir: string, targetPath: string): string {
  const relative = path.relative(baseDir, targetPath);
  if (!relative || relative.startsWith("..")) {
    return targetPath;
  }
  return relative;
}

async function fetchGitHubLatestRelease(runtime: StationDemoRuntime): Promise<GitHubRelease> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sidflow-station-demo",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await runtime.fetchImpl(
    `https://api.github.com/repos/${STATION_DEMO_RELEASE_REPO}/releases/latest`,
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

async function downloadToFile(runtime: StationDemoRuntime, url: string, destinationPath: string): Promise<void> {
  const response = await runtime.fetchImpl(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "sidflow-station-demo",
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
  runtime: StationDemoRuntime,
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
  runtime: StationDemoRuntime,
  cwd: string,
): Promise<StationDatasetResolution> {
  const cacheRoot = path.resolve(cwd, STATION_DEMO_CACHE_DIR);
  const statePath = path.join(cacheRoot, STATION_DEMO_CACHE_STATE);
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

async function resolveStationDataset(
  runtime: StationDemoRuntime,
  options: StationDemoCliOptions,
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

function buildSidplayArgs(track: StationTrackDetails): string[] {
  const durationMs = resolveTrackDurationMs(track);
  const wholeSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  return ["-q", "-os", `-o${track.song_index}`, `-t${wholeSeconds}`, track.absolutePath];
}

function openReadonlyDatabase(dbPath: string): Database {
  return new Database(dbPath, { readonly: true, strict: true });
}

function inspectExportDatabase(dbPath: string): ExportDatabaseInfo {
  const database = openReadonlyDatabase(dbPath);
  try {
    const columns = database.query("PRAGMA table_info(tracks)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const trackCountRow = database.query("SELECT COUNT(*) AS count FROM tracks").get() as { count: number };
    const vectorCountRow = database
      .query("SELECT COUNT(*) AS count FROM tracks WHERE vector_json IS NOT NULL AND vector_json != ''")
      .get() as { count: number };

    return {
      trackCount: trackCountRow.count,
      hasTrackIdentity: columnNames.has("track_id") && columnNames.has("song_index"),
      hasVectorData: vectorCountRow.count > 0,
    };
  } finally {
    database.close();
  }
}

function readRandomTracksExcluding(dbPath: string, limit: number, excludedTrackIds: Iterable<string>): StationTrackRow[] {
  const excluded = [...excludedTrackIds];
  const database = openReadonlyDatabase(dbPath);
  try {
    if (excluded.length === 0) {
      return database
        .query(
          `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
           FROM tracks
           ORDER BY RANDOM()
           LIMIT ?`,
        )
        .all(limit) as StationTrackRow[];
    }

    const placeholders = excluded.map(() => "?").join(", ");
    return database
      .query(
        `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
         FROM tracks
         WHERE track_id NOT IN (${placeholders})
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(...excluded, limit) as StationTrackRow[];
  } finally {
    database.close();
  }
}

function readTrackRowById(dbPath: string, trackId: string): StationTrackRow | null {
  const database = openReadonlyDatabase(dbPath);
  try {
    return (
      (database
        .query(
          `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
           FROM tracks
           WHERE track_id = ?`,
        )
        .get(trackId) as StationTrackRow | null) ?? null
    );
  } finally {
    database.close();
  }
}

function readTrackVectorsByIds(dbPath: string, trackIds: string[]): Map<string, number[]> {
  if (trackIds.length === 0) {
    return new Map();
  }

  const database = openReadonlyDatabase(dbPath);
  try {
    const placeholders = trackIds.map(() => "?").join(", ");
    const rows = database
      .query(
        `SELECT track_id, vector_json
         FROM tracks
         WHERE track_id IN (${placeholders})`,
      )
      .all(...trackIds) as StationTrackVectorRow[];

    const result = new Map<string, number[]>();
    for (const row of rows) {
      if (!row.vector_json) {
        continue;
      }
      result.set(row.track_id, JSON.parse(row.vector_json) as number[]);
    }
    return result;
  } finally {
    database.close();
  }
}

function buildWeightsByTrackId(ratings: Map<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [trackId, rating] of ratings) {
    if (rating >= 5) {
      result[trackId] = 9;
      continue;
    }
    if (rating >= 4) {
      result[trackId] = 4;
      continue;
    }
    if (rating >= 3) {
      result[trackId] = 1.5;
      continue;
    }
    result[trackId] = 0.1;
  }
  return result;
}

function pickFavoriteTrackIds(ratings: Map<string, number>): string[] {
  const ordered = [...ratings.entries()].sort((left, right) => right[1] - left[1]);
  const loved = ordered.filter(([, rating]) => rating >= 4).map(([trackId]) => trackId);
  if (loved.length > 0) {
    return loved;
  }
  const liked = ordered.filter(([, rating]) => rating >= 3).map(([trackId]) => trackId);
  if (liked.length > 0) {
    return liked;
  }
  const fallback = ordered.find(([, rating]) => rating > 0);
  return fallback ? [fallback[0]] : [];
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const dimensions = Math.min(left.length, right.length);
  for (let index = 0; index < dimensions; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function chooseStationTracks(
  recommendations: SimilarityExportRecommendation[],
  stationSize: number,
  adventure: number,
  random: () => number,
): SimilarityExportRecommendation[] {
  if (recommendations.length <= stationSize) {
    return recommendations;
  }

  const chosen: SimilarityExportRecommendation[] = [];
  const used = new Set<string>();
  const bucketCounts = new Map<string, number>();
  const sorted = [...recommendations].sort((left, right) => right.score - left.score || left.rank - right.rank);
  const bestScore = sorted[0]?.score ?? 0;
  const worstScore = sorted[sorted.length - 1]?.score ?? bestScore;
  const scoreExponent = Math.max(1.15, 3.05 - (Math.max(1, adventure) * 0.35));
  const candidatesByBucket = new Map<string, SimilarityExportRecommendation[]>();

  for (const recommendation of sorted) {
    const bucketKey = deriveStationBucketKey(recommendation.sid_path);
    const bucket = candidatesByBucket.get(bucketKey) ?? [];
    bucket.push(recommendation);
    candidatesByBucket.set(bucketKey, bucket);
  }

  for (let index = 0; index < stationSize && used.size < sorted.length; index += 1) {
    const bucketEntries = [...candidatesByBucket.entries()].filter(([, bucketCandidates]) => bucketCandidates.some((entry) => !used.has(entry.track_id)));
    if (bucketEntries.length === 0) {
      break;
    }

    const minBucketCount = Math.min(...bucketEntries.map(([bucketKey]) => bucketCounts.get(bucketKey) ?? 0));
    const eligibleBuckets = bucketEntries.filter(([bucketKey]) => (bucketCounts.get(bucketKey) ?? 0) === minBucketCount);

    const weightedBuckets = eligibleBuckets.map(([bucketKey, bucketCandidates]) => {
      const nextCandidate = bucketCandidates.find((entry) => !used.has(entry.track_id));
      const normalizedScore = !nextCandidate || bestScore === worstScore
        ? 1
        : Math.max(0, Math.min(1, (nextCandidate.score - worstScore) / (bestScore - worstScore)));
      const scoreWeight = Math.pow(0.05 + (normalizedScore * 0.95), scoreExponent);
      return {
        bucketCandidates,
        bucketKey,
        weight: Math.max(0.0001, scoreWeight),
      };
    });

    const totalBucketWeight = weightedBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);
    let bucketCursor = random() * totalBucketWeight;
    let selectedBucket = weightedBuckets[weightedBuckets.length - 1]!;
    for (const bucket of weightedBuckets) {
      bucketCursor -= bucket.weight;
      if (bucketCursor <= 0) {
        selectedBucket = bucket;
        break;
      }
    }

    const bucketCandidates = selectedBucket.bucketCandidates.filter((entry) => !used.has(entry.track_id));
    if (bucketCandidates.length === 0) {
      continue;
    }

    const weightedCandidates = bucketCandidates.map((entry) => {
      const normalizedScore = bestScore === worstScore
        ? 1
        : Math.max(0, Math.min(1, (entry.score - worstScore) / (bestScore - worstScore)));
      const scoreWeight = Math.pow(0.05 + (normalizedScore * 0.95), scoreExponent);
      return {
        entry,
        weight: Math.max(0.0001, scoreWeight),
      };
    });

    const totalWeight = weightedCandidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let cursor = random() * totalWeight;
    let picked = weightedCandidates[weightedCandidates.length - 1]!;

    for (const candidate of weightedCandidates) {
      cursor -= candidate.weight;
      if (cursor <= 0) {
        picked = candidate;
        break;
      }
    }

    chosen.push(picked.entry);
    used.add(picked.entry.track_id);
    bucketCounts.set(selectedBucket.bucketKey, (bucketCounts.get(selectedBucket.bucketKey) ?? 0) + 1);
  }

  return chosen;
}

function resolvePlaylistWindowStart(
  filteredIndices: number[],
  selectedIndex: number,
  visibleRows: number,
  previousWindowStart: number,
): number {
  if (filteredIndices.length === 0) {
    return 0;
  }

  const rows = Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, visibleRows);
  const maxWindowStart = Math.max(0, filteredIndices.length - rows);
  let windowStart = Math.max(0, Math.min(previousWindowStart, maxWindowStart));
  const focusPosition = Math.max(0, filteredIndices.indexOf(selectedIndex));

  if (focusPosition < windowStart) {
    windowStart = focusPosition;
  } else if (focusPosition >= windowStart + rows) {
    windowStart = focusPosition - rows + 1;
  }

  return Math.max(0, Math.min(windowStart, maxWindowStart));
}

function orderStationTracksByFlow(
  recommendations: SimilarityExportRecommendation[],
  vectorsByTrackId: Map<string, number[]>,
  adventure: number,
  random: () => number,
): SimilarityExportRecommendation[] {
  if (recommendations.length <= 2) {
    return [...recommendations];
  }

  const originalOrder = new Map(recommendations.map((recommendation, index) => [recommendation.track_id, index]));
  const remaining = [...recommendations].sort(
    (left, right) => right.score - left.score || (originalOrder.get(left.track_id)! - originalOrder.get(right.track_id)!),
  );
  const ordered = [remaining.shift()!];
  const shortlistSize = Math.max(1, Math.min(remaining.length, 1 + Math.floor(adventure / 2)));

  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1]!;
    const previousVector = vectorsByTrackId.get(previous.track_id);
    const scored = remaining
      .map((candidate) => {
        const candidateVector = vectorsByTrackId.get(candidate.track_id);
        const continuity = previousVector && candidateVector
          ? cosineSimilarity(previousVector, candidateVector)
          : candidate.score;
        const blended = (continuity * 0.72) + (candidate.score * 0.28);
        return { blended, candidate };
      })
      .sort(
        (left, right) => right.blended - left.blended
          || right.candidate.score - left.candidate.score
          || (originalOrder.get(left.candidate.track_id)! - originalOrder.get(right.candidate.track_id)!),
      );

    const picked = scored[Math.min(scored.length - 1, Math.floor(random() * Math.min(scored.length, shortlistSize)))]!.candidate;
    ordered.push(picked);
    remaining.splice(remaining.findIndex((entry) => entry.track_id === picked.track_id), 1);
  }

  return ordered;
}

function summarizeRatingAnchors(ratings: Map<string, number>): { excluded: number; positive: number; strong: number } {
  let excluded = 0;
  let positive = 0;
  let strong = 0;
  for (const rating of ratings.values()) {
    if (rating <= 2) {
      excluded += 1;
    }
    if (rating >= 3) {
      positive += 1;
    }
    if (rating >= 4) {
      strong += 1;
    }
  }
  return { excluded, positive, strong };
}

async function resolveLatestFeaturesJsonl(classifiedPath: string): Promise<string | undefined> {
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

function extractYear(released: string): string | undefined {
  const match = released.match(/(19|20)\d{2}/);
  return match?.[0];
}

function getTerminalSize(stream: NodeJS.WritableStream): { columns: number; rows: number } {
  const terminal = stream as NodeJS.WritableStream & { columns?: number; rows?: number };
  return {
    columns: terminal.columns ?? 100,
    rows: terminal.rows ?? 32,
  };
}

function resolvePlaylistWindowRows(queueLength: number, terminalRows: number): number {
  const visibleRows = Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, terminalRows - STATION_SCREEN_RESERVED_ROWS);
  return Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, Math.min(queueLength, visibleRows));
}

function deriveStationBucketKey(sidPath: string): string {
  const segments = sidPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return sidPath;
  }

  const first = segments[0]!;
  const second = segments[1];
  if (["DEMOS", "GAMES", "MUSICIANS"].includes(first.toUpperCase()) && second) {
    return `${first}/${second}`;
  }
  return first;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "unknown";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTrackSummary(track: StationTrackDetails): string {
  const title = track.title || path.basename(track.sid_path);
  const author = track.author || "unknown author";
  return `${title} | ${author} | ${formatDuration(track.durationMs)} | ${track.sid_path}#${track.song_index}`;
}

function supportsAnsi(runtime: StationDemoRuntime): boolean {
  const stdout = runtime.stdout as NodeJS.WriteStream;
  return Boolean(stdout.isTTY && !runtime.prompt);
}

function colorize(enabled: boolean, color: string, value: string): string {
  if (!enabled) {
    return value;
  }
  return `${color}${value}${ANSI.reset}`;
}

function bold(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.bold, value);
}

function subtle(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.brightBlack, value);
}

function dim(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.dim, value);
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}

function formatPercent(elapsedMs: number, durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0%";
  }
  const ratio = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return `${Math.round(ratio * 100)}%`;
}

function renderProgressBar(enabled: boolean, elapsedMs: number, durationMs: number, width: number, filledColor: string): string {
  const safeWidth = Math.max(10, width);
  const ratio = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  const filled = Math.round(safeWidth * ratio);
  const full = enabled ? "█" : "#";
  const empty = enabled ? "░" : "-";
  const filledPart = full.repeat(filled);
  const emptyPart = empty.repeat(Math.max(0, safeWidth - filled));
  return `${colorize(enabled, filledColor, filledPart)}${colorize(enabled, ANSI.brightBlack, emptyPart)}`;
}

function renderLegend(enabled: boolean): string {
  return [
    `${colorize(enabled, ANSI.brightRed, "0")} dislike`,
    `${colorize(enabled, ANSI.brightRed, "1")} reject`,
    `${colorize(enabled, ANSI.brightYellow, "2")} weak fit`,
    `${colorize(enabled, ANSI.brightBlue, "3")} keep`,
    `${colorize(enabled, ANSI.brightGreen, "4")} strong fit`,
    `${colorize(enabled, ANSI.bold + ANSI.brightMagenta, "5")} station anchor`,
  ].join("  ");
}

function renderProgressLine(
  enabled: boolean,
  label: string,
  elapsedMs: number,
  durationMs: number,
  width: number,
  accentColor: string,
): string {
  const barWidth = Math.max(16, Math.min(36, width - 34));
  const labelText = colorize(enabled, accentColor, label);
  return truncate(
    `${labelText} [${renderProgressBar(enabled, elapsedMs, durationMs, barWidth, accentColor)}] ${formatDuration(elapsedMs)} / ${formatDuration(durationMs)} (${formatPercent(elapsedMs, durationMs)})`,
    width,
  );
}

function normalizeFilterQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function trackMatchesFilter(track: StationTrackDetails, filterQuery: string): boolean {
  const normalized = normalizeFilterQuery(filterQuery);
  if (!normalized) {
    return true;
  }
  const title = (track.title || path.basename(track.sid_path)).toLowerCase();
  const author = (track.author || "").toLowerCase();
  return title.includes(normalized) || author.includes(normalized);
}

function getFilteredTrackIndices(queue: StationTrackDetails[], filterQuery: string): number[] {
  const normalized = normalizeFilterQuery(filterQuery);
  if (!normalized) {
    return queue.map((_, index) => index);
  }

  const indices: number[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    if (trackMatchesFilter(queue[index]!, normalized)) {
      indices.push(index);
    }
  }
  return indices;
}

function clampSelectionToMatches(matches: number[], preferredIndex: number, fallbackIndex: number): number {
  if (matches.length === 0) {
    return Math.max(0, fallbackIndex);
  }
  if (matches.includes(preferredIndex)) {
    return preferredIndex;
  }
  if (matches.includes(fallbackIndex)) {
    return fallbackIndex;
  }

  let closest = matches[0]!;
  let closestDistance = Math.abs(closest - preferredIndex);
  for (const index of matches) {
    const distance = Math.abs(index - preferredIndex);
    if (distance < closestDistance) {
      closest = index;
      closestDistance = distance;
    }
  }
  return closest;
}

function moveSelectionInMatches(matches: number[], selectedIndex: number, delta: number): number | null {
  if (matches.length === 0) {
    return null;
  }
  const currentPosition = matches.indexOf(selectedIndex);
  const startPosition = currentPosition >= 0 ? currentPosition : 0;
  const nextPosition = Math.max(0, Math.min(matches.length - 1, startPosition + delta));
  return matches[nextPosition] ?? null;
}

function moveCurrentInMatches(matches: number[], currentIndex: number, direction: -1 | 1): number | null {
  if (matches.length === 0) {
    return null;
  }

  if (direction > 0) {
    for (const index of matches) {
      if (index > currentIndex) {
        return index;
      }
    }
    return matches[matches.length - 1] ?? null;
  }

  for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
    if (matches[matchIndex]! < currentIndex) {
      return matches[matchIndex] ?? null;
    }
  }
  return matches[0] ?? null;
}

function renderTrackWindow(
  enabled: boolean,
  queue: StationTrackDetails[],
  filteredIndices: number[],
  currentIndex: number,
  selectedIndex: number,
  windowStart: number,
  width: number,
  visibleRows: number,
): string[] {
  if (filteredIndices.length === 0) {
    const rows = Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, visibleRows);
    const lines = [truncate(subtle(enabled, "No playlist matches the current filter."), width)];
    while (lines.length < rows) {
      lines.push(subtle(enabled, "·"));
    }
    return lines;
  }
  const rows = Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, visibleRows);
  const clampedWindowStart = Math.max(0, Math.min(windowStart, Math.max(0, filteredIndices.length - rows)));
  const windowEnd = Math.min(filteredIndices.length, clampedWindowStart + rows);
  const lines: string[] = [];

  for (let matchPosition = clampedWindowStart; matchPosition < windowEnd; matchPosition += 1) {
    const index = filteredIndices[matchPosition]!;
    const isCurrent = index === currentIndex;
    const isSelected = index === selectedIndex;
    const track = queue[index]!;
    const title = track.title || path.basename(track.sid_path);
    const author = track.author || "unknown";
    const marker = isCurrent && isSelected
      ? colorize(enabled, ANSI.brightGreen, "◆")
      : isCurrent
        ? colorize(enabled, ANSI.brightGreen, "▶")
        : isSelected
          ? colorize(enabled, ANSI.brightYellow, "➜")
          : colorize(enabled, ANSI.brightBlack, "•");
    const position = `${String(index + 1).padStart(3, "0")}/${String(queue.length).padStart(3, "0")}`;
    const line = `${marker} ${position} ${title} — ${author} — ${formatDuration(track.durationMs)}`;
    const styledLine = isCurrent
      ? bold(enabled, colorize(enabled, ANSI.brightGreen, line))
      : isSelected
        ? colorize(enabled, ANSI.yellow, line)
        : subtle(enabled, line);
    lines.push(truncate(styledLine, width));
  }

  while (lines.length < rows) {
    lines.push(subtle(enabled, "·"));
  }

  return lines;
}

function renderStationScreen(state: StationScreenState, ansiEnabled: boolean, columns: number, rows: number): string {
  const width = Math.max(80, columns);
  const height = Math.max(24, rows);
  const title = bold(ansiEnabled, "SIDFlow Station Demo");
  const current = state.current;
  const elapsedMs = Math.min(state.elapsedMs ?? 0, state.durationMs ?? resolveTrackDurationMs(current));
  const durationMs = state.durationMs ?? resolveTrackDurationMs(current);
  const playlistElapsedMs = Math.min(state.playlistElapsedMs ?? 0, state.playlistDurationMs ?? durationMs);
  const playlistDurationMs = state.playlistDurationMs ?? durationMs;
  const selectedIndex = state.selectedIndex ?? state.index;
  const selectedTrack = state.queue?.[selectedIndex];
  const filterQuery = state.filterQuery ?? "";
  const filteredIndices = getFilteredTrackIndices(state.queue ?? [state.current], filterQuery);
  const filterBadge = filterQuery
    ? `${state.filterEditing ? "filtering" : "filter"} \"${filterQuery}\" (${filteredIndices.length}/${state.queue?.length ?? 1})`
    : "filter off";
  const titleLine = truncate(`${colorize(ansiEnabled, ANSI.green, current.title || path.basename(current.sid_path))} — ${current.author || "unknown author"}`, width);
  const playbackBadge = state.playbackMode === "none"
    ? colorize(ansiEnabled, ANSI.brightBlack, "silent")
    : colorize(ansiEnabled, ANSI.brightGreen, state.playbackMode);
  const pausedBadge = state.paused ? colorize(ansiEnabled, ANSI.brightYellow, "paused") : colorize(ansiEnabled, ANSI.brightBlack, "live");

  const lines = [
    title,
    `${subtle(ansiEnabled, state.phase === "rating" ? "seed capture" : "station playback")}  ${playbackBadge}  ${pausedBadge}`,
    "",
    bold(ansiEnabled, "Source"),
    `${subtle(ansiEnabled, "Dataset")} ${truncate(state.dataSource, width - 9)}`,
    `${subtle(ansiEnabled, "DB")} ${truncate(state.dbPath, width - 4)}`,
    ...(state.featuresJsonl ? [truncate(`${subtle(ansiEnabled, "Provenance")} ${state.featuresJsonl}`, width)] : []),
    "",
    bold(ansiEnabled, "Guide"),
    `${subtle(ansiEnabled, "Legend")} ${renderLegend(ansiEnabled)}`,
    `${subtle(ansiEnabled, "Best")} 5 locks the vibe in for future picks. 0 is a hard dislike.`,
    `${subtle(ansiEnabled, "Duration gate")} >= ${Math.max(1, state.minDurationSeconds ?? 15)}s`,
    "",
    `${bold(ansiEnabled, state.phase === "rating" ? `Rate songs until ${state.ratedTarget} are scored` : "Now Playing")}`,
    titleLine,
    truncate(`${current.sid_path}#${current.song_index}  |  ${current.released || "unknown release"}  |  e=${current.e} m=${current.m} c=${current.c}${current.p ? ` p=${current.p}` : ""}`, width),
    truncate(`Feedback  likes=${current.likes}  dislikes=${current.dislikes}  skips=${current.skips}  plays=${current.plays}`, width),
    renderProgressLine(ansiEnabled, "Song Progress", elapsedMs, durationMs, width, ANSI.brightGreen),
    renderProgressLine(ansiEnabled, "Playlist Pos ", playlistElapsedMs, playlistDurationMs, width, ANSI.brightCyan),
    truncate(`You rated ${state.ratedCount}/${state.ratedTarget}${state.currentRating !== undefined ? `  |  current=${state.currentRating}/5` : ""}`, width),
    "",
  ];

  if (state.phase === "rating") {
    lines.push(
      truncate(`${bold(ansiEnabled, `Seed ${state.index + 1}`)}  ${subtle(ansiEnabled, "Controls")} 1-5 rate  s skip  b back  r replay  q quit`, width),
      truncate(`${subtle(ansiEnabled, "Shortcuts")} l like(5)  d dislike(0)`, width),
      truncate(state.statusLine ?? "Skipped songs do not count. Keep rating until the target is reached.", width),
      truncate(state.hintLine ?? "", width),
    );
  } else {
    const selectionHint = state.hintLine ?? (
      selectedTrack && selectedTrack.track_id !== current.track_id
        ? `Selected ${selectedIndex + 1}/${state.total}: ${selectedTrack.title || path.basename(selectedTrack.sid_path)}`
        : "Selection is on the currently playing song."
    );
    const playlistRows = resolvePlaylistWindowRows(state.queue?.length ?? 1, height);
    lines.push(
      truncate(`${bold(ansiEnabled, `Station ${state.index + 1}/${state.total}`)}  ${subtle(ansiEnabled, "Controls")} ←/→ play prev/next  ↑/↓ browse  PgUp/PgDn jump  Enter play selected`, width),
      truncate(`${subtle(ansiEnabled, "Shortcuts")} / filter title/artist  space pause/resume  h shuffle  s skip=dislike  l like(5)  d dislike(0)  r replay  u rebuild  0-5 rate+rebuild  q quit`, width),
      truncate(`${subtle(ansiEnabled, "Filter")} ${filterBadge}${state.filterEditing ? "  Enter keep  Esc clear" : "  / edit  Esc clear"}`, width),
      truncate(state.statusLine ?? "Recommendations reflect the rated tracks shown above.", width),
      truncate(selectionHint, width),
      "",
      bold(ansiEnabled, `Playlist Window (${playlistRows} visible${filterQuery ? `, ${filteredIndices.length} filtered` : ""})`),
      ...renderTrackWindow(
        ansiEnabled,
        state.queue ?? [state.current],
        filteredIndices,
        state.index,
        selectedIndex,
        state.playlistWindowStart ?? 0,
        width,
        playlistRows,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

class ScreenRenderer {
  private readonly ansiEnabled: boolean;
  private firstPaint = true;

  constructor(private readonly runtime: StationDemoRuntime) {
    this.ansiEnabled = supportsAnsi(runtime);
  }

  render(state: StationScreenState): void {
    const { columns, rows } = getTerminalSize(this.runtime.stdout);
    const screen = renderStationScreen(state, this.ansiEnabled, columns, rows);

    if (this.ansiEnabled) {
      const prefix = this.firstPaint ? "\u001b[?25l" : "";
      this.runtime.stdout.write(`${prefix}\u001b[H\u001b[2J${screen}`);
      this.firstPaint = false;
      return;
    }

    this.runtime.stdout.write(screen);
  }

  close(): void {
    if (this.ansiEnabled) {
      this.runtime.stdout.write(`${ANSI.reset}\u001b[?25h`);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePromptResponse(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "left") {
    return "left";
  }
  if (trimmed === "right") {
    return "right";
  }
  if (trimmed === "up") {
    return "up";
  }
  if (trimmed === "down") {
    return "down";
  }
  if (trimmed === "pgup" || trimmed === "pageup") {
    return "pgup";
  }
  if (trimmed === "pgdn" || trimmed === "pagedown") {
    return "pgdn";
  }
  if (trimmed === "enter") {
    return "";
  }
  if (trimmed === "space") {
    return " ";
  }
  return trimmed;
}

function mapSeedToken(token: string): SeedAction | null {
  if (["q", "\u0003"].includes(token)) {
    return { type: "quit" };
  }
  if (["b", "left"].includes(token)) {
    return { type: "back" };
  }
  if (["r", "up"].includes(token)) {
    return { type: "replay" };
  }
  if (["l", "+"].includes(token)) {
    return { type: "rate", rating: 5 };
  }
  if (["d", "x"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  if (["s", "right", "down", ""].includes(token)) {
    return { type: "skip" };
  }
  const rating = Number.parseInt(token, 10);
  if (Number.isInteger(rating) && rating >= 0 && rating <= 5) {
    return { type: "rate", rating };
  }
  return null;
}

function mapStationToken(token: string): StationAction | null {
  if (["q", "\u0003"].includes(token)) {
    return { type: "quit" };
  }
  if (["right", "n"].includes(token)) {
    return { type: "next" };
  }
  if (["left", "b"].includes(token)) {
    return { type: "back" };
  }
  if (["up", "k"].includes(token)) {
    return { type: "cursorUp" };
  }
  if (["down", "j"].includes(token)) {
    return { type: "cursorDown" };
  }
  if (["pgup"].includes(token)) {
    return { type: "pageUp" };
  }
  if (["pgdn"].includes(token)) {
    return { type: "pageDown" };
  }
  if (token === "") {
    return { type: "playSelected" };
  }
  if (token === " ") {
    return { type: "togglePause" };
  }
  if (["/", "f"].includes(token)) {
    return { type: "setFilter", value: "", editing: true };
  }
  if (["h"].includes(token)) {
    return { type: "shuffle" };
  }
  if (["r"].includes(token)) {
    return { type: "replay" };
  }
  if (["s"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  if (["u"].includes(token)) {
    return { type: "rebuild" };
  }
  if (["l", "+"].includes(token)) {
    return { type: "rate", rating: 5 };
  }
  if (["d", "x"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  const rating = Number.parseInt(token, 10);
  if (Number.isInteger(rating) && rating >= 0 && rating <= 5) {
    return { type: "rate", rating };
  }
  return null;
}

class PromptInputController implements InputController {
  constructor(private readonly ask: (message: string) => Promise<string>) {}

  close(): void {
    return;
  }

  async readSeedAction(): Promise<SeedAction> {
    while (true) {
      const answer = normalizePromptResponse(await this.ask("Rate 0-5, l=like, d=dislike, s=skip, b=back, r=replay, q=quit > "));
      const action = mapSeedToken(answer);
      if (action) {
        return action;
      }
    }
  }

  async readStationAction(_timeoutMs: number): Promise<StationAction> {
    while (true) {
      const answer = normalizePromptResponse(
        await this.ask("Command / filter, left/right/up/down/pgup/pgdn, enter=play, space=pause, h=shuffle, s=skip-dislike, l=like, d=dislike, r=replay, u=rebuild, 0-5=rate, q=quit > "),
      );
      if (["/", "f"].includes(answer)) {
        const filterValue = await this.ask("Filter title/artist (blank clears) > ");
        return { type: "setFilter", value: filterValue, editing: false };
      }
      const action = mapStationToken(answer);
      if (action) {
        return action;
      }
    }
  }
}

function decodeTerminalInput(chunk: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    const remainder = chunk.slice(index);
    if (remainder.startsWith("\u001b[5~")) {
      tokens.push("pgup");
      index += 4;
      continue;
    }
    if (remainder.startsWith("\u001b[6~")) {
      tokens.push("pgdn");
      index += 4;
      continue;
    }
    if (remainder.startsWith("\u001b[C")) {
      tokens.push("right");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[D")) {
      tokens.push("left");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[A")) {
      tokens.push("up");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[B")) {
      tokens.push("down");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b")) {
      tokens.push("escape");
      index += 1;
      continue;
    }
    const char = chunk[index];
    if (char === " ") {
      tokens.push(" ");
      index += 1;
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      tokens.push("backspace");
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      tokens.push("");
    } else {
      tokens.push(char.toLowerCase());
    }
    index += 1;
  }
  return tokens;
}

class RawInputController implements InputController {
  private readonly stdin: NodeJS.ReadStream;
  private readonly queue: string[] = [];
  private readonly handleData: (chunk: string) => void;
  private closed = false;
  private filterEditing = false;
  private filterBuffer = "";

  constructor(runtime: StationDemoRuntime) {
    this.stdin = runtime.stdin as NodeJS.ReadStream;
    this.handleData = (chunk: string) => {
      this.queue.push(...decodeTerminalInput(chunk));
    };

    this.stdin.setEncoding("utf8");
    this.stdin.setRawMode?.(true);
    this.stdin.resume();
    this.stdin.on("data", this.handleData);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stdin.off("data", this.handleData);
    this.stdin.setRawMode?.(false);
    this.stdin.pause();
  }

  private async nextMappedAction<T>(timeoutMs: number | null, mapper: (token: string) => T | null, onTick?: () => void): Promise<T | null> {
    const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
    while (true) {
      while (this.queue.length > 0) {
        const action = mapper(this.queue.shift()!);
        if (action) {
          return action;
        }
      }

      if (deadline !== null && Date.now() >= deadline) {
        return null;
      }

      onTick?.();
      const remaining = deadline === null ? 120 : Math.max(20, Math.min(120, deadline - Date.now()));
      await sleep(remaining);
    }
  }

  async readSeedAction(): Promise<SeedAction> {
    const action = await this.nextMappedAction<SeedAction>(null, mapSeedToken);
    return action ?? { type: "quit" };
  }

  async readStationAction(timeoutMs: number, onTick?: () => void): Promise<StationAction> {
    const action = await this.nextMappedAction<StationAction>(
      timeoutMs,
      (token) => {
        if (this.filterEditing) {
          if (token === "\u0003") {
            return { type: "quit" };
          }
          if (token === "escape") {
            this.filterEditing = false;
            this.filterBuffer = "";
            return { type: "setFilter", value: "", editing: false };
          }
          if (token === "") {
            this.filterEditing = false;
            return { type: "setFilter", value: this.filterBuffer, editing: false };
          }
          if (token === "backspace") {
            this.filterBuffer = this.filterBuffer.slice(0, -1);
            return { type: "setFilter", value: this.filterBuffer, editing: true };
          }
          if (token.length === 1 && token >= " ") {
            this.filterBuffer += token;
            return { type: "setFilter", value: this.filterBuffer, editing: true };
          }
          return null;
        }

        if (["/", "f"].includes(token)) {
          this.filterEditing = true;
          return { type: "setFilter", value: this.filterBuffer, editing: true };
        }

        return mapStationToken(token);
      },
      onTick,
    );
    return action ?? { type: "timeout" };
  }
}

function createInputController(runtime: StationDemoRuntime): InputController {
  if (runtime.prompt) {
    return new PromptInputController(runtime.prompt);
  }

  const stdout = runtime.stdout as NodeJS.WriteStream;
  const stdin = runtime.stdin as NodeJS.ReadStream;
  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error("Interactive station demo requires a TTY unless a prompt override is provided");
  }

  return new RawInputController(runtime);
}

async function createPlaybackAdapter(
  mode: PlaybackMode,
  config: SidflowConfig,
  options: StationDemoCliOptions,
): Promise<PlaybackAdapter> {
  if (mode === "none") {
    return new NoopPlaybackAdapter();
  }

  if (mode === "local") {
    const sidplayPath = options.sidplayPath ?? config.sidplayPath;
    if (!sidplayPath) {
      throw new Error("Local playback requires sidplayPath in config or --sidplay-path");
    }
    return new LocalSidplayPlaybackAdapter(sidplayPath);
  }

  const ultimate64 = config.render?.ultimate64;
  const host = options.c64uHost ?? ultimate64?.host;
  const https = options.c64uHttps ?? ultimate64?.https;
  const password = options.c64uPassword ?? ultimate64?.password;

  if (!host) {
    throw new Error("C64U playback requires render.ultimate64.host in config or --c64u-host");
  }

  return new Ultimate64PlaybackAdapter(
    new Ultimate64Client({
      host,
      https,
      password,
    }),
  );
}

async function resolveTrackDetails(
  track: StationTrackRow,
  hvscRoot: string,
  runtime: MetadataResolver,
  cache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails> {
  const absolutePath = await resolvePlayableSidPath(hvscRoot, track.sid_path);

  if (!cache.has(track.sid_path)) {
    cache.set(
      track.sid_path,
      (async () => {
        try {
          const metadata = await runtime.parseSidFile(absolutePath);
          const durationMs = await runtime.lookupSongDurationMs(absolutePath, hvscRoot, track.song_index, hvscRoot);
          return { metadata, durationMs };
        } catch {
          return {};
        }
      })(),
    );
  }

  const resolved = await cache.get(track.sid_path)!;
  const metadata = resolved.metadata;
  return {
    ...track,
    absolutePath,
    title: metadata?.title ?? path.basename(track.sid_path),
    author: metadata?.author ?? "",
    released: metadata?.released ?? "",
    year: metadata ? extractYear(metadata.released) : undefined,
    durationMs: resolved.durationMs,
    songs: metadata?.songs,
  };
}

async function resolvePlayableSidPath(hvscRoot: string, sidPath: string): Promise<string> {
  const candidates = [
    path.resolve(hvscRoot, sidPath),
    path.resolve(hvscRoot, "C64Music", sidPath),
    path.resolve(hvscRoot, "update", sidPath),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`SID file not found under ${hvscRoot}: ${sidPath}`);
}

class NoopPlaybackAdapter implements PlaybackAdapter {
  async start(_track: StationTrackDetails): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }

  async pause(): Promise<void> {
    return;
  }

  async resume(): Promise<void> {
    return;
  }
}

class LocalSidplayPlaybackAdapter implements PlaybackAdapter {
  private current: ChildProcess | null = null;
  private paused = false;

  constructor(private readonly sidplayPath: string) {}

  async start(track: StationTrackDetails): Promise<void> {
    await this.stop();
    const { spawn } = await import("node:child_process");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderr = "";
      const proc = spawn(this.sidplayPath, buildSidplayArgs(track), {
        stdio: ["ignore", "ignore", "pipe"],
      });

      this.current = proc;
      this.paused = false;

      const startupTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 300);

      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.once("error", (error) => {
        this.current = null;
        clearTimeout(startupTimer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      proc.once("exit", (code) => {
        if (this.current === proc) {
          this.current = null;
        }

        clearTimeout(startupTimer);
        if (!settled) {
          settled = true;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`sidplayfp exited with code ${code}: ${stderr.trim()}`));
          }
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.current) {
      this.paused = false;
      return;
    }

    const proc = this.current;
    this.current = null;
    this.paused = false;
    if (proc.exitCode !== null) {
      return;
    }
    proc.kill("SIGTERM");
  }

  async pause(): Promise<void> {
    if (!this.current || this.paused || this.current.exitCode !== null) {
      return;
    }
    this.current.kill("SIGSTOP");
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.current || !this.paused || this.current.exitCode !== null) {
      return;
    }
    this.current.kill("SIGCONT");
    this.paused = false;
  }
}

class Ultimate64PlaybackAdapter implements PlaybackAdapter {
  private sidVolumes: Uint8Array = Uint8Array.from([0x0f, 0x0f, 0x0f]);
  private paused = false;

  constructor(private readonly client: Ultimate64Client) {}

  async start(track: StationTrackDetails): Promise<void> {
    const buffer = await readFile(track.absolutePath);
    this.paused = false;
    await this.client.sidplay({ sidBuffer: buffer, songNumber: track.song_index });
  }

  async stop(): Promise<void> {
    this.paused = false;
    await this.client.reset();
  }

  async pause(): Promise<void> {
    if (this.paused) {
      return;
    }

    try {
      this.sidVolumes = await this.captureSidVolumes();
    } catch {
      // Keep the most recent known values if the machine cannot serve memory reads.
    }

    await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        await this.client.writeMemory({ address, data: new Uint8Array([this.sidVolumes[index]! & 0xf0]) });
      }),
    );
    await this.client.pause();
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.paused) {
      return;
    }
    await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        await this.client.writeMemory({ address, data: new Uint8Array([this.sidVolumes[index]]) });
      }),
    );
    await this.client.resume();
    this.paused = false;
  }

  private async captureSidVolumes(): Promise<Uint8Array> {
    const values = await Promise.all(
      U64_SID_VOLUME_REGISTERS.map(async (address, index) => {
        try {
          const data = await this.client.readMemory({ address, length: 1 });
          return data[0] ?? this.sidVolumes[index] ?? 0x0f;
        } catch {
          return this.sidVolumes[index] ?? 0x0f;
        }
      }),
    );
    return Uint8Array.from(values);
  }
}

async function buildStationQueue(
  dbPath: string,
  hvscRoot: string,
  ratings: Map<string, number>,
  stationSize: number,
  adventure: number,
  minDurationSeconds: number,
  runtime: StationDemoRuntime,
  metadataCache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails[]> {
  const favoriteTrackIds = pickFavoriteTrackIds(ratings);
  if (favoriteTrackIds.length === 0) {
    return [];
  }

  const excludeTrackIds = [...ratings.entries()].filter(([, rating]) => rating <= 2).map(([trackId]) => trackId);
  const recommendationLimitFloor = Math.max(stationSize * (3 + adventure), stationSize + 128);
  let recommendationLimit = recommendationLimitFloor;
  let details: StationTrackDetails[] = [];
  let previousCandidateCount = -1;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidates = recommendFromFavorites(dbPath, {
      favoriteTrackIds,
      excludeTrackIds,
      weightsByTrackId: buildWeightsByTrackId(ratings),
      limit: recommendationLimit,
    });

    if (candidates.length === previousCandidateCount) {
      break;
    }
    previousCandidateCount = candidates.length;

    const detailByTrackId = new Map<string, StationTrackDetails>();
    const filteredCandidates: SimilarityExportRecommendation[] = [];
    for (const recommendation of candidates) {
      const row = readTrackRowById(dbPath, recommendation.track_id);
      if (!row) {
        continue;
      }
      const detail = await resolveTrackDetails(row, hvscRoot, runtime, metadataCache);
      if (!isTrackLongEnough(detail, minDurationSeconds)) {
        continue;
      }
      detailByTrackId.set(detail.track_id, detail);
      filteredCandidates.push(recommendation);
    }

    const chosen = chooseStationTracks(filteredCandidates, stationSize, adventure, runtime.random);
    const orderedChosen = orderStationTracksByFlow(
      chosen,
      readTrackVectorsByIds(dbPath, chosen.map((recommendation) => recommendation.track_id)),
      adventure,
      runtime.random,
    );
    const nextDetails: StationTrackDetails[] = [];
    for (const recommendation of orderedChosen) {
      const detail = detailByTrackId.get(recommendation.track_id);
      if (detail) {
        nextDetails.push(detail);
      }
    }

    if (nextDetails.length > details.length) {
      details = nextDetails;
    }
    if (details.length >= stationSize || candidates.length < recommendationLimit) {
      break;
    }
    recommendationLimit = Math.max(recommendationLimit + stationSize, recommendationLimit * 2);
  }

  return details;
}

function mergeQueueKeepingCurrent(
  current: StationTrackDetails,
  rebuilt: StationTrackDetails[],
  currentIndex: number,
): { queue: StationTrackDetails[]; index: number } {
  const deduped = rebuilt.filter((track) => track.track_id !== current.track_id);
  const nextIndex = Math.min(currentIndex, deduped.length);
  deduped.splice(nextIndex, 0, current);
  return { queue: deduped, index: nextIndex };
}

function shuffleQueueKeepingCurrent(
  queue: StationTrackDetails[],
  currentIndex: number,
  random: () => number,
): StationTrackDetails[] {
  if (queue.length <= 2) {
    return [...queue];
  }

  const current = queue[currentIndex]!;
  const tail = [...queue.slice(0, currentIndex), ...queue.slice(currentIndex + 1)];
  for (let index = tail.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const next = tail[index]!;
    tail[index] = tail[swapIndex]!;
    tail[swapIndex] = next;
  }
  return [current, ...tail];
}

function sumPlaylistDurationMs(queue: StationTrackDetails[]): number {
  return queue.reduce((total, track) => total + resolveTrackDurationMs(track), 0);
}

function resolvePlaylistPositionMs(
  queue: StationTrackDetails[],
  currentIndex: number,
  currentElapsedMs: number,
): number {
  const beforeCurrent = queue.slice(0, currentIndex).reduce((total, track) => total + resolveTrackDurationMs(track), 0);
  return beforeCurrent + Math.max(0, Math.min(currentElapsedMs, resolveTrackDurationMs(queue[currentIndex] ?? queue[0]!)));
}

function buildInitialSeedStatus(
  dataSource: string,
  dbPath: string,
  playbackMode: PlaybackMode,
  adventure: number,
  ratedCount: number,
  ratedTarget: number,
  current: StationTrackDetails,
  currentRating: number | undefined,
  featuresJsonl: string | undefined,
  index: number,
  minDurationSeconds: number,
): StationScreenState {
  return {
    phase: "rating",
    current,
    index,
    total: ratedTarget,
    ratedCount,
    ratedTarget,
    ratings: new Map(),
    playbackMode,
    adventure,
    dataSource,
    dbPath,
    featuresJsonl,
    currentRating,
    durationMs: resolveTrackDurationMs(current),
    minDurationSeconds,
    elapsedMs: 0,
  };
}

export async function runStationDemoCli(
  argv: string[],
  overrides?: Partial<StationDemoRuntime>,
): Promise<number> {
  const runtime = mergeRuntime(overrides);
  const result = parseStationDemoArgs(argv);
  const exitCode = handleParseResult(result, HELP_TEXT, runtime.stdout, runtime.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  const playbackMode = resolvePlaybackMode(options);
  if (!playbackMode) {
    runtime.stderr.write("Error: --playback must be local, c64u, or none\n");
    return 1;
  }

  const config = await runtime.loadConfig(options.config);
  const hvscRoot = path.resolve(runtime.cwd(), options.hvsc ?? config.sidPath);
  let dataset: StationDatasetResolution;
  try {
    dataset = await resolveStationDataset(runtime, options, config);
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  }
  const { dataSource, dbPath, featuresJsonl } = dataset;

  if (!(await pathExists(dbPath))) {
    runtime.stderr.write(`Error: similarity export database not found at ${dbPath}\n`);
    return 1;
  }

  if (!(await pathExists(hvscRoot))) {
    runtime.stderr.write(`Error: SID collection root not found at ${hvscRoot}\n`);
    return 1;
  }

  const exportInfo = inspectExportDatabase(dbPath);
  if (!exportInfo.hasTrackIdentity) {
    runtime.stderr.write(
      `Error: ${dbPath} is an older similarity export schema without track-level identity columns (track_id, song_index).\n`,
    );
    runtime.stderr.write("Build or point to a newer Phase 5 similarity export before running the station demo.\n");
    return 1;
  }
  if (!exportInfo.hasVectorData) {
    runtime.stderr.write(`Error: ${dbPath} does not contain vector_json data, so station recommendations cannot be rebuilt.\n`);
    return 1;
  }
  if (exportInfo.trackCount === 0) {
    runtime.stderr.write("Error: export database does not contain any tracks\n");
    return 1;
  }

  const input = createInputController(runtime);
  const renderer = new ScreenRenderer(runtime);
  const playback = runtime.createPlaybackAdapter
    ? await runtime.createPlaybackAdapter(playbackMode, config, options)
    : await createPlaybackAdapter(playbackMode, config, options);
  const metadataCache = new Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>();
  const ratedTarget = Math.max(MINIMUM_RATED_TRACKS, options.sampleSize ?? MINIMUM_RATED_TRACKS);
  const stationTarget = Math.max(MINIMUM_STATION_TRACKS, options.stationSize ?? MINIMUM_STATION_TRACKS);
  const minDurationSeconds = Math.max(1, options.minDuration ?? 15);
  const selectionStatePath = buildSelectionStatePath(runtime.cwd(), dbPath, hvscRoot);

  if (options.resetSelections) {
    await rm(selectionStatePath, { force: true });
  }

  const stopPlayback = async (): Promise<void> => {
    try {
      await playback.stop();
    } catch {
      // ignore cleanup errors
    }
  };

  const pausePlayback = async (): Promise<void> => {
    try {
      await playback.pause();
    } catch {
      // ignore pause errors
    }
  };

  const resumePlayback = async (): Promise<void> => {
    try {
      await playback.resume();
    } catch {
      // ignore resume errors
    }
  };

  let interrupted = false;
  const handleSigint = (): void => {
    interrupted = true;
    void stopPlayback();
  };

  runtime.onSignal("SIGINT", handleSigint);

  try {
    const ratings = options.resetSelections
      ? new Map<string, number>()
      : await readPersistedStationSelections(selectionStatePath, dbPath, hvscRoot);
    const seenTrackIds = new Set<string>();
    const seeds: StationTrackDetails[] = [];
    let seedIndex = 0;
    const reusedPersistedRatings = !options.resetSelections && ratings.size >= ratedTarget;
    let seedStatus = reusedPersistedRatings
      ? `Reused ${ratings.size} persisted ratings. Starting the station immediately.`
      : ratings.size > 0
        ? `Loaded ${ratings.size} persisted ratings. Keep rating until ${ratedTarget} songs are scored.`
        : options.resetSelections
          ? "Cleared persisted ratings. Keep rating until the target is reached."
          : "Skipped songs do not count. Keep rating until the target is reached.";

    while (!interrupted && ratings.size < ratedTarget) {
      if (seedIndex >= seeds.length) {
        const batchSize = Math.max(12, (ratedTarget - ratings.size) * 3);
        const nextRows = readRandomTracksExcluding(dbPath, batchSize, seenTrackIds);
        if (nextRows.length === 0) {
          break;
        }
        for (const row of nextRows) {
          if (seenTrackIds.has(row.track_id)) {
            continue;
          }
          seenTrackIds.add(row.track_id);
          const resolved = await resolveTrackDetails(row, hvscRoot, runtime, metadataCache);
          if (!isTrackLongEnough(resolved, minDurationSeconds)) {
            continue;
          }
          seeds.push(resolved);
        }
      }

      if (seedIndex >= seeds.length) {
        break;
      }

      const current = seeds[seedIndex];
      let startedAt = Date.now();
      await playback.start(current);

      while (!interrupted) {
        const elapsedMs = Date.now() - startedAt;
        const currentRating = ratings.get(current.track_id);
        renderer.render({
          ...buildInitialSeedStatus(
            dataSource,
            dbPath,
            playbackMode,
            options.adventure ?? 3,
            ratings.size,
            ratedTarget,
            current,
            currentRating,
            featuresJsonl,
            seedIndex,
            minDurationSeconds,
          ),
          ratings,
          statusLine: seedStatus,
          hintLine: `Seen ${seenTrackIds.size}/${exportInfo.trackCount} tracks so far.`,
          elapsedMs,
        });

        const action = await input.readSeedAction();
        if (action.type === "quit") {
          renderer.render({
            ...buildInitialSeedStatus(
              dataSource,
              dbPath,
              playbackMode,
              options.adventure ?? 3,
              ratings.size,
              ratedTarget,
              current,
              ratings.get(current.track_id),
              featuresJsonl,
              seedIndex,
              minDurationSeconds,
            ),
            ratings,
            statusLine: "Session ended.",
            elapsedMs: Date.now() - startedAt,
          });
          return 0;
        }
        if (action.type === "replay") {
          await stopPlayback();
          await playback.start(current);
          startedAt = Date.now();
          seedStatus = `Replaying ${current.title || path.basename(current.sid_path)}.`;
          continue;
        }
        if (action.type === "back") {
          await stopPlayback();
          seedIndex = Math.max(0, seedIndex - 1);
          seedStatus = "Moved back to the previous seed.";
          break;
        }
        if (action.type === "skip") {
          ratings.delete(current.track_id);
          await stopPlayback();
          seedIndex += 1;
          seedStatus = "Skipped. It does not count toward the station target.";
          break;
        }

        ratings.set(current.track_id, action.rating);
        await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
        await stopPlayback();
        seedIndex += 1;
        seedStatus = action.rating === 5
          ? `Liked ${current.title || path.basename(current.sid_path)}.`
          : action.rating === 0
            ? `Disliked ${current.title || path.basename(current.sid_path)}.`
            : `Stored ${action.rating}/5 for ${current.title || path.basename(current.sid_path)}.`;
        break;
      }
    }

    if (ratings.size < ratedTarget) {
      runtime.stderr.write(
        `Error: only ${ratings.size} songs were rated before the export ran out of unseen tracks that satisfy the ${minDurationSeconds}s minimum; the target is ${ratedTarget}.\n`,
      );
      return 1;
    }

    let stationQueue = await buildStationQueue(
      dbPath,
      hvscRoot,
      ratings,
      stationTarget,
      options.adventure ?? 3,
      minDurationSeconds,
      runtime,
      metadataCache,
    );

    if (stationQueue.length === 0) {
      runtime.stderr.write("Error: no station candidates were produced from the supplied ratings\n");
      return 1;
    }
    if (stationQueue.length < stationTarget) {
      runtime.stderr.write(
        `Error: only ${stationQueue.length} long-enough station tracks were available; at least ${stationTarget} are required for the playlist.\n`,
      );
      return 1;
    }

    let stationIndex = 0;
    let selectedIndex = 0;
    let playlistWindowStart = 0;
    let stationFilter = "";
    let filterEditing = false;
    const initialSummary = summarizeRatingAnchors(ratings);
    let stationStatus = reusedPersistedRatings
      ? `Reused ${ratings.size} persisted ratings. Station ready immediately (${initialSummary.strong} strong anchors, ${initialSummary.excluded} excluded dislikes). Flow is sequenced by similarity.`
      : `Station ready from ${ratings.size} ratings (${initialSummary.strong} strong anchors, ${initialSummary.excluded} excluded dislikes). Flow is sequenced by similarity.`;

    while (!interrupted && stationQueue.length > 0) {
      const current = stationQueue[stationIndex];
      const durationMs = resolveTrackDurationMs(current);
      let elapsedBeforePauseMs = 0;
      let startedAt = Date.now();
      let paused = false;
      await playback.start(current);

      while (!interrupted) {
        const getCurrentElapsedMs = () => (
          paused
            ? elapsedBeforePauseMs
            : Math.min(durationMs, elapsedBeforePauseMs + (Date.now() - startedAt))
        );
        const render = () => {
          const terminalSize = getTerminalSize(runtime.stdout);
          const liveElapsedMs = getCurrentElapsedMs();
          const livePlaylistDurationMs = sumPlaylistDurationMs(stationQueue);
          const livePlaylistElapsedMs = resolvePlaylistPositionMs(stationQueue, stationIndex, liveElapsedMs);
          const filteredIndices = getFilteredTrackIndices(stationQueue, stationFilter);
          const effectiveSelectedIndex = clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex);
          const playlistRows = resolvePlaylistWindowRows(stationQueue.length, terminalSize.rows);
          playlistWindowStart = resolvePlaylistWindowStart(filteredIndices, effectiveSelectedIndex, playlistRows, playlistWindowStart);
          const selectedTrack = stationQueue[effectiveSelectedIndex];
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            selectedIndex: effectiveSelectedIndex,
            playlistWindowStart,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dataSource,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: liveElapsedMs,
            durationMs,
            playlistElapsedMs: livePlaylistElapsedMs,
            playlistDurationMs: livePlaylistDurationMs,
            filterQuery: stationFilter,
            filterEditing,
            filterMatchCount: filteredIndices.length,
            paused,
            statusLine: stationStatus,
            hintLine: selectedTrack && selectedTrack.track_id !== current.track_id
              ? `Selected ${effectiveSelectedIndex + 1}/${stationQueue.length}: ${selectedTrack.title || path.basename(selectedTrack.sid_path)}`
              : `Playhead ${stationIndex + 1}/${stationQueue.length}. Browse with ↑/↓/PgUp/PgDn, Enter plays the selected track.`,
          });
        };

        render();
        const currentElapsedMs = getCurrentElapsedMs();
        const remainingMs = paused ? 86_400_000 : Math.max(1, durationMs - currentElapsedMs);
        const action = await input.readStationAction(remainingMs, render);
        render();

        if (action.type === "timeout") {
          await stopPlayback();
          if (stationQueue.length === 1) {
            startedAt = Date.now();
            elapsedBeforePauseMs = 0;
            paused = false;
            await playback.start(current);
            stationStatus = "Only one track is available, replaying it.";
            continue;
          }
          stationIndex = Math.min(stationQueue.length - 1, stationIndex + 1);
          selectedIndex = stationIndex;
          stationStatus = "Advanced to the next track.";
          break;
        }

        if (action.type === "quit") {
          const liveElapsedMs = getCurrentElapsedMs();
          const livePlaylistDurationMs = sumPlaylistDurationMs(stationQueue);
          const livePlaylistElapsedMs = resolvePlaylistPositionMs(stationQueue, stationIndex, liveElapsedMs);
          const filteredIndices = getFilteredTrackIndices(stationQueue, stationFilter);
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            selectedIndex: clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex),
            playlistWindowStart,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dataSource,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: liveElapsedMs,
            durationMs,
            playlistElapsedMs: livePlaylistElapsedMs,
            playlistDurationMs: livePlaylistDurationMs,
            filterQuery: stationFilter,
            filterEditing,
            filterMatchCount: filteredIndices.length,
            paused,
            statusLine: "Station session ended.",
          });
          return 0;
        }

        if (action.type === "replay") {
          await stopPlayback();
          await playback.start(current);
          startedAt = Date.now();
          elapsedBeforePauseMs = 0;
          paused = false;
          selectedIndex = clampSelectionToMatches(getFilteredTrackIndices(stationQueue, stationFilter), stationIndex, stationIndex);
          playlistWindowStart = 0;
          stationStatus = `Replaying ${current.title || path.basename(current.sid_path)}.`;
          continue;
        }

        if (action.type === "setFilter") {
          stationFilter = normalizeFilterQuery(action.value);
          filterEditing = action.editing;
          const filteredIndices = getFilteredTrackIndices(stationQueue, stationFilter);
          if (filteredIndices.length > 0) {
            selectedIndex = clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex);
            playlistWindowStart = resolvePlaylistWindowStart(
              filteredIndices,
              selectedIndex,
              resolvePlaylistWindowRows(stationQueue.length, getTerminalSize(runtime.stdout).rows),
              playlistWindowStart,
            );
            stationStatus = stationFilter
              ? `Filtering playlist by \"${stationFilter}\" (${filteredIndices.length}/${stationQueue.length} matches).`
              : "Cleared the playlist filter.";
          } else {
            playlistWindowStart = 0;
            stationStatus = stationFilter
              ? `No playlist matches for \"${stationFilter}\". Press Esc or / to adjust the filter.`
              : "Cleared the playlist filter.";
          }
          continue;
        }

        const filteredIndices = getFilteredTrackIndices(stationQueue, stationFilter);

        if (action.type === "next") {
          const nextIndex = stationFilter
            ? moveCurrentInMatches(filteredIndices, stationIndex, 1)
            : Math.min(stationQueue.length - 1, stationIndex + 1);
          if (nextIndex === null || nextIndex === stationIndex) {
            stationStatus = stationFilter
              ? `Already at the end of the filtered playlist for \"${stationFilter}\".`
              : "Already at the end of the station playlist.";
            continue;
          }
          await stopPlayback();
          stationIndex = nextIndex;
          selectedIndex = stationIndex;
          playlistWindowStart = 0;
          stationStatus = "Moved to the next station track.";
          break;
        }

        if (action.type === "back") {
          const previousIndex = stationFilter
            ? moveCurrentInMatches(filteredIndices, stationIndex, -1)
            : Math.max(0, stationIndex - 1);
          if (previousIndex === null || previousIndex === stationIndex) {
            stationStatus = stationFilter
              ? `Already at the start of the filtered playlist for \"${stationFilter}\".`
              : "Already at the start of the station playlist.";
            continue;
          }
          await stopPlayback();
          stationIndex = previousIndex;
          selectedIndex = stationIndex;
          playlistWindowStart = 0;
          stationStatus = "Moved to the previous station track.";
          break;
        }

        if (action.type === "cursorUp") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, -1) ?? selectedIndex
            : Math.max(0, selectedIndex - 1);
          stationStatus = `Selected track ${selectedIndex + 1}/${stationQueue.length} without interrupting playback.`;
          continue;
        }

        if (action.type === "cursorDown") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, 1) ?? selectedIndex
            : Math.min(stationQueue.length - 1, selectedIndex + 1);
          stationStatus = `Selected track ${selectedIndex + 1}/${stationQueue.length} without interrupting playback.`;
          continue;
        }

        if (action.type === "pageUp") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, -1) ?? selectedIndex
            : Math.max(0, selectedIndex - 10);
          stationStatus = `Jumped selection to track ${selectedIndex + 1}/${stationQueue.length}.`;
          continue;
        }

        if (action.type === "pageDown") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, 1) ?? selectedIndex
            : Math.min(stationQueue.length - 1, selectedIndex + 10);
          stationStatus = `Jumped selection to track ${selectedIndex + 1}/${stationQueue.length}.`;
          continue;
        }

        if (action.type === "playSelected") {
          if (filteredIndices.length === 0) {
            stationStatus = stationFilter
              ? `No playlist matches for \"${stationFilter}\". Press Esc or / to adjust the filter.`
              : "The playlist is empty.";
            continue;
          }
          if (selectedIndex === stationIndex) {
            stationStatus = paused
              ? "Selection is already paused on the current song. Press space to resume."
              : "Selection is already the live song.";
            continue;
          }
          await stopPlayback();
          stationIndex = selectedIndex;
          playlistWindowStart = 0;
          stationStatus = `Started selected track ${stationIndex + 1}/${stationQueue.length}.`;
          break;
        }

        if (action.type === "togglePause") {
          if (paused) {
            await resumePlayback();
            startedAt = Date.now();
            paused = false;
            stationStatus = `Resumed ${current.title || path.basename(current.sid_path)}.`;
          } else {
            elapsedBeforePauseMs = currentElapsedMs;
            await pausePlayback();
            paused = true;
            stationStatus = `Paused ${current.title || path.basename(current.sid_path)}.`;
          }
          continue;
        }

        if (action.type === "shuffle") {
          stationQueue = shuffleQueueKeepingCurrent(stationQueue, stationIndex, runtime.random);
          stationIndex = 0;
          selectedIndex = clampSelectionToMatches(getFilteredTrackIndices(stationQueue, stationFilter), 0, 0);
          playlistWindowStart = 0;
          stationStatus = "Shuffled the remaining playlist around the current song.";
          continue;
        }

        if (action.type === "rate") {
          ratings.set(current.track_id, action.rating);
          const rebuilt = await buildStationQueue(
            dbPath,
            hvscRoot,
            ratings,
            stationTarget,
            options.adventure ?? 3,
            minDurationSeconds,
            runtime,
            metadataCache,
          );
          if (rebuilt.length >= stationTarget) {
            const merged = mergeQueueKeepingCurrent(current, rebuilt, stationIndex);
            stationQueue = merged.queue;
            stationIndex = merged.index;
            selectedIndex = clampSelectionToMatches(getFilteredTrackIndices(stationQueue, stationFilter), stationIndex, stationIndex);
            playlistWindowStart = 0;
            await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
            const rebuiltSummary = summarizeRatingAnchors(ratings);
            stationStatus = action.rating === 5
              ? `Liked this track. Rebuilt from ${ratings.size} ratings; current song pinned, remaining queue re-sequenced by similarity (${rebuiltSummary.strong} strong anchors, ${rebuiltSummary.excluded} excluded dislikes).`
              : action.rating === 0
                ? `Disliked this track. Rebuilt from ${ratings.size} ratings; current song pinned, remaining queue re-sequenced by similarity (${rebuiltSummary.strong} strong anchors, ${rebuiltSummary.excluded} excluded dislikes).`
                : `Stored ${action.rating}/5. Rebuilt from ${ratings.size} ratings; current song pinned, remaining queue re-sequenced by similarity (${rebuiltSummary.strong} strong anchors, ${rebuiltSummary.excluded} excluded dislikes).`;
          } else {
            stationStatus = action.rating === 5
              ? "Liked this track. Rebuild produced no better candidates, so the current queue stays active."
              : action.rating === 0
                ? "Disliked this track. Rebuild produced no better candidates, so the current queue stays active."
                : `Stored ${action.rating}/5. Rebuild produced no better candidates, so the current queue stays active.`;
          }
          continue;
        }

        const rebuilt = await buildStationQueue(
          dbPath,
          hvscRoot,
          ratings,
          stationTarget,
          options.adventure ?? 3,
          minDurationSeconds,
          runtime,
          metadataCache,
        );
        if (rebuilt.length >= stationTarget) {
          const merged = mergeQueueKeepingCurrent(current, rebuilt, stationIndex);
          stationQueue = merged.queue;
          stationIndex = merged.index;
          selectedIndex = clampSelectionToMatches(getFilteredTrackIndices(stationQueue, stationFilter), stationIndex, stationIndex);
          playlistWindowStart = 0;
          await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
          const rebuiltSummary = summarizeRatingAnchors(ratings);
          stationStatus = `Rebuilt from ${ratings.size} ratings; current song pinned, remaining queue re-sequenced by similarity (${rebuiltSummary.strong} strong anchors, ${rebuiltSummary.excluded} excluded dislikes).`;
        } else {
          stationStatus = "Rebuild did not produce a full 100-song queue; the current playlist stays active.";
        }
      }
    }

    return 0;
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  } finally {
    runtime.offSignal("SIGINT", handleSigint);
    input.close();
    renderer.close();
    await stopPlayback();
  }
}

export const __stationDemoTestUtils = {
  buildStationQueue,
  buildSelectionStatePath,
  chooseStationTracks,
  deriveStationBucketKey,
  getTerminalSize,
  orderStationTracksByFlow,
  resolvePlaylistWindowRows,
  resolvePlaylistWindowStart,
};

if (import.meta.main) {
  runStationDemoCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
