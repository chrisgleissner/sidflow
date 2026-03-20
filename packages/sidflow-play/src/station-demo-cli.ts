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
type Phase = "rating" | "station";

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
  total: number;
  ratedCount: number;
  ratedTarget: number;
  ratings: Map<string, number>;
  playbackMode: PlaybackMode;
  adventure: number;
  dbPath: string;
  featuresJsonl?: string;
  currentRating?: number;
  queue?: StationTrackDetails[];
  elapsedMs?: number;
  durationMs?: number;
  minDurationSeconds?: number;
  statusLine?: string;
  hintLine?: string;
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
    description: "Minimum number of songs to rate before station generation (minimum effective target: 10)",
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
The station is built from the exported SQLite DB; the optional features JSONL is only shown as companion provenance.

Workflow:
  1. Pull random tracks directly from the export DB.
  2. Keep rating until at least 10 songs are actually rated.
  3. Build a station from the export vectors.
  4. Navigate with arrows, replay, or rebuild the queue without stopping the current song.
  5. Ignore tracks shorter than --min-duration.

Commands:
  Rating phase: 0-5 rate, l like(5), d dislike(0), s skip, b back, r replay, q quit
  Station phase: right/left next/back, s skip=dislike, l like(5), d dislike(0), r replay, u rebuild, 0-5 rate+rebuild, q quit`,
  ARG_DEFS,
  [
    "sidflow-play station-demo",
    "sidflow-play station-demo --playback none --sample-size 10 --station-size 8 --min-duration 20",
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

function buildWeightsByTrackId(ratings: Map<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [trackId, rating] of ratings) {
    result[trackId] = Math.max(0.1, rating);
  }
  return result;
}

function pickFavoriteTrackIds(ratings: Map<string, number>): string[] {
  const ordered = [...ratings.entries()].sort((left, right) => right[1] - left[1]);
  const favorites = ordered.filter(([, rating]) => rating >= 3).map(([trackId]) => trackId);
  if (favorites.length > 0) {
    return favorites;
  }
  const fallback = ordered.find(([, rating]) => rating > 0);
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

function renderProgressBar(enabled: boolean, elapsedMs: number, durationMs: number, width: number): string {
  const safeWidth = Math.max(10, width);
  const ratio = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  const filled = Math.round(safeWidth * ratio);
  const full = enabled ? "█" : "#";
  const empty = enabled ? "░" : "-";
  return `${full.repeat(filled)}${empty.repeat(Math.max(0, safeWidth - filled))}`;
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

function renderTrackWindow(enabled: boolean, queue: StationTrackDetails[], currentIndex: number, width: number): string[] {
  const windowStart = Math.max(0, currentIndex - 5);
  const windowEnd = Math.min(queue.length, currentIndex + 6);
  const lines: string[] = [];

  for (let index = windowStart; index < windowEnd; index += 1) {
    const marker = index === currentIndex ? colorize(enabled, ANSI.brightGreen, "▶") : colorize(enabled, ANSI.brightBlack, "•");
    const track = queue[index];
    const title = track.title || path.basename(track.sid_path);
    const author = track.author || "unknown";
    const line = `${marker} ${String(index + 1).padStart(2, "0")}/${String(queue.length).padStart(2, "0")} ${title} — ${author} — ${formatDuration(track.durationMs)}`;
    lines.push(truncate(line, width));
  }

  while (lines.length < 11) {
    lines.push(dim(enabled, "·"));
  }

  return lines;
}

function renderStationScreen(state: StationScreenState, ansiEnabled: boolean, columns: number): string {
  const width = Math.max(80, columns);
  const title = bold(ansiEnabled, "SIDFlow Station Demo");
  const current = state.current;
  const elapsedMs = Math.min(state.elapsedMs ?? 0, state.durationMs ?? resolveTrackDurationMs(current));
  const durationMs = state.durationMs ?? resolveTrackDurationMs(current);
  const titleLine = truncate(`${current.title || path.basename(current.sid_path)} — ${current.author || "unknown author"}`, width);
  const playbackBadge = state.playbackMode === "none"
    ? colorize(ansiEnabled, ANSI.brightBlack, "silent")
    : colorize(ansiEnabled, ANSI.brightGreen, state.playbackMode);

  const lines = [
    `${title}  ${dim(ansiEnabled, state.phase === "rating" ? "seed capture" : "station playback")}  ${playbackBadge}`,
    `${dim(ansiEnabled, "DB")} ${truncate(state.dbPath, width - 4)}`,
    `${dim(ansiEnabled, "Legend")} ${renderLegend(ansiEnabled)}`,
    `${dim(ansiEnabled, "Best")} 5 locks the vibe in for future picks. 0 is a hard dislike.`,
    `${dim(ansiEnabled, "Duration gate")} >= ${Math.max(1, state.minDurationSeconds ?? 15)}s`,
    "",
    `${bold(ansiEnabled, state.phase === "rating" ? `Rate songs until ${state.ratedTarget} are scored` : "Current station track")}`,
    titleLine,
    truncate(`${current.sid_path}#${current.song_index}  |  ${current.released || "unknown release"}  |  e=${current.e} m=${current.m} c=${current.c}${current.p ? ` p=${current.p}` : ""}`, width),
    truncate(`Feedback  likes=${current.likes}  dislikes=${current.dislikes}  skips=${current.skips}  plays=${current.plays}`, width),
    truncate(`Progress  [${renderProgressBar(ansiEnabled, elapsedMs, durationMs, Math.max(16, Math.min(36, width - 30)))}] ${formatDuration(elapsedMs)} / ${formatDuration(durationMs)} (${formatPercent(elapsedMs, durationMs)})`, width),
    truncate(`You rated ${state.ratedCount}/${state.ratedTarget}${state.currentRating !== undefined ? `  |  current=${state.currentRating}/5` : ""}`, width),
    "",
  ];

  if (state.phase === "rating") {
    lines.push(
      truncate(`${bold(ansiEnabled, `Seed ${state.index + 1}`)}  ${dim(ansiEnabled, "Controls")} 1-5 rate  s skip  b back  r replay  q quit`, width),
      truncate(`${dim(ansiEnabled, "Shortcuts")} l like(5)  d dislike(0)`, width),
      truncate(state.statusLine ?? "Skipped songs do not count. Keep rating until the target is reached.", width),
      truncate(state.hintLine ?? "", width),
    );
  } else {
    lines.push(
      truncate(`${bold(ansiEnabled, `Station ${state.index + 1}/${state.total}`)}  ${dim(ansiEnabled, "Controls")} ← previous  → next  s skip=dislike  r replay  u rebuild  1-5 rate+rebuild  q quit`, width),
      truncate(`${dim(ansiEnabled, "Shortcuts")} l like(5)  d dislike(0)  arrows are navigation only`, width),
      truncate(state.statusLine ?? "Recommendations reflect the rated tracks shown above.", width),
      truncate(state.hintLine ?? "", width),
      "",
      bold(ansiEnabled, "Playlist Window"),
      ...renderTrackWindow(ansiEnabled, state.queue ?? [state.current], state.index, width),
    );
  }

  if (state.featuresJsonl) {
    lines.push("", truncate(`${dim(ansiEnabled, "Provenance")} ${state.featuresJsonl}`, width));
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
    const stdout = this.runtime.stdout as NodeJS.WriteStream & { columns?: number };
    const columns = stdout.columns ?? 100;
    const screen = renderStationScreen(state, this.ansiEnabled, columns);

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
  if (["right", "n", ""].includes(token)) {
    return { type: "next" };
  }
  if (["left", "b"].includes(token)) {
    return { type: "back" };
  }
  if (["up", "r"].includes(token)) {
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
      const answer = normalizePromptResponse(await this.ask("Command left/right, s=skip-dislike, l=like, d=dislike, r=replay, u=rebuild, 0-5=rate, q=quit > "));
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
    const char = chunk[index];
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
    const action = await this.nextMappedAction<StationAction>(timeoutMs, mapStationToken, onTick);
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

  const candidates = recommendFromFavorites(dbPath, {
    favoriteTrackIds,
    excludeTrackIds: [...ratings.entries()].filter(([, rating]) => rating <= 2).map(([trackId]) => trackId),
    weightsByTrackId: buildWeightsByTrackId(ratings),
    limit: Math.max(stationSize * (2 + adventure), stationSize + 8),
  });
  const chosen = chooseStationTracks(candidates, stationSize, adventure, runtime.random);

  const details: StationTrackDetails[] = [];
  for (const recommendation of chosen) {
    const row = readTrackRowById(dbPath, recommendation.track_id);
    if (!row) {
      continue;
    }
    const detail = await resolveTrackDetails(row, hvscRoot, runtime, metadataCache);
    if (!isTrackLongEnough(detail, minDurationSeconds)) {
      continue;
    }
    details.push(detail);
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

function buildInitialSeedStatus(
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
  const minDurationSeconds = Math.max(1, options.minDuration ?? 15);

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
  };

  runtime.onSignal("SIGINT", handleSigint);

  try {
    const ratings = new Map<string, number>();
    const seenTrackIds = new Set<string>();
    const seeds: StationTrackDetails[] = [];
    let seedIndex = 0;
    let seedStatus = "Skipped songs do not count. Keep rating until the target is reached.";

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
      options.stationSize ?? 20,
      options.adventure ?? 3,
      minDurationSeconds,
      runtime,
      metadataCache,
    );

    if (stationQueue.length === 0) {
      runtime.stderr.write("Error: no station candidates were produced from the supplied ratings\n");
      return 1;
    }

    let stationIndex = 0;
    let stationStatus = `Station ready from ${ratings.size} rated songs.`;

    while (!interrupted && stationQueue.length > 0) {
      const current = stationQueue[stationIndex];
      const durationMs = resolveTrackDurationMs(current);
      let startedAt = Date.now();
      await playback.start(current);

      while (!interrupted) {
        const render = () => {
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: Date.now() - startedAt,
            durationMs,
            statusLine: stationStatus,
            hintLine: `Current playlist shows 5 tracks before and after the active song when available.`,
          });
        };

        render();
        const action = await input.readStationAction(durationMs, render);
        render();

        if (action.type === "timeout") {
          await stopPlayback();
          if (stationQueue.length === 1) {
            startedAt = Date.now();
            await playback.start(current);
            stationStatus = "Only one track is available, replaying it.";
            continue;
          }
          stationIndex = Math.min(stationQueue.length - 1, stationIndex + 1);
          stationStatus = "Advanced to the next track.";
          break;
        }

        if (action.type === "quit") {
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: Date.now() - startedAt,
            durationMs,
            statusLine: "Station session ended.",
          });
          return 0;
        }

        if (action.type === "replay") {
          await stopPlayback();
          await playback.start(current);
          startedAt = Date.now();
          stationStatus = `Replaying ${current.title || path.basename(current.sid_path)}.`;
          continue;
        }

        if (action.type === "next") {
          await stopPlayback();
          stationIndex = Math.min(stationQueue.length - 1, stationIndex + 1);
          stationStatus = "Moved to the next station track.";
          break;
        }

        if (action.type === "back") {
          await stopPlayback();
          stationIndex = Math.max(0, stationIndex - 1);
          stationStatus = "Moved to the previous station track.";
          break;
        }

        if (action.type === "rate") {
          ratings.set(current.track_id, action.rating);
          const rebuilt = await buildStationQueue(
            dbPath,
            hvscRoot,
            ratings,
            options.stationSize ?? 20,
            options.adventure ?? 3,
            minDurationSeconds,
            runtime,
            metadataCache,
          );
          if (rebuilt.length > 0) {
            const merged = mergeQueueKeepingCurrent(current, rebuilt, stationIndex);
            stationQueue = merged.queue;
            stationIndex = merged.index;
            stationStatus = action.rating === 5
              ? "Liked this track and rebuilt the station without interrupting playback."
              : action.rating === 0
                ? "Disliked this track and rebuilt the station without interrupting playback."
                : `Stored ${action.rating}/5 and rebuilt the station without interrupting playback.`;
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
          options.stationSize ?? 20,
          options.adventure ?? 3,
          minDurationSeconds,
          runtime,
          metadataCache,
        );
        if (rebuilt.length > 0) {
          const merged = mergeQueueKeepingCurrent(current, rebuilt, stationIndex);
          stationQueue = merged.queue;
          stationIndex = merged.index;
          stationStatus = "Rebuilt the station around the current song.";
        } else {
          stationStatus = "Rebuild produced no candidates; the current queue stays active.";
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

if (import.meta.main) {
  runStationDemoCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
