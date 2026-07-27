// ---------------------------------------------------------------------------
// Reusable persona scoring — shared across CLI and web
// ---------------------------------------------------------------------------

import {
  PERSONA_IDS,
  PERSONAS,
  type PersonaId,
  type PersonaDefinition,
  type PersonaMetricName,
  type PersonaMetrics,
} from "./persona.js";
import type { PersonaProfile } from "./persona-profile.js";

// ---------------------------------------------------------------------------
// Track context for scoring
// ---------------------------------------------------------------------------

export interface PersonaTrackContext {
  metrics: PersonaMetrics;
  ratings: { e?: number; m?: number; c?: number };
  metadata?: {
    category?: string;
    composer?: string;
    year?: number;
    sidType?: string;
    sidChipCount?: number;
    sidModel?: string;
    clock?: string;
    subtuneCount?: number;
    titleThemeTags?: string[];
  };
  rarity?: number;
  /**
   * How large a body of work this track's composer has in the corpus, on [0, 1].
   *
   * `composer_focus` is "one composer, without manual browsing", which a composer with
   * a single tune cannot support and a prolific one can. Supplying this turns the
   * composer signal from "does this track have an author" — true of essentially all of
   * HVSC, and therefore a constant — into something that separates tracks.
   */
  composerProminence?: number;
  /**
   * Where the track's release year falls in the corpus's range, on [0, 1], oldest to
   * newest.
   *
   * Monotone on purpose. `era_explorer` wants historically coherent journeys, and a
   * monotone signal makes its selection a contiguous era rather than a scatter; a
   * non-monotone encoding would give resolution without giving coherence.
   */
  yearPosition?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * How much of a hybrid persona's score its defining metadata decides.
 *
 * A station has to be what its name says. "Composer Deep-Dive", "Era Explorer",
 * "Deep Discovery" and "Game Themes" are metadata-led by definition -- that is what
 * `kind: "hybrid"` means -- yet the blend was 85% audio against a bonus that could move
 * a score by at most 0.021. Rarity, the entire premise of Deep Discovery, was worth
 * 0.015. The measurable consequence: with populations equalised, Deep Discovery and
 * Melodic selected member sets at Jaccard 0.84, sharing 91% of their tracks. Two tiles,
 * one station.
 *
 * At 0.55 the metadata leads and the audio component becomes what it should be -- the
 * secondary filter that keeps the station listenable rather than the thing that defines
 * it.
 *
 * Chosen by measurement, not taste. Worst pairwise Jaccard across the nine stations on
 * HVSC, at equal 20% populations, measured BEFORE melodic/experimental was declared
 * mutually exclusive -- which is why that pair can appear here at all:
 *
 * | weight | worst pair                  | Jaccard |
 * |-------:|-----------------------------|--------:|
 * |   0.15 | experimental/deep_discovery |   0.741 |
 * |   0.30 | melodic/experimental        |   0.659 |
 * |   0.45 | melodic/experimental        |   0.659 |
 * |   0.55 | melodic/experimental        |   0.659 |
 *
 * That is exactly the finding. Past 0.30 the binding pair is two AUDIO personas, which
 * this weight cannot affect -- so the hybrids stopped being what limits distinctness,
 * and the remaining overlap became a question for the conflict rules rather than for the
 * blend. Within that range 0.55 gives the lowest hybrid-vs-anything overlap; going
 * further starts admitting tracks whose audio is a poor fit for the station's mood,
 * which a listener hears immediately even when the metadata premise is satisfied.
 *
 * With the exclusivity in place the shipped worst pair is 0.386 (fast_paced /
 * experimental); see STYLE_CONFLICT_PAIRS in style-assignment.ts.
 */
const HYBRID_METADATA_WEIGHT = 0.55;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeRating(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return clamp01((value - 1) / 4);
}

function average(values: number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Core audio-led scoring (same formula as persona-station.ts)
// ---------------------------------------------------------------------------

function scoreAudioPersona(
  metrics: PersonaMetrics,
  ratings: { e?: number; m?: number; c?: number },
  persona: PersonaDefinition,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const metricName of Object.keys(persona.metricWeights) as PersonaMetricName[]) {
    const weight = persona.metricWeights[metricName];
    const direction = persona.metricDirections[metricName];
    const raw = metrics[metricName];
    let contribution: number;
    if (direction === 1) {
      contribution = raw;
    } else if (direction === -1) {
      contribution = 1 - raw;
    } else {
      contribution = 0.5;
    }
    breakdown[metricName] = contribution * weight;
    weightedSum += contribution * weight;
    totalWeight += weight;
  }

  const ratingDistance = average([
    Math.abs(normalizeRating(ratings.e) - normalizeRating(persona.ratingTargets.e)),
    Math.abs(normalizeRating(ratings.m) - normalizeRating(persona.ratingTargets.m)),
    Math.abs(normalizeRating(ratings.c) - normalizeRating(persona.ratingTargets.c)),
  ]);

  const metricScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  const score = clamp01(metricScore * 0.82 + (1 - ratingDistance) * 0.18);
  return { score, breakdown };
}

// ---------------------------------------------------------------------------
// Metadata bonus scoring for hybrid personas
// ---------------------------------------------------------------------------

/**
 * Metadata bonus for the four hybrid personas.
 *
 * ## Content, not presence
 *
 * `composer` and `category` used to contribute a flat amount for merely BEING there.
 * On HVSC both resolve for essentially every track — composer from the SID header or
 * from the `MUSICIANS/<letter>/<name>/` path, category from the top-level directory —
 * so the bonus was a constant added to every score, which changes no ranking at all.
 *
 * That is not a small effect. Measured over 87,868 tracks, `era_explorer`'s score took
 * **14 distinct values** with presence-based metadata supplied, because all five of its
 * metric directions are 0 and its only other input was two constants. 16% of the corpus
 * fell inside a single tie at a 20% cut, so its station membership was decided by a
 * tie-break rather than by anything about the music. `composer_focus` was unmoved by
 * metadata entirely: 30 distinct scores with it and 30 without.
 *
 * Each field now contributes its CONTENT when the caller supplies the corpus-relative
 * context needed to compute it, and falls back to the old presence behaviour when it
 * does not. Callers without a corpus — a single-track scoring request from the web API,
 * say — keep working and keep their previous ordering.
 *
 * The per-field budgets are unchanged, so the 0.85/0.15 audio/metadata blend is
 * untouched and this cannot shift a hybrid's score further than the old code could.
 * What changes is that the movement within that budget now means something.
 *
 * `category` stays presence-based, alone among the four. Its budget is 0.02 and there
 * is no principled ordering of DEMOS, GAMES and MUSICIANS; ranking them would be noise
 * dressed as signal, which is the defect this function is being repaired for.
 */
/**
 * Relative influence of each metadata field within a persona's own signal budget.
 *
 * `category` is absent, and its absence is the point. It resolves for 100% of HVSC --
 * it is just the top-level directory -- and there is no principled ordering of DEMOS,
 * GAMES and MUSICIANS, so it can only ever contribute a constant. A constant cannot
 * rank anything, and pretending otherwise is the defect this function was repaired for.
 * It stays in the personas' `primaryMetadataFields` because it is genuinely used for
 * diversity rules downstream; it just does not score.
 */
const METADATA_FIELD_BUDGETS = {
  composer: 0.05,
  year: 0.04,
  titleThemeTags: 0.10,
  rarity: 0.10,
} as const;

/**
 * How well a track scores on the metadata that is ACTUALLY AVAILABLE for it, on [0, 1].
 *
 * Normalised over the budget of the present fields rather than of all declared ones, so
 * a missing field neither helps nor hurts. The alternative -- dividing by the full
 * declared budget -- silently penalises partial metadata: a track with three theme tags
 * but no parseable release year would score 0.47 where a track with no metadata at all
 * falls back to its audio score of 0.58, so supplying real evidence would make it rank
 * WORSE. Measured, and the reason for this shape.
 */
function scoreMetadataAffinity(
  context: PersonaTrackContext,
  persona: PersonaDefinition,
): { affinity: number; available: boolean; breakdown: Record<string, number> } {
  if (!persona.metadataPolicy) {
    return { affinity: 0, available: false, breakdown: {} };
  }

  const breakdown: Record<string, number> = {};
  const fields = persona.metadataPolicy.primaryMetadataFields;
  const metadata = context.metadata;
  let achieved = 0;
  let budget = 0;

  if (fields.includes("composer") && metadata?.composer) {
    // Prominence when the caller measured it; full credit for mere presence when it did
    // not, so a single-track scoring request keeps its previous ordering.
    const value = context.composerProminence == null ? 1 : clamp01(context.composerProminence);
    budget += METADATA_FIELD_BUDGETS.composer;
    achieved += METADATA_FIELD_BUDGETS.composer * value;
    breakdown.composerAffinity = value;
  }

  if (fields.includes("year") && metadata?.year != null) {
    const value = context.yearPosition == null ? 1 : clamp01(context.yearPosition);
    budget += METADATA_FIELD_BUDGETS.year;
    achieved += METADATA_FIELD_BUDGETS.year * value;
    breakdown.yearAffinity = value;
  }

  if (fields.includes("titleThemeTags") && (metadata?.titleThemeTags?.length ?? 0) > 0) {
    // Saturates at four content words: past that a title is descriptive rather than more
    // thematic, and letting it keep climbing would just rank long titles first.
    const value = clamp01((metadata!.titleThemeTags!.length) / 4);
    budget += METADATA_FIELD_BUDGETS.titleThemeTags;
    achieved += METADATA_FIELD_BUDGETS.titleThemeTags * value;
    breakdown.themeTagAffinity = value;
  }

  // Rarity is a top-level context field, not nested in metadata.
  if (fields.includes("rarity") && context.rarity != null) {
    const value = clamp01(context.rarity);
    budget += METADATA_FIELD_BUDGETS.rarity;
    achieved += METADATA_FIELD_BUDGETS.rarity * value;
    breakdown.rarityAffinity = value;
  }

  return {
    affinity: budget > 0 ? clamp01(achieved / budget) : 0,
    available: budget > 0,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a single track for a specific persona.
 * For audio-led personas, uses metric weights + rating affinity.
 * For hybrid personas, adds deterministic metadata bonuses.
 */
export function scoreTrackForPersona(
  context: PersonaTrackContext,
  personaId: PersonaId,
): { score: number; breakdown: Record<string, number> } {
  const persona = PERSONAS[personaId];
  const { score: audioScore, breakdown: audioBreakdown } = scoreAudioPersona(
    context.metrics,
    context.ratings,
    persona,
  );

  if (persona.kind === "audio") {
    return { score: audioScore, breakdown: audioBreakdown };
  }

  const { affinity, available, breakdown: metaBreakdown } = scoreMetadataAffinity(context, persona);

  // No metadata at all: score on audio, with no blend and therefore no handicap.
  //
  // The old code blended an absent bonus in as a zero, which cost every hybrid a flat
  // 15% against personas that carry no bonus at all. In a top-3 race that decided the
  // whole bottom half of the coverage table -- the four metadata-starved personas took
  // the four lowest ranks (33.1%, 13.6%, 0.8%, 0.0%) while every audio-led one cleared
  // 47%. Falling back to the audio score says the honest thing instead: we have no
  // metadata signal for this track, so the audio decides.
  if (!available) {
    return { score: audioScore, breakdown: audioBreakdown };
  }

  const finalScore = clamp01(
    audioScore * (1 - HYBRID_METADATA_WEIGHT) + affinity * HYBRID_METADATA_WEIGHT,
  );

  return {
    score: finalScore,
    breakdown: { ...audioBreakdown, ...metaBreakdown },
  };
}

/**
 * Score a single track for all 9 personas.
 * Returns a map from PersonaId to score.
 */
export function scoreAllPersonas(
  context: PersonaTrackContext,
): Record<PersonaId, number> {
  const result = {} as Record<PersonaId, number>;
  for (const id of PERSONA_IDS) {
    result[id] = scoreTrackForPersona(context, id).score;
  }
  return result;
}

/**
 * Score with fallback hierarchy based on user profile.
 *
 * Fallback levels:
 * 1. Full personalization (profile has global centroid + persona modifier)
 * 2. Partial personalization (profile exists but no persona-specific data)
 * 3. No personalization (profile is null) — base persona score only
 */
export function scoreWithFallback(
  context: PersonaTrackContext,
  personaId: PersonaId,
  profile: PersonaProfile | null,
): number {
  const { score: baseScore } = scoreTrackForPersona(context, personaId);

  if (!profile) {
    return baseScore;
  }

  // Level 2: partial personalization — apply global centroid bias
  let adjustment = 0;
  if (profile.globalTasteCentroid) {
    const centroid = profile.globalTasteCentroid;
    // Compute alignment between track metrics and user's global taste centroid
    let alignment = 0;
    let count = 0;
    for (const key of Object.keys(centroid) as (keyof PersonaMetrics)[]) {
      if (centroid[key] != null) {
        alignment += 1 - Math.abs(context.metrics[key] - centroid[key]);
        count++;
      }
    }
    if (count > 0) {
      // Small nudge toward centroid alignment (max 5% adjustment)
      adjustment += (alignment / count - 0.5) * 0.10;
    }
  }

  // Level 1: full personalization — apply per-persona modifier
  const personaModifier = profile.perPersona[personaId];
  if (personaModifier && personaModifier.trackCount > 0) {
    // Penalize personas with high skip rates (max 3% penalty)
    adjustment -= personaModifier.skipRate * 0.03;
  }

  return clamp01(baseScore + adjustment);
}

/**
 * Apply recency penalty to prevent repeated tracks when switching personas.
 * Uses exponential decay with a 30-minute half-life.
 */
export function applyRecencyPenalty(
  baseScore: number,
  trackId: string,
  sessionHistory: string[],
  halfLifeMinutes?: number,
): number {
  // Simple version: check if trackId is in history (no timestamps needed for basic penalty)
  if (!sessionHistory.includes(trackId)) {
    return baseScore;
  }
  // Track is in session history: apply max penalty (40%) since we don't have timestamps
  // The more sophisticated version with timestamps is in persona-profile.ts
  return baseScore * 0.6;
}

/**
 * Apply recency penalty with timestamp-based exponential decay.
 */
export function applyRecencyPenaltyWithTimestamp(
  baseScore: number,
  trackId: string,
  sessionHistory: Array<{ trackId: string; timestamp: number }>,
  nowMs: number,
  halfLifeMinutes: number = 30,
): number {
  const entry = sessionHistory.find((h) => h.trackId === trackId);
  if (!entry) return baseScore;
  const ageMinutes = (nowMs - entry.timestamp) / 60_000;
  const decay = Math.pow(0.5, ageMinutes / halfLifeMinutes);
  return baseScore * (1 - 0.4 * decay);
}
