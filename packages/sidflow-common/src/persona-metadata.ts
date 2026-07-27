/**
 * Track metadata for persona scoring, derived from SID headers and HVSC paths.
 *
 * The four hybrid personas — `composer_focus`, `era_explorer`, `deep_discovery`,
 * `theme_hunter` — are defined with a `metadataPolicy` and earn their distinguishing
 * signal from composer, year, category and title-derived theme tags. The style-mask
 * builder passed no metadata at all, so `scoreMetadataBonus` returned 0 for every one
 * of them and they were scored on exactly the same five metrics derived from e/m/c/p
 * as the audio-led personas.
 *
 * Not on the same SCALE, though, and that is what decided the outcome: a hybrid scores
 * `clamp01(audioScore * 0.85 + bonus * 0.15)`, so a zero bonus is not neutral — it is a
 * flat 15% handicap in a top-3 race against five personas that carry none. The four
 * metadata-starved personas were exactly the four lowest-coverage ones in the shipped
 * bundle (33.1%, 13.6%, 0.8%, 0.0%) while every audio-led one cleared 47%.
 *
 * None of this is reclassification. Composer, title, year and category come from SID
 * file headers and from where a file sits in the collection — not from rendered audio.
 *
 * These helpers previously existed only inside `scripts/run-tiny-export-equivalence-audit.ts`,
 * which meant the audit measured personas with metadata while the export shipped them
 * without. Promoted here so there is one derivation and both use it.
 */

import path from "node:path";
import { parseSidFileFromBuffer } from "./sid-parser.js";
import type { PersonaMetrics } from "./persona.js";

/** The metadata `scoreTrackForPersona` can actually use, plus what derives it. */
export interface PersonaTrackMetadata {
  title?: string;
  composer?: string;
  year?: number;
  category?: string;
  titleThemeTags?: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Strip the `C64Music/` prefix if present.
 *
 * Whether it is present depends on where the operator pointed `sidPath`, so every
 * path-derived field has to tolerate both spellings or it silently reads the wrong
 * segment — "C64MUSIC" as the category, "MUSICIANS" as the composer.
 */
export function normalizeSidPathForMetadata(sidPath: string): string {
  const normalized = sidPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("C64Music/") ? normalized.slice("C64Music/".length) : normalized;
}

/** HVSC's top-level division: DEMOS, GAMES, MUSICIANS. */
export function deriveCategoryFromSidPath(sidPath: string): string | undefined {
  const first = normalizeSidPathForMetadata(sidPath).split("/").filter(Boolean)[0];
  return first?.toUpperCase();
}

/**
 * MUSICIANS/<letter>/<Composer_Name>/... — the collection's own composer index.
 *
 * Only meaningful under MUSICIANS; DEMOS and GAMES are organised by production, so a
 * composer has to come from the file header there.
 */
export function deriveComposerFromSidPath(sidPath: string): string | undefined {
  const segments = normalizeSidPathForMetadata(sidPath).split("/").filter(Boolean);
  if (segments[0]?.toUpperCase() === "MUSICIANS" && segments.length >= 3) {
    return segments[2];
  }
  return undefined;
}

/**
 * Content words from a title, which is all `theme_hunter` has to work with.
 *
 * Short tokens and structural words carry no theme, and including them would make
 * every title look alike — which is the failure mode this persona already has.
 */
export function deriveThemeTagsFromTitle(title: string): string[] {
  const stopWords = new Set(["the", "and", "for", "with", "from", "part", "song", "theme", "sid", "demo"]);
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));
  return [...new Set(tokens)].slice(0, 6);
}

/** First four-digit year in a PSID `released` field, e.g. "1987 Rob Hubbard". */
export function parseReleaseYear(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

/**
 * The five persona metrics, derived from the three rating quintiles.
 *
 * Worth naming plainly: this is the whole input to persona scoring for the audio-led
 * personas, so their score takes at most 125 distinct values over any corpus — one per
 * (e, m, c) cell, since `p` carries user feedback and is unset in a published export.
 * That ceiling is the structural limit on the category axis and the reason
 * `doc/station-quality.md` records deriving categories from the 58-dimension vector as
 * the next piece of work.
 */
export function buildPersonaMetricsFromRatings(
  ratings: { e: number; m: number; c: number; p?: number | null },
): PersonaMetrics {
  const energy = clamp01((ratings.e - 1) / 4);
  const mood = clamp01((ratings.m - 1) / 4);
  const complexity = clamp01((ratings.c - 1) / 4);
  const preference = ratings.p == null ? 0.5 : clamp01((ratings.p - 1) / 4);
  return {
    melodicComplexity: complexity,
    rhythmicDensity: energy,
    timbralRichness: (complexity + preference) / 2,
    nostalgiaBias: mood,
    experimentalTolerance: (complexity + (1 - mood) + preference) / 3,
  };
}

/**
 * Everything derivable from the path alone, with no file access.
 *
 * The fallback when a header will not parse, and the whole answer for callers with no
 * local collection. Keeping it separate means a consumer without HVSC still gets the
 * audio-led personas and the path-derived half of the hybrids rather than nothing.
 */
export function derivePersonaMetadataFromSidPath(sidPath: string): PersonaTrackMetadata {
  const normalized = normalizeSidPathForMetadata(sidPath);
  const title = path.basename(normalized, path.extname(normalized)).replace(/_/g, " ");
  return {
    title,
    composer: deriveComposerFromSidPath(sidPath),
    category: deriveCategoryFromSidPath(sidPath),
    titleThemeTags: deriveThemeTagsFromTitle(title),
  };
}

/**
 * Full metadata from a SID file's bytes, falling back to the path for anything the
 * header does not carry.
 *
 * Takes a buffer rather than a path on purpose: the tiny builder already reads every
 * file to compute its md5_48 identity, so parsing the header from the same buffer adds
 * no I/O to a 61,157-file pass.
 */
export function derivePersonaMetadataFromSidBuffer(
  sidPath: string,
  buffer: Buffer,
  report?: SidHeaderFallbackReport,
): PersonaTrackMetadata {
  const fromPath = derivePersonaMetadataFromSidPath(sidPath);
  try {
    const header = parseSidFileFromBuffer(buffer);
    const title = header.title?.trim() || fromPath.title;
    const composer = header.author?.trim() || fromPath.composer;
    return {
      title,
      composer,
      year: parseReleaseYear(header.released?.trim() || undefined),
      category: fromPath.category,
      titleThemeTags: title ? deriveThemeTagsFromTitle(title) : fromPath.titleThemeTags,
    };
  } catch (error) {
    // A file that will not parse is a property of the collection, not a reason to fail an
    // export: the path-derived fields are still true and still useful. Accumulated and
    // reported once rather than logged per file, because a caller sweeping 61,157 files
    // needs a count and an example, not 61,157 lines.
    if (report) {
      report.count += 1;
      report.firstPath ??= sidPath;
      report.firstMessage ??= error instanceof Error ? error.message : String(error);
    }
    return fromPath;
  }
}

/** Accumulates SID header parse failures across a corpus sweep. See `summariseSidHeaderFallbacks`. */
export interface SidHeaderFallbackReport {
  count: number;
  firstPath?: string;
  firstMessage?: string;
}

export function createSidHeaderFallbackReport(): SidHeaderFallbackReport {
  return { count: 0 };
}

/** Emit one line if any file's header could not be parsed. Returns true if it reported. */
export function summariseSidHeaderFallbacks(report: SidHeaderFallbackReport, totalFiles: number): boolean {
  if (report.count === 0) {
    return false;
  }
  console.debug(
    `[persona-metadata] ${report.count}/${totalFiles} SID headers could not be parsed and fell back to `
    + `path-derived metadata (first: ${report.firstPath} — ${report.firstMessage}). `
    + "Composer and category still resolve from the path; year and title-derived theme tags do not.",
  );
  return true;
}

/**
 * How unusual a track's neighbourhood in the collection is, on [0, 1].
 *
 * `deep_discovery` is the only persona that reads `rarity`, and it is the only piece of
 * persona input that is genuinely continuous — every other signal is a quintile or a
 * presence flag. Measured as how sparse the track's containing directory is relative to
 * the corpus: a tune sitting alone in a folder is obscure, one of 200 in a well-known
 * musician's directory is not.
 */
export function computeDirectoryRarity(
  sidPath: string,
  tracksPerDirectory: Map<string, number>,
  minimum: number,
  maximum: number,
): number {
  if (maximum === minimum) {
    return 0.5;
  }
  const directory = path.posix.dirname(normalizeSidPathForMetadata(sidPath));
  const count = tracksPerDirectory.get(directory) ?? maximum;
  return clamp01(1 - ((count - minimum) / (maximum - minimum)));
}

/**
 * Corpus-relative context for the hybrid personas' metadata bonuses.
 *
 * Built in one pass over the corpus, then consulted per track. Everything here exists
 * because a bonus that scores metadata PRESENCE is a constant on a collection where the
 * metadata is universal, and a constant cannot rank anything.
 */
export interface PersonaCorpusContext {
  tracksPerDirectory: Map<string, number>;
  minimumDirectoryOccupancy: number;
  maximumDirectoryOccupancy: number;
  tracksPerComposer: Map<string, number>;
  maximumComposerTrackCount: number;
  /** Every observed year, ascending, one entry per track. Used for rank normalisation. */
  sortedYears: number[];
  minimumYear: number | null;
  maximumYear: number | null;
}

/**
 * Build the corpus-relative context in a single pass.
 *
 * Composer prominence is measured on a log scale. HVSC's composer distribution is
 * extremely long-tailed — 68% of composers have exactly one tune while a handful have
 * hundreds — so a linear share would put almost every composer indistinguishably near
 * zero and hand the entire signal to three or four names. A log scale separates "one
 * tune" from "a dozen" from "two hundred", which is the distinction
 * `composer_focus` actually needs.
 */
export function buildPersonaCorpusContext(
  tracks: Iterable<{ sid_path: string; metadata?: PersonaTrackMetadata }>,
): PersonaCorpusContext {
  const tracksPerDirectory = new Map<string, number>();
  const tracksPerComposer = new Map<string, number>();
  const years: number[] = [];

  for (const track of tracks) {
    const directory = path.posix.dirname(normalizeSidPathForMetadata(track.sid_path));
    tracksPerDirectory.set(directory, (tracksPerDirectory.get(directory) ?? 0) + 1);

    const composer = track.metadata?.composer;
    if (composer) {
      tracksPerComposer.set(composer, (tracksPerComposer.get(composer) ?? 0) + 1);
    }

    const year = track.metadata?.year;
    if (typeof year === "number" && Number.isFinite(year)) {
      years.push(year);
    }
  }

  years.sort((left, right) => left - right);
  const directoryCounts = [...tracksPerDirectory.values()];
  const composerCounts = [...tracksPerComposer.values()];
  return {
    tracksPerDirectory,
    minimumDirectoryOccupancy: directoryCounts.length > 0 ? Math.min(...directoryCounts) : 0,
    maximumDirectoryOccupancy: directoryCounts.length > 0 ? Math.max(...directoryCounts) : 0,
    tracksPerComposer,
    maximumComposerTrackCount: composerCounts.length > 0 ? Math.max(...composerCounts) : 0,
    sortedYears: years,
    minimumYear: years.length > 0 ? years[0]! : null,
    maximumYear: years.length > 0 ? years[years.length - 1]! : null,
  };
}

/** How large a body of work a composer has in this corpus, on [0, 1], log-scaled. */
export function computeComposerProminence(
  composer: string | undefined,
  context: PersonaCorpusContext,
): number | undefined {
  if (!composer || context.maximumComposerTrackCount <= 1) {
    return undefined;
  }
  const count = context.tracksPerComposer.get(composer) ?? 1;
  return clamp01(Math.log(count) / Math.log(context.maximumComposerTrackCount));
}

/**
 * Where a year falls among the corpus's years, on [0, 1], oldest to newest.
 *
 * RANK-normalised rather than min-max, for two reasons.
 *
 * The first is robustness. PSID `released` fields are free text and a handful parse to
 * nonsense — measured on HVSC 85, the range comes out as 1982 to 2048, and that single
 * bad 2048 compresses forty-four real years of C64 history into the bottom 60% of the
 * scale. Rank normalisation gives an outlier one track's worth of influence instead of
 * the whole axis.
 *
 * The second is consistency. The similarity vector and the e/m/c ratings are both
 * rank-normalised at export time precisely so that no dimension's spread depends on its
 * extremes. Doing the same here means "the newest fifth of the corpus" is a statement
 * about the collection rather than about its worst-parsed record.
 */
export function computeYearPosition(
  year: number | undefined,
  context: PersonaCorpusContext,
): number | undefined {
  if (year == null || context.sortedYears.length === 0) {
    return undefined;
  }
  const total = context.sortedYears.length;
  // Midpoint of the tied span, matching normaliseVectorsByRank: every track of a given
  // year gets the same position, and that position is where the year sits as a whole.
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (context.sortedYears[middle]! < year) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const first = low;
  high = total;
  low = first;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (context.sortedYears[middle]! <= year) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const last = low;
  if (last <= first) {
    // Year not present in the corpus at all; place it by how many years precede it.
    return clamp01(first / total);
  }
  return clamp01((first + last) / 2 / total);
}

/** Directory occupancy counts for `computeDirectoryRarity`, over a whole corpus. */
export function buildDirectoryOccupancy(sidPaths: Iterable<string>): {
  tracksPerDirectory: Map<string, number>;
  minimum: number;
  maximum: number;
} {
  const tracksPerDirectory = new Map<string, number>();
  for (const sidPath of sidPaths) {
    const directory = path.posix.dirname(normalizeSidPathForMetadata(sidPath));
    tracksPerDirectory.set(directory, (tracksPerDirectory.get(directory) ?? 0) + 1);
  }
  const counts = [...tracksPerDirectory.values()];
  return {
    tracksPerDirectory,
    minimum: counts.length > 0 ? Math.min(...counts) : 0,
    maximum: counts.length > 0 ? Math.max(...counts) : 0,
  };
}
