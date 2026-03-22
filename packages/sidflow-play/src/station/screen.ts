import path from "node:path";
import type { StationDialogState, StationScreenState, StationTrackDetails, StationRuntime } from "./types.js";
import { MINIMUM_PLAYLIST_WINDOW_ROWS, STATION_SCREEN_RESERVED_ROWS } from "./constants.js";
import {
  ANSI,
  RATING_COLUMN_WIDTH,
  bold,
  colorize,
  extractYear,
  formatDuration,
  getTerminalSize,
  inverse,
  normalizeRating,
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
const NOW_PLAYING_BLOCK_HEIGHT = 5;
const VIEWPORT_BOTTOM_BUFFER = 5;

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
  const marker = isCurrent ? "►" : isSelected ? " " : "";
  return marker.padStart(MARKER_COLUMN_WIDTH, " ");
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
    return inverse(enabled, rawLine);
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
  playingIndex: number,
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
  const selectedPosition = filteredIndices.indexOf(selectedIndex);
  const visibleFocusPosition = selectedPosition >= 0 ? selectedPosition : filteredIndices.indexOf(playingIndex);

  if (visibleFocusPosition >= 0) {
    if (visibleFocusPosition < windowStart) {
      windowStart = visibleFocusPosition;
    } else if (visibleFocusPosition >= windowStart + rows) {
      windowStart = visibleFocusPosition - rows + 1;
    }
  }

  if (selectedPosition >= 0 && selectedIndex !== playingIndex) {
    return Math.max(0, Math.min(windowStart, maxWindowStart));
  }

  const focusPosition = filteredIndices.indexOf(playingIndex);
  if (focusPosition < 0) {
    return windowStart;
  }
  const bottomBuffer = Math.min(VIEWPORT_BOTTOM_BUFFER, Math.max(0, rows - 1));
  const viewportBottom = windowStart + rows - 1;
  const thresholdBottom = viewportBottom - bottomBuffer;

  if (focusPosition < windowStart) {
    windowStart = focusPosition;
  } else if (focusPosition > thresholdBottom) {
    windowStart = focusPosition - thresholdBottom + windowStart;
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
    lines.push(formatPlaylistRow(
      enabled,
      track,
      index,
      queue.length,
      ratings.get(track.track_id),
      isCurrent,
      isSelected,
      layout,
    ));
  }

  while (lines.length < rows) {
    lines.push(subtle(enabled, "·"));
  }

  return lines;
}

function renderHeader(enabled: boolean): string[] {
  return [bold(enabled, "SID Flow Station  |  C64U Live")];
}

function renderNowPlaying(state: StationScreenState, enabled: boolean, width: number): string[] {
  const current = state.current;
  const elapsedMs = Math.min(state.elapsedMs ?? 0, state.durationMs ?? resolveTrackDurationMs(current));
  const durationMs = state.durationMs ?? resolveTrackDurationMs(current);
  const lines = [
    bold(enabled, "Now Playing"),
    truncate(`${current.title || path.basename(current.sid_path)}  |  ${current.author || "unknown"}`, width),
    truncate(`${current.sid_path}#${current.song_index}  |  ${current.year || extractYear(current.released) || "-"}`, width),
    renderProgressLine(enabled, "Song", elapsedMs, durationMs, width, ANSI.brightGreen),
    truncate(`Rating ${state.currentRating ?? 0}/5  |  ${state.paused ? "paused" : "playing"}  |  ${formatDuration(durationMs)}`, width),
  ];
  while (lines.length < NOW_PLAYING_BLOCK_HEIGHT) {
    lines.push("");
  }
  return lines.slice(0, NOW_PLAYING_BLOCK_HEIGHT);
}

function renderFilterBar(state: StationScreenState, enabled: boolean, width: number): string {
  const parts: string[] = [];
  if (state.minimumRating !== undefined) {
    parts.push(colorize(enabled, ANSI.brightYellow, `★≥${state.minimumRating}`));
  }
  if (state.filterQuery) {
    parts.push(colorize(enabled, ANSI.brightCyan, `text="${state.filterQuery}"`));
  }
  if (state.ratingFilterEditing && state.ratingFilterQuery === "") {
    parts.push(colorize(enabled, ANSI.brightYellow, "★=?"));
  }
  if (state.filterEditing && !state.filterQuery) {
    parts.push(colorize(enabled, ANSI.brightCyan, 'text=""'));
  }
  const content = parts.length > 0 ? parts.join("  |  ") : subtle(enabled, "none");
  return truncate(`[Filter] ${content}`, width);
}

function renderControls(enabled: boolean, width: number): string[] {
  return [
    truncate(`Controls  ←/→ prev/next   ↑/↓ move   Enter play   Space pause`, width),
    truncate(`Browse    PgUp/PgDn page   ↑/↓ step   Enter on live track = no-op`, width),
    truncate(`Filter    * stars   / text   Esc clear`, width),
    truncate(`Rate      0-5 rate   l like   d dislike   s skip   h shuffle   g rebuild   r refresh   w save   o open   q quit`, width),
  ].map((line) => subtle(enabled, line));
}

function renderDialog(dialog: StationDialogState | undefined, enabled: boolean, width: number): string[] {
  if (!dialog) {
    return [];
  }
  if (dialog.mode === "save-playlist") {
    return [
      bold(enabled, "[Save Playlist]"),
      truncate(`Name: ${dialog.inputValue ?? ""}`, width),
      subtle(enabled, "Enter save   Esc cancel"),
    ];
  }
  const playlists = dialog.playlists ?? [];
  const selected = dialog.selectedPlaylistIndex ?? 0;
  const lines = [bold(enabled, "[Open Playlist]")];
  if (playlists.length === 0) {
    lines.push(subtle(enabled, "No saved playlists."));
  } else {
    for (let index = 0; index < Math.min(5, playlists.length); index += 1) {
      const playlist = playlists[index]!;
      const label = `${playlist.name}  (${playlist.trackIds.length} songs)`;
      lines.push(index === selected ? inverse(enabled, label) : label);
    }
  }
  lines.push(subtle(enabled, "↑/↓ select   Enter load   Esc cancel"));
  return lines.map((line) => truncate(line, width));
}

function renderFooter(state: StationScreenState, enabled: boolean, width: number): string[] {
  const footer = state.hintLine ? [truncate(state.hintLine, width)] : [];
  footer.push(truncate(state.statusLine ?? "", width));
  return footer.map((line) => subtle(enabled, line));
}

function renderStationLines(state: StationScreenState, ansiEnabled: boolean, columns: number, rows: number): string[] {
  const width = Math.max(80, columns);
  const height = Math.max(24, rows);
  const selectedIndex = state.selectedIndex ?? state.index;
  const filterQuery = state.filterQuery ?? "";
  const minimumRating = state.minimumRating;
  const filteredIndices = getFilteredTrackIndicesWithRatings(
    state.queue ?? [state.current],
    filterQuery,
    state.ratings,
    minimumRating,
  );
  const playlistRows = resolvePlaylistWindowRowsForScreen(
    state.queue?.length ?? 1,
    height,
    getStationReservedRows(state.featuresJsonl),
  );
  const lines = [
    ...renderHeader(ansiEnabled),
    "",
    ...renderNowPlaying(state, ansiEnabled, width),
    "",
    renderFilterBar(state, ansiEnabled, width),
    ...renderControls(ansiEnabled, width),
    ...renderDialog(state.dialog, ansiEnabled, width),
    "",
    bold(ansiEnabled, `Playlist Window (${playlistRows} visible)  ${filteredIndices.length}/${state.queue?.length ?? 1}`),
    ...renderTrackWindow(
      ansiEnabled,
      state.queue ?? [state.current],
      state.ratings,
      filteredIndices,
      state.index,
      selectedIndex,
      state.playlistWindowStart ?? 0,
      width - 2,
      playlistRows,
    ),
    "",
    ...renderFooter(state, ansiEnabled, width),
  ];
  while (lines.length < height) {
    lines.push("");
  }
  return lines.slice(0, height);
}

export function renderStationScreen(state: StationScreenState, ansiEnabled: boolean, columns: number, rows: number): string {
  return renderStationLines(state, ansiEnabled, columns, rows).join("\n");
}

export class ScreenRenderer {
  private readonly ansiEnabled: boolean;
  private firstPaint = true;
  private lastSize?: { columns: number; rows: number };
  private forceFullRefresh = false;

  constructor(private readonly runtime: StationRuntime) {
    this.ansiEnabled = supportsAnsi(runtime);
  }

  render(state: StationScreenState): void {
    const { columns, rows } = getTerminalSize(this.runtime.stdout);
    const lines = renderStationLines(state, this.ansiEnabled, columns, rows);

    if (this.ansiEnabled) {
      const resized = !this.lastSize || this.lastSize.columns !== columns || this.lastSize.rows !== rows;
      const prefix = this.firstPaint ? "\u001b[?1049h\u001b[?25l" : "";
      const refresh = this.forceFullRefresh || resized ? "\u001b[2J\u001b[H" : "";
      this.runtime.stdout.write(`${prefix}${refresh}`);
      for (let row = 0; row < lines.length; row += 1) {
        this.runtime.stdout.write(`\u001b[${row + 1};1H${lines[row] ?? ""}\u001b[K`);
      }
      for (let row = lines.length; row < rows; row += 1) {
        this.runtime.stdout.write(`\u001b[${row + 1};1H\u001b[K`);
      }
      this.firstPaint = false;
      this.forceFullRefresh = false;
      this.lastSize = { columns, rows };
      return;
    }

    this.runtime.stdout.write(lines.join("\n"));
  }

  refresh(): void {
    this.forceFullRefresh = true;
  }

  close(): void {
    if (this.ansiEnabled) {
      this.runtime.stdout.write(`${ANSI.reset}\u001b[?25h\u001b[?1049l`);
    }
  }
}
