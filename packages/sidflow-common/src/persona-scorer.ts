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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function scoreMetadataBonus(
  context: PersonaTrackContext,
  persona: PersonaDefinition,
): { bonus: number; breakdown: Record<string, number> } {
  if (!persona.metadataPolicy) {
    return { bonus: 0, breakdown: {} };
  }

  const breakdown: Record<string, number> = {};
  let totalBonus = 0;

  const fields = persona.metadataPolicy.primaryMetadataFields;
  const metadata = context.metadata;

  if (metadata) {
    if (fields.includes("composer") && metadata.composer) {
      breakdown.composerPresence = 0.05;
      totalBonus += 0.05;
    }

    if (fields.includes("year") && metadata.year != null) {
      const yearBonus = 0.04;
      breakdown.yearPresence = yearBonus;
      totalBonus += yearBonus;
    }

    if (fields.includes("category") && metadata.category) {
      breakdown.categoryPresence = 0.02;
      totalBonus += 0.02;
    }

    if (fields.includes("titleThemeTags") && metadata.titleThemeTags) {
      const tagCount = metadata.titleThemeTags.length;
      if (tagCount > 0) {
        const themeBonus = Math.min(tagCount * 0.03, 0.10);
        breakdown.themeTagBonus = themeBonus;
        totalBonus += themeBonus;
      }
    }
  }

  // Rarity is a top-level context field, not nested in metadata
  if (fields.includes("rarity") && context.rarity != null) {
    const rarityBonus = context.rarity * 0.10;
    breakdown.rarityBonus = rarityBonus;
    totalBonus += rarityBonus;
  }

  return { bonus: clamp01(totalBonus), breakdown };
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

  // Hybrid: blend audio score with metadata bonus
  const { bonus, breakdown: metaBreakdown } = scoreMetadataBonus(context, persona);
  const finalScore = clamp01(audioScore * 0.85 + bonus * 0.15);

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
