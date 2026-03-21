import path from "node:path";
import type { StationScreenState, StationTrackDetails, StationRuntime } from "./types.js";
import { MINIMUM_PLAYLIST_WINDOW_ROWS, STATION_SCREEN_RESERVED_ROWS } from "./constants.js";
import {
  ANSI,
  RATING_COLUMN_WIDTH,
  bold,
  colorize,
  extractYear,
  formatDuration,
  getTerminalSize,
  normalizeRating,
  renderLegend,
  renderProgressLine,
  renderStars,
  resolveTrackDurationMs,
  subtle,
  supportsAnsi,
  truncate,
} from "./formatting.js";

const INDEX_COLUMN_WIDTH = 7;
const MARKER_COLUMN_WIDTH = 2;
const DURATION_COLUMN_WIDTH = 5;
const YEAR_COLUMN_WIDTH = 4;
const PLAYLIST_COLUMN_GAP = 1;

interface PlaylistLayout {
  titleWidth: number;
  artistWidth: number;
}

function fitCell(value: string, width: number, align: "left" | "right" = "left"): string {
  if (width <= 0) {
    return "";
  }
  const clipped = truncate(value, width);
  return align === "right" ? clipped.padStart(width, " ") : clipped.padEnd(width, " ");
}

function resolvePlaylistLayout(width: number): PlaylistLayout {
  const fixedWidth = INDEX_COLUMN_WIDTH
    + MARKER_COLUMN_WIDTH
    + RATING_COLUMN_WIDTH
    + DURATION_COLUMN_WIDTH
    + YEAR_COLUMN_WIDTH
    + (PLAYLIST_COLUMN_GAP * 6);
  const flexibleWidth = Math.max(24, width - fixedWidth);
  const artistWidth = Math.max(10, Math.floor(flexibleWidth * 0.30));
  const titleWidth = Math.max(12, flexibleWidth - artistWidth);
  return { titleWidth, artistWidth };
}

function renderPlaylistMarker(enabled: boolean, isCurrent: boolean, isSelected: boolean): string {
  const marker = isCurrent ? "►" : isSelected ? ">" : "";
  const padded = marker.padStart(MARKER_COLUMN_WIDTH, " ");
  if (isCurrent) {
    return colorize(enabled, ANSI.brightGreen, padded);
  }
  if (isSelected) {
    return colorize(enabled, ANSI.green, padded);
  }
  return subtle(enabled, padded);
}

function formatPlaylistRow(
  enabled: boolean,
  track: StationTrackDetails,
  rowIndex: number,
  totalRows: number,
  rating: number | null | undefined,
  isCurrent: boolean,
  isSelected: boolean,
  layout: PlaylistLayout,
): string {
  const title = track.title || path.basename(track.sid_path);
  const author = track.author || "unknown";
  const year = track.year || extractYear(track.released) || "-";
  const rawLine = [
    fitCell(`${String(rowIndex + 1).padStart(3, "0")}/${String(totalRows).padStart(3, "0")}`, INDEX_COLUMN_WIDTH, "right"),
    renderPlaylistMarker(enabled, isCurrent, isSelected),
    renderStars(normalizeRating(rating)),
    fitCell(formatDuration(track.durationMs), DURATION_COLUMN_WIDTH, "right"),
    fitCell(title, layout.titleWidth),
    fitCell(author, layout.artistWidth),
    fitCell(year, YEAR_COLUMN_WIDTH),
  ].join(" ");

  if (isCurrent) {
    return bold(enabled, colorize(enabled, ANSI.brightGreen, rawLine));
  }
  if (isSelected) {
    return colorize(enabled, ANSI.green, rawLine);
  }
  return subtle(enabled, rawLine);
}

export function normalizeFilterQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeRatingFilterQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function parseMinimumRatingFilter(value: string | undefined): number | undefined {
  const normalized = normalizeRatingFilterQuery(value);
  if (!normalized) {
    return undefined;
  }
  const match = normalized.match(/^\*?([0-5])$/);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1]!, 10);
}

function formatMinimumRatingFilter(value: number | undefined): string {
  return value === undefined ? "off" : `*${value}`;
}

export function trackMatchesFilter(track: StationTrackDetails, filterQuery: string): boolean {
  const normalized = normalizeFilterQuery(filterQuery);
  if (!normalized) {
    return true;
  }
  const title = (track.title || path.basename(track.sid_path)).toLowerCase();
  const author = (track.author || "").toLowerCase();
  return title.includes(normalized) || author.includes(normalized);
}

export function getFilteredTrackIndices(queue: StationTrackDetails[], filterQuery: string): number[] {
  return getFilteredTrackIndicesWithRatings(queue, filterQuery, new Map(), undefined);
}

export function getFilteredTrackIndicesWithRatings(
  queue: StationTrackDetails[],
  filterQuery: string,
  ratings: Map<string, number>,
  minimumRating: number | undefined,
): number[] {
  const normalized = normalizeFilterQuery(filterQuery);
  if (!normalized && minimumRating === undefined) {
    return queue.map((_, index) => index);
  }

  const indices: number[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const track = queue[index]!;
    const ratingMatches = minimumRating === undefined || normalizeRating(ratings.get(track.track_id)) >= minimumRating;
    if (ratingMatches && trackMatchesFilter(track, normalized)) {
      indices.push(index);
    }
  }
  return indices;
}

function renderActiveBadge(enabled: boolean, label: string, value: string, color: string, active: boolean): string {
  const content = `${label} ${value}`;
  if (!active) {
    return subtle(enabled, content);
  }
  return bold(enabled, colorize(enabled, color, content));
}

export function clampSelectionToMatches(matches: number[], preferredIndex: number, fallbackIndex: number): number {
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

export function moveSelectionInMatches(matches: number[], selectedIndex: number, delta: number): number | null {
  if (matches.length === 0) {
    return null;
  }
  const currentPosition = matches.indexOf(selectedIndex);
  const startPosition = currentPosition >= 0 ? currentPosition : 0;
  const nextPosition = Math.max(0, Math.min(matches.length - 1, startPosition + delta));
  return matches[nextPosition] ?? null;
}

export function moveCurrentInMatches(matches: number[], currentIndex: number, direction: -1 | 1): number | null {
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

export function resolvePlaylistWindowStart(
  filteredIndices: number[],
  selectedIndex: number,
  visibleRows: number,
  previousWindowStart: number,
): number {
  if (filteredIndices.length === 0) {
    return 0;
  }

  const rows = Math.max(1, visibleRows);
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

export function resolvePlaylistWindowRows(queueLength: number, terminalRows: number): number {
  const visibleRows = Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, terminalRows - STATION_SCREEN_RESERVED_ROWS);
  return Math.max(MINIMUM_PLAYLIST_WINDOW_ROWS, Math.min(queueLength, visibleRows));
}

export function resolvePlaylistWindowRowsForScreen(queueLength: number, terminalRows: number, reservedRows: number): number {
  if (queueLength <= 0) {
    return 0;
  }
  const availableRows = Math.max(0, terminalRows - reservedRows);
  if (availableRows <= 0) {
    return 0;
  }
  return Math.min(queueLength, availableRows);
}

export function getStationReservedRows(featuresJsonl?: string): number {
  return featuresJsonl ? 29 : 28;
}

function renderTrackWindow(
  enabled: boolean,
  queue: StationTrackDetails[],
  ratings: Map<string, number>,
  filteredIndices: number[],
  currentIndex: number,
  selectedIndex: number,
  windowStart: number,
  width: number,
  visibleRows: number,
): string[] {
  if (filteredIndices.length === 0) {
    const rows = Math.max(0, visibleRows);
    if (rows === 0) {
      return [];
    }
    const lines = [truncate(subtle(enabled, "No playlist matches the current filter."), width)];
    while (lines.length < rows) {
      lines.push(subtle(enabled, "·"));
    }
    return lines;
  }
  const rows = Math.max(0, visibleRows);
  if (rows === 0) {
    return [];
  }
  const clampedWindowStart = Math.max(0, Math.min(windowStart, Math.max(0, filteredIndices.length - rows)));
  const windowEnd = Math.min(filteredIndices.length, clampedWindowStart + rows);
  const lines: string[] = [];
  const layout = resolvePlaylistLayout(width);

  for (let matchPosition = clampedWindowStart; matchPosition < windowEnd; matchPosition += 1) {
    const index = filteredIndices[matchPosition]!;
    const isCurrent = index === currentIndex;
    const isSelected = index === selectedIndex;
    const track = queue[index]!;
    lines.push(
      formatPlaylistRow(
        enabled,
        track,
        index,
        queue.length,
        ratings.get(track.track_id),
        isCurrent,
        isSelected,
        layout,
      ),
    );
  }

  while (lines.length < rows) {
    lines.push(subtle(enabled, "·"));
  }

  return lines;
}

export function renderStationScreen(state: StationScreenState, ansiEnabled: boolean, columns: number, rows: number): string {
  const width = Math.max(80, columns);
  const height = Math.max(24, rows);
  const title = bold(ansiEnabled, "SIDFlow SID CLI Station");
  const current = state.current;
  const elapsedMs = Math.min(state.elapsedMs ?? 0, state.durationMs ?? resolveTrackDurationMs(current));
  const durationMs = state.durationMs ?? resolveTrackDurationMs(current);
  const playlistElapsedMs = Math.min(state.playlistElapsedMs ?? 0, state.playlistDurationMs ?? durationMs);
  const playlistDurationMs = state.playlistDurationMs ?? durationMs;
  const selectedIndex = state.selectedIndex ?? state.index;
  const selectedTrack = state.queue?.[selectedIndex];
  const filterQuery = state.filterQuery ?? "";
  const ratingFilterQuery = state.ratingFilterQuery ?? "";
  const minimumRating = state.minimumRating;
  const filteredIndices = getFilteredTrackIndicesWithRatings(
    state.queue ?? [state.current],
    filterQuery,
    state.ratings,
    minimumRating,
  );
  const textBadge = renderActiveBadge(
    ansiEnabled,
    state.filterEditing ? "TEXT>" : "TEXT",
    filterQuery ? `"${filterQuery}"` : "off",
    ANSI.brightCyan,
    Boolean(filterQuery) || Boolean(state.filterEditing),
  );
  const starsBadge = renderActiveBadge(
    ansiEnabled,
    state.ratingFilterEditing ? "STARS>" : "STARS",
    state.ratingFilterEditing && ratingFilterQuery
      ? ratingFilterQuery
      : formatMinimumRatingFilter(minimumRating),
    ANSI.brightYellow,
    minimumRating !== undefined || Boolean(state.ratingFilterEditing),
  );
  const titleLine = truncate(`${colorize(ansiEnabled, ANSI.green, current.title || path.basename(current.sid_path))} — ${current.author || "unknown author"}`, width);
  const playbackBadge = state.playbackMode === "none"
    ? colorize(ansiEnabled, ANSI.brightBlack, "silent")
    : colorize(ansiEnabled, ANSI.brightGreen, state.playbackMode);
  const pausedBadge = state.paused ? colorize(ansiEnabled, ANSI.brightYellow, "paused") : colorize(ansiEnabled, ANSI.brightBlack, "live");

  const lines = [
    title,
    `${subtle(ansiEnabled, state.phase === "rating" ? "seed capture" : "station playback")}  ${playbackBadge}  ${pausedBadge}`,
    "",
    bold(ansiEnabled, "Data"),
    `${subtle(ansiEnabled, "Dataset")} ${truncate(state.dataSource, width - 9)}`,
    `${subtle(ansiEnabled, "DB")} ${truncate(state.dbPath, width - 4)}`,
    ...(state.featuresJsonl ? [truncate(`${subtle(ansiEnabled, "Provenance")} ${state.featuresJsonl}`, width)] : []),
    "",
    bold(ansiEnabled, "Keys"),
    `${subtle(ansiEnabled, "Legend")} ${renderLegend(ansiEnabled)}`,
    `${subtle(ansiEnabled, "Scale")} 5 anchor  4 strong  3 keep  2 weak  1 reject  0 block`,
    `${subtle(ansiEnabled, "Duration gate")} >= ${Math.max(1, state.minDurationSeconds ?? 15)}s`,
    "",
    `${bold(ansiEnabled, state.phase === "rating" ? `Seed pass ${state.ratedCount}/${state.ratedTarget}` : "Now Playing")}`,
    titleLine,
    truncate(`${current.sid_path}#${current.song_index}  |  ${current.released || "unknown release"}  |  e=${current.e} m=${current.m} c=${current.c}${current.p ? ` p=${current.p}` : ""}`, width),
    truncate(`Feedback  likes=${current.likes}  dislikes=${current.dislikes}  skips=${current.skips}  plays=${current.plays}`, width),
    renderProgressLine(ansiEnabled, "Song Progress", elapsedMs, durationMs, width, ANSI.brightGreen),
    renderProgressLine(ansiEnabled, "Playlist Pos ", playlistElapsedMs, playlistDurationMs, width, ANSI.green),
    truncate(`Ratings ${state.ratedCount} total  Target ${state.ratedTarget}${state.currentRating !== undefined ? `  Current ${state.currentRating}/5` : ""}`, width),
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
    const playlistRows = resolvePlaylistWindowRowsForScreen(
      state.queue?.length ?? 1,
      height,
      getStationReservedRows(state.featuresJsonl),
    );
    lines.push(
      truncate(`${bold(ansiEnabled, `Station ${state.index + 1}/${state.total}`)}  ${subtle(ansiEnabled, "Controls")} ←/→ play prev/next  ↑/↓ browse  PgUp/PgDn jump  Enter play selected`, width),
      truncate(`${subtle(ansiEnabled, "Shortcuts")} / text  ? stars  space pause  h shuffle  s skip=0  l like=5  d dislike=0  r replay  u refresh  0-5 rate  q quit`, width),
      truncate(`${subtle(ansiEnabled, "Filters")} ${textBadge}  ${starsBadge}  ${filteredIndices.length}/${state.queue?.length ?? 1}${state.filterEditing || state.ratingFilterEditing ? "  Enter keep  Esc clear" : "  / edit  ? edit"}`, width),
      truncate(state.statusLine ?? "Recommendations reflect the rated tracks shown above.", width),
      truncate(selectionHint, width),
      "",
      bold(ansiEnabled, `Playlist Window (${playlistRows} visible${filterQuery || minimumRating !== undefined ? `, ${filteredIndices.length} shown` : ""})`),
    );
    lines.push(
      ...renderTrackWindow(
        ansiEnabled,
        state.queue ?? [state.current],
        state.ratings,
        filteredIndices,
        state.index,
        selectedIndex,
        state.playlistWindowStart ?? 0,
        width,
        playlistRows,
      ),
    );
  }

  return lines.slice(0, height).join("\n");
}

export class ScreenRenderer {
  private readonly ansiEnabled: boolean;
  private firstPaint = true;
  private lastSize?: { columns: number; rows: number };

  constructor(private readonly runtime: StationRuntime) {
    this.ansiEnabled = supportsAnsi(runtime);
  }

  render(state: StationScreenState): void {
    const { columns, rows } = getTerminalSize(this.runtime.stdout);
    const screen = renderStationScreen(state, this.ansiEnabled, columns, rows);

    if (this.ansiEnabled) {
      const resized = !this.lastSize || this.lastSize.columns !== columns || this.lastSize.rows !== rows;
      const prefix = this.firstPaint ? "\u001b[?1049h\u001b[?25l" : "";
      const refresh = resized ? "\u001b[2J\u001b[H" : "\u001b[H";
      this.runtime.stdout.write(`${prefix}${refresh}${screen}\u001b[J`);
      this.firstPaint = false;
      this.lastSize = { columns, rows };
      return;
    }

    this.runtime.stdout.write(screen);
  }

  close(): void {
    if (this.ansiEnabled) {
      this.runtime.stdout.write(`${ANSI.reset}\u001b[?25h\u001b[?1049l`);
    }
  }
}
