/**
 * Minimal plain-text screen parser for interaction tests.
 *
 * Pass `renderStationScreen(state, false, cols, rows)` output — ANSI disabled —
 * and get back a structured view of the playlist rows and footer lines.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedPlaylistRow {
  /** Raw "031/100" label from the index column */
  indexLabel: string;
  /** 0-based index (031 → 30) */
  rawIndex: number;
  /** True if line contains the currently-playing marker "►" */
  hasCurrentMarker: boolean;
  /** True if line contains the selected-but-not-current marker "▸" */
  hasSelectedMarker: boolean;
  /** Rest of the line after the marker and index columns */
  remainder: string;
}

export interface ParsedScreen {
  rawLines: string[];
  playlistHeader: string;
  /** Declared visible-row count extracted from the playlist header */
  declaredVisibleRows: number;
  playlistRows: ParsedPlaylistRow[];
  statusLine: string;
  hintLine: string;
  /** True if any playlist row carries the current-track marker */
  currentVisible: boolean;
  /** True if any playlist row carries the selected marker */
  selectedVisible: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CURRENT_MARKER = "►";
const SELECTED_MARKER = "▸";

// ─── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a plain-text station screen (renderStationScreen with ansiEnabled=false).
 *
 * Strategy:
 * 1. Find the "Playlist Window (N visible)…" anchor line.
 * 2. Read exactly N subsequent lines as the playlist content block.
 * 3. The last non-empty, non-filler lines after the playlist block are the footer.
 */
export function parseScreen(screenText: string): ParsedScreen {
  const rawLines = screenText.split("\n");
  const playlistRows: ParsedPlaylistRow[] = [];
  let playlistHeaderLine = -1;
  let playlistHeader = "";
  let declaredVisibleRows = 0;
  let statusLine = "";
  let hintLine = "";

  // Step 1: Locate the playlist header line
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = (rawLines[i] ?? "").trim();
    const match = trimmed.match(/^Playlist Window \((\d+) visible\)/);
    if (match) {
      playlistHeaderLine = i;
      playlistHeader = trimmed;
      declaredVisibleRows = parseInt(match[1]!, 10);
      break;
    }
  }

  // Step 2: Parse playlist content lines (exactly declaredVisibleRows after header)
  if (playlistHeaderLine >= 0) {
    for (
      let i = playlistHeaderLine + 1;
      i < playlistHeaderLine + 1 + declaredVisibleRows && i < rawLines.length;
      i++
    ) {
      const parsed = tryParsePlaylistRow(rawLines[i] ?? "");
      if (parsed) {
        playlistRows.push(parsed);
      }
      // Filler "·" lines are silently skipped (not playlist rows)
    }
  }

  // Step 3: Collect footer from lines after the playlist content block.
  // renderFooter emits: hintLine (if present) then statusLine.
  const afterPlaylist = playlistHeaderLine + 1 + declaredVisibleRows;
  const footerCandidates: string[] = [];
  for (let i = afterPlaylist; i < rawLines.length; i++) {
    const trimmed = (rawLines[i] ?? "").trim();
    if (trimmed !== "" && !/^·+$/.test(trimmed)) {
      footerCandidates.push(trimmed);
    }
  }
  // renderFooter order: hint first, then status
  if (footerCandidates.length >= 2) {
    hintLine = footerCandidates[0]!;
    statusLine = footerCandidates[1]!;
  } else if (footerCandidates.length === 1) {
    statusLine = footerCandidates[0]!;
  }

  return {
    rawLines,
    playlistHeader,
    declaredVisibleRows,
    playlistRows,
    statusLine,
    hintLine,
    currentVisible: playlistRows.some((r) => r.hasCurrentMarker),
    selectedVisible: playlistRows.some((r) => r.hasSelectedMarker),
  };
}

function tryParsePlaylistRow(line: string): ParsedPlaylistRow | null {
  const trimmed = line.trim();

  // Must contain "NNN/MMM" near the start (the index column)
  const indexMatch = trimmed.match(/^(\d{1,5}\/\d{1,5})/);
  if (!indexMatch) return null;

  const indexLabel = indexMatch[1]!;
  const rawIndex = parseInt(indexLabel.split("/")[0]!, 10) - 1; // convert to 0-based

  const hasCurrentMarker = trimmed.includes(CURRENT_MARKER);
  const hasSelectedMarker = trimmed.includes(SELECTED_MARKER);

  // Everything after the index label and marker
  const afterIndex = trimmed.slice(indexLabel.length).trim();
  const remainder = afterIndex
    .replace(CURRENT_MARKER, "")
    .replace(SELECTED_MARKER, "")
    .trim();

  return { indexLabel, rawIndex, hasCurrentMarker, hasSelectedMarker, remainder };
}

// ─── Invariant checker ─────────────────────────────────────────────────────────

export interface InvariantOptions {
  /** Expected currently-playing 0-based index (may be out of view) */
  currentIndex?: number;
  /** Expected selected 0-based index (may differ from current; may be out of view) */
  selectedIndex?: number;
}

/**
 * Assert visual invariants against a parsed screen.
 *
 * Returns a list of violation descriptions, or an empty array if all pass.
 */
export function checkInvariants(parsed: ParsedScreen, opts: InvariantOptions = {}): string[] {
  const errors: string[] = [];

  // 1. At most one current-marker row
  const currentRows = parsed.playlistRows.filter((r) => r.hasCurrentMarker);
  if (currentRows.length > 1) {
    errors.push(
      `Expected at most 1 current-marker row, found ${currentRows.length}: ${currentRows.map((r) => r.indexLabel).join(", ")}`,
    );
  }

  // 2. At most one selected-marker row
  const selectedRows = parsed.playlistRows.filter((r) => r.hasSelectedMarker);
  if (selectedRows.length > 1) {
    errors.push(
      `Expected at most 1 selected-marker row, found ${selectedRows.length}: ${selectedRows.map((r) => r.indexLabel).join(", ")}`,
    );
  }

  // 3. No row can have both markers (current takes visual priority)
  const bothRows = parsed.playlistRows.filter((r) => r.hasCurrentMarker && r.hasSelectedMarker);
  if (bothRows.length > 0) {
    errors.push(
      `Found row(s) with both current and selected markers: ${bothRows.map((r) => r.indexLabel).join(", ")}`,
    );
  }

  // 4. If known current index is in view, it must carry "►"
  if (opts.currentIndex !== undefined) {
    const inViewRow = parsed.playlistRows.find((r) => r.rawIndex === opts.currentIndex);
    if (inViewRow && !inViewRow.hasCurrentMarker) {
      errors.push(`Row ${opts.currentIndex} is in view but lacks current marker "►"`);
    }
  }

  // 5. If known selected index differs from current and is in view, it must carry "▸"
  if (
    opts.selectedIndex !== undefined &&
    opts.currentIndex !== undefined &&
    opts.selectedIndex !== opts.currentIndex
  ) {
    const inViewRow = parsed.playlistRows.find((r) => r.rawIndex === opts.selectedIndex);
    if (inViewRow && !inViewRow.hasSelectedMarker) {
      errors.push(
        `Row ${opts.selectedIndex} is in view, differs from current ${opts.currentIndex}, but lacks selected marker "▸"`,
      );
    }
  }

  // 6. When current and selected are the same, no "▸" should appear
  if (
    opts.selectedIndex !== undefined &&
    opts.currentIndex !== undefined &&
    opts.selectedIndex === opts.currentIndex
  ) {
    if (selectedRows.length > 0) {
      errors.push(
        `Current and selected are the same (${opts.currentIndex}) but "▸" marker appeared on row(s): ${selectedRows.map((r) => r.indexLabel).join(", ")}`,
      );
    }
  }

  return errors;
}

/**
 * Find the visible playlist row for a 0-based track index, if present.
 */
export function findRow(parsed: ParsedScreen, zeroBasedIndex: number): ParsedPlaylistRow | undefined {
  return parsed.playlistRows.find((r) => r.rawIndex === zeroBasedIndex);
}

/**
 * Assert that invariants pass, throwing with a detailed message if not.
 */
export function assertInvariants(parsed: ParsedScreen, opts: InvariantOptions = {}): void {
  const errors = checkInvariants(parsed, opts);
  if (errors.length > 0) {
    throw new Error(`Screen invariant failures:\n${errors.map((e) => `  • ${e}`).join("\n")}`);
  }
}
