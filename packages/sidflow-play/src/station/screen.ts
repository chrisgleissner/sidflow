import path from "node:path";
import type { StationScreenState, StationTrackDetails, StationRuntime } from "./types.js";
import { MINIMUM_PLAYLIST_WINDOW_ROWS, STATION_SCREEN_RESERVED_ROWS } from "./constants.js";
import {
  ANSI,
  bold,
  colorize,
  formatDuration,
  getTerminalSize,
  renderLegend,
  renderProgressLine,
  resolveTrackDurationMs,
  subtle,
  supportsAnsi,
  truncate,
} from "./formatting.js";

export function normalizeFilterQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
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
          ? colorize(enabled, ANSI.green, "➜")
          : colorize(enabled, ANSI.brightBlack, "•");
    const position = `${String(index + 1).padStart(3, "0")}/${String(queue.length).padStart(3, "0")}`;
    const line = `${marker} ${position} ${title} — ${author} — ${formatDuration(track.durationMs)}`;
    const styledLine = isCurrent
      ? bold(enabled, colorize(enabled, ANSI.brightGreen, line))
      : isSelected
        ? colorize(enabled, ANSI.green, line)
        : subtle(enabled, line);
    lines.push(truncate(styledLine, width));
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
    renderProgressLine(ansiEnabled, "Playlist Pos ", playlistElapsedMs, playlistDurationMs, width, ANSI.green),
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
    const playlistRows = resolvePlaylistWindowRowsForScreen(
      state.queue?.length ?? 1,
      height,
      getStationReservedRows(state.featuresJsonl),
    );
    lines.push(
      truncate(`${bold(ansiEnabled, `Station ${state.index + 1}/${state.total}`)}  ${subtle(ansiEnabled, "Controls")} ←/→ play prev/next  ↑/↓ browse  PgUp/PgDn jump  Enter play selected`, width),
      truncate(`${subtle(ansiEnabled, "Shortcuts")} / filter title/artist  space pause/resume  h shuffle  s skip=dislike  l like(5)  d dislike(0)  r replay  u rebuild  0-5 rate+rebuild  q quit`, width),
      truncate(`${subtle(ansiEnabled, "Filter")} ${filterBadge}${state.filterEditing ? "  Enter keep  Esc clear" : "  / edit  Esc clear"}`, width),
      truncate(state.statusLine ?? "Recommendations reflect the rated tracks shown above.", width),
      truncate(selectionHint, width),
      "",
      bold(ansiEnabled, `Playlist Window (${playlistRows} visible${filterQuery ? `, ${filteredIndices.length} filtered` : ""})`),
    );
    lines.push(
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

  return lines.slice(0, height).join("\n");
}

export class ScreenRenderer {
  private readonly ansiEnabled: boolean;
  private firstPaint = true;

  constructor(private readonly runtime: StationRuntime) {
    this.ansiEnabled = supportsAnsi(runtime);
  }

  render(state: StationScreenState): void {
    const { columns, rows } = getTerminalSize(this.runtime.stdout);
    const screen = renderStationScreen(state, this.ansiEnabled, columns, rows);

    if (this.ansiEnabled) {
      const prefix = this.firstPaint ? "\u001b[?1049h\u001b[?25l" : "";
      this.runtime.stdout.write(`${prefix}\u001b[H${screen}\u001b[J`);
      this.firstPaint = false;
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
