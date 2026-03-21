import path from "node:path";
import type { StationTrackDetails, StationRuntime } from "./types.js";

const STAR_RATINGS = [
  "[☆☆☆☆☆]",
  "[★☆☆☆☆]",
  "[★★☆☆☆]",
  "[★★★☆☆]",
  "[★★★★☆]",
  "[★★★★★]",
] as const;

export const RATING_COLUMN_WIDTH = 7;

export const ANSI = {
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

export function resolveTrackDurationMs(track: StationTrackDetails): number {
  if (typeof track.durationMs === "number" && Number.isFinite(track.durationMs) && track.durationMs > 0) {
    return track.durationMs;
  }
  return 120_000;
}

export function isTrackLongEnough(track: StationTrackDetails, minDurationSeconds: number): boolean {
  return resolveTrackDurationMs(track) >= Math.max(1, minDurationSeconds) * 1000;
}

export function formatDuration(durationMs?: number): string {
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

export function normalizeRating(input: number | null | undefined): number {
  if (input == null) {
    return 0;
  }
  if (!Number.isFinite(input)) {
    return 0;
  }
  const integerRating = Math.trunc(input);
  if (integerRating < 0) {
    return 0;
  }
  if (integerRating > 5) {
    return 5;
  }
  return integerRating;
}

export function renderStars(rating: number | null | undefined): string {
  return STAR_RATINGS[normalizeRating(rating)] ?? STAR_RATINGS[0];
}

export function formatTrackSummary(track: StationTrackDetails): string {
  const title = track.title || path.basename(track.sid_path);
  const author = track.author || "unknown author";
  return `${title} | ${author} | ${formatDuration(track.durationMs)} | ${track.sid_path}#${track.song_index}`;
}

export function supportsAnsi(runtime: StationRuntime): boolean {
  const stdout = runtime.stdout as NodeJS.WriteStream;
  return Boolean(stdout.isTTY && !runtime.prompt);
}

export function colorize(enabled: boolean, color: string, value: string): string {
  if (!enabled) {
    return value;
  }
  return `${color}${value}${ANSI.reset}`;
}

export function bold(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.bold, value);
}

export function subtle(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.brightBlack, value);
}

export function dim(enabled: boolean, value: string): string {
  return colorize(enabled, ANSI.dim, value);
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}

export function formatPercent(elapsedMs: number, durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0%";
  }
  const ratio = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return `${Math.round(ratio * 100)}%`;
}

export function renderProgressBar(enabled: boolean, elapsedMs: number, durationMs: number, width: number, filledColor: string): string {
  const safeWidth = Math.max(10, width);
  const ratio = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  const filled = Math.round(safeWidth * ratio);
  const full = enabled ? "█" : "#";
  const empty = enabled ? "░" : "-";
  const filledPart = full.repeat(filled);
  const emptyPart = empty.repeat(Math.max(0, safeWidth - filled));
  return `${colorize(enabled, filledColor, filledPart)}${colorize(enabled, ANSI.brightBlack, emptyPart)}`;
}

export function renderLegend(enabled: boolean): string {
  return [
    `${colorize(enabled, ANSI.brightRed, "0")} dislike`,
    `${colorize(enabled, ANSI.brightRed, "1")} reject`,
    `${colorize(enabled, ANSI.brightYellow, "2")} weak fit`,
    `${colorize(enabled, ANSI.brightBlue, "3")} keep`,
    `${colorize(enabled, ANSI.brightGreen, "4")} strong fit`,
    `${colorize(enabled, ANSI.bold + ANSI.brightMagenta, "5")} station anchor`,
  ].join("  ");
}

export function renderProgressLine(
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

export function extractYear(released: string): string | undefined {
  const match = released.match(/(19|20)\d{2}/);
  return match?.[0];
}

export function getTerminalSize(stream: NodeJS.WritableStream): { columns: number; rows: number } {
  const terminal = stream as NodeJS.WritableStream & { columns?: number; rows?: number };
  return {
    columns: terminal.columns ?? 100,
    rows: terminal.rows ?? 32,
  };
}

export function renderRelativePath(baseDir: string, targetPath: string): string {
  const relative = path.relative(baseDir, targetPath);
  if (!relative || relative.startsWith("..")) {
    return targetPath;
  }
  return relative;
}
