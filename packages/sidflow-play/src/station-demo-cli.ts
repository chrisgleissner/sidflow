#!/usr/bin/env bun

import process from "node:process";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { Database } from "bun:sqlite";
import {
  formatHelp,
  handleParseResult,
  loadConfig,
  lookupSongDurationMs,
  parseArgs,
  parseSidFile,
  pathExists,
  recommendFromFavorites,
  type ArgDef,
  type SidFileMetadata,
  type SidflowConfig,
  type SimilarityExportRecommendation,
  Ultimate64Client,
} from "@sidflow/common";

type PlaybackMode = "local" | "c64u" | "none";

interface StationDemoCliOptions {
  config?: string;
  db?: string;
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
}

interface StationDemoRuntime extends MetadataResolver {
  loadConfig: typeof loadConfig;
  createPlaybackAdapter?: (mode: PlaybackMode, config: SidflowConfig, options: StationDemoCliOptions) => Promise<PlaybackAdapter>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  cwd: () => string;
  prompt?: (message: string) => Promise<string>;
  random: () => number;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  offSignal: (signal: NodeJS.Signals, handler: () => void) => void;
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
    description: "Path to exported similarity SQLite database",
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
    description: "Number of random tracks to rate before station generation",
    defaultValue: 10,
    constraints: { min: 1 },
  },
  {
    name: "--station-size",
    type: "integer",
    description: "Number of recommendations to keep in the station queue",
    defaultValue: 20,
    constraints: { min: 1 },
  },
];

const HELP_TEXT = formatHelp(
  "sidflow-play station-demo [options]",
  `Interactive demo proving the exported similarity SQLite DB is self-contained.
The station is built from the exported SQLite DB; the optional features JSONL is only shown as companion provenance.

Workflow:
  1. Pull random tracks directly from the export DB.
  2. Play and rate them from 1-5.
  3. Build a station from the export vectors.
  4. Navigate with next/back while inspecting previous/current/next context.

Commands:
  Rating phase: 1-5 to rate, s to skip, b to go back, q to quit
  Station phase: n next, b back, r replay, 1-5 to refine station, q to quit`,
  ARG_DEFS,
  [
    "sidflow-play station-demo",
    "sidflow-play station-demo --playback none --sample-size 5 --station-size 8",
    "sidflow-play station-demo --c64u-host 192.168.1.13 --adventure 5",
  ],
);

const defaultRuntime: StationDemoRuntime = {
  loadConfig,
  parseSidFile,
  lookupSongDurationMs,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  cwd: () => process.cwd(),
  random: () => Math.random(),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  offSignal: (signal, handler) => {
    process.off(signal, handler);
  },
};

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

function buildSidplayArgs(track: StationTrackDetails): string[] {
  const args = [`-o${track.song_index}`];
  const durationMs = resolveTrackDurationMs(track);
  const wholeSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  args.push(`-t${wholeSeconds}`);
  args.push(track.absolutePath);
  return args;
}

function openReadonlyDatabase(dbPath: string): Database {
  return new Database(dbPath, { readonly: true, strict: true });
}

function readRandomTracks(dbPath: string, limit: number): StationTrackRow[] {
  const database = openReadonlyDatabase(dbPath);
  try {
    return database
      .query(
        `SELECT track_id, sid_path, song_index, e, m, c, p, likes, dislikes, skips, plays, last_played
         FROM tracks
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(limit) as StationTrackRow[];
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

function buildWeightsByTrackId(ratings: Map<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [trackId, rating] of ratings) {
    if (rating >= 3) {
      result[trackId] = rating - 2;
    }
  }
  return result;
}

function pickFavoriteTrackIds(ratings: Map<string, number>): string[] {
  const favorites = [...ratings.entries()]
    .filter(([, rating]) => rating >= 3)
    .sort((left, right) => right[1] - left[1])
    .map(([trackId]) => trackId);
  if (favorites.length > 0) {
    return favorites;
  }

  const fallback = [...ratings.entries()].sort((left, right) => right[1] - left[1])[0];
  return fallback ? [fallback[0]] : [];
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

  const poolSize = Math.min(recommendations.length, Math.max(stationSize, stationSize * (1 + adventure)));
  const pool = recommendations.slice(0, poolSize);
  const chosen: SimilarityExportRecommendation[] = [];
  const used = new Set<string>();
  const windowSize = Math.max(1, adventure);

  for (let index = 0; index < stationSize && used.size < pool.length; index += 1) {
    const segmentStart = Math.min(pool.length - 1, Math.floor((index * pool.length) / stationSize));
    const segmentEnd = Math.min(pool.length, segmentStart + windowSize);
    const segment = pool.slice(segmentStart, segmentEnd).filter((entry) => !used.has(entry.track_id));
    const candidates = segment.length > 0 ? segment : pool.filter((entry) => !used.has(entry.track_id));
    if (candidates.length === 0) {
      break;
    }
    const picked = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    chosen.push(picked);
    used.add(picked.track_id);
  }

  return chosen;
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

function formatDuration(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "unknown";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTrackSummary(track: StationTrackDetails): string {
  const label = `${track.sid_path}#${track.song_index}`;
  const title = track.title || path.basename(track.sid_path);
  const author = track.author || "unknown author";
  const year = track.year ?? "unknown year";
  return `${title} | ${author} | ${year} | ${formatDuration(track.durationMs)} | ${label}`;
}

function renderTrackCard(
  track: StationTrackDetails,
  phase: "rating" | "station",
  index: number,
  total: number,
  rating?: number,
): string {
  const lines = [
    "",
    `${phase === "rating" ? "Seed" : "Station"} ${index + 1}/${total}`,
    `Title: ${track.title || path.basename(track.sid_path)}`,
    `Author: ${track.author || "unknown"}`,
    `Released: ${track.released || "unknown"}`,
    `Duration: ${formatDuration(track.durationMs)}`,
    `Track: ${track.sid_path}#${track.song_index}`,
    `Ratings: e=${track.e} m=${track.m} c=${track.c}${track.p ? ` p=${track.p}` : ""}`,
    `Feedback: likes=${track.likes} dislikes=${track.dislikes} skips=${track.skips} plays=${track.plays}`,
  ];
  if (rating !== undefined) {
    lines.push(`Your rating: ${rating}/5`);
  }
  return `${lines.join("\n")}\n`;
}

function renderStationContext(queue: StationTrackDetails[], index: number, adventure: number): string {
  const previous = index > 0 ? formatTrackSummary(queue[index - 1]) : "none";
  const current = formatTrackSummary(queue[index]);
  const next = index + 1 < queue.length ? formatTrackSummary(queue[index + 1]) : "none";
  return [
    "",
    `Adventure: ${adventure}/5`,
    `Previous: ${previous}`,
    `Current: ${current}`,
    `Next: ${next}`,
    "",
  ].join("\n");
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

  return candidates[0];
}

class NoopPlaybackAdapter implements PlaybackAdapter {
  async start(_track: StationTrackDetails): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    return;
  }
}

class LocalSidplayPlaybackAdapter implements PlaybackAdapter {
  private current: ChildProcess | null = null;

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

      const startupTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 300);

      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.once("spawn", () => {
        return;
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
      return;
    }

    const proc = this.current;
    this.current = null;
    if (proc.exitCode !== null) {
      return;
    }
    proc.kill("SIGTERM");
  }
}

class Ultimate64PlaybackAdapter implements PlaybackAdapter {
  constructor(private readonly client: Ultimate64Client) {}

  async start(track: StationTrackDetails): Promise<void> {
    const buffer = await readFile(track.absolutePath);
    await this.client.sidplay({ sidBuffer: buffer, songNumber: track.song_index });
  }

  async stop(): Promise<void> {
    await this.client.reset();
  }
}

function createPrompt(runtime: StationDemoRuntime): { ask: (message: string) => Promise<string>; close: () => void } {
  if (runtime.prompt) {
    return {
      ask: runtime.prompt,
      close: () => {},
    };
  }

  if (!(runtime.stdin as NodeJS.ReadStream).isTTY || !(runtime.stdout as NodeJS.WriteStream).isTTY) {
    throw new Error("Interactive station demo requires a TTY unless a prompt override is provided");
  }

  const { createInterface } = require("node:readline/promises") as typeof import("node:readline/promises");
  const rl = createInterface({ input: runtime.stdin, output: runtime.stdout });
  return {
    ask: async (message: string) => (await rl.question(message)).trim(),
    close: () => {
      rl.close();
    },
  };
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

async function waitForStationAction(
  runtime: StationDemoRuntime,
  prompt: { ask: (message: string) => Promise<string>; close: () => void },
  timeoutMs: number,
): Promise<string> {
  if (runtime.prompt) {
    return (await prompt.ask("Command n=next, b=back, r=replay, 1-5=refine, q=quit > ")).toLowerCase();
  }

  if (!(runtime.stdin as NodeJS.ReadStream).isTTY || !(runtime.stdout as NodeJS.WriteStream).isTTY) {
    return "n";
  }

  runtime.stdout.write("Command n=next, b=back, r=replay, 1-5=refine, q=quit > ");

  return await new Promise<string>((resolve) => {
    const stdin = runtime.stdin as NodeJS.ReadStream;
    stdin.setEncoding("utf8");
    stdin.setRawMode?.(true);
    stdin.resume();

    const cleanup = (value: string) => {
      clearTimeout(timer);
      stdin.off("data", handleData);
      stdin.setRawMode?.(false);
      stdin.pause();
      runtime.stdout.write("\n");
      resolve(value);
    };

    const handleData = (chunk: string) => {
      for (const char of chunk) {
        const normalized = char.toLowerCase();
        if (char === "\u0003") {
          cleanup("q");
          return;
        }
        if (["n", "b", "r", "q", "1", "2", "3", "4", "5"].includes(normalized)) {
          runtime.stdout.write(normalized);
          cleanup(normalized);
          return;
        }
      }
    };

    const timer = setTimeout(() => {
      runtime.stdout.write("[auto-next]");
      cleanup("n");
    }, Math.max(1_000, timeoutMs));

    stdin.on("data", handleData);
  });
}

async function buildStationQueue(
  dbPath: string,
  hvscRoot: string,
  ratings: Map<string, number>,
  stationSize: number,
  adventure: number,
  runtime: StationDemoRuntime,
  metadataCache: Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>,
): Promise<StationTrackDetails[]> {
  const favoriteTrackIds = pickFavoriteTrackIds(ratings);
  if (favoriteTrackIds.length === 0) {
    return [];
  }

  const candidates = recommendFromFavorites(dbPath, {
    favoriteTrackIds,
    excludeTrackIds: [...ratings.entries()].filter(([, rating]) => rating <= 2).map(([trackId]) => trackId),
    weightsByTrackId: buildWeightsByTrackId(ratings),
    limit: Math.max(stationSize, stationSize * (1 + adventure)),
  });
  const chosen = chooseStationTracks(candidates, stationSize, adventure, runtime.random);

  const details: StationTrackDetails[] = [];
  for (const recommendation of chosen) {
    const row = readTrackRowById(dbPath, recommendation.track_id);
    if (!row) {
      continue;
    }
    details.push(await resolveTrackDetails(row, hvscRoot, runtime, metadataCache));
  }
  return details;
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
  const dbPath = path.resolve(runtime.cwd(), options.db ?? "data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite");
  const hvscRoot = path.resolve(runtime.cwd(), options.hvsc ?? config.sidPath);
  const classifiedPath = path.resolve(runtime.cwd(), config.classifiedPath ?? "data/classified");
  const featuresJsonl = options.featuresJsonl
    ? path.resolve(runtime.cwd(), options.featuresJsonl)
    : await resolveLatestFeaturesJsonl(classifiedPath);

  if (!(await pathExists(dbPath))) {
    runtime.stderr.write(`Error: similarity export database not found at ${dbPath}\n`);
    return 1;
  }

  if (!(await pathExists(hvscRoot))) {
    runtime.stderr.write(`Error: SID collection root not found at ${hvscRoot}\n`);
    return 1;
  }

  const prompt = createPrompt(runtime);
  const playback = runtime.createPlaybackAdapter
    ? await runtime.createPlaybackAdapter(playbackMode, config, options)
    : await createPlaybackAdapter(playbackMode, config, options);
  const metadataCache = new Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>();

  runtime.stdout.write(`SQLite export: ${dbPath}\n`);
  runtime.stdout.write(`SID root: ${hvscRoot}\n`);
  runtime.stdout.write(`Companion features JSONL: ${featuresJsonl ?? "not supplied"}\n`);
  runtime.stdout.write("Recommendations come from the SQLite export; the features JSONL is optional provenance only.\n");
  runtime.stdout.write(`Playback mode: ${playbackMode}\n`);
  runtime.stdout.write(`Adventure: ${options.adventure ?? 3}/5\n`);

  const stopPlayback = async (): Promise<void> => {
    try {
      await playback.stop();
    } catch {
      // ignore cleanup errors
    }
  };

  let interrupted = false;
  const handleSigint = (): void => {
    interrupted = true;
    void stopPlayback();
    prompt.close();
  };

  runtime.onSignal("SIGINT", handleSigint);

  try {
    const seedRows = readRandomTracks(dbPath, options.sampleSize ?? 10);
    if (seedRows.length === 0) {
      runtime.stderr.write("Error: export database does not contain any tracks\n");
      return 1;
    }

    const seeds = await Promise.all(seedRows.map((row) => resolveTrackDetails(row, hvscRoot, runtime, metadataCache)));
    const ratings = new Map<string, number>();

    let seedIndex = 0;
    while (!interrupted && seedIndex < seeds.length) {
      const current = seeds[seedIndex];
      await playback.start(current);
      runtime.stdout.write(renderTrackCard(current, "rating", seedIndex, seeds.length, ratings.get(current.track_id)));

      const answer = (await prompt.ask("Rate 1-5, s=skip, b=back, q=quit > ")).toLowerCase();
      if (answer === "q") {
        runtime.stdout.write("Session ended.\n");
        return 0;
      }
      if (answer === "b") {
        await stopPlayback();
        seedIndex = Math.max(0, seedIndex - 1);
        continue;
      }
      if (answer === "s" || answer === "") {
        ratings.delete(current.track_id);
        await stopPlayback();
        seedIndex += 1;
        continue;
      }

      const rating = Number.parseInt(answer, 10);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        runtime.stderr.write("Please enter 1-5, s, b, or q.\n");
        continue;
      }

      ratings.set(current.track_id, rating);
      await stopPlayback();
      seedIndex += 1;
    }

    const stationQueue = await buildStationQueue(
      dbPath,
      hvscRoot,
      ratings,
      options.stationSize ?? 20,
      options.adventure ?? 3,
      runtime,
      metadataCache,
    );

    if (stationQueue.length === 0) {
      runtime.stderr.write("Error: no station candidates were produced from the supplied ratings\n");
      return 1;
    }

    runtime.stdout.write(`\nStation ready with ${stationQueue.length} tracks from the standalone SQLite export.\n`);

    let stationIndex = 0;
    while (!interrupted) {
      const current = stationQueue[stationIndex];
      await playback.start(current);
      runtime.stdout.write(renderTrackCard(current, "station", stationIndex, stationQueue.length));
      runtime.stdout.write(renderStationContext(stationQueue, stationIndex, options.adventure ?? 3));
      const answer = await waitForStationAction(runtime, prompt, resolveTrackDurationMs(current));

      if (answer === "q") {
        runtime.stdout.write("Station session ended.\n");
        return 0;
      }
      if (answer === "r" || answer === "") {
        await stopPlayback();
        continue;
      }
      if (answer === "n") {
        await stopPlayback();
        stationIndex = Math.min(stationQueue.length - 1, stationIndex + 1);
        continue;
      }
      if (answer === "b") {
        await stopPlayback();
        stationIndex = Math.max(0, stationIndex - 1);
        continue;
      }

      const rating = Number.parseInt(answer, 10);
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        ratings.set(current.track_id, rating);
        await stopPlayback();
        const rebuilt = await buildStationQueue(
          dbPath,
          hvscRoot,
          ratings,
          options.stationSize ?? 20,
          options.adventure ?? 3,
          runtime,
          metadataCache,
        );
        if (rebuilt.length > 0) {
          stationQueue.splice(0, stationQueue.length, ...rebuilt);
          stationIndex = 0;
          runtime.stdout.write("Station rebuilt from updated ratings.\n");
        }
        continue;
      }

      runtime.stderr.write("Please enter n, b, r, 1-5, or q.\n");
    }

    return 0;
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  } finally {
    runtime.offSignal("SIGINT", handleSigint);
    prompt.close();
    await stopPlayback();
  }
}

if (import.meta.main) {
  runStationDemoCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}